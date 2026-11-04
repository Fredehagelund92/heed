import { overlaps } from './validity.ts'
import {
  type AuditFacet,
  type AuditRead,
  type RecordsFound,
  type RecordsKind,
  type RecordsRow,
  type RecordsSection,
} from './records-answer.ts'
import type { RecordsItem, RecordsWorld } from './records.ts'

export { auditFacets, type AuditFacet, type AuditRead } from './records-answer.ts'

/*
  The audit (FR-720): an analysis of the context's own records, one read with a closed list of
  facets. A model or a rule chooses the facets; this code computes every line; a template says it.
  No model writes a number, a name, a rank or a state here, and an analysis has no answer state.

  Pure, so the service and the mock binding answer alike: the caller gives the records the person
  may see, as Definitions, the Context list, Asked this week and Conflicts show them to that person.
  Every count has its denominator, a ranking says its rule, and each facet says what it cannot see.
*/

/** What Definitions keeps about a term, as the catalogue shows it to the person. */
export type AuditTerm = {
  key: string
  kind: 'metric' | 'dimension'
  name: string
  areaId: string | null
  /** What the source says now: `changed` and `gone` are CON-209 and CON-210. */
  state: 'current' | 'changed' | 'gone'
  /** The source's own words; null when it gives none. */
  words: string | null
  /** Live context items about it, by kind. */
  shelf: Record<RecordsKind, number>
}

/** A live context item, with what a pair of them is compared on. */
export type AuditItem = {
  id: string
  kind: RecordsKind
  title: string
  areaId: string
  metrics: readonly string[]
  values: readonly string[]
  start: string
  end: string | null
  /** The items an owner said it disagrees with, by id. */
  conflicts: readonly string[]
}

/** What the source lists that is not a term yet. */
export type AuditMembers = {
  /** Every member the source lists. */
  total: number
  /** Each one no term names; `suggested` is false for a date or an id, left out on purpose. */
  unlinked: readonly { name: string; valueType: string | null; suggested: boolean }[]
}

/** The records an analysis reads beyond the ones a records answer does. */
export type AuditWorld = {
  terms: readonly AuditTerm[]
  items: readonly AuditItem[]
  members: AuditMembers
  /** When the source was last read, as an ISO instant. */
  readAt: string | null
}

/** The person's own Inbox, by group, as the Inbox counts it. Waiting on others is not theirs to do. */
export type QueueLine = { group: string; count: number }

const groupWords: Record<string, string> = {
  gap: 'Not found',
  flag: 'Reported',
  look: 'Saved questions',
  alert: 'Alerts',
  mention: 'Mentioned you',
  check: 'Due for a check',
  suggestion: 'Suggestions',
}

/** How many rows a section lists, and how many sections an answer has, at most. */
const SECTION_ROWS = 5
const SECTIONS = 4

const SHORT = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')
/** A day as the answers write it: "2 Oct 2026". */
export function dayWords(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${d} ${SHORT[m! - 1]} ${y}`
}

const count = (n: number) => n.toLocaleString('en-GB')
const noun = (n: number, one: string, many: string) => (n === 1 ? one : many)
const list = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en')
const kindWord: Record<RecordsKind, string> = {
  event: 'event',
  issue: 'warning',
  note: 'rule',
  guide: 'guide',
}

/** The words of the question an audit was read as, for the Understood as line and for a follow-up. */
const facetWords: Record<AuditFacet, string> = {
  no_context: 'what has no context',
  no_words: 'what has no words from the source',
  no_domain: 'what has no domain',
  unlinked: 'what the source lists that Definitions does not',
  source_changed: 'what changed at the source',
  asked_nothing: 'what agents found nothing for',
  asked_most: 'what agents asked most',
  due: 'what is due for a check',
  conflicts: 'the conflicts',
  duplicates: 'what is written twice',
  overlaps: 'what overlaps',
  review: 'the review',
}

/** An audit in words: "what has no context". */
export const auditWords = (read: Pick<AuditRead, 'facets'>) =>
  list(read.facets.map((f) => facetWords[f]))

/** What each facet cannot see, said once however many facets share it. */
const notSeenOf: Record<AuditFacet, string> = {
  no_context: 'a definition your source does not hold, or a word people use that Heed cannot read',
  no_words: 'a definition your source does not hold, or a word people use that Heed cannot read',
  no_domain: 'a definition your source does not hold, or a word people use that Heed cannot read',
  unlinked: 'a definition your source does not hold, or a word people use that Heed cannot read',
  source_changed: 'a change at the source since the last read',
  asked_nothing: "what people ask in Ask, which is kept nowhere: this counts agents' calls only",
  asked_most: "what people ask in Ask, which is kept nowhere: this counts agents' calls only",
  due: 'an item that is wrong before its check date',
  conflicts: 'two items that disagree when no owner marked them',
  duplicates: 'two items that say the same thing under different titles',
  overlaps: 'whether the two items disagree: an owner decides that',
  review: 'a definition your source does not hold, or a word people use that Heed cannot read',
}

type Part = {
  /** The sentence when this is the whole answer. */
  sentence: string
  section: RecordsSection | null
  /** What to say when it came up empty in an analysis of several parts. */
  clear: string | null
  detail?: string | null
  note?: string | null
  ranked?: string | null
  /** How many it found, for the lead of an analysis of several parts. */
  found: number
}

/** Where a term's or a domain's list lives. */
const definitionsLink = (label: string, domain: string | null) => ({
  label,
  to: 'definitions' as const,
  domain,
  status: null,
})
const contextLink = (label: string, domain: string | null, status: 'due' | 'conflicts') => ({
  label,
  to: 'context' as const,
  domain,
  status,
})

const showing = (n: number) =>
  n > SECTION_ROWS ? `Showing ${SECTION_ROWS} of ${count(n)}, by name` : null

/** The analysis a question was read as, on the records the person may see. */
function readingOf(
  read: AuditRead,
  world: RecordsWorld,
  domain: { id: string; name: string } | null,
) {
  const audit: AuditWorld = world.audit ?? {
    terms: [],
    items: [],
    members: { total: 0, unlinked: [] },
    readAt: null,
  }
  const where = domain ? ` in ${domain.name}` : ''

  /** The terms it counts: metrics unless it asked for dimensions, in the domain when one is named. */
  const terms = () => {
    const of = read.of ?? 'metric'
    return audit.terms
      .filter((t) => (of === 'definition' || t.kind === of) && inDomain(t.areaId))
      .sort(byName)
  }

  const inDomain = (areaId: string | null) => !domain || areaId === domain.id

  const termsWord = (n: number) => {
    const of = read.of ?? 'metric'
    return of === 'dimension'
      ? noun(n, 'dimension', 'dimensions')
      : of === 'definition'
        ? noun(n, 'definition', 'definitions')
        : noun(n, 'metric', 'metrics')
  }

  const areaName = (id: string | null) => {
    return (id && world.areas.find((a) => a.id === id)?.name) || 'No domain'
  }

  const termRow = (t: AuditTerm, cells: string[]): RecordsRow => {
    return { type: 'term', key: t.key, kind: t.kind, name: t.name, page: t.name, cells }
  }

  /** A term's row in a section: its domain, unless the answer is about one. */
  const domainCells = (t: AuditTerm) => {
    return domain ? [] : [areaName(t.areaId)]
  }

  const nameColumns = () => {
    const of = read.of ?? 'metric'
    const name = of === 'dimension' ? 'Dimension' : of === 'definition' ? 'Definition' : 'Metric'
    return domain ? [name] : [name, 'Domain']
  }

  const definitionsMore = () => {
    return definitionsLink(
      domain ? `Open ${domain.name} in Definitions` : 'Open Definitions',
      domain?.id ?? null,
    )
  }

  /** What has nothing written, or none of one kind. */
  const noContext = (): Part => {
    const listed = terms()
    const kind = read.kind
    const none = listed.filter((t) =>
      kind ? t.shelf[kind] === 0 : Object.values(t.shelf).every((n) => n === 0),
    )
    const n = none.length
    const total = listed.length
    const word = termsWord(total)
    const what = kind ? `no ${kindWord[kind]}` : 'no context written'
    const have = listed.filter((t) => !none.includes(t))
    const named = kind && have.length > 0 && have.length <= SECTION_ROWS
    const rest = `${count(total - n)} of ${count(total)} ${kind ? (total - n === 1 ? 'has one' : 'have one') : 'have some'}`
    return {
      sentence: `${count(n)} of ${count(total)} ${word}${where} ${n === 1 ? 'has' : 'have'} ${what}, so ${rest}${named ? `: ${list(have.map((t) => t.name))}` : ''}.`,
      section: n
        ? {
            title: kind ? `No ${kindWord[kind]}` : 'No context written',
            count: `${count(n)} of ${count(total)} ${word}`,
            columns: nameColumns(),
            rows: none.slice(0, SECTION_ROWS).map((t) => termRow(t, domainCells(t))),
            shown: showing(n),
            more: definitionsMore(),
          }
        : null,
      clear: `All ${count(total)} ${word}${where} have ${kind ? `a ${kindWord[kind]}` : 'context written'}.`,
      note: `A ${(read.of ?? 'metric') === 'dimension' ? 'dimension' : 'metric'} is covered when at least one live context item names it.`,
      found: n,
    }
  }

  /** What the source gives no words for. */
  const noWords = (): Part => {
    const listed = terms()
    const none = listed.filter((t) => !t.words)
    const n = none.length
    const word = termsWord(listed.length)
    return {
      sentence: `${count(n)} of ${count(listed.length)} ${word}${where} ${n === 1 ? 'has' : 'have'} no words from the source.`,
      detail: n ? `The source gives no words for ${n === 1 ? 'it' : 'them'}.` : null,
      section: n
        ? {
            title: 'No words from the source',
            count: `${count(n)} of ${count(listed.length)} ${word}`,
            columns: nameColumns(),
            rows: none.slice(0, SECTION_ROWS).map((t) => termRow(t, domainCells(t))),
            shown: showing(n),
            more: null,
          }
        : null,
      clear: `The source gives words for all ${count(listed.length)} ${word}.`,
      found: n,
    }
  }

  /** What is in no domain, so nobody owns or checks it. */
  const noDomain = (): Part => {
    const listed = audit.terms
      .filter((t) => t.kind === (read.of === 'dimension' ? 'dimension' : 'metric'))
      .sort(byName)
    const none = listed.filter((t) => !t.areaId)
    const n = none.length
    const word = termsWord(listed.length)
    return {
      sentence: n
        ? `${count(n)} of ${count(listed.length)} ${word} ${n === 1 ? 'has' : 'have'} no domain, so no owner.`
        : `All ${count(listed.length)} ${word} have a domain, so each has an owner.`,
      detail: n ? 'An administrator can put a metric in a domain.' : null,
      section: n
        ? {
            title: 'No domain, so no owner',
            count: `${count(n)} of ${count(listed.length)} ${word}`,
            columns: [nameColumns()[0]!],
            rows: none.slice(0, SECTION_ROWS).map((t) => termRow(t, [])),
            shown: showing(n),
            more: null,
          }
        : null,
      clear: `All ${count(listed.length)} ${word} have a domain.`,
      found: n,
    }
  }

  /** What the source lists that no term names. */
  const unlinked = (several: boolean): Part => {
    const { total, unlinked } = audit.members
    const suggested = unlinked.filter((m) => m.suggested)
    const shown = several ? suggested : unlinked
    const n = shown.length
    const dates = unlinked.length - suggested.length
    const members = noun(total, 'member', 'members')
    return {
      sentence: `${count(unlinked.length)} of ${count(total)} ${members} the source lists ${unlinked.length === 1 ? 'is' : 'are'} not in Definitions.`,
      detail: dates
        ? `${count(dates)} of them ${dates === 1 ? 'is a date or an id' : 'are dates or ids'}, left out on purpose: the dates of a context item cover those.`
        : null,
      section: n
        ? {
            title: 'In the source, not in Definitions',
            count: `${count(n)} of ${count(total)} ${members}`,
            columns: ['Member', 'Kind'],
            rows: [...shown]
              .sort(byName)
              .slice(0, SECTION_ROWS)
              .map((m) => ({
                type: 'member' as const,
                name: m.name,
                cells: [m.valueType ?? 'Not said'],
              })),
            shown: showing(n),
            more: definitionsLink('Open Definitions', null),
          }
        : null,
      clear: dates
        ? `The source lists ${count(dates)} more ${noun(dates, 'member', 'members')}, left out on purpose as dates or ids.`
        : 'Everything the source lists is in Definitions.',
      found: n,
    }
  }

  /** What changed or went at the source. */
  const sourceChanged = (): Part => {
    const listed = terms()
    const moved = listed.filter((t) => t.state !== 'current')
    const n = moved.length
    const lastRead = audit.readAt
      ? ` The source was last read on ${dayWords(audit.readAt)}.`
      : ''
    return {
      sentence: n
        ? `${count(n)} of ${count(listed.length)} ${termsWord(listed.length)} changed or went at the source.${lastRead}`
        : `No definition changed at the source.${lastRead}`,
      section: n
        ? {
            title: 'Changed at the source',
            count: `${count(n)} of ${count(listed.length)} ${termsWord(listed.length)}`,
            columns: [nameColumns()[0]!, 'What'],
            rows: moved
              .slice(0, SECTION_ROWS)
              .map((t) => termRow(t, [t.state === 'gone' ? 'Gone' : 'Changed'])),
            shown: showing(n),
            more: definitionsMore(),
          }
        : null,
      clear: `No definition changed at the source.${lastRead}`,
      found: n,
    }
  }

  /** What agents asked, as Asked this week may show it, in the domain and for the value named. */
  const askedTopics = () => {
    const asked = world.asked ?? { rows: [], minimum: 5 }
    const value = read.value
    return {
      minimum: asked.minimum,
      rows: asked.rows.filter(
        (r) => inDomain(r.area ?? null) && (!value || (r.values ?? []).includes(value)),
      ),
    }
  }

  const askedNothing = (): Part => {
    const { rows, minimum } = askedTopics()
    const { nothing, section } = foundNothing({ rows, minimum })
    const n = nothing.length
    const top = nothing[0]
    return {
      sentence: n
        ? `Agents found nothing for ${count(n)} of ${count(rows.length)} topics${where} this week.`
        : `Agents found something for every topic${where} asked about ${minimum} times or more this week.`,
      section,
      clear: `Agents found something for every topic${where} asked about ${minimum} times or more this week.`,
      detail: n ? "This counts agents' calls that delivered nothing, this week." : null,
      ranked: top ? `Look first at ${top.title}: agents found nothing there most often.` : null,
      note: `A topic asked about fewer than ${minimum} times is not shown, so no small count is given away.`,
      found: n,
    }
  }

  const askedMost = (): Part => {
    const { rows, minimum } = askedTopics()
    const n = rows.length
    const named = read.value
      ? (world.terms.find((t) => t.key === read.value)?.name ?? '')
      : ''
    const about = named ? ` about ${named}` : ''
    return {
      sentence: n
        ? `Agents asked about ${count(n)} ${noun(n, 'topic', 'topics')}${about}${where} ${minimum} times or more this week.`
        : `No topic${about}${where} was asked about ${minimum} times or more this week.`,
      section: n
        ? {
            title: 'Asked most this week',
            count: `${count(n)} ${noun(n, 'topic', 'topics')}`,
            columns: ['Topic', 'Asked'],
            rows: rows.slice(0, SECTION_ROWS).map((r) => ({
              type: 'topic' as const,
              title: r.title,
              cells: [r.count === null ? `${count(r.atLeast)}+` : count(r.count)],
              gap: r.gap,
            })),
            shown: n > SECTION_ROWS ? `Showing the ${SECTION_ROWS} asked most` : null,
            more: null,
          }
        : null,
      clear: `No topic${about} was asked about ${minimum} times or more this week.`,
      note: `A topic asked about fewer than ${minimum} times is not shown, so no small count is given away.`,
      found: n,
    }
  }

  /** The metrics asked about most among those with nothing written: the two reads joined. */
  const askedAndUncovered = (): Part => {
    const listed = terms()
    const none = listed.filter((t) => Object.values(t.shelf).every((n) => n === 0))
    const { rows } = askedTopics()
    const times = (t: AuditTerm) =>
      rows
        .filter((r) => (r.metrics ?? []).includes(t.key))
        .reduce((sum, r) => sum + (r.count ?? r.atLeast), 0)
    const asked = none
      .map((t) => ({ t, n: times(t) }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n || byName(a.t, b.t))
    const word = termsWord(none.length)
    return {
      sentence: `${count(none.length)} of ${count(listed.length)} ${termsWord(listed.length)} have no context written. Of those, agents asked about ${count(asked.length)} this week.`,
      section: asked.length
        ? {
            title: 'Asked most, nothing written',
            count: `${count(asked.length)} of ${count(none.length)} ${word}`,
            columns: [nameColumns()[0]!, 'Asked'],
            rows: asked.slice(0, SECTION_ROWS).map(({ t, n }) => termRow(t, [count(n)])),
            shown: asked.length > SECTION_ROWS ? `Showing the ${SECTION_ROWS} asked most` : null,
            more: definitionsMore(),
          }
        : null,
      clear: `Agents did not ask about any of the ${count(none.length)} ${word} with no context this week.`,
      ranked: 'Asked most first, among what has no context written.',
      found: asked.length,
    }
  }

  const liveItems = (): readonly RecordsItem[] => {
    return world.items.filter((i) => i.status !== 'archived' && inDomain(i.areaId))
  }

  const duePart = (): Part => {
    const items = liveItems()
    const due = items
      .filter((i) => i.status === 'due')
      .sort(
        (a, b) =>
          (a.reviewDate ?? '9999').localeCompare(b.reviewDate ?? '9999') ||
          a.title.localeCompare(b.title),
      )
    const n = due.length
    const total = `${count(n)} of ${count(items.length)} ${noun(items.length, 'context item', 'context items')}`
    return {
      sentence: `${total}${where} ${n === 1 ? 'is' : 'are'} due for a check.`,
      section: n
        ? {
            title: 'Due for a check',
            count: total,
            columns: ['Context item', 'Due since'],
            rows: due.slice(0, SECTION_ROWS).map((i) => ({
              type: 'item' as const,
              id: i.id,
              kind: i.kind,
              title: i.title,
              areaId: i.areaId,
              cells: [i.reviewDate ? dayWords(i.reviewDate) : 'Not recorded'],
            })),
            shown: n > SECTION_ROWS ? `Showing the ${SECTION_ROWS} oldest` : null,
            more: contextLink(`Show all ${count(n)} in Context`, domain?.id ?? null, 'due'),
          }
        : null,
      clear: `Nothing${where} is due for a check.`,
      ranked: n ? 'Oldest check date first.' : null,
      found: n,
    }
  }

  const conflictsPart = (): Part => {
    const pairs = (world.conflicts ?? []).filter(
      (c) => !domain || c.holder.areaId === domain.id || c.other.areaId === domain.id,
    )
    const n = pairs.length
    const word = noun(n, 'conflict', 'conflicts')
    return {
      sentence: n
        ? `There ${n === 1 ? 'is' : 'are'} ${count(n)} ${word}${where}: these are only the pairs an owner marked.`
        : `An owner marked no conflict${where}.`,
      section: n
        ? {
            title: 'Conflicts',
            count: `${count(n)} ${word}`,
            columns: ['Context items that disagree', 'About'],
            rows: pairs.slice(0, SECTION_ROWS).map((c) => ({
              type: 'conflict' as const,
              key: c.key,
              holder: { id: c.holder.id, title: c.holder.title },
              other: { id: c.other.id, title: c.other.title },
              cells: [c.topic],
            })),
            shown: n > SECTION_ROWS ? `Showing ${SECTION_ROWS} of ${count(n)}` : null,
            more: contextLink(`Show all ${count(n)} in Context`, domain?.id ?? null, 'conflicts'),
          }
        : null,
      clear: `An owner marked no conflict${where}.`,
      found: n,
    }
  }

  /** Live items that say the same thing by the only test code can run: their words on the label. */
  const duplicates = (): Part => {
    if (read.of === 'definition') return sameWords()
    const pairs = writtenTwice(audit.items).filter(
      ([a, b]) => inDomain(a.areaId) || inDomain(b.areaId),
    )
    const n = pairs.length
    const total = liveItems().length
    const word = noun(n, 'pair', 'pairs')
    return {
      sentence: n
        ? `${count(n)} ${word} of ${count(total)} context items ${n === 1 ? 'is' : 'are'} written twice${where}: same title, same scope and same start date, both live.`
        : `No two of ${count(total)} context items${where} have the same title, scope and start date.`,
      section: n
        ? {
            title: 'Written twice',
            count: `${count(n)} ${word}`,
            columns: ['Context items', 'Starts'],
            rows: pairs.slice(0, SECTION_ROWS).map(([a, b]) => pairRow(a, b, [dayWords(a.start)])),
            shown: n > SECTION_ROWS ? `Showing ${SECTION_ROWS} of ${count(n)}` : null,
            more: null,
          }
        : null,
      clear: `No two context items${where} have the same title, scope and start date.`,
      found: n,
    }
  }

  /** Definitions compared by their words, the same words only, never by meaning. */
  const sameWords = (): Part => {
    const seen = new Map<string, AuditTerm>()
    const pairs: [AuditTerm, AuditTerm][] = []
    for (const t of audit.terms) {
      const words = t.words?.trim().toLowerCase()
      if (!words) continue
      const first = seen.get(words)
      if (first) pairs.push([first, t])
      else seen.set(words, t)
    }
    const n = pairs.length
    const total = audit.terms.length
    return {
      sentence: n
        ? `${count(n)} ${noun(n, 'pair', 'pairs')} of ${count(total)} definitions share the same words from the source.`
        : `No two definitions share the same words, of ${count(total)}.`,
      section: n
        ? {
            title: 'The same words',
            count: `${count(n)} ${noun(n, 'pair', 'pairs')}`,
            columns: ['Definition', 'Same words as'],
            rows: pairs.slice(0, SECTION_ROWS).map(([a, b]) => termRow(a, [b.name])),
            shown: null,
            more: definitionsMore(),
          }
        : null,
      clear: 'No two definitions share the same words.',
      note: 'Definitions are compared by their words, never by what they mean.',
      found: n,
    }
  }

  const overlapsPart = (): Part => {
    const names = new Map(world.terms.map((t) => [t.key, t.name]))
    const pairs = overlapping(audit.items).filter(
      ([a, b]) => inDomain(a.areaId) || inDomain(b.areaId),
    )
    const n = pairs.length
    const about = (a: AuditItem) =>
      [...a.metrics, ...a.values].map((key) => names.get(key) ?? key).join(', ')
    return {
      sentence: n
        ? `${count(n)} ${noun(n, 'pair', 'pairs')} of context items${where} ${n === 1 ? 'applies' : 'apply'} to the same thing on the same days. An overlap is not a conflict.`
        : `No two context items${where} of one kind apply to the same thing on the same days.`,
      section: n
        ? {
            title: 'Overlaps',
            count: `${count(n)} ${noun(n, 'pair', 'pairs')}`,
            columns: ['Context items', 'About'],
            rows: pairs.slice(0, SECTION_ROWS).map(([a, b]) => pairRow(a, b, [about(a)])),
            shown: n > SECTION_ROWS ? `Showing ${SECTION_ROWS} of ${count(n)}` : null,
            more: null,
          }
        : null,
      clear: `No two context items${where} of one kind overlap.`,
      note: 'Two items of one kind overlap when they name the same metric and value and their dates meet. Events are left out: an event happens once.',
      found: n,
    }
  }

  /** The other facets in one fixed order: for a domain a line each, for all of them a line a domain. */
  const review = (): Part => {
    return domain ? domainReview(domain) : libraryReview()
  }

  const domainReview = (area: { id: string; name: string }): Part => {
    const scoped = readingOf({ ...read, of: 'metric', kind: null }, world, area)
    const context = scoped.noContext()
    const due = scoped.duePart()
    const conflicts = scoped.conflictsPart()
    const twice = scoped.duplicates()
    const nothing = scoped.askedNothing()
    const line = (label: string, cell: string, more: RecordsSection['more']): RecordsRow => ({
      type: 'line',
      label,
      cells: [cell],
      more,
    })
    const rows = [
      line('No context written', context.section?.count ?? 'None', scoped.definitionsMore()),
      line('Due for a check', due.section?.count ?? 'None', due.section?.more ?? null),
      line('Conflicts', conflicts.section?.count ?? 'None', conflicts.section?.more ?? null),
      line('Written twice', twice.section?.count ?? 'None', null),
      line('Agents found nothing', nothing.section?.count ?? 'None', null),
    ]
    return {
      sentence: `This is what the records show for ${area.name}.`,
      section: {
        title: area.name,
        count: `${count(scoped.terms().length)} metrics`,
        columns: ['What', 'How many'],
        rows,
        shown: null,
        more: null,
      },
      clear: null,
      ranked: nothing.ranked ?? null,
      found: rows.length,
    }
  }

  const libraryReview = (): Part => {
    const rows = world.areas.map((a): RecordsRow => {
      const scoped = readingOf({ ...read, of: 'metric', kind: null }, world, a)
      const none = scoped.noContext()
      const due = scoped.duePart().found
      const conflicts = scoped.conflictsPart().found
      return {
        type: 'area',
        id: a.id,
        name: a.name,
        cells: [
          `${count(none.found)} of ${count(scoped.terms().length)}`,
          count(due),
          count(conflicts),
        ],
      }
    })
    return {
      sentence: 'This is what the records show, a line a domain.',
      section: {
        title: 'Domains',
        count: `${count(rows.length)} ${noun(rows.length, 'domain', 'domains')}`,
        columns: ['Domain', 'No context', 'Due for a check', 'Conflicts'],
        rows: rows.slice(0, SECTION_ROWS),
        shown: rows.length > SECTION_ROWS ? `Showing ${SECTION_ROWS} of ${count(rows.length)}` : null,
        more: null,
      },
      clear: null,
      found: rows.length,
    }
  }

  const part = (facet: AuditFacet, several: boolean): Part => {
    switch (facet) {
      case 'no_context':
        return noContext()
      case 'no_words':
        return noWords()
      case 'no_domain':
        return noDomain()
      case 'unlinked':
        return unlinked(several)
      case 'source_changed':
        return sourceChanged()
      case 'asked_nothing':
        return askedNothing()
      case 'asked_most':
        return askedMost()
      case 'due':
        return duePart()
      case 'conflicts':
        return conflictsPart()
      case 'duplicates':
        return duplicates()
      case 'overlaps':
        return overlapsPart()
      case 'review':
        return review()
    }
  }

  return { terms, part, unlinked, askedAndUncovered, noContext, duePart, conflictsPart, duplicates, askedNothing, definitionsMore }
}

const pairRow = (a: AuditItem, b: AuditItem, cells: string[]): RecordsRow => ({
  type: 'pair',
  holder: { id: a.id, title: a.title },
  other: { id: b.id, title: b.title },
  cells,
})

/** The same parts of a scope, whatever their order. */
const scopeOf = (i: Pick<AuditItem, 'metrics' | 'values'>) =>
  [[...i.metrics].sort().join(','), [...i.values].sort().join(',')].join('|')

const pairsOf = (items: readonly AuditItem[]) =>
  items.flatMap((a, i) => items.slice(i + 1).map((b): [AuditItem, AuditItem] => [a, b]))

/** Live items with the same title, the same scope and the same start date: the same words twice. */
export function writtenTwice(items: readonly AuditItem[]): [AuditItem, AuditItem][] {
  const same = (a: AuditItem, b: AuditItem) =>
    a.title.trim().toLowerCase() === b.title.trim().toLowerCase() &&
    scopeOf(a) === scopeOf(b) &&
    a.start === b.start
  return pairsOf(items).filter(([a, b]) => same(a, b))
}

const windowOf = (i: AuditItem) => ({ start: i.start, end: i.end ?? '9999-12-31' })

/**
 * Live items of one kind about the same metric and value whose dates meet, that no owner marked and
 * that are not written twice. An event happens once, so two events never overlap.
 */
export function overlapping(items: readonly AuditItem[]): [AuditItem, AuditItem][] {
  const twice = new Set(writtenTwice(items).map(([a, b]) => `${a.id}.${b.id}`))
  return pairsOf(items).filter(
    ([a, b]) =>
      a.kind === b.kind &&
      a.kind !== 'event' &&
      scopeOf(a) === scopeOf(b) &&
      a.metrics.length + a.values.length > 0 &&
      overlaps(windowOf(a), windowOf(b)) &&
      !a.conflicts.includes(b.id) &&
      !b.conflicts.includes(a.id) &&
      !twice.has(`${a.id}.${b.id}`),
  )
}

/**
 * How many calls found nothing, with how many there were only when what is left over is none or at
 * least the minimum: "9 of 12" would give away a 3 (FR-614). What found nothing is the count kept,
 * as in Observability, so the total is the one left out.
 */
function nothingCell(
  r: { nothing?: number | null; count: number | null },
  minimum: number,
): string {
  const nothing = r.nothing ?? 0
  const rest = r.count === null ? -1 : r.count - nothing
  return rest === 0 || rest >= minimum ? `${count(nothing)} of ${count(r.count!)}` : count(nothing)
}

/**
 * What agents' calls found nothing for this week, as Asked this week may show it: what their calls
 * delivered, under the minimum (FR-614), never what a topic reads as today. Most first.
 */
export function foundNothing(asked: {
  rows: NonNullable<RecordsWorld['asked']>['rows']
  minimum: number
}): { nothing: NonNullable<RecordsWorld['asked']>['rows'][number][]; section: RecordsSection | null } {
  const share = (r: { nothing?: number | null; atLeast: number; count: number | null }) =>
    (r.nothing ?? 0) / Math.max(r.count ?? r.atLeast, 1)
  const nothing = asked.rows
    .filter((r) => (r.nothing ?? 0) > 0)
    .sort((a, b) => (b.nothing ?? 0) - (a.nothing ?? 0) || share(b) - share(a))
  const n = nothing.length
  return {
    nothing,
    section: n
      ? {
          title: 'Agents found nothing',
          count: `${count(n)} of ${count(asked.rows.length)} topics this week`,
          columns: ['Topic', 'Found nothing'],
          rows: nothing.slice(0, SECTION_ROWS).map((r) => ({
            type: 'topic' as const,
            title: r.title,
            cells: [nothingCell(r, asked.minimum)],
            gap: r.gap,
          })),
          shown: n > SECTION_ROWS ? `Showing the ${SECTION_ROWS} that found nothing most` : null,
          more: null,
        }
      : null,
  }
}

/** The person's own Inbox as lines of an answer. Nothing is stored, and only they see it. */
function queuePart(lines: readonly QueueLine[]): Part {
  const open = lines.filter((l) => groupWords[l.group])
  const n = open.reduce((sum, l) => sum + l.count, 0)
  return {
    sentence: n
      ? `${count(n)} ${noun(n, 'card waits', 'cards wait')} for you in your Inbox.`
      : 'Nothing is waiting on you in your Inbox.',
    section: n
      ? {
          title: 'Waiting on you',
          count: `${count(n)} ${noun(n, 'card', 'cards')}`,
          columns: ['Group', 'Cards'],
          rows: open.map((l) => ({
            type: 'line' as const,
            label: groupWords[l.group]!,
            cells: [count(l.count)],
            more: null,
          })),
          shown: null,
          more: { label: 'Open your Inbox', to: 'inbox', domain: null, status: null },
        }
      : null,
    clear: 'Nothing is waiting on you in your Inbox.',
    found: n,
  }
}

const understoodOf = (read: AuditRead, domain: { name: string } | null, queue: boolean) => {
  const what = [queue ? 'what is waiting on you' : null, read.facets.length ? auditWords(read) : null]
    .filter(Boolean)
    .join(' and ')
  const said = `${what[0]!.toUpperCase()}${what.slice(1)}`
  return domain ? `${said}, in ${domain.name}` : said
}

/**
 * The analysis: up to four sections with their counts, what came up empty, the rule behind a
 * ranking, and what the read cannot see. One part with rows is the answer's own rows.
 */
export function auditAnswer(
  read: AuditRead,
  world: RecordsWorld,
  base: Omit<RecordsFound, 'understood' | 'sentence'>,
  domain: { id: string; name: string } | null,
  queue: readonly QueueLine[] | null,
): RecordsFound {
  const reading = readingOf(read, world, domain)
  const facets = read.facets
  const joined = facets.includes('asked_most') && facets.includes('no_context')
  const several = facets.length + (queue ? 1 : 0) > 1
  const parts = [
    ...(queue ? [queuePart(queue)] : []),
    ...(joined
      ? [reading.askedAndUncovered()]
      : facets.map((facet) => reading.part(facet, several))),
  ]
  const full = parts.filter((p) => p.section)
  const kept = full.slice(0, SECTIONS)
  const left = full.slice(SECTIONS)
  const only = parts.length === 1 ? parts[0]! : null
  const lone = only?.section ?? null
  const notSeen = [...new Set(facets.map((f) => notSeenOf[f]))]
  const clear = parts.flatMap((p) => (!p.section && !only && p.clear ? [p.clear] : []))
  const ranked = parts.find((p) => p.ranked)?.ranked ?? null
  const asksDefinitions = facets.includes('unlinked') && !reading.unlinked(true).found
  const lead = asksDefinitions
    ? 'Nothing here says a definition is missing from your source. This is what the records show.'
    : 'This is what the records show.'
  const reads = [
    world.audit ? `${count(world.audit.terms.filter((t) => t.kind === 'metric').length)} metrics` : null,
    world.audit
      ? `${count(world.audit.terms.filter((t) => t.kind === 'dimension').length)} dimensions`
      : null,
    facets.some((f) => f === 'asked_nothing' || f === 'asked_most')
      ? 'what agents asked this week'
      : null,
    queue ? 'your Inbox' : null,
  ].filter(Boolean) as string[]
  const notes = parts.flatMap((p) => (p.note ? [p.note] : []))
  return {
    ...base,
    understood: understoodOf(read, domain, !!queue),
    read: `Read ${list(reads)}`,
    sentence: only ? only.sentence : lead,
    detail: only?.detail ?? null,
    columns: lone?.columns ?? [],
    rows: lone?.rows ?? [],
    total: only ? only.found : full.length,
    shown: lone?.shown ?? null,
    more: lone?.more ?? null,
    note: [...new Set(notes)].join(' ') || null,
    ...(only ? {} : { sections: kept.map((p) => p.section!) }),
    ...(clear.length || left.length
      ? {
          clear: [
            ...clear,
            ...(left.length
              ? [`Also found, not shown here: ${list(left.map((p) => `${p.section!.title.toLowerCase()} (${p.section!.count})`))}.`]
              : []),
          ],
        }
      : {}),
    ranked,
    notSeen: notSeen.length ? `Not seen: ${notSeen.join('; ')}.` : null,
    audit: read,
  }
}

/** The terms an analysis lists, whole, for a follow-up about all of them ("who owns those?"). */
export function auditedTerms(
  read: AuditRead,
  world: RecordsWorld,
  area: { id: string; name: string } | null,
): AuditTerm[] {
  const listed = readingOf(read, world, area).terms()
  const empty = (t: AuditTerm) => Object.values(t.shelf).every((n) => n === 0)
  return read.facets.flatMap((facet) =>
    facet === 'no_context'
      ? listed.filter(empty)
      : facet === 'no_words'
        ? listed.filter((t) => !t.words)
        : facet === 'no_domain'
          ? listed.filter((t) => !t.areaId)
          : [],
  )
}

/** The words of "what definitions are missing": each thing an honest answer is made from. */
const MISSING: AuditFacet[] = ['no_context', 'no_words', 'no_domain', 'unlinked', 'asked_nothing']

/**
 * How the most common analyses read, with no model. Each pattern names a kind of question, not one
 * phrase: what is missing, what has none of something, what is written twice, what overlaps, what
 * contradicts, how much is covered, a domain's review, and the person's own Inbox. A question that
 * names a metric or a market stays a question about the business.
 */
export function readAudit(
  t: string,
  scoped: boolean,
): { read: AuditRead; queue?: true } | null {
  const of = /\bdimensions?\b/.test(t) ? 'dimension' : /\bmetrics?\b/.test(t) ? 'metric' : null
  const read = (facets: AuditFacet[], kind: RecordsKind | null = null) => ({
    read: { facets, of, kind, value: null } satisfies AuditRead,
  })
  if (/\bwaiting (?:on|for) me\b|\bneeds? me\b|\bmy (?:inbox|queue)\b/.test(t))
    return { ...read([]), queue: true }
  if (scoped || /\bmost\b.*\bleast\b/.test(t)) return null
  if (/\bduplicat(?:es?|ed)\b|\b(?:written|said|listed) twice\b/.test(t)) return read(['duplicates'])
  if (/\boverlap(?:s|ping)?\b/.test(t)) return read(['overlaps'])
  if (/\bcontradict(?:s|ing|ions?|ory)?\b/.test(t) && !/\bdefinitions?\b/.test(t))
    return read(['conflicts'])
  if (
    /\bhealth check\b|\bhow complete\b|\bneeds? attention\b|\bhow (?:is|are) (?:the |our )?(?:library|context)\b/.test(
      t,
    )
  )
    return read(['review'])
  if (/\bcovers? everything\b|\b(?:biggest |main )?gaps? in\b.*\bcontext\b/.test(t))
    return read(['no_context', 'asked_nothing'])
  if (/\bagents?\b.*\b(?:most|most often)\b|\bmost asked\b|\basked (?:about )?most\b/.test(t))
    return read(['asked_most'])
  if (!/\bagents?\b/.test(t) && /\basked\b.*\b(?:found nothing|not found|no answers?)\b/.test(t))
    return read(['asked_nothing'])
  if (/\bsource\b/.test(t) && /\b(?:not|n t) (?:yet )?(?:added|linked|in definitions)\b/.test(t))
    return read(['unlinked'])
  if (/\b(?:changed?|gone|removed|renamed)\b.*\bat (?:the|our) source\b/.test(t))
    return read(['source_changed'])
  const thing = /\b(?:definitions?|metrics?|dimensions?)\b/
  if (thing.test(t) && /\bmissing\b/.test(t)) return read(MISSING)
  const none = '(?:no|without|missing|lacks?|lacking)'
  if (/\b(?:metrics?|dimensions?)\b/.test(t)) {
    if (new RegExp(`\\b${none} (?:an? )?owners?\\b`).test(t)) return read(['no_domain'])
    if (new RegExp(`\\b${none} (?:a )?domains?\\b`).test(t)) return read(['no_domain'])
    if (new RegExp(`\\b${none} (?:a |any )?(?:definition|description|words)s?\\b`).test(t))
      return read(['no_words'])
    const kind = new RegExp(`\\b${none} (?:a |any )?(guide|rule|warning|event)s?\\b`).exec(t)?.[1]
    if (kind)
      return read(
        ['no_context'],
        ({ guide: 'guide', rule: 'note', warning: 'issue', event: 'event' } as const)[kind],
      )
  }
  if (
    new RegExp(`\\b${none} (?:any )?context\\b|\\bnothing (?:is )?written\\b`).test(t) ||
    /\b(?:metrics?|dimensions?) (?:have|has|with) context\b/.test(t) ||
    /\bcoverage\b|\bcovered\b/.test(t)
  )
    return read(['no_context'])
  return null
}
