import type { AuditMembers, AuditWorld, QueueLine } from '@domain/audit'
import {
  answerRecords,
  recogniseRecords,
  refusedAnswer,
  type RecordsAnswer,
  type RecordsAsk,
  type RecordsItem,
  type RecordsRecognition,
  type RecordsWorld,
} from '@domain/records'
import { cardGroups } from '@domain/inbox'
import type { Term } from '@domain/vocabulary'
import { toServerValidity } from '@/model/validity'
import { HIDE_UNDER } from '@/api/mock/obs-engine'
import type { Definition } from '@/lib/definitions'
import type { AskedRow } from '@/model/ask'
import type { ConflictRow } from '@/model/conflicts'
import type { DomainId, Fact } from '@/model/items'
import { addDays } from '@domain/status'
import { labelDay } from '@/model/validity'
import { facts as seedFacts, markets, metrics } from './data/world'

// Records answers on the mock binding: the service's (src/server/modules/answer/records.ts) over the
// demo world, from the same pure reader and the same templates (src/domain/records.ts), so both
// bindings answer a records question alike. The records are the Context list's own: every
// published and archived context item, never a draft.

/** The demo world's moment: noon on its today, 23 Oct 2026, UTC. */
export const RECORDS_NOW = '2026-10-23T12:00:00.000Z'

const slug = (name: string) => name.toLowerCase().replace(/\W+/g, '_')
/** A day's label as an instant: "3 Oct 2026" at 09:00 UTC. */
const instant = (label: string) => {
  const day = labelDay(label)
  return day ? `${day}T09:00:00.000Z` : null
}
/** When each item of the demo world was first published: its first check, before any change since. */
const firstPublished = new Map(seedFacts.map((f) => [f.id, instant(f.checkedOn)]))

/**
 * A dimension's values as the demo world lists them: the markets, or the names its definition
 * gives ("Footwear, Clothing, Camping, Climbing"). One it only counts ("2,400 campaigns") lists none.
 */
const valuesOf = (d: Definition) =>
  d.name === 'Market'
    ? markets
    : /,\s/.test(d.values ?? '')
      ? d.values!.split(/,\s+/).map((v) => v.trim())
      : []

/** The vocabulary as the engine names it: the metrics and dimensions with their domains, and their values. */
export function termsOf(definitions: readonly Definition[]): Term[] {
  const term = (
    key: string,
    kind: Term['kind'],
    name: string,
    areaId: string | null,
    aliases: string[] = [],
  ): Term => ({ key, kind, name, aliases, parentKey: null, areaId, definitionRefs: [] })
  const synonyms = (name: string) => definitions.filter((d) => d.sameAs === name).map((d) => d.name)
  return [
    ...definitions
      .filter((d) => d.type === 'metric' && !d.sameAs)
      .map((d) =>
        term(`metric:${slug(d.name)}`, 'metric', d.name, d.domain ?? null, [
          ...synonyms(d.name),
          ...(metrics.find((m) => m.name === d.name)?.otherNames ?? []),
        ]),
      ),
    ...definitions
      .filter((d) => d.type === 'dimension' && !d.sameAs)
      .map((d) => term(`dim:${slug(d.name)}`, 'dimension', d.name, d.domain ?? null)),
    ...definitions
      .filter((d) => d.type === 'dimension' && !d.sameAs)
      .flatMap((d) =>
        valuesOf(d).map((v) => ({
          ...term(`val:${slug(d.name)}/${slug(v)}`, 'dimension_value', v, null),
          parentKey: `dim:${slug(d.name)}`,
        })),
      ),
  ]
}

/**
 * Where the words name a metric, a dimension or a market, as the engine's reader finds names: whole
 * words, longest first.
 */
function spansOf(question: string, terms: readonly Term[]) {
  const names = terms
    .filter((t) => t.kind !== 'metric_group')
    .flatMap((t) => [t.name, ...t.aliases].map((name) => ({ name, key: t.key })))
    .sort((a, b) => b.name.length - a.name.length)
  const spans: { start: number; end: number; keys: string[] }[] = []
  for (const { name, key } of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const found = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').exec(question)
    if (!found) continue
    const at = { start: found.index, end: found.index + found[0].length, keys: [key] }
    if (!spans.some((s) => s.start < at.end && at.start < s.end)) spans.push(at)
  }
  return spans
}

/** The Context list's items as the records keep them. */
function itemsOf(pool: readonly Fact[]): RecordsItem[] {
  return pool.flatMap((f): RecordsItem[] => {
    if (f.status === 'Draft') return []
    const checked = instant(f.checkedOn)
    const day = labelDay(f.checkedOn)
    const due = day ? addDays(day, 90) : ''
    return [
      {
        id: f.id,
        kind: f.kind,
        areaId: f.domain,
        title: f.title,
        status:
          f.status === 'Archived' ? 'archived' : f.status === 'Needs checking' ? 'due' : 'live',
        // The demo world's check date is 90 days after the last check, as its Context list reads it.
        reviewDate: day && due < RECORDS_NOW.slice(0, 10) ? due : null,
        // Due before its check date: its definition changed since it was checked.
        checkFlag:
          f.status === 'Needs checking' && !(day && due < RECORDS_NOW.slice(0, 10))
            ? 'needs_check'
            : null,
        publishedAt: firstPublished.get(f.id) ?? checked,
        changedAt: checked,
        checkedAt: checked,
        // The demo world keeps no day an item was archived: its last decision is the archiving.
        archivedAt: f.status === 'Archived' ? checked : null,
        owners: f.owners ?? [],
      },
    ]
  })
}

/**
 * Asked this week's rows as the records read them: counts, small ones hidden, and the open card for
 * those who manage the topic's domain, as on the service.
 */
function askedOf(
  rows: readonly AskedRow[],
  manages: (domain: DomainId | undefined) => boolean,
): NonNullable<RecordsWorld['asked']> {
  return {
    minimum: HIDE_UNDER,
    rows: rows.map((r) => {
      const card = r.next?.href.match(/card=([^&]+)/)?.[1]
      const draft = r.next?.href.match(/gap=([^&]+)/)?.[1]
      return {
        title: r.title,
        count: r.count.endsWith('+') ? null : Number(r.count),
        atLeast: r.times,
        nothing: r.nothing,
        state: r.state,
        area: r.topic.domain ?? null,
        metrics: r.topic.metric ? [`metric:${slug(r.topic.metric)}`] : [],
        values: markets.includes(r.topic.where) ? [`val:market/${slug(r.topic.where)}`] : [],
        gap:
          r.next && manages(r.topic.domain)
            ? { card: card ? decodeURIComponent(card) : (draft ?? ''), draft: draft ?? null }
            : null,
      }
    }),
  }
}

/** What the demo's source lists that no term names: its two date members, left out on purpose. */
const members: AuditMembers = {
  total: 31,
  unlinked: [
    { name: 'Order day', valueType: 'Date', suggested: false },
    { name: 'Marketing day', valueType: 'Date', suggested: false },
  ],
}

/** What an analysis reads in the demo world, as the service reads the catalogue (FR-720). */
function auditOf(world: Pick<RecordsSource, 'pool' | 'definitions'>): AuditWorld {
  const live = world.pool.filter((f) => f.status === 'Live' || f.status === 'Needs checking')
  const names = new Map(world.definitions.map((d) => [d.name, d]))
  const key = (name: string) => (names.get(name)?.type === 'metric' ? `metric:${slug(name)}` : null)
  return {
    terms: world.definitions
      .filter((d) => (d.type === 'metric' || d.type === 'dimension') && !d.sameAs)
      .map((d) => {
        const about = live.filter((f) =>
          d.type === 'metric'
            ? f.where.includes(d.name)
            : d.name === 'Market' && f.where.some((w) => markets.includes(w)),
        )
        const count = (kind: RecordsItem['kind']) => about.filter((f) => f.kind === kind).length
        return {
          key: d.type === 'metric' ? `metric:${slug(d.name)}` : `dim:${slug(d.name)}`,
          kind: d.type as 'metric' | 'dimension',
          name: d.name,
          areaId: d.domain ?? null,
          state: d.changed ? ('changed' as const) : ('current' as const),
          words: d.definition || null,
          shelf: {
            event: count('event'),
            issue: count('issue'),
            note: count('note'),
            guide: count('guide'),
          },
        }
      }),
    items: live.map((f) => ({
      id: f.id,
      kind: f.kind,
      title: f.title,
      areaId: f.domain,
      metrics: f.where.flatMap((w) => key(w) ?? []),
      values: f.where.filter((w) => markets.includes(w)).map((w) => `val:market/${slug(w)}`),
      start: toServerValidity(f.valid).start ?? '2000-01-01',
      end: toServerValidity(f.valid).end ?? null,
      conflicts: [
        ...(f.disagreesWith ? [f.disagreesWith] : []),
        ...world.pool.filter((x) => x.disagreesWith === f.id).map((x) => x.id),
      ],
    })),
    members,
    readAt: `${RECORDS_NOW.slice(0, 10)}T06:00:00.000Z`,
  }
}

/** The Conflicts filter's rows as the records read them; the demo says since when as "24 Sep". */
const conflictsOf = (rows: readonly ConflictRow[]): NonNullable<RecordsWorld['conflicts']> =>
  rows.map((r) => ({
    key: r.key,
    holder: { id: r.holder.id, title: r.holder.title ?? '', areaId: r.holder.domain },
    other: { id: r.other.id, title: r.other.title ?? '', areaId: r.other.domain },
    topic: r.topic,
    since: r.since ? labelDay(`${r.since} ${RECORDS_NOW.slice(0, 4)}`) : null,
  }))

/**
 * The records answer to a typed question, or null when it is not a records question: the matcher
 * answers it then, as before.
 */
/** How a question reads as a records question, as the service's reader reads it, or null. */
export function recognisedFor(
  question: string,
  world: Pick<RecordsSource, 'definitions' | 'domains'> & { people?: readonly string[] },
): RecordsRecognition | null {
  const terms = termsOf(world.definitions)
  return recogniseRecords(question, {
    spans: spansOf(question, terms),
    terms,
    domains: world.domains,
    now: RECORDS_NOW,
    glossary: world.definitions.filter((d) => d.type === 'term' && !d.sameAs),
    people: world.people,
    tools: [...new Set(world.definitions.flatMap((d) => d.tool ?? []))],
  })
}

/** The demo world a records answer is counted from. */
type RecordsSource = {
  pool: readonly Fact[]
  domains: readonly { id: DomainId; name: string; owners: readonly string[] }[]
  definitions: readonly Definition[]
  asked: () => readonly AskedRow[]
  /** The conflicts as Context's Conflicts filter lists them to the person. */
  conflicts: () => readonly ConflictRow[]
  /** Whether the person manages a domain's topics: an administrator, or one of its owners. */
  manages: (domain: DomainId | undefined) => boolean
  /** The person's own Inbox, by group. */
  queue: () => readonly QueueLine[]
}

/** The person's cards as the Inbox groups them: how many of each, most needing first. */
export const queueOf = (cards: readonly { type: string }[]): QueueLine[] =>
  cardGroups.flatMap((group) => {
    const count = cards.filter((c) => c.type === group).length
    return count ? [{ group, count }] : []
  })

/** A records question answered, as the rules read it or as a plan chose it. */
export function recordsOf(ask: RecordsAsk, world: RecordsSource): RecordsAnswer {
  // The demo world names owners by name, so a name is its own id here.
  const areas = world.domains.map((d) => ({ id: d.id, name: d.name, ownerIds: [...d.owners] }))
  const names = new Set(areas.flatMap((a) => a.ownerIds))
  const facets = ask.audit?.facets ?? []
  const analysis = ask.intent === 'audit' || ask.intent === 'queue' || !!ask.over
  const reviews = facets.includes('review')
  const asks = (...wanted: string[]) => reviews || facets.some((f) => wanted.includes(f))
  return answerRecords(
    ask,
    {
      items: itemsOf(world.pool),
      areas,
      people: Object.fromEntries([...names].map((n) => [n, n])),
      terms: termsOf(world.definitions),
      asked:
        ask.intent === 'asked_nothing' || asks('asked_nothing', 'asked_most')
          ? askedOf(world.asked(), world.manages)
          : null,
      conflicts:
        ask.intent === 'conflicts' || asks('conflicts', 'overlaps')
          ? conflictsOf(world.conflicts())
          : null,
      audit: analysis ? auditOf(world) : null,
      queue: ask.intent === 'queue' ? world.queue() : null,
      glossary: world.definitions.flatMap((d) =>
        d.type === 'term' && d.definition ? [{ name: d.name, meaning: d.definition }] : [],
      ),
    },
    RECORDS_NOW,
  )
}

export function recordsFor(question: string, world: RecordsSource): RecordsAnswer | null {
  const found = recognisedFor(question, world)
  if (!found) return null
  if (found.type === 'refused')
    return refusedAnswer({
      areas: world.domains.map((d) => ({ id: d.id, name: d.name, ownerIds: [...d.owners] })),
    })
  return recordsOf(found.ask, world)
}
