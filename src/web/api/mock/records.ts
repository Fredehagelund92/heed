import {
  answerRecords,
  recogniseRecords,
  refusedAnswer,
  type RecordsAnswer,
  type RecordsItem,
  type RecordsWorld,
} from '@domain/records'
import type { Term } from '@domain/vocabulary'
import { HIDE_UNDER } from '@/api/mock/obs-engine'
import type { Definition } from '@/lib/definitions'
import type { AskedRow } from '@/model/ask'
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
function termsOf(definitions: readonly Definition[]): Term[] {
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
        state: r.state,
        gap:
          r.next && manages(r.topic.domain)
            ? { card: card ? decodeURIComponent(card) : (draft ?? ''), draft: draft ?? null }
            : null,
      }
    }),
  }
}

/**
 * The records answer to a typed question, or null when it is not a records question: the matcher
 * answers it then, as before.
 */
export function recordsFor(
  question: string,
  world: {
    pool: readonly Fact[]
    domains: readonly { id: DomainId; name: string; owners: readonly string[] }[]
    definitions: readonly Definition[]
    asked: () => readonly AskedRow[]
    /** Whether the person manages a domain's topics: an administrator, or one of its owners. */
    manages: (domain: DomainId | undefined) => boolean
  },
): RecordsAnswer | null {
  const terms = termsOf(world.definitions)
  const found = recogniseRecords(question, {
    spans: spansOf(question, terms),
    terms,
    domains: world.domains,
    now: RECORDS_NOW,
  })
  if (!found) return null
  // The demo world names owners by name, so a name is its own id here.
  const areas = world.domains.map((d) => ({ id: d.id, name: d.name, ownerIds: [...d.owners] }))
  if (found.type === 'refused') return refusedAnswer({ areas })
  const names = new Set(areas.flatMap((a) => a.ownerIds))
  return answerRecords(
    found.ask,
    {
      items: itemsOf(world.pool),
      areas,
      people: Object.fromEntries([...names].map((n) => [n, n])),
      terms,
      asked: found.ask.intent === 'asked_nothing' ? askedOf(world.asked(), world.manages) : null,
    },
    RECORDS_NOW,
  )
}
