import { ORPCError } from '@orpc/client'
import type * as z from 'zod/mini'
import type {
  blockedVersionSchema,
  changeWhySchema,
  editionComparisonSchema,
  editionCompareInputSchema,
  editionFeedInputSchema,
  editionFeedSchema,
  editionSummarySchema,
  itemChangeSchema,
  itemComparisonSchema,
} from '../../../contract/editions.ts'
import type { Edition } from '../../../contract/review.ts'
import {
  changeSentence,
  editionChangeKinds,
  highestRisk,
  isSystemFilled,
  noChanges,
  type ChangeCounts,
  type EditionChangeKind,
} from '../../../domain/editions.ts'
import type { ItemKind, RiskLevel } from '../../../domain/item.ts'
import type { ItemVersion } from '../../../domain/item-version.ts'
import { mentionDiff, versionDiff } from '../../../domain/review.ts'
import type { Queryable } from '../../db/database.ts'
import { forReader } from '../library/index.ts'
import { readVersions } from '../proposals/index.ts'
import { editionByLabel, editionFields, liveEdition } from './release.ts'

type Why = z.infer<typeof changeWhySchema>
type ItemChange = z.infer<typeof itemChangeSchema>
type Comparison = z.infer<typeof editionComparisonSchema>
type EditionSummary = z.infer<typeof editionSummarySchema>

/** One item whose served version differs between two states, before who and why are read. */
type ChangeRow = {
  itemId: string
  change: EditionChangeKind
  title: string
  areaId: string
  kind: ItemKind
  riskLevel: RiskLevel
  fromId: string | null
  fromNo: number | null
  toId: string | null
  toNo: number | null
  /** Either version has an audience group: counted, never shown (groups are parked). */
  withheld: boolean
}

/**
 * Classifies pairs of versions of one item (`p.item_id`, `p.a` earlier, `p.b` later):
 * - no version in `a` is `added`; no version in `b` is `retired` when `left` (an SQL condition,
 *   true when it left in an edition that was not a rollback) holds, and `removed` otherwise;
 * - a recheck with the same core content (CON-211) is `checked`, the same content digest is
 *   `resaved`, anything else `changed`.
 */
function classified(pairs: string, left: string, extra = ''): string {
  return `select ${extra}p.item_id as "itemId",
      case when va.id is null then 'added'
           when vb.id is null then case when ${left} then 'retired' else 'removed' end
           when vb.is_recheck and va.core_digest=vb.core_digest then 'checked'
           when va.content_digest=vb.content_digest then 'resaved'
           else 'changed' end as change,
      coalesce(vb.title,va.title) as title,coalesce(vb.area_id,va.area_id) as "areaId",coalesce(vb.kind,va.kind)::text as kind,
      coalesce(vb.risk,va.risk)::text as "riskLevel",va.id::text as "fromId",va.version_no as "fromNo",
      vb.id::text as "toId",vb.version_no as "toNo",
      not (cl_version_open(p.a) and cl_version_open(p.b)) as withheld
    from (${pairs}) p
    left join item_versions va on va.id=p.a left join item_versions vb on vb.id=p.b`
}

/**
 * Items whose served version differs between edition `a` and edition `b` (SQL expressions for
 * edition numbers; 0 is "before the first edition"; `b` older than `a` compares backwards). An
 * item can differ only if one of its service ranges starts or ends after the earlier edition and
 * up to the later one, so only those items are looked at (indexed in 0042), and their rows in
 * service at either edition are joined. Going forward, an item that left was retired unless it
 * last left in a rollback.
 */
function rangeChanges(a: string, b: string, item?: string): string {
  const lo = `least(${a},${b})`
  const hi = `greatest(${a},${b})`
  const only = item ? ` and item_id=${item}` : ''
  const pairs = `select t.item_id,sa.version_id as a,sb.version_id as b
    from (select item_id from item_version_service where lower(editions) > ${lo} and lower(editions) <= ${hi}${only}
          union select item_id from item_version_service where upper(editions) > ${lo} and upper(editions) <= ${hi}${only}) t
    left join item_version_service sa on sa.item_id=t.item_id and sa.editions @> (${a})::bigint
    left join item_version_service sb on sb.item_id=t.item_id and sb.editions @> (${b})::bigint
    where sa.version_id is distinct from sb.version_id`
  const left = `${a} < ${b} and (select e.reason from item_version_service s join editions e on e.seq=upper(s.editions)
      where s.item_id=p.item_id and upper(s.editions) > ${lo} and upper(s.editions) <= ${hi}
      order by upper(s.editions) desc limit 1) <> 'rollback'`
  return classified(pairs, left)
}

/**
 * What each of some editions (`seqs`, an SQL array of edition numbers) changed against the sealed
 * edition before it, with the edition's number as `seq`. Nothing is sealed in between, so an item
 * changed in edition N exactly when a row of it opens or closes at N: the row that closes is the
 * version before, the row that opens the version after. Both are plain index lookups (0042), so
 * the work follows the items an edition changes, not everything in service.
 */
function editionChanges(seqs: string, item?: string): string {
  const only = item ? ` and item_id=${item}` : ''
  const pairs = `select coalesce(o.seq,c.seq) as seq,coalesce(o.item_id,c.item_id) as item_id,
      c.version_id as a,o.version_id as b
    from (select item_id,version_id,lower(editions) as seq from item_version_service
           where lower(editions)=any(${seqs})${only}) o
    full join (select item_id,version_id,upper(editions) as seq from item_version_service
           where upper(editions)=any(${seqs})${only}) c on c.item_id=o.item_id and c.seq=o.seq
    where o.version_id is distinct from c.version_id`
  return classified(
    pairs,
    `(select e.reason from editions e where e.seq=p.seq) <> 'rollback'`,
    'p.seq::float8 as seq,',
  )
}

/**
 * Vocabulary terms whose served version, or the domain the source gives them (0054), differs
 * between `a` and `b`, counted the same way.
 */
function vocabularyChanges(a: string, b: string): string {
  const lo = `least(${a},${b})`
  const hi = `greatest(${a},${b})`
  const moved = (table: string) =>
    `select term_key from ${table} where lower(editions) > ${lo} and lower(editions) <= ${hi}
     union select term_key from ${table} where upper(editions) > ${lo} and upper(editions) <= ${hi}`
  return `select count(*)::int
    from (${moved('vocab_term_service')} union ${moved('source_domain_service')}) t
    left join vocab_term_service sa on sa.term_key=t.term_key and sa.editions @> (${a})::bigint
    left join vocab_term_service sb on sb.term_key=t.term_key and sb.editions @> (${b})::bigint
    left join source_domain_service da on da.term_key=t.term_key and da.editions @> (${a})::bigint
    left join source_domain_service db on db.term_key=t.term_key and db.editions @> (${b})::bigint
    where sa.version_id is distinct from sb.version_id or da.area_id is distinct from db.area_id`
}

/** How many vocabulary terms each of some editions changed, as `editionChanges` counts items. */
function vocabularyPerEdition(seqs: string): string {
  const changed = (table: string, column: string) =>
    `select coalesce(o.seq,c.seq) as seq,coalesce(o.term_key,c.term_key) as term_key
       from (select term_key,${column} as value,lower(editions) as seq from ${table} where lower(editions)=any(${seqs})) o
       full join (select term_key,${column} as value,upper(editions) as seq from ${table} where upper(editions)=any(${seqs})) c
         on c.term_key=o.term_key and c.seq=o.seq
      where o.value is distinct from c.value`
  return `select seq::float8 as seq,count(distinct term_key)::int as count
    from (${changed('vocab_term_service', 'version_id')}
          union all ${changed('source_domain_service', 'area_id')}) x group by 1`
}

const changeRank = (change: EditionChangeKind) => editionChangeKinds.indexOf(change)
/** Change order (added first), then title, then id: the order every list of changes uses. */
function byChange(a: ChangeRow, b: ChangeRow) {
  return (
    changeRank(a.change) - changeRank(b.change) ||
    a.title.localeCompare(b.title, 'en') ||
    (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0)
  )
}

/** How often each value occurs, by value. */
function tally<Value extends string>(values: readonly Value[]): [Value, number][] {
  const counts = new Map<Value, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
}

function countChanges(rows: readonly ChangeRow[]): ChangeCounts {
  const counts = noChanges()
  for (const row of rows) counts[row.change] += 1
  return counts
}

const leaves = (change: EditionChangeKind) => change === 'retired' || change === 'removed'

type VersionWhy = {
  id: string
  proposerId: string | null
  channel: Why['channel']
  editedBy: string | null
  proposal: { id: string; number: number } | null
  decisions: (Why['decisions'][number] & {
    proposal: {
      id: string
      number: number
      proposerId: string | null
      channel: Why['channel']
    } | null
  })[]
}

/**
 * Who made each change and why (G2): for a version that is served, the proposal that brought it
 * in and the accept decisions; for an item that left, its retire decisions and their proposal.
 * Row security applies: every version that was ever served is readable, and so are its decisions.
 */
async function whyOf(tx: Queryable, rows: readonly ChangeRow[]) {
  const ids = [
    ...new Set(rows.map((row) => (leaves(row.change) ? row.fromId : row.toId)).filter(Boolean)),
  ]
  const found = ids.length
    ? await tx.query<VersionWhy>(
        `select v.id::text,v.proposer_id::text as "proposerId",v.created_via::text as channel,
           v.edited_by::text as "editedBy",
           (select json_build_object('id',p.id::text,'number',p.number::float8) from proposals p
             where p.item_version_id=v.id order by (p.state='accepted') desc,p.number desc limit 1) as proposal,
           coalesce((select json_agg(json_build_object('decidedBy',d.decided_by::text,'capacity',d.capacity::text,
               'outcome',d.outcome::text,'reason',d.reason,'decidedAt',d.decided_at::text,
               'proposal',case when p.id is null then null else json_build_object('id',p.id::text,
                 'number',p.number::float8,'proposerId',p.proposer_id::text,'channel',p.channel::text) end)
               order by d.decided_at,d.id)
             from decisions d left join proposals p on p.id=d.proposal_id
             where d.item_version_id=v.id and d.outcome in ('accept','retire')),'[]') as decisions
         from item_versions v where v.id=any($1::uuid[])`,
        [ids],
      )
    : []
  const versions = new Map(found.map((v) => [v.id, v]))
  return (row: ChangeRow): Why => {
    const none: Why = {
      proposal: null,
      proposerId: null,
      channel: null,
      editedBy: null,
      decisions: [],
    }
    const plain = ({ proposal: _p, ...decision }: VersionWhy['decisions'][number]) => decision
    if (leaves(row.change)) {
      const version = row.fromId ? versions.get(row.fromId) : undefined
      // Going back takes an item out without a decision; the edition says who and why.
      if (!version || row.change === 'removed') return none
      const retire = version.decisions.filter((d) => d.outcome === 'retire')
      const proposal = retire.find((d) => d.proposal)?.proposal ?? null
      return {
        proposal: proposal && { id: proposal.id, number: proposal.number },
        proposerId: proposal?.proposerId ?? null,
        channel: proposal?.channel ?? null,
        editedBy: null,
        decisions: retire.map(plain),
      }
    }
    const version = row.toId ? versions.get(row.toId) : undefined
    if (!version) return none
    return {
      proposal: version.proposal,
      proposerId: version.proposerId,
      channel: version.channel,
      editedBy: version.editedBy,
      decisions: version.decisions.filter((d) => d.outcome === 'accept').map(plain),
    }
  }
}

function asChange(row: ChangeRow, why: Why): ItemChange {
  return {
    itemId: row.itemId,
    change: row.change,
    title: row.title,
    areaId: row.areaId,
    kind: row.kind,
    riskLevel: row.riskLevel,
    from: row.fromId === null ? null : { version: row.fromNo!, versionId: row.fromId },
    to: row.toId === null ? null : { version: row.toNo!, versionId: row.toId },
    why,
  }
}

/** Display names of people and areas, for sentences. */
async function names(tx: Queryable, people: readonly string[], areas: readonly string[]) {
  const persons = people.length
    ? await tx.query<{ id: string; name: string }>(
        'select id::text,display_name as name from people where id=any($1::uuid[])',
        [[...new Set(people)]],
      )
    : []
  const areaRows = areas.length
    ? await tx.query<{ id: string; name: string }>('select id,name from areas where id=any($1)', [
        [...new Set(areas)],
      ])
    : []
  const person = new Map(persons.map((p) => [p.id, p.name]))
  const area = new Map(areaRows.map((a) => [a.id, a.name]))
  return {
    person: (id: string | null | undefined) => (id ? (person.get(id) ?? null) : null),
    area: (id: string) => area.get(id) ?? id,
  }
}

const sortedAreas = (rows: readonly ChangeRow[]) => [...new Set(rows.map((r) => r.areaId))].sort()

async function previousEdition(tx: Queryable, seq: number): Promise<Edition | null> {
  const [row] = await tx.query<Edition>(
    `select ${editionFields} from editions e where e.sealed_at is not null and e.seq<$1
     order by e.seq desc limit 1`,
    [seq],
  )
  return row ?? null
}

/** The two editions of a comparison: by default the live edition and the one before it. */
async function editionPair(tx: Queryable, from?: string, to?: string) {
  const later = to ? await editionByLabel(tx, to) : await liveEdition(tx)
  const earlier = from ? await editionByLabel(tx, from) : await previousEdition(tx, later.seq)
  return { from: earlier, to: later, a: earlier?.seq ?? 0, b: later.seq }
}

type CompareInput = z.infer<typeof editionCompareInputSchema>

/**
 * G1, net change: every item that differs between two editions, once, with counts over all of
 * them for the filter menus and a page of the ones that match. Sealed editions never change, so
 * a page of two named editions is stable; name both when paging. `items` narrows the changed
 * items, their counts and the withheld count to those items (the Workbench asks about the items
 * of one test question).
 */
export async function compareEditions(
  tx: Queryable,
  input: CompareInput,
  { items }: { items?: readonly string[] } = {},
): Promise<Comparison> {
  const { from, to, a, b } = await editionPair(tx, input.from, input.to)
  // One connection runs one query at a time, so these follow each other.
  const ranged = await tx.query<ChangeRow>(rangeChanges('$1::bigint', '$2::bigint'), [a, b])
  const only = items ? new Set(items) : null
  const changed = only ? ranged.filter((row) => only.has(row.itemId)) : ranged
  const rows = changed.filter((row) => !row.withheld)
  const [vocabulary] = await tx.query<{ count: number }>(
    vocabularyChanges('$1::bigint', '$2::bigint'),
    [a, b],
  )
  const [span] = await tx.query<{ n: number }>(
    `select count(*)::int as n from editions where sealed_at is not null
      and seq > least($1::bigint,$2::bigint) and seq <= greatest($1::bigint,$2::bigint)`,
    [a, b],
  )
  rows.sort(byChange)
  const matching = rows.filter(
    (row) =>
      (!input.change || row.change === input.change) &&
      (!input.areaId || row.areaId === input.areaId) &&
      (!input.kind || row.kind === input.kind) &&
      (!input.riskLevel || row.riskLevel === input.riskLevel),
  )
  const limit = input.limit ?? 50
  const offset = input.offset ?? 0
  const shown = matching.slice(offset, offset + limit)
  const why = await whyOf(tx, shown)
  const fields = await changedFields(tx, shown)
  const named = await names(tx, [], sortedAreas(rows))
  const counts = countChanges(rows)
  return {
    from,
    to,
    editions: span!.n,
    backwards: a > b,
    sentence: changeSentence({
      reason: null,
      counts,
      only: rows.length === 1 ? rows[0]! : null,
      areas: sortedAreas(rows).map(named.area),
      vocabulary: vocabulary!.count,
      withheld: changed.length - rows.length,
      editions: span!.n,
    }),
    facets: {
      change: counts,
      areas: tally(rows.map((row) => row.areaId)).map(([areaId, count]) => ({ areaId, count })),
      kinds: tally(rows.map((row) => row.kind)).map(([kind, count]) => ({ kind, count })),
      risks: tally(rows.map((row) => row.riskLevel)).map(([riskLevel, count]) => ({
        riskLevel,
        count,
      })),
    },
    vocabulary: vocabulary!.count,
    withheld: changed.length - rows.length,
    total: matching.length,
    limit,
    offset,
    items: shown.map((row) => ({ ...asChange(row, why(row)), fields: fields(row) })),
  }
}

type Versions = Map<string, ItemVersion>
/** Versions as the reader may read them: without the items the audience rule hides from them. */
async function versionsOf(tx: Queryable, ids: readonly (string | null)[]): Promise<Versions> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))]
  if (!wanted.length) return new Map()
  const stored = await readVersions(tx, wanted)
  const shown = await forReader(
    tx,
    stored.map((row) => row.version),
  )
  return new Map(stored.map((row, index) => [row.id, shown[index]!]))
}

/** The field changes of one item, from the earlier state to the later one. */
function fieldChanges(before: ItemVersion | null, after: ItemVersion | null) {
  if (after) return versionDiff(before, after)
  // An item that left: every field it had, going to nothing.
  return before
    ? versionDiff(null, before).map(({ field, after: value }) => ({
        field,
        before: value,
        after: null,
      }))
    : []
}

/** The names of the fields that differ on each row, for the compare list. */
async function changedFields(tx: Queryable, rows: readonly ChangeRow[]) {
  const versions = await versionsOf(
    tx,
    rows
      .filter((row) => row.change === 'changed' || row.change === 'checked')
      .flatMap((row) => [row.fromId, row.toId]),
  )
  return (row: ChangeRow): string[] => {
    if (row.change !== 'changed' && row.change !== 'checked') return []
    const before = versions.get(row.fromId!) ?? null
    const after = versions.get(row.toId!) ?? null
    return before && after ? versionDiff(before, after).map((change) => change.field) : []
  }
}

/**
 * G1 and G2 for one item: its field changes between two editions, its mentions added and removed,
 * and each edition in between that changed it, with who and why at each step.
 */
export async function compareItem(
  tx: Queryable,
  input: { id: string; from?: string | undefined; to?: string | undefined },
): Promise<z.infer<typeof itemComparisonSchema>> {
  if (!(await tx.query('select 1 from items where id=$1', [input.id])).length)
    throw new ORPCError('NOT_FOUND', { message: "We couldn't find this fact." })
  const { from, to, a, b } = await editionPair(tx, input.from, input.to)
  const [row] = await tx.query<ChangeRow>(rangeChanges('$1::bigint', '$2::bigint', '$3'), [
    a,
    b,
    input.id,
  ])
  // Each edition in between where a row of the item opens or closes.
  const boundaries = (
    await tx.query<{ seq: number }>(
      `select distinct x::float8 as seq from item_version_service s
         cross join lateral (values (lower(s.editions)),(upper(s.editions))) v(x)
        where s.item_id=$3 and x > least($1::bigint,$2::bigint) and x <= greatest($1::bigint,$2::bigint)`,
      [a, b, input.id],
    )
  ).map((boundary) => boundary.seq)
  const steps = boundaries.length
    ? await tx.query<ChangeRow & { seq: number }>(
        `${editionChanges('$1::bigint[]', '$2')} order by 1`,
        [boundaries, input.id],
      )
    : []
  const editions = steps.length
    ? await tx.query<Edition>(`select ${editionFields} from editions e where e.seq=any($1)`, [
        steps.map((step) => step.seq),
      ])
    : []
  // Like the edition export, nothing of a version with an audience group is shown.
  if (row?.withheld || steps.some((step) => step.withheld))
    throw new ORPCError('NOT_FOUND', { message: "We couldn't find this fact." })
  const why = await whyOf(tx, row ? [row, ...steps] : steps)
  const versions = await versionsOf(tx, row ? [row.fromId, row.toId] : [])
  const before = row?.fromId ? (versions.get(row.fromId) ?? null) : null
  const after = row?.toId ? (versions.get(row.toId) ?? null) : null
  return {
    from: from?.label ?? null,
    to: to.label,
    backwards: a > b,
    change: row ? asChange(row, why(row)) : null,
    fields: fieldChanges(before, after).map((change) => ({
      ...change,
      systemFilled: isSystemFilled(change.field),
    })),
    mentions: mentionDiff(before?.mentions ?? [], after?.mentions ?? []),
    steps: steps.map((step) => {
      const { from: stepFrom, to: stepTo, ...change } = asChange(step, why(step))
      return {
        edition: editions.find((e) => e.seq === step.seq)!,
        change: change.change,
        from: stepFrom,
        to: stepTo,
        why: change.why,
      }
    }),
  }
}

/** Editions made by decisions on their items, whose decisions say who and why. */
const decidedBy: readonly string[] = ['proposal_accepted', 'item_retired', 'source_rechecked']

/** How many of an edition's items the feed lists; the rest are counted in `more`. */
const FEED_ITEMS = 10

/**
 * G3: editions newest first, each with what it changed, in counts and in one sentence that says
 * who did it and why, so the feed needs no call per edition. Cursor paging by edition number.
 */
export async function editionFeed(
  tx: Queryable,
  input: z.infer<typeof editionFeedInputSchema>,
): Promise<z.infer<typeof editionFeedSchema>> {
  const limit = input.limit ?? 20
  const before = input.before ? await editionByLabel(tx, input.before) : null
  const after = input.after ? await editionByLabel(tx, input.after) : null
  const through = input.through ? await editionByLabel(tx, input.through) : null
  const page = await tx.query<Edition>(
    `select ${editionFields}
     from editions e where e.sealed_at is not null and ($1::bigint is null or e.seq<$1)
       and ($2::bigint is null or e.seq>$2) and ($4::bigint is null or e.seq<=$4)
     order by e.seq desc limit $3`,
    [before?.seq ?? null, after?.seq ?? null, limit + 1, through?.seq ?? null],
  )
  const next = page.length > limit ? page[limit - 1]!.label : null
  const entries = page.slice(0, limit)
  const seqs = entries.map((e) => e.seq)
  const rows = await tx.query<ChangeRow & { seq: number }>(editionChanges('$1::bigint[]'), [seqs])
  const vocabulary = await tx.query<{ seq: number; count: number }>(
    vocabularyPerEdition('$1::bigint[]'),
    [seqs],
  )
  const bySeq = new Map<number, ChangeRow[]>()
  const withheld = new Map<number, number>()
  for (const row of rows)
    if (row.withheld) withheld.set(row.seq, (withheld.get(row.seq) ?? 0) + 1)
    else bySeq.set(row.seq, [...(bySeq.get(row.seq) ?? []), row])
  for (const list of bySeq.values()) list.sort(byChange)
  const listed = [...bySeq.values()].flatMap((list) => list.slice(0, FEED_ITEMS))
  const why = await whyOf(tx, listed)
  const whyByRow = new Map(listed.map((row) => [row, why(row)]))
  const summaries = entries.map((edition) => {
    const changes = bySeq.get(edition.seq) ?? []
    const items = changes.slice(0, FEED_ITEMS).map((row) => asChange(row, whyByRow.get(row)!))
    return { edition, changes, items }
  })
  const decisions = (items: readonly ItemChange[]) =>
    items
      .flatMap((item) => item.why.decisions)
      .sort((x, y) => (x.decidedAt < y.decidedAt ? -1 : x.decidedAt > y.decidedAt ? 1 : 0))
  const named = await names(
    tx,
    summaries.flatMap(({ edition, items }) => [
      ...(edition.actorId ? [edition.actorId] : []),
      ...items.flatMap((item) => [
        ...(item.why.proposerId ? [item.why.proposerId] : []),
        ...item.why.decisions.map((d) => d.decidedBy),
      ]),
    ]),
    rows.map((row) => row.areaId),
  )
  return {
    next,
    entries: summaries.map(({ edition, changes, items }): EditionSummary => {
      // A decision made this edition when it accepted, retired or checked items; going back or
      // changing an area brings no decision of its own, only the edition's actor and note.
      const made = decidedBy.includes(edition.reason) ? decisions(items) : []
      // Who made it: the edition's actor, else (an edition from before actors were recorded) the
      // last decision that published it.
      const actorId = edition.actorId ?? made.at(-1)?.decidedBy ?? null
      // Why, in their own words: the edition's note, else the owner's or deputy's reason.
      const deciding = made.filter((d) => d.capacity !== 'approver')
      const why = edition.note ?? deciding.at(-1)?.reason ?? made.at(-1)?.reason ?? null
      const proposers = [...new Set(items.map((item) => item.why.proposerId).filter(Boolean))]
      const counts = countChanges(changes)
      const areas = sortedAreas(changes)
      return {
        edition,
        sentence: changeSentence({
          reason: edition.reason,
          restores: edition.restores,
          actor: named.person(actorId),
          proposer:
            proposers.length === 1 && changes.length === items.length
              ? named.person(proposers[0])
              : null,
          why,
          counts,
          only: changes.length === 1 ? changes[0]! : null,
          areas: areas.map(named.area),
          vocabulary: vocabulary.find((v) => v.seq === edition.seq)?.count ?? 0,
          withheld: withheld.get(edition.seq) ?? 0,
        }),
        counts,
        areas,
        highestRisk: highestRisk(changes.map((change) => change.riskLevel)),
        vocabulary: vocabulary.find((v) => v.seq === edition.seq)?.count ?? 0,
        actorId,
        why,
        items,
        more: changes.length - items.length,
        withheld: withheld.get(edition.seq) ?? 0,
      }
    }),
  }
}

/**
 * Versions an edition serves that the serving guard would refuse to serve again (FR-205), with
 * the database's own reason (`cl_item_version_problem`). A version still served needs no check.
 * The title of a version with an audience group stays out, as everywhere in these reads.
 */
export function blockedVersions(
  tx: Queryable,
  seq: number,
): Promise<z.infer<typeof blockedVersionSchema>[]> {
  return tx.query(
    `select v.item_id as "itemId",case when cl_audience_allows(v.audience_groups) then v.title end as title,
       v.version_no as version,p.problem
       from item_version_service t join item_versions v on v.id=t.version_id
       cross join lateral (select cl_item_version_problem(t.version_id) as problem) p
      where t.editions @> $1::bigint and p.problem is not null
        and not exists (select 1 from item_version_service s where s.item_id=t.item_id
                         and s.version_id=t.version_id and upper_inf(s.editions))
      order by v.title,v.item_id`,
    [seq],
  )
}

/** G7: what going back to an edition would change, and what would stop it, before anyone does it. */
export async function rollbackPreview(tx: Queryable, label: string) {
  const target = await editionByLabel(tx, label)
  const live = await liveEdition(tx)
  const comparison = await compareEditions(tx, { from: live.label, to: target.label })
  return { live, target, comparison, blocked: await blockedVersions(tx, target.seq) }
}
