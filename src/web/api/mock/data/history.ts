import type { Fact, LogEntry } from '@/model/items'
import { TODAY, type Version, type VersionKind } from '@/model/history'
import { domains, people } from './world'

// The versions of a context item or a term, made up for the demo but shaped like the real table
// (item_versions: a number, who, when and what changed). Each item gets the same history every
// time; "Gift cards are left out of Norway orders" has 60 versions, to show a long one.

const LONG: Record<string, number> = { itm_gift_card_only: 60 }

/** A small seeded generator, so a history is the same on every visit. */
function seeded(seed: string) {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const isoOf = (label: string) => {
  const m = label.match(/(\d+) (\w{3}) (\d{4})/)
  return m
    ? `${m[3]}-${String(MONTHS.indexOf(m[2]!) + 1).padStart(2, '0')}-${m[1]!.padStart(2, '0')}`
    : TODAY
}
const daysBefore = (iso: string, days: number) =>
  new Date(Date.parse(iso) - days * 86400000).toISOString().slice(0, 10)

const KINDS: VersionKind[] = [
  'wording',
  'wording',
  'link',
  'formatting',
  'dates',
  'published',
  'returned',
  'checked',
]

/** What a version changed, with words to diff, from the item's own text. */
function change(
  kind: VersionKind,
  text: string,
  source: string,
): Pick<Version, 'summary' | 'field' | 'before' | 'after'> {
  const first = text.split(/(?<=\.)\s/)[0]!
  switch (kind) {
    case 'wording':
      return {
        summary: 'Reworded what agents should know.',
        field: 'What agents should know',
        before: first.replace(/\bthe\b/, 'all the'),
        after: first,
      }
    case 'link':
      return {
        summary: 'Moved the source to a new address.',
        field: 'Source',
        before: source.replace(/\/[^/]*$/, '/old'),
        after: source,
      }
    case 'formatting':
      return {
        summary: 'Turned the exceptions into a list.',
        field: 'What agents should know',
        before: first,
        after: first,
      }
    case 'dates':
      return {
        summary: 'Changed when it applies.',
        field: 'When',
        before: 'From a date, still going on',
        after: 'With an end date',
      }
    case 'published':
      return {
        summary: 'Published a suggestion as a new version.',
        field: 'What agents should know',
        before: first.replace(/\.$/, ''),
        after: first,
      }
    case 'returned':
      return {
        summary: 'Returned a suggestion with a note; nothing changed.',
        field: 'What agents should know',
        before: first,
        after: first,
      }
    case 'checked':
      return {
        summary: 'Checked against the source: still true.',
        field: 'Checked',
        before: 'Due for a check',
        after: 'Still true',
      }
    case 'synced':
      return {
        summary: 'The connected tool changed the definition.',
        field: 'Definition',
        before: first.replace(/\.$/, ', in euros.'),
        after: first,
      }
  }
  return { summary: '', field: '', before: '', after: '' }
}

const LOGGED: Record<LogEntry['what'], VersionKind> = {
  archived: 'archived',
  deleted: 'archived',
  moved: 'moved',
  kind: 'retyped',
  owners: 'owners',
  checked: 'checked',
  settled: 'conflict',
}
const FIELD: Record<LogEntry['what'], string> = {
  archived: 'Status',
  deleted: 'Status',
  moved: 'Domain',
  kind: 'Kind',
  owners: 'Owners',
  checked: 'Checked',
  settled: 'Conflict',
}

/**
 * A context item's versions, newest first. The newest is the check the item shows; changes made to
 * many items at once (archived, moved, its kind or owners, checked) come on top, from the log.
 */
export function historyOf(f: Fact, log: LogEntry[] = []): Version[] {
  const seeded = seededHistory(f)
  const mine = log.filter((e) => e.items.some((i) => i.id === f.id))
  return [
    ...mine.map((e, i) => ({
      v: seeded.length + mine.length - i,
      who: e.who,
      on: e.on,
      kind: LOGGED[e.what],
      summary: e.summary,
      field: FIELD[e.what],
      before: '',
      after: e.summary,
    })),
    ...seeded,
  ]
}

function seededHistory(f: Fact): Version[] {
  const rand = seeded(f.id)
  const n = LONG[f.id] ?? 3 + Math.floor(rand() * 6)
  const owners = domains[f.domain]?.owners ?? []
  const suggesters = people.filter((p) => !p.owns.length).map((p) => p.name)
  let on = isoOf(f.checkedOn)
  return Array.from({ length: n }, (_, i) => {
    const kind: VersionKind =
      i === 0 ? 'checked' : i === n - 1 ? 'published' : KINDS[Math.floor(rand() * KINDS.length)]!
    // Only an owner changes or checks an item; a suggester shows up in what the owner published.
    const who = i === 0 ? f.checkedBy : owners[Math.floor(rand() * owners.length)]!
    const version: Version = { v: n - i, who, on, kind, ...change(kind, f.summary, f.source) }
    if (kind === 'published')
      version.summary = `Published a suggestion from ${suggesters[Math.floor(rand() * suggesters.length)]}.`
    if (kind === 'returned')
      version.summary = `Returned a suggestion from ${suggesters[Math.floor(rand() * suggesters.length)]} with a note; nothing changed.`
    on = daysBefore(on, 2 + Math.floor(rand() * 12))
    return version
  })
}

/** A definition's versions: a term's edits by its writer, a synced one's changes from the tool. */
export function historyOfDefinition(
  d: { name: string; definition: string; by?: string; synced: boolean; updated: string },
  tool: string,
): Version[] {
  const rand = seeded(d.name)
  const n = 2 + Math.floor(rand() * 5)
  let on = isoOf(d.updated)
  return Array.from({ length: n }, (_, i) => {
    const kind: VersionKind = d.synced ? 'synced' : i === n - 1 ? 'published' : 'wording'
    const version: Version = {
      v: n - i,
      who: d.synced ? tool : (d.by ?? 'Someone'),
      on,
      kind,
      ...change(kind, d.definition || d.name, ''),
    }
    on = daysBefore(on, 5 + Math.floor(rand() * 20))
    return version
  })
}
