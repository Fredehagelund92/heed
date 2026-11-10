import type { Asked, LookupInput, RecordsAnswer } from '../../../contract/answer.ts'
import type { Catalogue } from '../../../contract/index.ts'
import type { ConflictList } from '../../../contract/conflicts.ts'
import type { LibraryIndex } from '../../../contract/schemas.ts'
import type {
  AuditItem,
  AuditMembers,
  AuditTerm,
  AuditWorld,
  QueueLine,
} from '../../../domain/audit.ts'
import {
  answerRecords,
  recogniseRecords,
  recordsKinds,
  refusedAnswer,
  type RecordsAsk,
  type RecordsIntent,
  type RecordsItem,
  type RecordsKind,
  type RecordsRecognition,
  type RecordsWorld,
} from '../../../domain/records.ts'
import { asksDefinition, readQuestion } from '../../../domain/scope.ts'
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
  small ones hidden. The conflicts are the Context list's Conflicts filter (`conflicts.list`), so
  a pair the person may not read whole is not there. An analysis (FR-720) reads the catalogue as
  Definitions shows it to the person, and the person's own Inbox. The question itself is never
  stored: only which of the records questions it was, by week, as a count.
*/

const DAY = 86_400_000

/** A topic that shows no count of the minimum: a row only for a question that names it. */
export type UnlistedTopic = NonNullable<RecordsWorld['asked']>['rows'][number]

/** The reads a records answer is made from, each as the person's request makes it. */
export type RecordsReads = {
  /** The Context list's items, as `library.index` gives them to the person. */
  index: () => Promise<LibraryIndex>
  /** The domains and their owners, by id. */
  areas: () => Promise<{ id: string; name: string; ownerIds: string[] }[]>
  /** The workspace's people, by name, as Context names owners. */
  people: () => Promise<{ id: string; name: string }[]>
  /** What agents asked, as this reader may have it, with its minimum. */
  asked: () => Promise<{
    asked: Asked
    minimum: number
    unlisted: UnlistedTopic[]
    domains: Record<string, number>
  }>
  /** Whether the person is an administrator, and the domains they own. */
  reader: () => Promise<{ admin: boolean; areas: readonly string[] }>
  /** The definitions the person's groups may not see, by ref, as the catalogue leaves them out. */
  hidden: () => Promise<readonly string[]>
  /** The conflicts, as Context's Conflicts filter lists them to the person. */
  conflicts: () => Promise<ConflictList>
  /** Definitions as the catalogue shows them to the person. */
  catalogue: () => Promise<Catalogue>
  /** What the sources list that no term names. */
  members: () => Promise<AuditMembers>
  /** The person's own Inbox, by group. */
  queue: () => Promise<readonly QueueLine[]>
  /** The words people wrote in Definitions, with what they wrote. */
  glossary: () => Promise<readonly { name: string; meaning: string }[]>
}

/** A question is read as a records question only as words: a scope picked with @ is the engine's. */
const wordsOnly = (input: LookupInput) =>
  !input.metrics?.length && !input.dimension_filters?.length && !input.window

/**
 * The service's own moment, and what moves a stamp to it: a demo or a test may pin the day
 * (`HEED_FIXED_TODAY`), and then every time the database stamped while it runs is moved by the same
 * days, onto the day it keeps. A day pinned in the past is kept whole: its moment is the end of that
 * day, so all it holds has happened, at any hour it runs. A stamp already on or before that moment
 * is the day it says, as the Context list shows it: it is left alone.
 */
export function momentOf(clock: Clock): { now: string; moved: (iso: string) => string } {
  const real = clock.now()
  const kept = Date.parse(clock.today())
  const gap = kept - Date.parse(real.toISOString().slice(0, 10))
  const shift = Math.round(gap / DAY) * DAY
  const now = new Date(shift < 0 ? kept + DAY - 1 : real.getTime() + gap).toISOString()
  return {
    now,
    moved: (iso) =>
      shift > 0 || Date.parse(iso) > Date.parse(now)
        ? new Date(Date.parse(iso) + shift).toISOString()
        : iso,
  }
}

/** When each listed item was first served and last left service. */
async function timesOf(
  tx: Queryable,
  items: readonly { id: string; version: number }[],
): Promise<Map<string, { published: string | null; ended: string | null }>> {
  if (!items.length) return new Map()
  const iso = (column: string) =>
    `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
  // Only the items the person's index listed; an edition's time is when it was made.
  const rows = await tx.query<{ id: string; published: string | null; ended: string | null }>(
    `with listed as materialized (
       select * from unnest($1::text[], $2::int[]) as l(id, version)),
     served as (
       select s.item_id as id, min(lo.created_at) as published, max(up.created_at) as ended
         from item_version_service s
         join listed l on l.id = s.item_id
         join editions lo on lo.seq = lower(s.editions)
         left join editions up on up.seq = upper(s.editions)
        group by s.item_id)
     select l.id, ${iso('s.published')} as published, ${iso('s.ended')} as ended
       from listed l left join served s on s.id = l.id`,
    [items.map((i) => i.id), items.map((i) => i.version)],
  )
  return new Map(rows.map((r) => [r.id, r]))
}

const isRecordsKind = (kind: string): kind is RecordsKind =>
  (recordsKinds as readonly string[]).includes(kind)

/**
 * The Context list's items as the records keep them, with their times moved to the service's day.
 * Each date is the field the list shows: the last check is its `lastChecked`, and an item is due
 * when its `trust` says so.
 */
export async function itemsOf(
  tx: Queryable,
  index: LibraryIndex,
  moment: Pick<ReturnType<typeof momentOf>, 'moved'>,
  dated = true,
): Promise<RecordsItem[]> {
  const listed = index.items.filter((i) => isRecordsKind(i.kind))
  const times = await timesOf(tx, dated ? listed : [])
  const moved = (iso: string | null | undefined) => (iso ? moment.moved(iso) : null)
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
      checkedAt: i.lastChecked ? moved(`${i.lastChecked.on}T00:00:00.000Z`) : null,
      archivedAt: i.status === 'retired' ? moved(t?.ended) : null,
      owners: i.owners,
      metrics: i.scope.metrics.map((m) => `metric:${m}`),
      values: i.scope.dimensionValues.map((v) => `val:${v.dimension}/${v.value}`),
    }
  })
}

/** What one intent needs read; the rest is left empty. */
const needs = (ask: RecordsAsk) => {
  const facets = ask.audit?.facets ?? ask.over?.facets ?? []
  const analysis = ask.intent === 'audit' || ask.intent === 'queue' || !!ask.over
  const reviews = facets.includes('review')
  return {
    items: !!ask.about || !['asked_nothing', 'terms', 'values', 'glossary'].includes(ask.intent),
    asked:
      ask.intent === 'asked_nothing' ||
      reviews ||
      facets.includes('asked_nothing') ||
      facets.includes('asked_most'),
    conflicts:
      ask.intent === 'conflicts' ||
      reviews ||
      facets.includes('conflicts') ||
      facets.includes('overlaps'),
    terms:
      analysis ||
      ask.intent === 'terms' ||
      ask.intent === 'values' ||
      (ask.intent === 'count' && ask.kind === 'definition'),
    audit: analysis,
    members: facets.includes('unlinked'),
    queue: ask.intent === 'queue',
    glossary: ask.intent === 'glossary',
  }
}

/** A catalogue term as an analysis reads it. */
const auditTermOf = (t: Catalogue['terms'][number]): AuditTerm => ({
  key: t.key,
  kind: t.kind,
  name: t.name,
  areaId: t.domain.areaId,
  state:
    t.definition?.state === 'missing'
      ? 'gone'
      : t.definition?.state === 'changed'
        ? 'changed'
        : 'current',
  changedAt: t.definition?.changedAt ?? null,
  words: t.definition?.descriptionCopy ?? null,
  shelf: {
    event: t.shelf.byKind.event,
    issue: t.shelf.byKind.issue,
    note: t.shelf.byKind.note,
    guide: t.shelf.byKind.guide,
  },
})

/** The Context list's live items as an analysis compares them, by the same keys Definitions has. */
function auditItemsOf(index: LibraryIndex, conflicts: ConflictList | null): AuditItem[] {
  const marked = (id: string) =>
    (conflicts?.rows ?? []).flatMap((r) =>
      r.holder.id === id ? [r.other.id] : r.other.id === id ? [r.holder.id] : [],
    )
  return index.items.flatMap((i): AuditItem[] =>
    isRecordsKind(i.kind) && i.status === 'accepted'
      ? [
          {
            id: i.id,
            kind: i.kind,
            title: i.title,
            areaId: i.areaId,
            metrics: i.scope.metrics.map((m) => `metric:${m}`),
            values: i.scope.dimensionValues.map((v) => `val:${v.dimension}/${v.value}`),
            start: i.validity.start,
            end: i.validity.end,
            conflicts: marked(i.id),
          },
        ]
      : [],
  )
}

/** What an analysis reads beyond a records answer: from what the person may see. */
async function auditWorldOf(
  reads: RecordsReads,
  need: ReturnType<typeof needs>,
  conflicts: ConflictList | null,
): Promise<AuditWorld> {
  // One after the other: a transaction runs one statement at a time.
  const catalogue = await reads.catalogue()
  const index = await reads.index()
  const members = need.members ? await reads.members() : { total: 0, unlinked: [] }
  const read = catalogue.sources
    .flatMap((source) => source.readAt ?? [])
    .sort()
    .at(-1)
  return {
    terms: catalogue.terms.map(auditTermOf),
    items: auditItemsOf(index, conflicts),
    members,
    readAt: read ?? null,
  }
}

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
 * How a question reads as a records question, or null when it is not one and not about one
 * person's work: the answer engine reads it then, as before. Nothing is counted yet.
 */
export async function recogniseRecordsOf(
  clock: Clock,
  bundle: ServingBundle,
  input: LookupInput,
  reads: Pick<RecordsReads, 'areas' | 'glossary' | 'people'>,
): Promise<RecordsRecognition | null> {
  if (!wordsOnly(input)) return null
  const read = readQuestion(input.question, bundle.terms, clock.today(), { loose: true })
  // A word of the workspace's own is read only for a question about what a word means.
  const named = read.terms.some((t) => t.kind === 'metric' || t.kind === 'metric_group')
  const glossary = asksDefinition(input.question) && !named ? await reads.glossary() : undefined
  return recogniseRecords(input.question, {
    spans: read.spans,
    terms: bundle.terms,
    domains: await reads.areas(),
    now: momentOf(clock).now,
    people: (await reads.people()).map((person) => person.name),
    tools: [...new Set(bundle.terms.flatMap((term) => term.described?.tool ?? []))],
    ...(glossary ? { glossary } : {}),
  })
}

/**
 * The records answer to a records question, read by the rules or chosen by Ask's planner
 * (FR-719), from what the person may see. Only which question it was is counted, by week.
 */
export async function answerRecordsOf(
  tx: Queryable,
  clock: Clock,
  bundle: ServingBundle,
  found: RecordsRecognition,
  reads: RecordsReads,
): Promise<RecordsAnswer> {
  const moment = momentOf(clock)
  const areas = await reads.areas()
  await countIntent(tx, found.type === 'refused' ? 'refused' : found.ask.intent, clock.today())
  if (found.type === 'refused') return refusedAnswer({ areas })
  const world = await worldFor(tx, found.ask, reads, areas, bundle, moment)
  return answerRecords(found.ask, world, moment.now)
}

async function worldFor(
  tx: Queryable,
  ask: RecordsAsk,
  reads: RecordsReads,
  areas: Awaited<ReturnType<RecordsReads['areas']>>,
  bundle: ServingBundle,
  moment: Pick<ReturnType<typeof momentOf>, 'moved'>,
): Promise<RecordsWorld> {
  const need = needs(ask)
  const [items, people, asked, hidden, conflicts] = await Promise.all([
    // An analysis reads an item's state and its check date, never when it was served.
    need.items ? reads.index().then((index) => itemsOf(tx, index, moment, !need.audit)) : [],
    reads.people(),
    need.asked ? reads.asked() : null,
    need.terms ? reads.hidden().then((refs) => new Set(refs)) : new Set<string>(),
    need.conflicts ? reads.conflicts() : null,
  ])
  const queue = need.queue ? await reads.queue() : null
  const glossary = need.glossary ? await reads.glossary() : null
  const audit = need.audit ? await auditWorldOf(reads, need, conflicts) : null
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
      start: asked.asked.week,
      domains: asked.domains,
      rows: [
        ...asked.asked.rows.map((r) => ({
          title: r.title,
          count: r.count,
          atLeast: r.atLeast,
          nothing: r.nothing,
          state: r.state,
          gap: r.gap,
          area: r.area,
          metrics: r.scope.metrics,
          values: Object.values(r.scope.filters).flat(),
        })),
        ...asked.unlisted,
      ],
    },
    // The list shows only pairs the person may read whole, so both titles are there.
    conflicts:
      conflicts?.rows.map((r) => ({
        key: r.key,
        holder: { id: r.holder.id, title: r.holder.title ?? '', areaId: r.holder.areaId },
        other: { id: r.other.id, title: r.other.title ?? '', areaId: r.other.areaId },
        topic: r.topic,
        since: r.since,
      })) ?? null,
    audit,
    queue,
    glossary,
  }
}
