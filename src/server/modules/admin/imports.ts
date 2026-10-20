import { ORPCError } from '@orpc/client'
import { parse } from 'yaml'
import type * as z from 'zod/mini'
import type { ItemImportReport, itemImportSchema } from '../../../contract/admin.ts'
import type { ProposalRecord } from '../../../contract/proposals.ts'
import type { FormatFinding } from '../../../domain/draft.ts'
import { ITEM_IMPORT_MAX_PROPOSALS, readItemFile } from '../../../domain/item-file.ts'
import { type ItemVersion, itemVersionDigests } from '../../../domain/item-version.ts'
import type { Queryable } from '../../db/database.ts'
import { type ProposalsService, readVersion } from '../proposals/index.ts'
import { recordAudit } from './audit.ts'

type Entry = ItemImportReport['entries'][number]

export interface ImportServices {
  proposals: ProposalsService
  /** Submits a proposal the way the form does, review checks included. */
  submit(id: string, revision: number): Promise<ProposalRecord>
}

/**
 * Who imports and how are not content: the same text imported again is unchanged. A live
 * version that no longer passes the item format (seeded demo data) never equals an entry.
 */
async function sameContent(live: ItemVersion, entry: ItemVersion) {
  const neutral = { proposerId: 'import', createdVia: 'import' as const }
  try {
    const [x, y] = await Promise.all([
      itemVersionDigests({ ...live, ...neutral }),
      itemVersionDigests({ ...entry, ...neutral }),
    ])
    return x.content === y.content
  } catch {
    return false
  }
}

async function liveVersion(tx: Queryable, itemId: string) {
  const [row] = await tx.query<{ id: string }>(
    `select s.version_id::text as id from item_version_service s
     where s.item_id=$1 and s.editions @> (select seq from live_edition)`,
    [itemId],
  )
  return row ? ((await readVersion(tx, row.id))?.version ?? null) : null
}

const counted = (entries: Entry[], error: string | null = null): ItemImportReport => ({
  applied: false,
  batchId: null,
  error,
  entries,
  counts: {
    create: entries.filter((e) => e.action === 'create').length,
    change: entries.filter((e) => e.action === 'change').length,
    unchanged: entries.filter((e) => e.action === 'unchanged').length,
    errors: entries.filter((e) => e.findings.some((f) => f.severity === 'error')).length,
  },
})

/**
 * FR-120: an item file becomes proposals through the one write interface, never accepted items.
 * Every entry gets the level 1 checks the form's create runs, mentions included. A dry run
 * changes nothing; an apply makes the proposals only when no entry has an error, all in one
 * transaction, in one import batch, and submits them for review unless asked to keep drafts.
 */
export async function importItems(
  tx: Queryable,
  services: ImportServices,
  input: z.infer<typeof itemImportSchema>,
): Promise<ItemImportReport> {
  let document: unknown
  try {
    document = parse(input.content, { maxAliasCount: 0 })
  } catch {
    return counted([], 'The file is neither YAML nor JSON')
  }
  const file = readItemFile(document)
  if (file.error) return counted([], file.error)

  const entries: Entry[] = []
  const plan: { entry: Entry; draft: NonNullable<(typeof file.entries)[number]['draft']> }[] = []
  const seen = new Set<string>()
  for (const read of file.entries) {
    const findings: FormatFinding[] = [...read.findings]
    const entry: Entry = {
      index: read.index,
      itemId: read.itemId,
      title: read.draft?.title ?? null,
      action: read.itemId ? 'change' : 'create',
      proposalId: null,
      findings,
    }
    entries.push(entry)
    if (read.itemId) {
      if (seen.has(read.itemId))
        findings.push({
          code: 'duplicate_item',
          field: 'id',
          message: 'This fact is in the file twice. Keep one of them.',
          severity: 'error',
        })
      seen.add(read.itemId)
    }
    if (!read.draft || findings.some((f) => f.severity === 'error')) continue
    let prepared
    try {
      prepared = await services.proposals.prepare({
        draft: read.draft,
        ...(read.itemId ? { itemId: read.itemId } : {}),
        channel: 'import',
      })
    } catch (error) {
      if (!(error instanceof ORPCError)) throw error
      findings.push({
        code: error.code === 'NOT_FOUND' ? 'unknown_item' : 'format',
        field: error.code === 'NOT_FOUND' ? 'id' : 'areaId',
        message:
          error.code === 'NOT_FOUND'
            ? "We couldn't find an accepted fact with this id."
            : error.message,
        severity: 'error',
      })
      continue
    }
    entry.title = prepared.draft.title ?? null
    // Nothing is proposed for an entry equal to its live version, so its checks do not apply:
    // an exported edition reads back unchanged even where a live item mentions a retired one.
    if (read.itemId && prepared.checks.version) {
      const live = await liveVersion(tx, read.itemId)
      if (live && (await sameContent(live, prepared.checks.version))) {
        entry.action = 'unchanged'
        continue
      }
    }
    for (const found of prepared.checks.findings)
      if (
        !findings.some(
          (f) => f.code === found.code && f.field === found.field && f.message === found.message,
        )
      )
        findings.push(found)
    if (findings.some((f) => f.severity === 'error')) continue
    plan.push({ entry, draft: read.draft })
  }

  const report = counted(
    entries,
    plan.length > ITEM_IMPORT_MAX_PROPOSALS
      ? `An import makes at most ${ITEM_IMPORT_MAX_PROPOSALS} proposals; this file would make ${plan.length}. Split it.`
      : null,
  )
  if (input.dryRun || report.counts.errors || report.error) return report

  const summary = { ...report.counts, submitted: input.submit }
  const [batch] = await tx.query<{ id: string }>(
    `insert into import_batches(created_by,mode,source_name,state,summary)
     values(cl_person(),'apply',$1,'done',$2) returning id::text`,
    [input.sourceName ?? null, JSON.stringify(summary)],
  )
  for (const { entry, draft } of plan) {
    const created = await services.proposals.create(
      { draft, ...(entry.itemId ? { itemId: entry.itemId } : {}), channel: 'import' },
      { importBatchId: batch!.id },
    )
    const proposal = input.submit ? await services.submit(created.id, created.revision) : created
    entry.proposalId = proposal.id
    entry.itemId = proposal.itemId
  }
  await recordAudit(tx, {
    action: 'import.applied',
    subjectType: 'import_batch',
    subjectId: batch!.id,
    details: { sourceName: input.sourceName ?? null, ...summary },
  })
  return { ...report, applied: true, batchId: batch!.id }
}
