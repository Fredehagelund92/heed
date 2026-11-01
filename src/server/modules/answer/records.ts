import type { Asked, LookupInput, RecordsAnswer } from '../../../contract/answer.ts'
import type { LibraryIndex } from '../../../contract/schemas.ts'
import {
  answerRecords,
  recogniseRecords,
  recordsKinds,
  refusedAnswer,
  type RecordsAsk,
  type RecordsIntent,
  type RecordsItem,
  type RecordsKind,
  type RecordsWorld,
} from '../../../domain/records.ts'
import { readQuestion } from '../../../domain/scope.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import type { ServingBundle } from '../editions/index.ts'

/*
  Records answers on the service (src/domain/records.ts): a question about the context's own
  records, answered from the reads the person's own request already makes, inside its transaction,
  so row security and the audience rule apply to every count and every title. The items are the
  Context list's (`library.index`: published and archived, never a draft, a suggestion or a
  deleted item, and never one an audience rule hides). Their times come from the editions that
  served them, for those items only. The vocabulary is the live edition's, as Definitions shows it
  to the person: a term whose definition their groups may not see is left out (CON-509). Owners are named as Context names them; nothing is read by
  person, no comment is read, and what agents asked comes from Asked this week, as counts only,
  small ones hidden. The question itself is never stored: only which of the records questions it
  was, by week, as a count.
*/

const DAY = 86_400_000

/** The reads a records answer is made from, each as the person's request makes it. */
export type RecordsReads = {
  /** The Context list's items, as `library.index` gives them to the person. */
  index: () => Promise<LibraryIndex>
  /** The domains and their owners, by id. */
  areas: () => Promise<{ id: string; name: string; ownerIds: string[] }[]>
  /** The workspace's people, by name, as Context names owners. */
  people: () => Promise<{ id: string; name: string }[]>
  /** Asked this week, with its minimum. */
  asked: () => Promise<{ asked: Asked; minimum: number }>
  /** The definitions the person's groups may not see, by ref, as the catalogue leaves them out. */
  hidden: () => Promise<readonly string[]>
}

/** A question is read as a records question only as words: a scope picked with @ is the engine's. */
const wordsOnly = (input: LookupInput) =>
  !input.metrics?.length && !input.dimension_filters?.length && !input.window

/**
 * The service's own moment, and how far its day is from the clock's: a demo or a test may pin the
 * day (`CL_FIXED_TODAY`), and then every time the database stamped is moved by the same days, as
 * the web app moves them, so "the last 24 hours" ends now on the day it keeps.
 */
function momentOf(clock: Clock): { now: string; shift: number } {
  const real = clock.now()
  const shift = Date.parse(clock.today()) - Date.parse(real.toISOString().slice(0, 10))
  return {
    now: new Date(real.getTime() + shift).toISOString(),
    shift: Math.round(shift / DAY) * DAY,
  }
}

/** When each listed item was first served, last left service, and its version last confirmed. */
async function timesOf(
  tx: Queryable,
  items: readonly { id: string; version: number }[],
): Promise<
  Map<string, { published: string | null; ended: string | null; checked: string | null }>
> {
  if (!items.length) return new Map()
  const iso = (column: string) =>
    `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
  // Only the items the person's index listed; the rule of each column is the index's own: an
  // edition's time is when it was made, and a check is the last acceptance of the version that is
  // not an approver's (cl_version_review).
  const rows = await tx.query<{
    id: string
    published: string | null
    ended: string | null
    checked: string | null
  }>(
    `with listed as materialized (
       select * from unnest($1::text[], $2::int[]) as l(id, version)),
     served as (
       select s.item_id as id, min(lo.created_at) as published, max(up.created_at) as ended
         from item_version_service s
         join listed l on l.id = s.item_id
         join editions lo on lo.seq = lower(s.editions)
         left join editions up on up.seq = upper(s.editions)
        group by s.item_id),
     checked as (
       select l.id, max(d.decided_at) as at
         from listed l
         join item_versions v on v.item_id = l.id and v.version_no = l.version
         join decisions d on d.item_version_id = v.id
        where d.outcome = 'accept' and d.capacity <> 'approver'
        group by l.id)
     select l.id, ${iso('s.published')} as published, ${iso('s.ended')} as ended,
            ${iso('c.at')} as checked
       from listed l left join served s on s.id = l.id left join checked c on c.id = l.id`,
    [items.map((i) => i.id), items.map((i) => i.version)],
  )
  return new Map(rows.map((r) => [r.id, r]))
}

const isRecordsKind = (kind: string): kind is RecordsKind =>
  (recordsKinds as readonly string[]).includes(kind)

/** The Context list's items as the records keep them, with their times moved to the service's day. */
async function itemsOf(tx: Queryable, index: LibraryIndex, shift: number): Promise<RecordsItem[]> {
  const listed = index.items.filter((i) => isRecordsKind(i.kind))
  const times = await timesOf(tx, listed)
  const moved = (iso: string | null | undefined) =>
    iso ? new Date(Date.parse(iso) + shift).toISOString() : null
  return listed.map((i) => {
    const t = times.get(i.id)
    return {
      id: i.id,
      kind: i.kind as RecordsKind,
      areaId: i.areaId,
      title: i.title,
      status: i.status === 'retired' ? 'archived' : i.trust === 'needs_check' ? 'due' : 'live',
      reviewDate: i.reviewDate,
      checkFlag: i.checkFlag,
      publishedAt: moved(t?.published),
      changedAt: moved(i.updatedAt),
      checkedAt: moved(t?.checked),
      archivedAt: i.status === 'retired' ? moved(t?.ended) : null,
      owners: i.owners,
    }
  })
}

/** What one intent needs read; the rest is left empty. */
const needs = (ask: RecordsAsk) => ({
  items: ask.intent !== 'asked_nothing' && ask.intent !== 'terms' && ask.intent !== 'values',
  asked: ask.intent === 'asked_nothing',
  terms:
    ask.intent === 'terms' ||
    ask.intent === 'values' ||
    (ask.intent === 'count' && ask.kind === 'definition'),
})

/** Counts that a records question of this intent was asked this week: the id only, never the words. */
async function countIntent(tx: Queryable, intent: RecordsIntent | 'refused', today: string) {
  await tx.query(
    `insert into records_asked_weekly (week, intent, asks)
     values (date_trunc('week', $1::date)::date, $2, 1)
     on conflict (week, intent) do update set asks = records_asked_weekly.asks + 1`,
    [today, intent],
  )
}

/**
 * The records answer to a question, or null when it is not a records question and not about one
 * person's work: the answer engine reads it then, as before.
 */
export async function recordsAnswerOf(
  tx: Queryable,
  clock: Clock,
  bundle: ServingBundle,
  input: LookupInput,
  reads: RecordsReads,
): Promise<RecordsAnswer | null> {
  if (!wordsOnly(input)) return null
  const today = clock.today()
  const { now, shift } = momentOf(clock)
  const read = readQuestion(input.question, bundle.terms, today)
  const areas = await reads.areas()
  const found = recogniseRecords(input.question, {
    spans: read.spans,
    terms: bundle.terms,
    domains: areas,
    now,
  })
  if (!found) return null
  await countIntent(tx, found.type === 'refused' ? 'refused' : found.ask.intent, today)
  if (found.type === 'refused') return refusedAnswer({ areas })
  return answerRecords(found.ask, await worldFor(tx, found.ask, reads, areas, bundle, shift), now)
}

async function worldFor(
  tx: Queryable,
  ask: RecordsAsk,
  reads: RecordsReads,
  areas: Awaited<ReturnType<RecordsReads['areas']>>,
  bundle: ServingBundle,
  shift: number,
): Promise<RecordsWorld> {
  const need = needs(ask)
  const [items, people, asked, hidden] = await Promise.all([
    need.items ? reads.index().then((index) => itemsOf(tx, index, shift)) : [],
    reads.people(),
    need.asked ? reads.asked() : null,
    need.terms ? reads.hidden().then((refs) => new Set(refs)) : new Set<string>(),
  ])
  // A term is left out when its groups may not see one of its definitions, as the catalogue
  // leaves it out, and a value with its dimension.
  const shown = new Set(
    bundle.terms.filter((t) => !t.definitionRefs.some((ref) => hidden.has(ref))).map((t) => t.key),
  )
  return {
    items,
    areas,
    people: Object.fromEntries(people.map((p) => [p.id, p.name])),
    // A metric's domain by the one domain rule (FR-136): the vocabulary's, else its source's.
    terms: bundle.terms
      .filter((t) => shown.has(t.key) && (!t.parentKey || shown.has(t.parentKey)))
      .map((t) => (t.kind === 'metric' ? { ...t, areaId: bundle.metricArea[t.key] ?? null } : t)),
    asked: asked && {
      minimum: asked.minimum,
      rows: asked.asked.rows.map((r) => ({
        title: r.title,
        count: r.count,
        atLeast: r.atLeast,
        state: r.state,
        gap: r.gap,
      })),
    },
  }
}
