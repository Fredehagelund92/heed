import { ORPCError } from '@orpc/client'
import type { ProposalRecord } from '../../../contract/proposals.ts'
import { previewVersion } from '../../../domain/draft.ts'
import { previewItemId } from '../../../domain/served-review.ts'
import type { ItemVersion } from '../../../domain/item-version.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { createToolService } from '../../mcp/service.ts'
import {
  DEFAULT_MCP_RATES,
  loadServingBundle,
  type RawLink,
  type ServingBundle,
  type ServingItem,
} from '../editions/index.ts'

type Head = { seq: string; label: string; overlay: string }

/**
 * The live edition with a draft in it: what agents would be served if the draft were accepted,
 * and the draft's item. The request transaction authorizes the proposal before assembling this
 * private bundle. `load` reads the live edition's bundle; a caller may pass a cached one.
 */
export async function draftBundle(
  tx: Queryable,
  p: ProposalRecord,
  load: (head: Head) => Promise<ServingBundle> = (head) => loadServingBundle(tx, head),
): Promise<{ bundle: ServingBundle; item: string }> {
  if (p.subject !== 'item' || !['create', 'change'].includes(p.action))
    throw new ORPCError('NOT_FOUND')
  const checked = previewVersion(p.draft, p.proposerId, p.channel)
  if (!checked.version)
    throw new ORPCError('UNPROCESSABLE_CONTENT', {
      message: 'Complete the draft to see what agents will get.',
      data: { findings: checked.findings },
    })
  const [head] = await tx.query<Head>(
    `select e.seq::text,e.label,coalesce((select seq::text from serving_overlay),'0') as overlay from editions e join live_edition l on l.seq=e.seq`,
  )
  if (!head)
    throw new ORPCError('PRECONDITION_FAILED', {
      message: "Nothing is shared with agents yet, so there's nothing to compare it with.",
    })
  const bundle = await load(head)
  const v = checked.version
  const id = previewItemId(p)
  const [submittedVersion] = p.itemVersionId
    ? await tx.query<{ version_no: number }>('select version_no from item_versions where id=$1', [
        p.itemVersionId,
      ])
    : []
  const versionNo =
    submittedVersion && !['draft', 'changes_requested'].includes(p.state)
      ? submittedVersion.version_no
      : (submittedVersion?.version_no ?? bundle.items.find((i) => i.id === id)?.version ?? 0) + 1
  return {
    bundle: candidateBundle(bundle, { id, versionNo, proposerId: p.proposerId, version: v }),
    item: id,
  }
}

/**
 * The bundle an agent would be served if this version were accepted: the version replaces the
 * item's live version, and the items it replaces are retired and name it (FR-219).
 */
export function candidateBundle(
  bundle: ServingBundle,
  candidate: { id: string; versionNo: number; proposerId: string | null; version: ItemVersion },
): ServingBundle {
  const { id, version: v } = candidate
  const item: ServingItem = {
    id,
    version: candidate.versionNo,
    areaId: v.areaId,
    scope: v.scope,
    validity: v.validity,
    reviewDate: v.reviewDate,
    riskLevel: v.riskLevel,
    checkFlag: null,
    status: 'accepted',
    proposerId: candidate.proposerId,
    conflicts: v.conflicts,
    audience: v.audience,
    summary: v.summary,
    ...(v.body === undefined ? {} : { body: v.body }),
    kind: v.kind,
    title: v.title,
    claim: v.claimLevel,
    evidence: v.evidence.map((e) => ({ url: e.url, quote: e.quote, read_on: e.date })),
    notToConclude: v.notToConclude,
    owner: { team: bundle.areas.find((a) => a.id === v.areaId)?.team ?? null },
    // Not accepted yet: an agent gets it only once an owner accepts it, and then says so.
    review: null,
  }
  const links: RawLink[] = v.mentions.map((m) => ({
    from_item: id,
    rel: 'mentions',
    to_kind: m.target.startsWith('item:')
      ? 'item'
      : m.target.startsWith('area:')
        ? 'area'
        : m.target.startsWith('term:')
          ? 'term'
          : m.target.startsWith('val:')
            ? 'dimension_value'
            : m.target.startsWith('dim:')
              ? 'dimension'
              : 'metric',
    to_id: /^(item|area):/.test(m.target) ? m.target.slice(5) : m.target,
    label: m.label,
  }))
  links.push(
    ...v.scope.metrics.map((key) => ({
      from_item: id,
      rel: 'applies_to',
      to_kind: 'metric',
      to_id: key,
      label: null,
    })),
    ...v.replaces.map((target) => ({
      from_item: id,
      rel: 'replaces',
      to_kind: 'item',
      to_id: target,
      label: null,
    })),
    ...v.conflicts.map((target) => ({
      from_item: id,
      rel: 'conflicts_with',
      to_kind: 'item',
      to_id: target,
      label: null,
    })),
    ...v.scope.dimensionValues.map((value) => ({
      from_item: id,
      rel: 'applies_to',
      to_kind: 'dimension_value',
      to_id: value.value,
      label: null,
    })),
    ...v.scope.dimensions.map((key) => ({
      from_item: id,
      rel: 'applies_to',
      to_kind: 'dimension',
      to_id: key,
      label: null,
    })),
  )
  return {
    ...bundle,
    refMarks: { ...bundle.refMarks, [id]: v.changeMarks },
    retired: [
      ...bundle.retired,
      ...bundle.items
        .filter((i) => v.replaces.includes(i.id))
        .map((i) => ({
          id: i.id,
          areaId: i.areaId,
          audience: i.audience.kind === 'everyone' ? null : i.audience.groups,
          validity: i.validity,
          replacedBy: id,
        })),
    ],
    items: [...bundle.items.filter((i) => i.id !== id && !v.replaces.includes(i.id)), item],
    links: [...bundle.links.filter((l) => l.from_item !== id), ...links],
  }
}

/**
 * Runs get_facts on a private bundle with the live reply's code, recording nothing (FR-108), or
 * get_context, the agent contract's tool, for the golden set's L1 pass. `web` is the web app's
 * address for the items' pages (FR-347); without it they are paths.
 */
export function previewDelivery(
  bundle: ServingBundle,
  clock: Clock,
  input: unknown,
  web: string | null = null,
  tool: 'get_facts' | 'get_context' = 'get_facts',
) {
  const noWrite = (): Promise<never> => Promise.reject(new Error('Preview cannot record demand'))
  const execute = createToolService(
    {
      bundle: () => Promise.resolve(bundle),
      // A check report never carries About our business: it is background, not evidence.
      policy: () =>
        Promise.resolve({
          client: null,
          tools: [],
          limits: {},
          rates: DEFAULT_MCP_RATES,
          about: '',
        }),
    },
    { write: noWrite, reportGap: noWrite, feedback: noWrite },
    () => new Date(clock.today() + 'T12:00:00Z'),
    undefined,
    web,
  )
  return execute(
    tool,
    input,
    { client: 'proposal-preview', scopes: ['read'], caller: 'eval', canSelectEdition: false },
    100000,
    () => {},
  )
}
