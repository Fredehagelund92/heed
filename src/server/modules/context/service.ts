import { ORPCError } from '@orpc/client'
import type {
  DeletedDraft,
  DraftFromText,
  ItemBulkInput,
  ItemBulkResult,
  ItemChange,
  ItemPage,
  ItemVersionEntry,
  PublishItemResult,
  RelatedContext,
} from '../../../contract/context.ts'
import { deriveAgentDraft } from '../../../domain/agent-draft.ts'
import {
  changeAction,
  changeSummary,
  planBulk,
  type BulkInput,
  type BulkPerson,
  type BulkRow,
  type BulkRowSkip,
} from '../../../domain/context-bulk.ts'
import type { Draft } from '../../../domain/draft.ts'
import type { ItemVersion } from '../../../domain/item-version.ts'
import { termDomain } from '../../../domain/catalogue.ts'
import { conflictPairs } from '../../../domain/conflicts.ts'
import { related } from '../../../domain/links.ts'
import type { ClashRelation } from '../../../domain/readiness.ts'
import { kinds, type Kind } from '../../../domain/words.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { liveServingBundle, type BundleCache } from '../answer/index.ts'
import { enabledTools } from '../editions/index.ts'
import type { LibraryService } from '../library/index.ts'
import { draftVocabulary } from '../../mcp/draft-tool.ts'
import { proposalEvent, readVersions, type ProposalsService } from '../proposals/index.ts'
import { draftOf, type ReviewPath, type ReviewService } from '../review/index.ts'
import { readableAddress, type PageReader } from '../web/index.ts'

/**
 * Context for people (docs/product.md, section 3): a context item's page and its history, the
 * items a person opened, changes to many items at once (FR-139), restoring a version as a draft
 * (FR-140), related context, publishing in one step as an owner (FR-137), a draft from pasted
 * text or a link, and the drafts that were deleted.
 *
 * Every change goes through the paths that already guard it: an archive is a retire decision, a
 * move or a new kind is a change its owner publishes, a check is a recheck, a deletion discards a
 * draft. A change to many items records one item_changes row, and its Undo takes back exactly
 * what it did, within limits.undo_seconds, by its maker only.
 */
export type ContextDeps = {
  library: LibraryService
  proposals: ProposalsService
  review: ReviewService
  path: ReviewPath
  readPage?: PageReader | undefined
}

/** The words a change records as its reason, where the rules ask for one. */
const reasons = {
  archive: 'Archived from the Context list.',
  check: 'Checked from the Context list: still true.',
  restored: (version: number) => `Restored from version ${version}.`,
}

const kindName = (kind: string) => (kind in kinds ? kinds[kind as Kind].label : 'Example')
const isItemId = (id: string) => /^itm_[a-z0-9]{8,16}$/.test(id)
const plainError = (error: unknown) =>
  error instanceof ORPCError ? error.message : "It couldn't be changed."

/** What Undo of a change needs, kept with it. */
type UndoRecord = {
  /** Decisions it made: archives, publishes of a move or a kind, checks. */
  decisions?: string[]
  /** Drafts it deleted. */
  drafts?: string[]
  /** The owners each item had before, by item. */
  owners?: Record<string, string[]>
}

export function createContextService(
  tx: Queryable,
  clock: Clock,
  cache: BundleCache,
  { library, proposals, review, path, readPage }: ContextDeps,
) {
  async function person(id: string | null): Promise<BulkPerson | null> {
    const [row] = await tx.query<BulkPerson>(
      `select p.id::text, p.display_name as name, cl_is_admin(p.id, now()) as admin,
              coalesce((select array_agg(a.area_id order by a.area_id) from area_assignments a
                         where a.person_id = p.id and a.role = 'owner' and a.valid_at @> now()), '{}') as owns
         from people p
        where p.id = coalesce($1::uuid, cl_person()) and p.deactivated_at is null and p.erased_at is null`,
      [id],
    )
    return row ?? null
  }
  async function me(): Promise<BulkPerson> {
    const found = await person(null)
    if (!found) throw new ORPCError('UNAUTHORIZED')
    return found
  }
  async function domainNames(): Promise<(id: string) => string> {
    const rows = await tx.query<{ id: string; name: string }>('select id, name from areas')
    const names = new Map(rows.map((r) => [r.id, r.name]))
    return (id) => names.get(id) ?? id
  }
  async function domainOwners(areaId: string): Promise<string[]> {
    const rows = await tx.query<{ id: string }>(
      `select a.person_id::text as id from area_assignments a join people p on p.id = a.person_id
        where a.area_id = $1 and a.role = 'owner' and a.valid_at @> now()
          and p.deactivated_at is null and p.erased_at is null
        order by a.person_id`,
      [areaId],
    )
    return rows.map((r) => r.id)
  }

  /**
   * The rows of a change, as the rule reads them, in the order asked: published items the person
   * may read, and drafts row security lets them see. A row that is neither is not found.
   */
  async function rowsOf(ids: readonly string[]): Promise<{ rows: BulkRow[]; missing: string[] }> {
    const itemIds = ids.filter(isItemId)
    const draftIds = ids.filter((id) => !isItemId(id))
    const items = await tx.query<Omit<BulkRow, 'owners'> & { own: string[] }>(
      `select i.id, i.title, i.kind::text as kind, i.area_id as "areaId",
              case when i.status = 'accepted' then 'live' else 'archived' end as status,
              coalesce((select array_agg(o.person_id::text order by o.person_id) from item_owners o
                         where o.item_id = i.id), '{}') as own
         from v_item_list i
        where i.id = any($1::text[]) and cl_audience_allows(i.audience_groups)`,
      [itemIds],
    )
    const drafts = await tx.query<Omit<BulkRow, 'owners'>>(
      `select p.id::text, coalesce(nullif(p.draft->>'title', ''), 'Untitled draft') as title,
              coalesce(p.draft->>'kind', 'note') as kind, p.area_id as "areaId", 'draft' as status
         from proposals p
        where p.id = any($1::uuid[]) and p.subject = 'item' and p.state = 'draft'
          and p.discarded_at is null and p.area_id is not null`,
      [draftIds],
    )
    const owners = new Map<string, string[]>()
    for (const area of new Set([...items, ...drafts].map((r) => r.areaId)))
      owners.set(area, await domainOwners(area))
    const byId = new Map<string, BulkRow>([
      ...items.map(({ own, ...row }): [string, BulkRow] => [
        row.id,
        { ...row, owners: own.length ? own : (owners.get(row.areaId) ?? []) },
      ]),
      ...drafts.map((row): [string, BulkRow] => [
        row.id,
        { ...row, owners: owners.get(row.areaId) ?? [] },
      ]),
    ])
    const rows: BulkRow[] = []
    const missing: string[] = []
    for (const id of new Set(ids)) {
      const row = byId.get(id)
      if (row) rows.push(row)
      else missing.push(id)
    }
    return { rows, missing }
  }

  async function opened(ids: readonly string[]): Promise<Set<string>> {
    const rows = await tx.query<{ id: string }>(
      'select item_id as id from item_reads where person_id = cl_person() and item_id = any($1::text[])',
      [ids],
    )
    return new Set(rows.map((r) => r.id))
  }

  /** The input as the rule reads it, refused when it names what does not exist or may not be used. */
  async function inputOf(input: ItemBulkInput, mine: BulkPerson): Promise<BulkInput> {
    const read: BulkInput = { action: input.action }
    if (input.action === 'domain') {
      if (!input.areaId)
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message: 'Choose a domain to move them to.',
        })
      const [area] = await tx.query<{ name: string }>(
        'select name from areas where id = $1 and archived_at is null',
        [input.areaId],
      )
      if (!area)
        throw new ORPCError('UNPROCESSABLE_CONTENT', { message: 'Choose a domain that exists.' })
      if (!mine.admin && !mine.owns.includes(input.areaId))
        throw new ORPCError('FORBIDDEN', {
          message: `Only owners of ${area.name} and admins can move context into it.`,
        })
      read.areaId = input.areaId
    }
    if (input.action === 'kind') {
      if (!input.kind)
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message: 'Choose the kind to change them to.',
        })
      read.kind = input.kind
    }
    if (input.action === 'owner_add' || input.action === 'owner_set') {
      const owner = input.personId ? await person(input.personId) : null
      if (!owner)
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message: 'Choose someone in the workspace.',
        })
      read.person = owner
    }
    return read
  }

  const notFound = (id: string): BulkRowSkip => ({
    id,
    title: '',
    code: 'not_found',
    why: 'not found',
    message: "You can't see it any more.",
  })

  async function plan(input: ItemBulkInput) {
    const mine = await me()
    const read = await inputOf(input, mine)
    const { rows, missing } = await rowsOf(input.rows)
    const names = await domainNames()
    const result = planBulk(rows, read, mine, {
      opened: await opened(rows.map((r) => r.id)),
      domainName: names,
    })
    return {
      mine,
      read,
      names,
      act: result.act,
      skipped: [...missing.map(notFound), ...result.skipped],
    }
  }

  /**
   * Publishes a change to a live item as its owner in one step: a change made from the live
   * version with `patch`, submitted, checked and published. Returns the decision it made.
   */
  async function publishChange(itemId: string, patch: Draft): Promise<string> {
    const created = await proposals.create({ itemId, draft: patch })
    const submitted = await proposals.submit(created.id, created.revision)
    await review.checkSubmitted(submitted.id)
    const current = await proposals.get(submitted.id)
    const published = await path.publish({ id: current.id, revision: current.revision })
    return published.undo.slice('decision:'.length)
  }

  async function lastDecision(itemId: string, outcome: 'retire' | 'accept'): Promise<string> {
    const [row] = await tx.query<{ id: string }>(
      `select d.id::text from decisions d join item_versions v on v.id = d.item_version_id
        where v.item_id = $1 and d.decided_by = cl_person() and d.outcome::text = $2
        order by d.decided_at desc, d.id desc limit 1`,
      [itemId, outcome],
    )
    if (!row) throw new Error('The decision was not recorded')
    return row.id
  }

  async function ownersBefore(itemId: string): Promise<string[]> {
    const rows = await tx.query<{ id: string }>(
      'select person_id::text as id from item_owners where item_id = $1 order by person_id',
      [itemId],
    )
    return rows.map((r) => r.id)
  }

  async function setOwners(itemId: string, owners: readonly string[]) {
    await tx.query('delete from item_owners where item_id = $1', [itemId])
    for (const owner of owners)
      await tx.query(
        'insert into item_owners (item_id, person_id, added_by) values ($1, $2, cl_person())',
        [itemId, owner],
      )
  }

  /** One row of a change, done in full or not at all; what Undo needs goes into `undo`. */
  async function applyRow(row: BulkRow, read: BulkInput, mine: BulkPerson, undo: UndoRecord) {
    switch (read.action) {
      case 'archive':
        await review.retire(row.id, reasons.archive)
        ;(undo.decisions ??= []).push(await lastDecision(row.id, 'retire'))
        return
      case 'delete': {
        const [draft] = await tx.query<{ revision: number }>(
          'select revision from proposals where id = $1',
          [row.id],
        )
        await proposals.discard(row.id, draft!.revision, { byDomainOwners: true })
        ;(undo.drafts ??= []).push(row.id)
        return
      }
      case 'domain': {
        const to = read.areaId!
        const before = await ownersBefore(row.id)
        const fits = await tx.query<{ id: string }>(
          `select person_id::text as id from unnest($1::uuid[]) as o(person_id)
            where cl_is_admin(person_id, now()) or cl_has_area_role(person_id, $2, 'owner', now())`,
          [before, to],
        )
        const owner = mine.owns.includes(to) ? mine.id : (await domainOwners(to))[0]
        ;(undo.decisions ??= []).push(
          await publishChange(row.id, { areaId: to, ...(owner ? { ownerId: owner } : {}) }),
        )
        // Its own owners go with it only where they own the new domain too.
        const kept = fits.map((f) => f.id)
        if (kept.length !== before.length) {
          ;(undo.owners ??= {})[row.id] = before
          await setOwners(row.id, kept)
        }
        return
      }
      case 'kind':
        ;(undo.decisions ??= []).push(await publishChange(row.id, { kind: read.kind! }))
        return
      case 'owner_add':
      case 'owner_set': {
        const before = await ownersBefore(row.id)
        ;(undo.owners ??= {})[row.id] = before
        const who = read.person!.id
        // Adding to a domain's owners names them too, so the item keeps everyone who answered for it.
        const start = before.length ? before : row.owners.filter((o) => o !== who)
        await setOwners(row.id, read.action === 'owner_set' ? [who] : [...start, who])
        return
      }
      case 'check': {
        const checked = await review.recheck(row.id, reasons.check, { v1: true })
        const [decision] = await tx.query<{ id: string }>(
          `select id::text from decisions where proposal_id = $1 order by decided_at desc, id desc limit 1`,
          [checked.proposal.id],
        )
        ;(undo.decisions ??= []).push(decision!.id)
        return
      }
    }
  }

  async function bulkApply(input: ItemBulkInput): Promise<ItemBulkResult> {
    const { mine, read, names, act, skipped } = await plan(input)
    const done: BulkRow[] = []
    const failed: ItemBulkResult['failed'] = []
    const undo: UndoRecord = {}
    for (const row of act) {
      await tx.query('savepoint item_change')
      // What Undo needs for this row joins the change's only once the row is done.
      const own: UndoRecord = {}
      try {
        await applyRow(row, read, mine, own)
        await tx.query('release savepoint item_change')
        done.push(row)
        undo.decisions = [...(undo.decisions ?? []), ...(own.decisions ?? [])]
        undo.drafts = [...(undo.drafts ?? []), ...(own.drafts ?? [])]
        undo.owners = { ...undo.owners, ...own.owners }
      } catch (error) {
        await tx.query('rollback to savepoint item_change')
        failed.push({ id: row.id, title: row.title, message: plainError(error) })
      }
    }
    if (!done.length) return { done: [], skipped, failed, change: null, undo: null }
    const summary = changeSummary(
      read,
      done.map((r) => r.title),
      names,
    )
    const [change] = await tx.query<{ id: string }>(
      `insert into item_changes (action, made_by, summary, items, undo)
       values ($1, cl_person(), $2, $3, $4) returning id::text`,
      [
        changeAction[read.action],
        summary,
        JSON.stringify(done.map((r) => ({ id: r.id, title: r.title, areaId: r.areaId }))),
        JSON.stringify(undo),
      ],
    )
    return {
      done: done.map((r) => r.id),
      skipped,
      failed,
      change: { id: change!.id, summary },
      undo: `change:${change!.id}`,
    }
  }

  /**
   * Takes back one change to many items, by its maker within the window: its decisions are undone
   * in one edition, its drafts come back, and each item's owners are what they were.
   */
  async function undoChange(id: string): Promise<{ edition: string | null }> {
    const [change] = await tx.query<{ undo: UndoRecord; mine: boolean; undone: boolean }>(
      `select undo, made_by = cl_person() as mine, undone_at is not null as undone
         from item_changes where id = $1::uuid`,
      [id],
    )
    if (!change) throw new ORPCError('NOT_FOUND')
    if (!change.mine)
      throw new ORPCError('FORBIDDEN', {
        message: 'Only the person who made the change can undo it.',
      })
    if (change.undone)
      throw new ORPCError('CONFLICT', { message: 'This change is already undone.' })
    const [marked] = await tx.query<{ id: string }>(
      'update item_changes set undone_at = now() where id = $1::uuid returning id::text',
      [id],
    )
    if (!marked)
      throw new ORPCError('CONFLICT', {
        message: 'It is too late to undo this change. Change them again instead.',
      })
    const { decisions = [], drafts = [], owners = {} } = change.undo
    // The decisions first: a move undone puts each item back in its domain, where its owners were.
    const undone = decisions.length ? await path.undoDecisions(decisions) : { edition: null }
    for (const [itemId, before] of Object.entries(owners)) await setOwners(itemId, before)
    for (const draft of drafts) {
      const [back] = await tx.query<Parameters<typeof proposalEvent>[1]>(
        `update proposals set discarded_at = null where id = $1
         returning id::text, area_id as "areaId", state::text as state, revision`,
        [draft],
      )
      if (back) await proposalEvent(tx, back, 'restored', { change: id })
    }
    return undone
  }

  async function markRead(id: string) {
    if (!(await library.getIndexRow(id))) throw new ORPCError('NOT_FOUND')
    await tx.query(
      `insert into item_reads (person_id, item_id) values (cl_person(), $1)
       on conflict (person_id, item_id) do update set read_at = now()`,
      [id],
    )
    return { read: true }
  }

  /** What one version changed against the one before it, as History says it. */
  function entryOf(
    before: ItemVersion | null,
    after: ItemVersion,
    recheck: boolean,
    names: (id: string) => string,
  ): Pick<ItemVersionEntry, 'kind' | 'field' | 'before' | 'after'> {
    const none = { field: '', before: '', after: '' }
    if (!before) return { kind: 'published', ...none }
    if (recheck) return { kind: 'checked', ...none }
    if (before.areaId !== after.areaId)
      return {
        kind: 'moved',
        field: 'Domain',
        before: names(before.areaId),
        after: names(after.areaId),
      }
    if (before.kind !== after.kind)
      return {
        kind: 'retyped',
        field: 'Kind',
        before: kindName(before.kind),
        after: kindName(after.kind),
      }
    if (before.title !== after.title)
      return { kind: 'wording', field: 'Title', before: before.title, after: after.title }
    const text = (v: ItemVersion) => [v.summary, v.body ?? ''].filter(Boolean).join('\n\n')
    if (text(before) !== text(after))
      return { kind: 'wording', field: 'Text', before: text(before), after: text(after) }
    const dates = (v: ItemVersion) => `${v.validity.start} to ${v.validity.end ?? 'no end'}`
    if (dates(before) !== dates(after))
      return { kind: 'dates', field: 'When', before: dates(before), after: dates(after) }
    const source = (v: ItemVersion) => v.evidence.map((e) => e.url).join('\n')
    if (source(before) !== source(after))
      return { kind: 'link', field: 'Source', before: source(before), after: source(after) }
    // A version that only set or removed the Conflict flag says so, not a wording change.
    const flags = (v: ItemVersion) => [...v.conflicts].sort().join('\n')
    if (flags(before) !== flags(after))
      return {
        kind: 'conflict',
        field: 'Disagrees with',
        before: flags(before),
        after: flags(after),
      }
    return {
      kind: 'wording',
      field: "Don't conclude",
      before: before.notToConclude,
      after: after.notToConclude,
    }
  }

  /** An item's history, newest first: each version agents got, its archives and owner changes. */
  async function historyOf(itemId: string): Promise<ItemVersionEntry[]> {
    const day = (at: string) => `to_char(${at} at time zone 'UTC', 'YYYY-MM-DD')`
    const served = await tx.query<{
      id: string
      recheck: boolean
      by: string | null
      at: string
      agent: { name: string; personId: string } | null
    }>(
      `select v.id::text, v.is_recheck as recheck,
              (select d.decided_by::text from decisions d where d.item_version_id = v.id
                  and d.outcome = 'accept' order by d.decided_at, d.id limit 1) as by,
              (select jsonb_build_object('name', p.agent_name, 'personId', p.proposer_id::text)
                 from proposals p where p.item_version_id = v.id and p.agent_name is not null
                order by p.created_at limit 1) as agent,
              coalesce((select min(e.created_at) from item_version_service s
                          join editions e on e.seq = lower(s.editions) where s.version_id = v.id),
                       v.created_at)::text as at
         from item_versions v
        where v.item_id = $1 and exists (select 1 from item_version_service s where s.version_id = v.id)
        order by v.version_no`,
      [itemId],
    )
    const contents = new Map(
      (
        await readVersions(
          tx,
          served.map((s) => s.id),
        )
      ).map((v) => [v.id, v]),
    )
    const names = await domainNames()
    const dated: (ItemVersionEntry & { at: string })[] = []
    let previous: ItemVersion | null = null
    for (const s of served) {
      const stored = contents.get(s.id)
      if (!stored) continue
      const entry = entryOf(previous, stored.version, s.recheck, names)
      dated.push({
        version: stored.versionNo,
        personId: s.by,
        on: s.at.slice(0, 10),
        at: s.at,
        ...entry,
        restorable: ['published', 'wording', 'link', 'dates'].includes(entry.kind),
        ...(s.agent ? { agent: s.agent } : {}),
      })
      previous = stored.version
    }
    const others = await tx.query<{
      kind: 'archived' | 'owners' | 'conflict'
      by: string
      on: string
      at: string
      summary: string
    }>(
      `select 'archived' as kind, d.decided_by::text as by, ${day('d.decided_at')} as on,
              d.decided_at::text as at, d.reason as summary
         from decisions d join item_versions v on v.id = d.item_version_id
        where v.item_id = $1 and d.outcome = 'retire'
          and not exists (select 1 from decision_undos u where u.decision_id = d.id)
       union all
       select 'owners', c.made_by::text, ${day('c.made_at')}, c.made_at::text,
              -- The sentence names a title: an item the reader may not see makes it a count.
              case when not exists (select 1 from jsonb_array_elements(c.items) e
                                     where not cl_item_open(e->>'id')) then c.summary
                   else 'Changed the owners of ' || jsonb_array_length(c.items) || ' items.' end
         from item_changes c
        where c.action = 'owners' and c.undone_at is null
          and c.items @> jsonb_build_array(jsonb_build_object('id', $1::text))
       union all
       -- A conflict settled with a reason is on both items' history (FR-220).
       select 'conflict', k.decided_by::text, ${day('k.decided_at')}, k.decided_at::text,
              case k.outcome when 'kept_one' then 'Settled a conflict: kept one, archived the other. '
                             when 'kept_both' then 'Kept both items of a conflict. '
                             else 'Not a conflict: the flag was removed. ' end
              || 'Reason: ' || k.reason || coalesce(' “' || k.quote || '”', '')
         from conflict_decisions k
        where k.undone_at is null and $1 in (k.holder_item_id, k.other_item_id)`,
      [itemId],
    )
    for (const o of others)
      dated.push({
        version: null,
        kind: o.kind,
        personId: o.by,
        on: o.on,
        at: o.at,
        field: '',
        before: '',
        after: o.summary,
        restorable: false,
      })
    return dated
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (b.version ?? 0) - (a.version ?? 0))
      .map(({ at: _at, ...entry }) => entry)
  }

  /** The live items this one is in a conflict with, either way round, that the person may read. */
  async function conflictsOf(id: string): Promise<string[]> {
    const bundle = await liveServingBundle(tx, cache)
    const served = bundle.items.filter((i) => i.status === 'accepted')
    const others = conflictPairs(served).flatMap((p) =>
      p.holderId === id ? [p.otherId] : p.otherId === id ? [p.holderId] : [],
    )
    if (!others.length) return []
    const open = await tx.query<{ id: string }>(
      'select i.id from v_item_list i where i.id = any($1::text[]) and cl_audience_allows(i.audience_groups) order by i.id',
      [others],
    )
    return open.map((r) => r.id)
  }

  async function page(id: string): Promise<ItemPage | null> {
    const row = await library.getIndexRow(id)
    const item = row ? await library.getItem(id) : null
    if (!row || !item) return null
    const mine = await me()
    return {
      item,
      lastChecked: row.lastChecked,
      trust: row.trust,
      chips: row.chips,
      owners: row.owners,
      history: await historyOf(id),
      canChange: mine.admin || mine.owns.includes(row.areaId),
      conflicts: await conflictsOf(id),
    }
  }

  /** An earlier version's words as a new draft of a change, for an owner or an admin (FR-140). */
  async function restoreAsDraft(input: { id: string; version: number }) {
    const row = await library.getIndexRow(input.id)
    if (!row) throw new ORPCError('NOT_FOUND')
    const mine = await me()
    if (!mine.admin && !mine.owns.includes(row.areaId))
      throw new ORPCError('FORBIDDEN', {
        message: 'Only an owner of its domain or an admin can restore an earlier version.',
      })
    if (row.status !== 'accepted')
      throw new ORPCError('CONFLICT', {
        message: "It is archived, so an earlier version can't come back as a change to it.",
      })
    const [version] = await tx.query<{ id: string }>(
      `select v.id::text from item_versions v
        where v.item_id = $1 and v.version_no = $2
          and exists (select 1 from item_version_service s where s.version_id = v.id)`,
      [input.id, input.version],
    )
    const stored = version ? (await readVersions(tx, [version.id]))[0] : undefined
    if (!stored) throw new ORPCError('NOT_FOUND', { message: "We couldn't find that version." })
    if (stored.versionNo === row.version)
      throw new ORPCError('CONFLICT', { message: 'This is the version agents get now.' })
    // The words, dates and sources of that version, in the domain and with the kind it has now.
    const {
      reviewDate: _due,
      changeMarks: _marks,
      references: _refs,
      ...words
    } = draftOf(stored.version)
    const created = await proposals.create({
      itemId: input.id,
      draft: { ...words, areaId: row.areaId, kind: row.kind, ownerId: row.ownerId },
      reason: reasons.restored(input.version),
    })
    return { proposalId: created.id }
  }

  /**
   * The domain of each metric or dimension, as Definitions shows it: its own, or else the one its
   * source names (`termDomain`).
   */
  async function termAreas(
    terms: readonly { key: string; areaId: string | null }[],
    keys: readonly string[],
  ): Promise<(key: string) => string | undefined> {
    const hints = keys.length
      ? await tx.query<{ key: string; areaId: string | null }>(
          `select key, area_id as "areaId"
             from serving_source_domains((select seq from live_edition)) where key = any($1)`,
          [keys],
        )
      : []
    return (key) =>
      termDomain(
        terms.find((t) => t.key === key)?.areaId ?? null,
        hints.find((h) => h.key === key)?.areaId ?? null,
      ).areaId ?? undefined
  }

  /**
   * Related context, one step away, as get_related follows it on what agents get now: from an
   * item the person may read, or from a metric or a dimension by its key. Whether agents follow
   * links at all is the get_related switch (FR-407), which people see in Related too.
   */
  async function relatedOf(id: string): Promise<RelatedContext | null> {
    const item = id.startsWith('itm_')
    const row = item ? await library.getIndexRow(id) : null
    if (item && !row) return null
    const [bundle, tools] = await Promise.all([liveServingBundle(tx, cache), enabledTools(tx)])
    const following = tools.includes('get_related')
    const graph = related(bundle, { id, depth: 1, today: clock.today() })
    const termArea = await termAreas(bundle.terms, [
      ...(item ? [] : [id]),
      ...(graph.found ? graph.nodes.filter((n) => n.type !== 'item').map((n) => n.id) : []),
    ])
    const areaId = item ? row?.areaId : termArea(id)
    // An item the person may read that agents are not given has nothing to follow; a definition
    // that is not in the vocabulary agents read is not found.
    if (!graph.found)
      return item ? { ...(areaId ? { areaId } : {}), nodes: [], withheld: 0, following } : null
    // Each node once, by the start's own link to it that comes first in the fixed order, read
    // from the start's side. Links among the neighbours are not how they relate to the start. A
    // metric the text mentions and the item applies to is a link people follow: the mention wins.
    const backwards: Record<string, string> = { mentions: 'mentioned_by', replaces: 'replaced_by' }
    const relationOf = new Map<string, string>()
    for (const e of graph.edges) {
      const [other, rel] =
        e.from === id ? [e.to, e.rel] : e.to === id ? [e.from, backwards[e.rel] ?? e.rel] : []
      if (!other || !rel) continue
      const known = relationOf.get(other)
      if (!known || (known === 'applies_to' && rel !== 'in_area')) relationOf.set(other, rel)
    }
    // A retired or replaced item gives agents only the words that linked to it (FR-333); people
    // read it by its title and domain, as the Context list shows it, when they may read it.
    const retired = new Map(
      await Promise.all(
        graph.nodes
          .filter((node) => node.type === 'item' && node.status !== 'current')
          .map(async (node) => [node.id, await library.getIndexRow(node.id)] as const),
      ),
    )
    return {
      ...(areaId ? { areaId } : {}),
      nodes: graph.nodes.map((node) => {
        const type = ['item', 'metric', 'dimension', 'dimension_value', 'area', 'term'].includes(
          node.type,
        )
          ? (node.type as RelatedContext['nodes'][number]['type'])
          : 'other'
        const shown = retired.get(node.id)
        const area = 'area' in node && node.area ? node.area : (shown?.areaId ?? termArea(node.id))
        return {
          type,
          id: node.id,
          label: shown?.title ?? node.label,
          relation: relationOf.get(node.id) ?? 'mentions',
          status: node.status,
          ...('kind' in node ? { kind: node.kind } : shown ? { kind: shown.kind } : {}),
          ...(area ? { areaId: area } : {}),
        }
      }),
      withheld: graph.withheld,
      following,
    }
  }

  /**
   * Publish in one step (FR-137): the draft becomes a suggestion, and an owner of its domain or
   * an admin publishes it at once, through the same checks and gate as the review. Anyone else's
   * waits for the owners. A publish that the gate refuses changes nothing.
   */
  async function publish(input: {
    draft: Draft
    itemId?: string | undefined
    reason?: string | undefined
    draftId?: string | undefined
    relations?: { itemId: string; relation: ClashRelation }[] | undefined
  }): Promise<PublishItemResult> {
    const created = input.draftId
      ? await finish(input.draftId, input.draft, input.reason)
      : await proposals.create({
          draft: input.draft,
          ...(input.itemId ? { itemId: input.itemId } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
        })
    // A draft that was started from an item changes that item.
    const itemId = input.draftId ? (created.itemId ?? undefined) : input.itemId
    const submitted = await proposals.submit(created.id, created.revision)
    await review.checkSubmitted(submitted.id)
    const areaId = submitted.areaId!
    const mine = await me()
    // A change to an item is the person's to publish only where they own both its domain now and
    // the one it goes to, as a move in the Context list is.
    // It fails closed: a change whose item agents don't get now waits as a suggestion.
    const owns = (area: string) => mine.admin || mine.owns.includes(area)
    let fromOwned = true
    if (itemId) {
      const [live] = await tx.query<{ areaId: string }>(
        `select v.area_id as "areaId" from item_version_service s join item_versions v on v.id = s.version_id
          where s.item_id = $1 and s.editions @> (select seq from live_edition)`,
        [itemId],
      )
      fromOwned = !!live && owns(live.areaId)
    }
    if (!owns(areaId) || !fromOwned)
      return { published: false, proposalId: submitted.id, ownerIds: await domainOwners(areaId) }
    const current = await proposals.get(submitted.id)
    const published = await path.publish(
      {
        id: current.id,
        revision: current.revision,
        ...(input.relations?.length ? { relations: input.relations } : {}),
      },
      { clashesOnly: true },
    )
    return {
      published: true,
      itemId: published.proposal.itemId!,
      proposalId: submitted.id,
      edition: published.edition?.label ?? null,
      undo: published.undo,
    }
  }

  /** The person's own draft, with the words they finished it with: only its writer sends a draft. */
  async function finish(id: string, draft: Draft, reason: string | undefined) {
    const [row] = await tx.query<{ revision: number }>(
      `select revision from proposals where id = $1 and subject = 'item' and state = 'draft'`,
      [id],
    )
    if (!row) throw new ORPCError('NOT_FOUND', { message: "This draft isn't here any more." })
    return proposals.save(id, row.revision, draft, reason)
  }

  /**
   * A draft from pasted text, or from the page a link points to, with no model: the words, a kind
   * and dates by rule, and where it applies by the vocabulary's names (deriveAgentDraft). What it
   * guessed is named, for the writer to check.
   */
  async function draftFromText(text: string): Promise<DraftFromText> {
    const today = clock.today()
    const trimmed = text.trim()
    let words = trimmed
    let title: string | undefined
    let evidence: Draft['evidence']
    if (readPage && /^https?:\/\/\S+$/.test(trimmed) && readableAddress(trimmed)) {
      const read = await readPage(trimmed).catch(() => {
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message: "We couldn't read that page. Paste its text instead.",
        })
      })
      words = read.paragraphs.join('\n\n').slice(0, 4_000)
      title = read.title?.slice(0, 200) ?? undefined
      const first = read.paragraphs.find((p) => p.trim()) ?? ''
      const sentence = first.match(/^[\s\S]*?[.!?](?=\s|$)/)?.[0] ?? first
      evidence = [{ url: read.finalUrl, quote: sentence.slice(0, 500), date: today }]
    }
    if (!words)
      throw new ORPCError('UNPROCESSABLE_CONTENT', { message: 'Paste some text or a link.' })
    const derived = deriveAgentDraft(
      { text: words, ...(title ? { title } : {}) },
      { ...(await draftVocabulary(tx)), today },
    )
    const draft: Draft = { ...derived.draft, ...(evidence ? { evidence } : {}) }
    const unsure = Object.entries(derived.marks)
      .filter(([field, mark]) => mark !== 'confirmed' && field !== 'summary' && field !== 'body')
      .map(([field]) => field)
    return { draft, unsure: evidence ? [...unsure, 'evidence'] : unsure }
  }

  /**
   * The History log. An item the audience rule hides from the reader is left out of a change and
   * counted, never named; the change's sentence names a title, so it reads as a count instead.
   */
  async function changes(): Promise<ItemChange[]> {
    return tx.query<ItemChange>(
      `with listed as (
         select c.*,
                (select coalesce(jsonb_agg(e order by n), '[]') from jsonb_array_elements(c.items)
                   with ordinality x(e, n) where cl_item_open(e->>'id')) as shown
           from item_changes c order by c.made_at desc, c.id desc limit 200)
       select id::text, action, made_by::text as "personId",
              to_char(made_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at,
              case when jsonb_array_length(shown) = jsonb_array_length(items) then summary
                   else 'Changed ' || jsonb_array_length(items) || ' items.' end as summary,
              shown as items,
              (jsonb_array_length(items) - jsonb_array_length(shown))::int as withheld,
              undone_at is not null as undone
         from listed order by made_at desc, id desc`,
    )
  }

  async function deleted(): Promise<DeletedDraft[]> {
    return tx.query<DeletedDraft>(
      `select p.id::text, coalesce(nullif(p.draft->>'title', ''), 'Untitled draft') as title,
              p.area_id as "areaId", p.discarded_by::text as "personId",
              to_char(p.discarded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at
         from proposals p
        where p.discarded_at is not null and p.subject = 'item'
        order by p.discarded_at desc, p.id limit 200`,
    )
  }

  return {
    page,
    markRead,
    bulkApply,
    undoChange,
    restoreAsDraft,
    related: relatedOf,
    publish,
    draftFromText,
    changes,
    deleted,
  }
}

export type ContextService = ReturnType<typeof createContextService>
