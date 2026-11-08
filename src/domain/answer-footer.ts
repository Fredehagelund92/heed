import type { Answer, AnswerBundle } from './answer.ts'
import type { AnswerFooter, RecordsAbout, RecordsFound, RecordsRow } from './records-answer.ts'
import type { RecordsAsk, RecordsItem, RecordsWorld } from './records.ts'
import { windowWords } from './dates.ts'
import { shiftDate } from './validity.ts'

/*
  What every answer owes the reader, in one place: what a count is out of, what the read could not
  see, and what in it may be out of date. Each read's template says its own answer; this adds the
  rest, so no read can forget it. Pure, and only ever fixed sentences: no model writes these, and
  they name only what the answer already read.
*/

export const noFooter: AnswerFooter = { denominator: null, notSeen: null, stale: null }

/** A template's own "Not seen:" line, which the footer keeps. */
export const notSeen = (what: string): AnswerFooter => ({
  ...noFooter,
  notSeen: `Not seen: ${what}.`,
})

const list = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/** Why an item may be out of date, in words. */
const outOfDate: Record<NonNullable<Answer['items'][number]['unverifiedReason']>, string> = {
  past_review_date: 'its check date has passed',
  needs_check: 'its definition changed since it was checked',
  source_missing: 'its source is missing',
}

/** How many out-of-date items a line names. */
const STALE_ITEMS = 3

const staleLine = (lines: readonly string[]) =>
  lines.length
    ? `${lines.slice(0, STALE_ITEMS).join('; ')}${lines.length > STALE_ITEMS ? `, and ${lines.length - STALE_ITEMS} more` : ''}.`
    : null

/** What an answer from the context owes, whatever state it has: an item out of date stays said. */
export function readsFooter(
  bundle: Pick<AnswerBundle, 'terms'>,
  a: Pick<Answer, 'items' | 'uncovered'>,
  /** How many items fitted past what a search gives. */
  cut = 0,
): AnswerFooter | null {
  const stale = a.items.flatMap((item) =>
    item.unverifiedReason ? [`${item.title}: ${outOfDate[item.unverifiedReason]}`] : [],
  )
  const name = (key: string) => bundle.terms.find((t) => t.key === key)?.name ?? key
  const nothing = [...a.uncovered.metrics, ...a.uncovered.values].map(name)
  const footer = {
    denominator: cut
      ? `Read the ${a.items.length} that fit best of ${a.items.length + cut} context items.`
      : null,
    notSeen:
      a.items.length && nothing.length ? `Nothing is written about ${list(nothing)} here.` : null,
    stale: staleLine(stale),
  }
  return footer.denominator || footer.notSeen || footer.stale ? footer : null
}

/** Whether an item is about what the question narrowed a read to: each part, when it names one. */
export const isAbout = (i: RecordsItem, about: RecordsAbout | undefined) =>
  !about ||
  ((!about.metrics.length || about.metrics.some((m) => i.metrics?.includes(m))) &&
    (!about.values.length || about.values.some((v) => i.values?.includes(v))))

/** The reads whose sentence counts rows with nothing to measure them against. */
const OUT_OF_LIVE: readonly RecordsAsk['intent'][] = ['created', 'changed', 'conflicts']
/** The facets that do the same in an analysis. */
const LIVE_FACETS: readonly string[] = ['conflicts', 'overlaps', 'duplicates']
/** The reads of the context list, which never holds a draft or a suggestion. */
const LISTED: readonly RecordsAsk['intent'][] = ['created', 'changed', 'archived', 'count']

const askedDays = (start: string) =>
  windowWords({ start, end: shiftDate(start, 7) }).replace(/^(\d+)-/, '$1 to ')

/** What a records answer owes: its own line, what its count is out of, and what is due in its rows. */
export function recordsFooter(
  found: RecordsFound,
  ask: RecordsAsk,
  world: RecordsWorld,
): AnswerFooter {
  const area = ask.domain ? world.areas.find((a) => a.id === ask.domain) : undefined
  const scope = world.items.filter(
    (i) =>
      (!area || i.areaId === area.id) &&
      (!ask.kind || ask.kind === 'definition' || i.kind === ask.kind) &&
      isAbout(i, ask.about),
  )
  const period = found.period ?? ask.period
  const inPeriod = (iso: string | null) =>
    !!period &&
    iso !== null &&
    Date.parse(iso) >= Date.parse(period.start) &&
    Date.parse(iso) < Date.parse(period.end)
  const overAll =
    (ask.intent === 'created' || ask.intent === 'changed') &&
    scope.some(
      (i) =>
        i.status === 'archived' &&
        (ask.intent === 'created'
          ? inPeriod(i.publishedAt)
          : [i.archivedAt, i.publishedAt, i.changedAt, i.checkedAt].some(inPeriod)),
    )
  const live = overAll ? scope.length : scope.filter((i) => i.status !== 'archived').length
  const facets = ask.audit?.facets ?? []
  const asked =
    ask.intent === 'asked_nothing' ||
    facets.some((f) => f === 'asked_nothing' || f === 'asked_most' || f === 'review')
  const denominators = [
    OUT_OF_LIVE.includes(ask.intent) || facets.some((f) => LIVE_FACETS.includes(f))
      ? `Out of ${live.toLocaleString('en-GB')} ${overAll ? '' : 'live '}context ${live === 1 ? 'item' : 'items'}${area ? ` in ${area.name}` : ''}.`
      : null,
    asked && world.asked?.start
      ? `This week here is ${askedDays(world.asked.start)}, as Observability counts it.`
      : null,
    asked && area && world.asked?.domains?.[area.id] !== undefined
      ? `Agents asked about ${area.name} ${world.asked.domains[area.id]!.toLocaleString('en-GB')} times in all this week.`
      : null,
  ].filter(Boolean)
  const rows: readonly RecordsRow[] = [
    ...found.rows,
    ...(found.sections ?? []).flatMap((s) => s.rows),
  ]
  const byId = new Map(world.items.map((i) => [i.id, i]))
  const due =
    ask.intent === 'due'
      ? []
      : rows.flatMap((r) =>
          r.type === 'item' && byId.get(r.id)?.status === 'due'
            ? [`${r.title}: its check date has passed`]
            : [],
        )
  return {
    denominator: denominators.join(' ') || null,
    notSeen:
      found.footer?.notSeen ??
      (LISTED.includes(ask.intent)
        ? 'Not seen: drafts and suggestions, which are not context yet.'
        : null),
    stale: staleLine(due),
  }
}
