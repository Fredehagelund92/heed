import { ORPCError } from '@orpc/client'
import type {
  BinEntry,
  BinItem,
  BinList,
  BinMoveInput,
  BinMoveResult,
  BinPreview,
  BinRescuePreview,
  BinRestoreInput,
  BinRestoreResult,
} from '../../../contract/bin.ts'
import { type Rescue, rescueDraft } from '../../../domain/bin-rescue.ts'
import type { ContextItem } from '../../../domain/item.ts'
import { namedItems, withoutItems } from '../../../domain/mentions.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { lockReleases, publishEdition } from '../editions/index.ts'
import { forReader, hiddenItems } from '../library/index.ts'
import {
  type ProposalsService,
  readVersions,
  rejectMentions,
  rejectSensitive,
} from '../proposals/index.ts'
import { draftOf } from './checks.ts'
import { insertDecision, isAdmin } from './records.ts'

/** Proposal states a reviewer still decides: none can be accepted while the item is in the Bin. */
const OPEN_STATES = `('submitted','in_review','changes_requested')`

const entryFields = `b.item_id as "itemId",v.kind::text as kind,v.area_id as "areaId",v.title,
  v.version_no as version,b.reason,b.binned_by::text as "binnedBy",
  to_char(b.binned_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as "binnedAt",
  b.binned_edition is not null as "wasLive",
  case when a.archived_at is not null then a.name end as "deletedDomain",
  (select count(*)::int from proposals p where p.item_id=b.item_id and p.discarded_at is null
    and p.state in ${OPEN_STATES}) as "openProposals"`
// An item the audience rule hides counts as absent from the Bin too (0083).
const entryFrom = `from item_bin b
  join item_versions v on v.id=b.version_id and cl_version_open(v.id)
  join areas a on a.id=b.area_id`

type LibraryRow = {
  id: string
  title: string
  versionId: string
  areaId: string
  live: boolean
  openProposals: number
}

/** "Norway closure" or "3 items", for a refusal that names what it is about. */
const named = (titles: string[]) =>
  titles.length === 1 ? `"${titles[0]}"` : `${titles.length.toLocaleString('en')} facts`

/** An item of a deleted domain in the Bin, as a rescue reads it. */
type Orphan = { itemId: string; versionId: string; title: string; deletedDomain: string }
/** An orphan fitted to the chosen domain: the draft of its proposal, and what that changed. */
type Fitted = Orphan & Rescue

/**
 * The Bin (0067): an administrator moves items out of the library and restores them. Moving an
 * item agents get retires it (FR-218), so one edition stops delivery for the whole action; an
 * item already retired moves without one. Restoring serves the version that was live again in one
 * edition, through the same guarded functions; an item retired before it moved comes back retired.
 * An item whose domain was deleted is restored into another domain instead (FR-814, 0079): it
 * comes back retired, and a proposal opens there with its last content, fitted to that domain,
 * for its owners to review. Nothing is deleted: every version, decision and edition stays, and
 * the history log keeps each action. Every call is for administrators, and the service and the
 * row policies both check it.
 */
export function createBinService(tx: Queryable, clock: Clock, proposals: ProposalsService) {
  async function administrator(action: string) {
    if (!(await isAdmin(tx)))
      throw new ORPCError('FORBIDDEN', { message: `Only an admin can ${action}.` })
  }

  /** The library's items of `ids`, as the person reads them; refuses an id that is not one. */
  async function libraryItems(ids: readonly string[]): Promise<LibraryRow[]> {
    const rows = await tx.query<LibraryRow>(
      `select l.id,l.title,l.version_id::text as "versionId",l.area_id as "areaId",
              l.status='accepted' as live,
              (select count(*)::int from proposals p where p.item_id=l.id and p.discarded_at is null
                and p.state in ${OPEN_STATES}) as "openProposals"
         from unnest($1::text[]) with ordinality as x(id,n) join v_item_list l on l.id=x.id
        where cl_audience_allows(l.audience_groups) order by x.n`,
      [ids],
    )
    if (rows.length === ids.length) return rows
    const found = new Set(rows.map((row) => row.id))
    const missing = ids.filter((id) => !found.has(id))
    const [binned] = await tx.query<{ n: number }>(
      'select count(*)::int as n from item_bin where item_id=any($1) and restored_at is null',
      [missing],
    )
    if (binned!.n > 0)
      throw new ORPCError('CONFLICT', {
        message:
          binned!.n === 1
            ? 'This fact is already in the Bin.'
            : `${binned!.n} of these facts are already in the Bin.`,
      })
    throw new ORPCError('NOT_FOUND', { message: "We couldn't find this fact in the library." })
  }

  async function entries(ids: readonly string[]): Promise<BinEntry[]> {
    return tx.query<BinEntry>(
      `select ${entryFields} ${entryFrom}
        where b.item_id=any($1) and b.restored_at is null order by b.binned_at desc,b.item_id collate "C"`,
      [ids],
    )
  }

  async function log(action: string, areaId: string, itemId: string, details: object) {
    await tx.query(
      `insert into audit_log(actor_id,actor_kind,action,area_id,subject_type,subject_id,details)
       values(cl_person(),'person',$1,$2,'item',$3,$4)`,
      [action, areaId, itemId, JSON.stringify(details)],
    )
  }

  /** The area an edition is announced in: the one area all its items share, otherwise none. */
  const oneArea = (rows: readonly { areaId: string }[]) =>
    new Set(rows.map((row) => row.areaId)).size === 1 ? rows[0]!.areaId : null

  /**
   * The items of a deleted domain fitted to the domain `areaId` (bin-rescue.ts): each one's last
   * content, the changes it needs there, and why one cannot go, read on the live edition. Level 1
   * then checks each draft as a submit will, so a finding it would refuse on is said now.
   */
  async function fit(orphans: readonly Orphan[], areaId: string): Promise<Fitted[]> {
    const [world] = await tx.query<{
      name: string
      owners: string[]
      terms: string[]
      definitions: string[]
      items: string[]
      areas: string[]
    }>(
      `select a.name,
         array(select s.person_id::text from area_assignments s join people p on p.id=s.person_id
                where s.area_id=a.id and s.role='owner' and s.valid_at @> now()
                  and p.deactivated_at is null and p.erased_at is null order by s.person_id) as owners,
         array(select key from serving_vocabulary((select seq from live_edition)))
           || array(select 'term:'||id::text from terms where deleted_at is null) as terms,
         array(select ref from definitions) as definitions,
         array(select s.item_id from item_version_service s join item_versions v on v.id=s.version_id
                where s.editions @> (select seq from live_edition) and cl_audience_allows(v.audience_groups)) as items,
         array(select id from areas where archived_at is null) as areas
       from areas a where a.id=$1 and a.archived_at is null`,
      [areaId],
    )
    if (!world)
      throw new ORPCError('UNPROCESSABLE_CONTENT', { message: 'Choose a domain that exists.' })
    const read = await readVersions(
      tx,
      orphans.map((orphan) => orphan.versionId),
    )
    // A conflict with an item the audience rule hides is not the administrator's to see or keep.
    const hidden = await hiddenItems(
      tx,
      read.flatMap((row) => namedItems(row.version)),
    )
    const versions = new Map(
      read.map((row) => [row.id, { ...row, version: withoutItems(row.version, hidden) }]),
    )
    // The words for the people, terms and items the changes name.
    const keys = [...versions.values()].flatMap(({ version }) => [
      ...version.scope.metrics,
      ...version.scope.dimensions,
      ...version.scope.dimensionValues.map((row) => row.value),
    ])
    const [words] = await tx.query<{
      people: Record<string, string> | null
      terms: Record<string, string> | null
      items: Record<string, string> | null
    }>(
      `select (select jsonb_object_agg(id::text,display_name) from people where id::text=any($1::text[])) as people,
              (select jsonb_object_agg(term_key,name) from (select distinct on (term_key) term_key,name
                 from vocab_term_versions where term_key=any($2::text[]) order by term_key,version_no desc) t) as terms,
              (select jsonb_object_agg(item_id,title) from (select distinct on (item_id) item_id,title
                 from item_versions where item_id=any($3::text[]) order by item_id,version_no desc) t) as items`,
      [
        [...world.owners, ...[...versions.values()].map(({ version }) => version.ownerId)],
        keys,
        [...versions.values()].flatMap(({ version }) => version.conflicts),
      ],
    )
    const sets = {
      terms: new Set(world.terms),
      definitions: new Set(world.definitions),
      items: new Set(world.items),
      areas: new Set(world.areas),
    }
    const fitted: Fitted[] = []
    for (const orphan of orphans) {
      const stored = versions.get(orphan.versionId)
      if (!stored)
        throw new ORPCError('NOT_FOUND', { message: "We couldn't find this fact in the Bin." })
      const rescue = rescueDraft(draftOf(stored.version), orphan.itemId, {
        today: clock.today(),
        from: { name: orphan.deletedDomain },
        to: { id: areaId, name: world.name, owners: world.owners },
        ...sets,
        personName: (id) => words?.people?.[id] ?? 'Someone',
        termName: (key) => words?.terms?.[key] ?? key,
        itemTitle: (id) => words?.items?.[id] ?? id,
      })
      let problem = rescue.problem
      if (!problem) {
        const { checks } = await proposals.prepareRescue(orphan.itemId, rescue.draft)
        problem = checks.findings.find((finding) => finding.severity === 'error')?.message ?? null
      }
      fitted.push({ ...orphan, ...rescue, problem })
    }
    return fitted
  }

  /** The items of `ids` in the Bin whose domain is deleted, in the order of `ids`. */
  async function orphansOf(ids: readonly string[]): Promise<Orphan[]> {
    const rows = await tx.query<Orphan & { deleted: boolean }>(
      `select b.item_id as "itemId",b.version_id::text as "versionId",v.title,a.name as "deletedDomain",
              a.archived_at is not null as deleted
         from unnest($1::text[]) with ordinality as x(id,n)
         join item_bin b on b.item_id=x.id and b.restored_at is null
         join item_versions v on v.id=b.version_id and cl_version_open(v.id)
         join areas a on a.id=b.area_id
        order by x.n`,
      [ids],
    )
    if (rows.length !== ids.length)
      throw new ORPCError('NOT_FOUND', { message: "We couldn't find this fact in the Bin." })
    return rows.filter((row) => row.deleted).map(({ deleted: _deleted, ...orphan }) => orphan)
  }

  return {
    async list(): Promise<BinList> {
      await administrator('open the Bin')
      return {
        items: await tx.query<BinEntry>(
          `select ${entryFields} ${entryFrom}
            where b.restored_at is null order by b.binned_at desc,b.item_id collate "C"`,
        ),
      }
    },

    /**
     * One item in the Bin, to read before restoring it: its entry and the item as the library
     * showed it when it moved, from the document every item has (v_item_doc, 0078). Agents never
     * read it.
     */
    async get(id: string): Promise<BinItem> {
      await administrator('open the Bin')
      const [entry] = await entries([id])
      const [row] = entry
        ? await tx.query<{ doc: ContextItem }>(
            'select doc from v_item_doc where id=$1 and cl_audience_allows(audience_groups)',
            [id],
          )
        : []
      if (!entry || !row)
        throw new ORPCError('NOT_FOUND', { message: "We couldn't find this fact in the Bin." })
      // Its status as the library showed it, which Restore brings back: none serves it now.
      const [doc] = await forReader(tx, [row.doc])
      return { entry, item: { ...doc!, status: entry.wasLive ? 'accepted' : 'retired' } }
    },

    /** What moving items to the Bin would do, so the person is warned before they do it. */
    async preview(ids: readonly string[]): Promise<BinPreview> {
      await administrator('move facts to the Bin')
      const rows = await libraryItems([...new Set(ids)])
      return {
        items: rows.map(({ id, title, live, openProposals }) => ({
          itemId: id,
          title,
          live,
          openProposals,
        })),
      }
    },

    async move(input: BinMoveInput): Promise<BinMoveResult> {
      await lockReleases(tx)
      await administrator('move facts to the Bin')
      rejectSensitive(input.reason)
      rejectMentions(input.reason)
      const ids = [...new Set(input.ids)]
      const rows = await libraryItems(ids)
      const live = rows.filter((row) => row.live)
      // A retire decision for each item agents get: the closing guard (0006) asks for it.
      for (const row of live)
        await insertDecision(tx, {
          proposalId: null,
          itemVersionId: row.versionId,
          areaId: row.areaId,
          capacity: 'administrator',
          outcome: 'retire',
          reason: input.reason,
        })
      const edition = live.length
        ? await publishEdition(
            tx,
            { reason: 'item_retired', close: live.map((row) => row.id), note: input.reason },
            oneArea(live),
          )
        : null
      for (const row of rows) {
        await tx.query(
          `insert into item_bin(item_id,version_id,area_id,reason,binned_by,binned_edition)
           values($1,$2,$3,$4,cl_person(),$5)`,
          [row.id, row.versionId, row.areaId, input.reason, row.live ? edition!.seq : null],
        )
        await log('item.binned', row.areaId, row.id, {
          title: row.title,
          reason: input.reason,
          versionId: row.versionId,
          edition: row.live ? edition!.label : null,
          openProposals: row.openProposals,
        })
      }
      return { items: await entries(ids), edition }
    },

    /**
     * What restoring the items of a deleted domain among `ids` into `areaId` would change in each
     * (FR-814), so the Restore dialog shows every change before anyone confirms it.
     */
    async rescuePreview(input: {
      ids: readonly string[]
      areaId: string
    }): Promise<BinRescuePreview> {
      await administrator('restore facts from the Bin')
      const orphans = await orphansOf([...new Set(input.ids)])
      return {
        items: (await fit(orphans, input.areaId)).map(
          ({ itemId, title, deletedDomain, changes, problem }) => ({
            itemId,
            title,
            deletedDomain,
            changes,
            problem,
          }),
        ),
      }
    },

    async restore(input: BinRestoreInput): Promise<BinRestoreResult> {
      await lockReleases(tx)
      await administrator('restore facts from the Bin')
      const ids = [...new Set(input.ids)]
      const rows = await tx.query<{
        id: string
        itemId: string
        versionId: string
        areaId: string
        title: string
        wasLive: boolean
        problem: string | null
        deletedDomain: string | null
      }>(
        `select b.id::text,b.item_id as "itemId",b.version_id::text as "versionId",b.area_id as "areaId",
                v.title,b.binned_edition is not null as "wasLive",
                case when b.binned_edition is null then null else cl_item_version_problem(b.version_id) end as problem,
                case when a.archived_at is not null then a.name end as "deletedDomain"
           from unnest($1::text[]) with ordinality as x(id,n)
           join item_bin b on b.item_id=x.id and b.restored_at is null
           join item_versions v on v.id=b.version_id
           join areas a on a.id=b.area_id
          order by x.n for update of b`,
        [ids],
      )
      if (rows.length !== ids.length)
        throw new ORPCError('NOT_FOUND', { message: "We couldn't find this fact in the Bin." })
      // An item of a deleted domain has no domain to go back to (FR-814): it goes to the domain
      // the administrator chose, retired, with a proposal there.
      const orphaned = rows.filter((row) => row.deletedDomain)
      const back = rows.filter((row) => !row.deletedDomain)
      if (orphaned.length && !input.areaId)
        throw new ORPCError('CONFLICT', {
          message: `${named(orphaned.map((row) => row.title))} ${orphaned.length === 1 ? 'belongs' : 'belong'} to ${orphaned[0]!.deletedDomain}, which was deleted. Nothing was restored. Choose another domain for ${orphaned.length === 1 ? 'it' : 'them'}, or restore ${orphaned[0]!.deletedDomain} first in Administration, Domains.`,
        })
      if (input.areaId && !orphaned.length)
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message:
            'Nothing was restored. Only a fact whose domain was deleted can move to another domain.',
        })
      const rescues = input.areaId
        ? await fit(
            orphaned.map((row) => ({
              itemId: row.itemId,
              versionId: row.versionId,
              title: row.title,
              deletedDomain: row.deletedDomain!,
            })),
            input.areaId,
          )
        : []
      const unfit = rescues.filter((rescue) => rescue.problem)
      if (unfit.length)
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message: `${named(unfit.map((rescue) => rescue.title))} can't move to ${rescues[0]!.changes[0]!.after}: ${unfit[0]!.problem} Nothing was restored.`,
        })
      // Every version served again passes the serving rules once more (FR-205), as on a rollback.
      const blocked = back.filter((row) => row.problem)
      if (blocked.length)
        throw new ORPCError('CONFLICT', {
          message: `${named(blocked.map((row) => row.title))} can't be shared with agents again: ${blocked[0]!.problem}. Nothing was restored.`,
        })
      const served = back.filter((row) => row.wasLive)
      const edition = served.length
        ? await publishEdition(
            tx,
            {
              reason: 'item_restored',
              serve: served.map((row) => row.versionId),
              note: null,
            },
            oneArea(served),
          )
        : null
      for (const row of back) {
        await tx.query(
          `update item_bin set restored_by=cl_person(),restored_at=now(),restored_via='restore',
                  restored_edition=$2 where id=$1`,
          [row.id, row.wasLive ? edition!.seq : null],
        )
        await log('item.restored', row.areaId, row.itemId, {
          title: row.title,
          versionId: row.versionId,
          edition: row.wasLive ? edition!.label : null,
        })
      }
      // A rescue serves nothing: the item stays retired until its proposal is accepted. The Bin
      // record names the proposal, so its submit knows the version it follows.
      const opened: BinRestoreResult['proposals'] = []
      for (const rescue of rescues) {
        const row = orphaned.find((candidate) => candidate.itemId === rescue.itemId)!
        const { proposal } = await proposals.rescue(rescue.itemId, rescue.draft)
        await tx.query(
          `update item_bin set restored_by=cl_person(),restored_at=now(),restored_via='rescue',
                  restored_area=$2,rescue_proposal=$3 where id=$1`,
          [row.id, input.areaId, proposal.id],
        )
        const submitted = await proposals.submit(proposal.id, proposal.revision)
        await log('item.restored', input.areaId!, rescue.itemId, {
          title: rescue.title,
          versionId: rescue.versionId,
          edition: null,
          deletedDomain: rescue.deletedDomain,
          domain: rescue.changes[0]!.after,
          proposal: submitted.number,
          changes: rescue.changes,
        })
        opened.push({ itemId: rescue.itemId, id: submitted.id, number: submitted.number })
      }
      return { restored: rows.map((row) => row.itemId), edition, proposals: opened }
    },
  }
}
export type BinService = ReturnType<typeof createBinService>
