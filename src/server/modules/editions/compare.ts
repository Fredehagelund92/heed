import type * as z from 'zod/mini'
import type {
  blockedVersionSchema,
  changeWhySchema,
  editionComparisonSchema,
  editionCompareInputSchema,
  itemChangeSchema,
} from '../../../contract/editions.ts'
import type { Edition } from '../../../contract/review.ts'
import {
  changeSentence,
  editionChangeKinds,
  noChanges,
  type ChangeCounts,
  type EditionChangeKind,
} from '../../../domain/editions.ts'
import type { ItemKind, RiskLevel } from '../../../domain/item.ts'
import type { ItemVersion } from '../../../domain/item-version.ts'
import { versionDiff } from '../../../domain/review.ts'
import type { Queryable } from '../../db/database.ts'
import { forReader } from '../library/index.ts'
import { readVersions } from '../proposals/index.ts'
import { editionByLabel, editionFields, liveEdition } from './release.ts'

type Why = z.infer<typeof changeWhySchema>
type ItemChange = z.infer<typeof itemChangeSchema>
type Comparison = z.infer<typeof editionComparisonSchema>

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
async function compareEditions(
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
