import type { AnswerState } from './answer.ts'
import { DEFAULT_PRODUCT_NAME } from './brand.ts'
import {
  auditAnswer,
  auditedTerms,
  dayWords,
  dueRead,
  foundNothing,
  readAudit,
  type AuditWorld,
  type QueueLine,
} from './audit.ts'
import {
  recordsKinds,
  type AuditRead,
  type LimitReason,
  type RecordsFound,
  type RecordsIntent,
  type RecordsKind,
  type RecordsPeriod,
  type RecordsRow,
  type RecordsAnswer,
} from './records-answer.ts'
import { reachesBeyond } from './plain-read.ts'
import { asksDefinition } from './scope.ts'
import { normalizeName, type Term } from './vocabulary.ts'

/*
  Records answers: a question about the context's own records, not about the business. "Give me
  context created in the last 24 hours", "what is due for a check in Sales", "who owns Orders".
  Ask answers them from what the workspace keeps about its context items, domains and owners, and
  from what agents asked this week, never from what an item says, and agents never read them.

  The list of questions is closed: read by fixed word patterns, each answered by a fixed read and a
  sentence template. An analysis of the records is one more of them (src/domain/audit.ts). Two of them are about the vocabulary itself, as Definitions
  shows it: its metrics and dimensions ("list 10 dimensions", "how many metrics are in Sales"),
  and the values of a dimension ("what markets are there"). One is the conflicts, as Context's
  Conflicts filter lists them ("list conflicts", "what is unresolved"). No model chooses or writes anything. A
  question none of them fits is left to the answer engine, which says when it looked nothing up. A
  model may later fill the same `RecordsAsk` for words the patterns miss; the reads, the
  permissions and the screen would not change.

  Pure, so the service and the mock binding read a question and answer it alike: the caller gives
  the records the person may see (only what the Context list shows them), the names the engine's
  reader found in the words, and the moment it is now. Times are UTC: Heed keeps no time zone of
  its own, so every period says it.
*/

export {
  recordsAnswerSchema,
  recordsIntents,
  recordsKinds,
  type RecordsAnswer,
  type RecordsFound,
  type RecordsIntent,
  type RecordsKind,
  type RecordsPeriod,
  type RecordsRow,
} from './records-answer.ts'
export { dayWords } from './audit.ts'

/** Each kind as people name it, one and several, and as a table's row names it. */
const kindWords: Record<RecordsKind, { one: string; many: string; label: string }> = {
  event: { one: 'event', many: 'events', label: 'Event' },
  issue: { one: 'warning', many: 'warnings', label: 'Warning' },
  note: { one: 'rule', many: 'rules', label: 'Rule' },
  guide: { one: 'guide', many: 'guides', label: 'Guide' },
}

/** How many rows an answer lists at most, on every screen. Context lists the rest. */
export const RECORDS_ROWS = 5

/** What a question asks, from the closed list: an intent and its few slots. */
export type RecordsAsk = {
  intent: RecordsIntent
  /** A domain, by id. */
  domain: string | null
  /** A kind of context item, or definitions (the metrics and dimensions of the vocabulary). */
  kind: RecordsKind | 'definition' | null
  /** A metric, by key, for who owns it. */
  metric: string | null
  period: RecordsPeriod | null
  /** Which domains and context items have no owner, instead of who owns one. */
  noOwner: boolean
  /** For `terms` and `values`: what of the vocabulary is asked. */
  catalogue?: CatalogueAsk
  /** For `audit`, and for `queue` beside the person's Inbox: the analysis (FR-720). */
  audit?: AuditRead
  /** For `owner`: who owns what the chat's last analysis listed. */
  over?: AuditRead
  /** For `glossary`: the word, as a person wrote it in Definitions. */
  word?: string
  /** What the answer leads with when the question reaches beyond what is written (FR-720). */
  limit?: LimitReason
}

/** A question about the vocabulary itself: its metrics and dimensions, or a dimension's values. */
export type CatalogueAsk = {
  /** Metrics, dimensions, both (`definition`), or the values of `dimension`. */
  of: 'metric' | 'dimension' | 'definition' | 'value'
  /** The dimension whose values are asked, by key. */
  dimension: string | null
  /** How many the words asked for ("list 10 dimensions"); null when they named no number. */
  limit: number | null
  /** How many there are ("how many metrics"), rather than which. */
  count: boolean
}

/** A term of the vocabulary, as a records answer names and counts it. */
type RecordsTerm = Pick<Term, 'key' | 'kind' | 'name' | 'aliases' | 'parentKey' | 'areaId'>

/* ---------- reading the question ---------- */

/** What the engine's reader found in the words, and the names a question may use. */
export type RecordsReading = {
  /** The names the reader found, by where they are in the question (UTF-16 offsets, end exclusive). */
  spans: readonly { start: number; end: number; keys?: readonly string[]; dates?: boolean }[]
  /** The vocabulary the keys are from. */
  terms: readonly RecordsTerm[]
  /** The domains, by id and name. */
  domains: readonly { id: string; name: string }[]
  /** The moment it is now, as an ISO instant. */
  now: string
  /** The words people wrote in Definitions, when the question asks what a word means. */
  glossary?: readonly { name: string }[]
  /** The workspace's people, by name: a question that names one is about that person. */
  people?: readonly string[]
  /** The tools the source is read from, as people name them: "Cube". */
  tools?: readonly string[]
}

export type RecordsRecognition =
  | {
      type: 'records'
      ask: RecordsAsk
      /**
       * A question about what changed that names nothing Heed keeps ("what changed last month?"):
       * a person means the business, so Ask's planner reads it first (FR-719); with no planner it
       * is the context's changes, as before.
       */
      loose?: true
      /**
       * The words ask for a judgement, not for this read ("what would you change..."): the planner
       * reads it first, and with no planner Ask says it cannot, unless the read is an analysis.
       */
      judgement?: true
    }
  /** A question about one person's work: refused, with a reason, never looked up. */
  | { type: 'refused' }

/** Words the way the patterns read them: lower case, letters and digits, one space between. */
const plain = (text: string) =>
  normalizeName(text)
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/'(?!s\b)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Where a name is in the question, whole words only, any case. */
function findName(question: string, name: string): { start: number; end: number } | null {
  const words = name.trim()
  if (!words) return null
  const found = new RegExp(`(?<![\\p{L}\\p{N}])${escape(words)}(?![\\p{L}\\p{N}])`, 'iu').exec(
    question,
  )
  return found ? { start: found.index, end: found.index + found[0].length } : null
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && b.start < a.end

/**
 * Nouns that make a question about the records: what Heed keeps, never what the business does.
 * Plainer words for an entry and the kinds' names (an item, a rule, an event) are everyday words
 * too ("the new rule in Spain", "items sold in Norway"), so they count only in a question that
 * names no metric and no market.
 */
const RECORDS_NOUN = /\b(context|definitions?|domains?|library|owners?)\b/
const PLAIN_NOUN =
  /\b(items?|entries|entry|records?|facts?|guides?|rules?|warnings?|events?|notes?)\b/

/** Who may be the subject of "what did X write" without it being one person's work. */
const NOT_A_PERSON =
  'agents?|anyone|anybody|someone|somebody|nobody|noone|people|everyone|everybody|we|the|owners|administrators|admins|heed|been|it|this|that|there|they|you|no|any|some|all|none|nothing|anything|something|everything|our|their|these|those|a|an|not|most|many|few|was|were|is|are|has|have|had|got|just|recently|lately|already|ever|still|yet|context|items?|entries|entry|records?|facts?|notes?|guides?|rules?|warnings?|events?|metrics?|dimensions?|definitions?|domains?|sources?|values?|kpis?|things?|questions?|topics?'
const PERSON_VERBS =
  'write|wrote|written|add|added|change|changed|edit|edited|check|checked|create|created|publish|published|archive|archived|suggest|suggested|review|reviewed|do|done|work on|worked on'
const PERSON_PAST =
  'wrote|written|added|changed|edited|checked|created|published|archived|suggested|reviewed|worked on'

/**
 * A question about what one named or implied person did: refused, since no read here filters by a
 * person. It turns on who the question is about, never on words like "nobody" or "who": an
 * indefinite word names no one, and "who owns" asks for a domain's owners.
 */
function aboutAPerson(t: string): boolean {
  if (
    new RegExp(
      `\\b(?:what|which|how many)\\b(?: [a-z]+){0,3} (?:did|has|have|does) (?!(?:${NOT_A_PERSON})\\b)[a-z]+(?: [a-z]+)? (?:${PERSON_VERBS})\\b`,
    ).test(t)
  )
    return true
  // "everything Ines wrote", "all Tomas published": no question word, the person is the subject.
  if (
    new RegExp(
      `\\b(?:everything|anything|all|whatever|what)(?: that)? (?!(?:${NOT_A_PERSON})\\b)[a-z]+(?: has| have| had)? (?:${PERSON_PAST})\\b`,
    ).test(t)
  )
    return true
  // A ranking of people: "who is furthest behind", "who reviews the slowest".
  if (
    /\bwho\b.*\b(?:behind|furthest|slowest|fastest|latest|most|least|best|worst)\b/.test(t) &&
    !/\bwho (?:owns|is the owner|are the owners)\b/.test(t)
  )
    return true
  if (
    new RegExp(
      `\\b(?:written|added|changed|edited|checked|created|published|archived|suggested|reviewed) by (?!(?:an? )?(?:${NOT_A_PERSON}|agent|owner|administrator)\\b)[a-z]+`,
    ).test(t)
  )
    return true
  if (/\bwho (?:wrote|created|added|changed|edited|checked|published|archived|reviewed)\b/.test(t))
    return true
  return /\b(?:my|[a-z]+'s) (?:work|changes|edits|checks|suggestions|drafts)\b/.test(t)
}

/**
 * Whether the words name someone in the workspace, once the vocabulary's names are out of them: no
 * read here filters by a person. A whole name of two or more words reads in any case; one word of
 * a name only with its capital and not as the first word, so "Will orders rise?" names nobody.
 */
function namesAPerson(words: string, people: readonly string[]): boolean {
  const said = words.trim()
  const capitalised = (part: string) =>
    /^\p{Lu}/u.test(part) &&
    new RegExp(`(?<=\\S\\s+)${escape(part)}(?![\\p{L}\\p{N}])`, 'u').test(said)
  return people.some((name) => {
    const parts = name.trim().split(/\s+/)
    return (parts.length > 1 && findName(said, name) !== null) || parts.some(capitalised)
  })
}

/** Words that ask for a judgement, not a read: the rules leave these to the planner. */
const JUDGEMENT = /\b(?:think|thinks|believe|improve|better definition)\b/
/** Words that say a read is not the whole of it, when the read is not itself an analysis. */
const LOOSE_READ = /\b(?:missing|complete|enough|covers?|covered|and who owns)\b/

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  fourteen: 14,
  thirty: 30,
  'twenty four': 24,
}

const HOUR = 3_600_000
const DAY = 24 * HOUR
const SHORT = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')

/** An instant to the minute, UTC: "29 Oct 15:30", with the year when it is not `now`'s. */
function instantWords(at: number, now: number): string {
  const d = new Date(at)
  const year = d.getUTCFullYear() === new Date(now).getUTCFullYear() ? '' : ` ${d.getUTCFullYear()}`
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
  return `${d.getUTCDate()} ${SHORT[d.getUTCMonth()]}${year} ${time}`
}

const midnight = (at: number) => at - (at % DAY)

function period(start: number, end: number, words: string, now: number, assumed = false) {
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    words,
    label: `${instantWords(start, now)} to ${instantWords(end, now)}, UTC`,
    assumed,
  }
}

/**
 * The period the words name, up to now: the hours or days back from now ("the last 24 hours",
 * "the past 3 days"), or whole UTC days from midnight ("today", "yesterday", "since Monday", "this
 * week", "last week", "this month"). A week starts on Monday. Null when the words name none.
 */
export function readRecordsPeriod(text: string, nowIso: string): RecordsPeriod | null {
  const t = plain(text)
  const now = Date.parse(nowIso)
  const today = midnight(now)
  const back = new RegExp(
    `\\b(?:in |over |during )?(?:the )?(?:last|past|previous) (\\d+|${Object.keys(NUMBERS).join('|')}) (hours?|days?|weeks?)\\b`,
  ).exec(t)
  if (back) {
    const n = /^\d+$/.test(back[1]!) ? Number(back[1]) : NUMBERS[back[1]!]!
    const unit = back[2]!.startsWith('hour') ? HOUR : back[2]!.startsWith('day') ? DAY : 7 * DAY
    const name = back[2]!.replace(/s$/, '')
    return period(now - n * unit, now, `in the last ${n === 1 ? name : `${n} ${name}s`}`, now)
  }
  if (/\b(?:last|past) (?:day|24 ?h)\b/.test(t))
    return period(now - DAY, now, 'in the last 24 hours', now)
  if (/\b(?:last|past) hour\b/.test(t)) return period(now - HOUR, now, 'in the last hour', now)
  const since =
    /\bsince (monday|tuesday|wednesday|thursday|friday|saturday|sunday|yesterday)\b/.exec(t)
  if (since) {
    if (since[1] === 'yesterday') return period(today - DAY, now, 'since yesterday', now)
    const want = WEEKDAYS.indexOf(since[1]!)
    const day = (new Date(now).getUTCDay() + 6) % 7
    const start = today - ((day - want + 7) % 7) * DAY
    return period(start, now, `since ${since[1]![0]!.toUpperCase()}${since[1]!.slice(1)}`, now)
  }
  if (/\btoday\b/.test(t)) return period(today, now, 'today', now)
  if (/\byesterday\b/.test(t)) return period(today - DAY, today, 'yesterday', now)
  const monday = today - ((new Date(now).getUTCDay() + 6) % 7) * DAY
  if (/\bthis week\b/.test(t)) return period(monday, now, 'this week', now)
  if (/\blast week\b/.test(t)) return period(monday - 7 * DAY, monday, 'last week', now)
  const first = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1)
  if (/\bthis month\b/.test(t)) return period(first, now, 'this month', now)
  if (/\blast month\b/.test(t)) {
    const d = new Date(first)
    const before = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)
    return period(before, first, 'last month', now)
  }
  return null
}

/** The period an answer about changes takes when the words name none: the last 7 days. */
export const assumedPeriod = (nowIso: string): RecordsPeriod => {
  const now = Date.parse(nowIso)
  return period(now - 7 * DAY, now, 'in the last 7 days', now, true)
}

/** A word's plural, as people write a dimension's name for its values: Markets, Countries. */
const pluralOf = (word: string) =>
  /[^aeiou]y$/.test(word)
    ? `${word.slice(0, -1)}ies`
    : /(?:s|x|z|ch|sh)$/.test(word)
      ? `${word}es`
      : `${word}s`

/**
 * Words that ask for the conflicts: the pairs of context items an owner said disagree, which stay
 * unsettled until an owner chooses ("list conflicts", "which items disagree", "what is unresolved").
 */
const CONFLICTS =
  /\b(?:conflicts?|conflicting|conflicted|disagree|disagrees|disagreeing|disagreements?|contradict|contradicts|contradicting|contradictory|contradictions?|unresolved|unsettled|not (?:yet )?(?:settled|resolved))\b/

/** The vocabulary's own words: a conflict among them is Definitions' own, not one between items. */
const VOCABULARY = /\b(?:definitions?|metrics?|dimensions?|terms?|synonyms?|values?)\b/

/**
 * Words that make a question one of the other records questions, one about what a name means, or
 * one about how the business did ("which products sold best", "why did campaigns drop").
 */
const NOT_CATALOGUE =
  /\b(?:conflicts?|conflicting|disagree|disagrees|disagreeing|unresolved|unsettled|why|drop|dropped|fall|fell|rise|rose|jump|jumped|spike|increase|increased|decrease|decreased|decline|declined|best|worst|weakest|strongest|riskiest|same|most|least|highest|lowest|biggest|perform|performed|performing|created|added|add|new|newest|latest|recent|recently|lately|published|written|wrote|changed|change|changes|updated|edited|modified|archived|retired|due|overdue|stale|outdated|owns?|owners?|owned|mean|means|meaning|meant|defined|define|stand for|stands for|missing|unanswered)\b/

/**
 * Whether a dimension's plural is asked for as a list: after list, show, name or give me; in
 * "what or which ... are there / exist / do we have"; after "how many"; or as the whole question.
 * "Which products sold last week" is about the business, not the vocabulary.
 */
const listing = (t: string, word: string) => {
  const w = escape(word)
  return (
    new RegExp(`^(?:the )?${w}$`).test(t) ||
    new RegExp(`^(?:please )?(?:list|show|name|give me)\\b.*\\b${w}\\b`).test(t) ||
    new RegExp(`\\b(?:what|which) (?:[a-z]+ )?${w}\\b.* (?:are there|exist|do we have)\\b`).test(
      t,
    ) ||
    new RegExp(`\\bhow many (?:[a-z]+ )?${w}\\b`).test(t)
  )
}

const COUNT = /\bhow many\b|\b(?:count|number) of\b|\bin total\b/

/**
 * A question about the vocabulary itself, or null: a plural that names what Definitions lists
 * (metrics, dimensions, definitions, or a dimension's values by its name, "markets") in words
 * that name no metric and no value. "List orders in Norway" names a metric, so it stays with the
 * answer engine.
 */
function catalogueAsk(
  t: string,
  named: RecordsReading['spans'],
  terms: ReadonlyMap<string, RecordsTerm>,
): CatalogueAsk | null {
  const kinds = named.flatMap((s) => (s.keys ?? []).map((k) => terms.get(k)?.kind))
  if (kinds.some((k) => k !== 'dimension') || NOT_CATALOGUE.test(t)) return null
  const count = COUNT.test(t)
  const numbers = Object.keys(NUMBERS).filter((n) => NUMBERS[n]! > 1)
  const limitBefore = (noun: string) => {
    const found = new RegExp(`\\b(\\d+|${numbers.join('|')}) (?:[a-z]+ )?${noun}\\b`).exec(t)
    if (!found) return null
    const n = /^\d+$/.test(found[1]!) ? Number(found[1]) : NUMBERS[found[1]!]!
    return n > 0 ? n : null
  }
  // A dimension's values: its name in the plural ("markets", "countries"), or its name as the
  // reader found it with the word "values" ("the values of Market").
  const dimensions = [...terms.values()].filter((d) => d.kind === 'dimension')
  const plural = dimensions
    .flatMap((d) => [d.name, ...d.aliases].map((name) => ({ d, word: pluralOf(plain(name)) })))
    .sort((a, b) => b.word.length - a.word.length)
    .find(({ word }) => listing(t, word))
  const read = named
    .flatMap((s) => (s.keys ?? []).map((k) => terms.get(k)))
    .find((d) => d?.kind === 'dimension')
  const valuesOf = plural?.d ?? (read && /\bvalues?\b/.test(t) ? read : undefined)
  if (valuesOf)
    return {
      of: 'value',
      dimension: valuesOf.key,
      limit: plural ? limitBefore(escape(plural.word)) : limitBefore('values?'),
      count,
    }
  if (named.length) return null
  const noun = /\b(metrics|dimensions|definitions)\b/.exec(t)?.[1]
  // "How many definitions" is the count of definitions Records already answers.
  if (!noun || (noun === 'definitions' && count)) return null
  return {
    of: noun === 'metrics' ? 'metric' : noun === 'dimensions' ? 'dimension' : 'definition',
    dimension: null,
    limit: limitBefore(noun),
    count,
  }
}

/** The kind a word names, or definitions. */
function kindIn(t: string): RecordsKind | 'definition' | null {
  if (/\bdefinitions?\b/.test(t)) return 'definition'
  if (/\bguides?\b/.test(t)) return 'guide'
  if (/\brules?\b/.test(t)) return 'note'
  if (/\bwarnings?\b/.test(t)) return 'issue'
  if (/\bevents?\b/.test(t)) return 'event'
  return null
}

/**
 * Reads a question as one of the records questions, or as a question about one person's work,
 * which is refused; null for anything else, which the answer engine reads as before.
 *
 * A domain is found by its name. The names of metrics and markets the engine's reader found are
 * taken out of the words first, so "What is new customers?" is not "what is new". A question that
 * names a metric or a market is a records question only when it also names what Heed keeps (a
 * context item, a domain, an owner) or asks who owns it: "What changed in returns in the United
 * Kingdom this week?" stays a question about the business.
 */
export function recogniseRecords(
  question: string,
  reading: RecordsReading,
): RecordsRecognition | null {
  const found = readRecords(question, reading)
  if (found?.type !== 'records') return found
  const t = plain(question)
  const analysis = found.ask.intent === 'audit' || found.ask.intent === 'queue'
  return JUDGEMENT.test(t) || reachesBeyond(t) || (!analysis && LOOSE_READ.test(t))
    ? { ...found, loose: true, judgement: true }
    : found
}

function readRecords(question: string, reading: RecordsReading): RecordsRecognition | null {
  // The domain is the longest name found, and the reader's names inside it are the domain's.
  const domain = [...reading.domains]
    .sort((a, b) => b.name.length - a.name.length)
    .map((d) => ({ d, at: findName(question, d.name) }))
    .find((x) => x.at)
  const terms = new Map(reading.terms.map((t) => [t.key, t]))
  const named = reading.spans.filter((s) => !s.dates && !(domain && overlaps(s, domain.at!)))
  const metric = named
    .flatMap((s) => (s.keys ?? []).map((k) => terms.get(k)))
    .find((t) => t?.kind === 'metric')
  // The words without the names the reader found, and without the domain's name.
  let words = question
  for (const at of [...named, ...(domain ? [domain.at!] : [])].sort((a, b) => b.start - a.start))
    words = `${words.slice(0, at.start)} ${words.slice(at.end)}`
  const t = plain(words)
  const scoped = named.length > 0
  const noun = RECORDS_NOUN.test(t) || (!named.length && PLAIN_NOUN.test(t))
  if (namesAPerson(words, reading.people ?? []) || aboutAPerson(t)) return { type: 'refused' }

  const ask = (intent: RecordsIntent, extra: Partial<RecordsAsk> = {}): RecordsRecognition => ({
    type: 'records',
    ask: {
      intent,
      domain: domain?.d.id ?? null,
      kind: null,
      metric: null,
      period: null,
      noOwner: false,
      ...extra,
    },
  })

  const word =
    asksDefinition(question) && !scoped
      ? reading.glossary?.find((g) => findName(question, g.name))
      : undefined
  if (word) return ask('glossary', { word: word.name })
  const audit = readAudit(t, scoped, (reading.tools ?? []).map(plain))
  if (audit)
    return audit.queue
      ? ask('queue', audit.read.facets.length ? { audit: audit.read } : {})
      : ask('audit', { audit: audit.read })

  if (
    !(scoped && !noun) &&
    (/\bagents?\b.*\b(?:nothing|not found|no answers?|missing|unanswered|not (?:find|found|get|answered)|did not find|didn t find|could not find|couldn t find|found no)\b/.test(
      t,
    ) ||
      /\b(?:nothing|not found|no answers?)\b.*\bagents?\b/.test(t) ||
      /\bunanswered\b|\bwent unanswered\b|\bwhat (?:is|are) (?:missing|not covered)\b/.test(t))
  )
    return ask('asked_nothing', {
      period: readRecordsPeriod('this week', reading.now),
    })
  if (
    /\b(?:no|without|missing|lacks?|lacking) (?:an? )?owners?\b|\bunowned\b|\bnobody owns\b|\bno one owns\b|\bnot owned\b|\bhas no owner\b/.test(
      t,
    )
  )
    return ask('owner', { noOwner: true })
  if (
    /\bwho (?:owns|is the owner|are the owners|is responsible|are responsible|looks after|look after|is in charge)\b|\bowners? of\b|\bwhose\b|\bwho checks\b|\bwho reviews\b/.test(
      t,
    )
  )
    return ask('owner', { metric: domain ? null : (metric?.key ?? null) })
  if (!(scoped && !noun) && CONFLICTS.test(t) && !VOCABULARY.test(t)) return ask('conflicts')
  const catalogue = catalogueAsk(t, named, terms)
  if (catalogue)
    return ask(catalogue.of === 'value' ? 'values' : 'terms', {
      // A dimension's values are the same in every domain.
      domain: catalogue.of === 'value' ? null : (domain?.d.id ?? null),
      catalogue,
    })
  if (scoped && !noun) return null
  if (
    /\b(?:archived|retired|taken down|withdrawn|no longer (?:in use|active|used|served))\b/.test(t)
  )
    return ask('archived', { kind: kindOrNull(t) })
  if (
    /\b(?:due for (?:a )?(?:check|review)s?|overdue|out of date|outdated|stale|needs? (?:a )?(?:check|review|look|rechecking|checking)|past (?:its|their|the) (?:check|review) dates?|(?:check|review) dates? (?:has |have )?passed|need (?:to be )?checked)\b/.test(
      t,
    )
  )
    // Definitions are not checked here; "outdated definitions" is the context due for a check.
    return ask('due', { kind: kindIn(t) })
  if (/\bhow many\b|\b(?:count|number) of\b|\bin total\b/.test(t) && noun)
    return ask('count', { kind: kindIn(t) })

  const created =
    /\b(?:created|added|add|new|newest|latest|recent|recently|lately|published|came in|written|wrote)\b/.test(
      t,
    )
  const changed = /\b(?:changed|change|changes|updated|edited|modified|touched|different)\b/.test(t)
  if (created || changed) {
    const read = readRecordsPeriod(words, reading.now)
    const chosen = read ?? assumedPeriod(reading.now)
    const found = ask(changed ? 'changed' : 'created', { kind: kindOrNull(t), period: chosen })
    return changed && !noun && found.type === 'records' ? { ...found, loose: true } : found
  }
  return null
}

/** A kind of context item the words name; definitions are no context items. */
const kindOrNull = (t: string): RecordsKind | null => {
  const k = kindIn(t)
  return k === 'definition' ? null : k
}

/* ---------- answering it ---------- */

/** A context item as the records keep it, as the Context list shows it to the person. */
export type RecordsItem = {
  id: string
  kind: RecordsKind
  areaId: string
  title: string
  /** As the Context list says it: live, due for a check, or archived. */
  status: 'live' | 'due' | 'archived'
  reviewDate: string | null
  checkFlag: 'needs_check' | 'source_missing' | null
  /** When it was first published: agents first got it. Null when not known. */
  publishedAt: string | null
  /** When its current version was published. */
  changedAt: string | null
  /** When its current version was last confirmed: its acceptance, or a later check. */
  checkedAt: string | null
  /** When it was archived; null while it is not. */
  archivedAt: string | null
  /** Its own owners, by id, when not its domain's. */
  owners: readonly string[]
}

/** The records a question is answered from: only what the person may see. */
export type RecordsWorld = {
  items: readonly RecordsItem[]
  areas: readonly { id: string; name: string; ownerIds: readonly string[] }[]
  /** People's names, by id, as Context names them. */
  people: Readonly<Record<string, string>>
  /** The vocabulary as Definitions shows it to the person: a term it leaves out is not here. */
  terms: readonly RecordsTerm[]
  /**
   * What agents asked this week, as Asked this week counts it: each topic's count, null under the
   * minimum, how many of those calls delivered nothing, also null under it, and the state Ask gives
   * it now. Null when the question does not need it.
   */
  asked: {
    rows: readonly {
      title: string
      count: number | null
      atLeast: number
      /** The calls that delivered no item: what agents found, not what the topic reads as now. */
      nothing?: number | null
      state: AnswerState
      gap: { card: string; draft: string | null } | null
      /** The topic's domain, metrics and values, for an analysis that narrows them. */
      area?: string | null
      metrics?: readonly string[]
      values?: readonly string[]
    }[]
    minimum: number
  } | null
  /**
   * The conflicts as Context's Conflicts filter lists them to the person, in its order: pairs of
   * live items they may read whole, a pair kept as both and unchanged since left out. Null when the
   * question does not need them.
   */
  conflicts: readonly RecordsConflict[] | null
  /** What an analysis reads besides these (FR-720). Null when the question does not need it. */
  audit?: AuditWorld | null
  /** The person's own Inbox, by group. Null when the question does not need it. */
  queue?: readonly QueueLine[] | null
  /** The words people wrote in Definitions, with what they wrote. */
  glossary?: readonly { name: string; meaning: string }[] | null
}

/** A conflict as the records keep it: the pair, by the item that holds the flag first. */
export type RecordsConflict = {
  key: string
  holder: { id: string; title: string; areaId: string }
  other: { id: string; title: string; areaId: string }
  /** What both apply to, in words: "Orders in Norway". */
  topic: string
  /** The day agents started to get both, as an ISO date; null when not known. */
  since: string | null
}

const count = (n: number) => n.toLocaleString('en-GB')
/** The sentence each limit leads with (docs/design/copy.md). */
export const limitSaid: Record<LimitReason, string> = {
  advice: 'What to do is not written down. Here is what is.',
  forecast: 'What happens next is not written down. Here is what is.',
  outside: 'Ask knows only what is written here, not what others do. Here is what is.',
  numbers: `${DEFAULT_PRODUCT_NAME} keeps no numbers, so Ask cannot work this out. Here is what is written.`,
  partly: 'Ask could read only part of this question. Here is what is written about what it names.',
  general: 'Nothing is written about this in particular. Here is what is written in general.',
}
/** A limit's sentence when nothing was read: there is nothing to go on to. */
export const limitAlone: Record<LimitReason, string> = {
  advice: 'What to do is not written down.',
  forecast: 'What happens next is not written down.',
  outside: 'Ask knows only what is written here, not what others do.',
  numbers: `${DEFAULT_PRODUCT_NAME} keeps no numbers, so Ask cannot work this out.`,
  partly: 'Ask could read only part of this question.',
  general: 'Nothing is written about this in particular.',
}
const itemsWords = (n: number, kind: RecordsKind | null = null) =>
  `${count(n)} ${kind ? (n === 1 ? kindWords[kind].one : kindWords[kind].many) : n === 1 ? 'context item' : 'context items'}`
const was = (n: number) => (n === 1 ? 'was' : 'were')
const is = (n: number) => (n === 1 ? 'is' : 'are')
const list = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
const since = (iso: string | null) => (iso ? Date.parse(iso) : Number.NaN)
const within = (iso: string | null, p: RecordsPeriod) =>
  iso !== null && since(iso) >= since(p.start) && since(iso) < since(p.end)

const NOTE =
  'Live means published and in use. Due for a check means its check date passed or its source changed.'

/**
 * The answer to a records question, from the records the person may see. Every count is exact:
 * it counts what the Context list shows them. Only what agents asked is counted under a minimum
 * and hidden below it, as Asked this week does.
 */
export function answerRecords(ask: RecordsAsk, world: RecordsWorld, nowIso: string): RecordsFound {
  const area = ask.domain ? (world.areas.find((a) => a.id === ask.domain) ?? null) : null
  const domain = area ? { id: area.id, name: area.name } : null
  const inScope = world.items.filter(
    (i) =>
      (!area || i.areaId === area.id) &&
      (!ask.kind || ask.kind === 'definition' || i.kind === ask.kind),
  )
  const kind = ask.kind && ask.kind !== 'definition' ? ask.kind : null
  const what = itemsWords(inScope.length, kind)
  const base = {
    refused: false as const,
    intent: ask.intent,
    period: ask.period,
    domain,
    read: `Read ${what}${domain ? ` in ${domain.name}` : ''}`,
    detail: null,
    detailItem: null,
    columns: [] as string[],
    rows: [] as RecordsRow[],
    total: 0,
    shown: null,
    more: null,
    note: null,
  }
  const where = domain ? ` in ${domain.name}` : ''
  const things = kind ? kindWords[kind].many : 'context items'
  const itemRow = (i: RecordsItem, cells: string[]): RecordsRow => ({
    type: 'item',
    id: i.id,
    kind: i.kind,
    title: i.title,
    areaId: i.areaId,
    cells,
  })
  const ownersOf = (a: { ownerIds: readonly string[] }) =>
    a.ownerIds.map((id) => world.people[id] ?? 'Someone who left')

  switch (ask.intent) {
    case 'created': {
      const p = ask.period ?? assumedPeriod(nowIso)
      const found = inScope
        .filter((i) => within(i.publishedAt, p))
        .sort((a, b) => since(b.publishedAt) - since(a.publishedAt))
      const latest = [...inScope]
        .filter((i) => i.publishedAt && since(i.publishedAt) < since(p.end))
        .sort((a, b) => since(b.publishedAt) - since(a.publishedAt))[0]
      const n = found.length
      return {
        ...base,
        period: p,
        understood: `${kind ? `${kindWords[kind].label}s` : 'Context'} created${where}, ${p.words.replace(/^in the /, '')}`,
        sentence: n
          ? `${itemsWords(n, kind)} ${was(n)} created${where} ${p.words}.`
          : `${kind ? `No ${things} were` : 'Nothing was'} created${where} ${p.words}.`,
        ...(!n && latest
          ? {
              detail: `The latest ${kind ? kindWords[kind].one : 'context item'} was created on ${dayWords(latest.publishedAt!)}:`,
              detailItem: { id: latest.id, title: latest.title },
            }
          : {}),
        columns: ['Context item', 'Created'],
        rows: found.slice(0, RECORDS_ROWS).map((i) => itemRow(i, [dayWords(i.publishedAt!)])),
        total: n,
        shown: n > RECORDS_ROWS ? `Showing the ${RECORDS_ROWS} newest` : null,
        note: 'Created means first published, when agents could first get it.',
      }
    }
    case 'changed': {
      const p = ask.period ?? assumedPeriod(nowIso)
      const changes = inScope
        .flatMap((i) => {
          const what: [string, string | null][] = [
            ['Archived', i.archivedAt],
            ['Added', i.publishedAt],
            ['Changed', i.changedAt],
            ['Checked', i.checkedAt],
          ]
          const hit = what.find(([, at]) => within(at, p))
          return hit ? [{ item: i, what: hit[0], at: hit[1]! }] : []
        })
        .sort((a, b) => since(b.at) - since(a.at))
      const by = (w: string) => changes.filter((c) => c.what === w).length
      const parts = (
        [
          ['added', by('Added')],
          ['changed', by('Changed')],
          ['checked', by('Checked')],
          ['archived', by('Archived')],
        ] as const
      )
        .filter(([, n]) => n > 0)
        .map(([w, n]) => `${count(n)} ${w}`)
      const n = changes.length
      return {
        ...base,
        period: p,
        understood: `Changes to ${kind ? `${kindWords[kind].many}` : 'context'}${where}, ${p.words.replace(/^in the /, '')}`,
        sentence: n
          ? `${itemsWords(n, kind)} changed${where} ${p.words}: ${list(parts)}.`
          : `Nothing changed${where} ${p.words}.`,
        columns: ['Context item', 'What', 'When'],
        rows: changes.slice(0, RECORDS_ROWS).map((c) => itemRow(c.item, [c.what, dayWords(c.at)])),
        total: n,
        shown: n > RECORDS_ROWS ? `Showing the ${RECORDS_ROWS} latest` : null,
        note: 'Each context item is counted once, for the last thing that happened to it.',
      }
    }
    case 'due': {
      const owners = area ? ownersOf(area) : []
      const read = dueRead(inScope, {
        where,
        domainId: domain?.id ?? null,
        ...(kind ? { things: kindWords[kind].many, one: kindWords[kind].one } : {}),
      })
      const open = inScope.filter((i) => i.status !== 'archived').length
      return {
        ...base,
        understood: `Due for a check${kind ? `, ${kindWords[kind].many}` : ''}${domain ? `, in ${domain.name}` : ''}`,
        read: `Read ${itemsWords(open, kind)}${where}`,
        sentence: read.sentence,
        detail:
          area && owners.length
            ? `${domain!.name} is owned by ${list(owners)}.`
            : area
              ? `${domain!.name} has no owner to check them. An administrator can add one.`
              : null,
        columns: read.section?.columns ?? [],
        rows: read.section?.rows ?? [],
        total: read.found,
        shown: read.section?.shown ?? null,
        ranked: read.ranked ?? null,
        more: read.section?.more ?? null,
        note:
          ask.kind === 'definition'
            ? 'A definition needs no check: the context written about it does. Context whose definition changed is due for a check too.'
            : null,
        notSeen: 'Not seen: an item that is wrong before its check date.',
      }
    }
    case 'archived': {
      const gone = inScope
        .filter((i) => i.status === 'archived')
        .sort((a, b) => since(b.archivedAt) - since(a.archivedAt) || a.title.localeCompare(b.title))
      const n = gone.length
      return {
        ...base,
        understood: `Archived${kind ? `, ${kindWords[kind].many}` : ''}${domain ? `, in ${domain.name}` : ''}`,
        sentence: n
          ? `${itemsWords(n, kind)}${where} ${is(n)} archived.`
          : `${kind ? `No ${things} are` : 'Nothing is'} archived${where}.`,
        columns: ['Context item', 'Archived'],
        rows: gone
          .slice(0, RECORDS_ROWS)
          .map((i) => itemRow(i, [i.archivedAt ? dayWords(i.archivedAt) : ''])),
        total: n,
        shown: n > RECORDS_ROWS ? `Showing the ${RECORDS_ROWS} latest` : null,
        more: n
          ? {
              label: `Show all ${count(n)} in Context`,
              to: 'context',
              domain: domain?.id ?? null,
              status: 'archived',
            }
          : null,
        note: 'Archived context items stay in Context. Agents no longer get them.',
      }
    }
    case 'conflicts':
      return conflictsAnswer(world, base, domain)
    case 'owner':
      return ownerAnswer(ask, world, base, area)
    case 'terms':
    case 'values':
      return catalogueAnswer(ask, world, base, domain)
    case 'count': {
      if (ask.kind === 'definition') {
        const terms = world.terms.filter(
          (t) => (t.kind === 'metric' || t.kind === 'dimension') && (!area || t.areaId === area.id),
        )
        const metrics = terms.filter((t) => t.kind === 'metric').length
        const dimensions = terms.length - metrics
        const n = terms.length
        return {
          ...base,
          understood: `Count of definitions${domain ? `, in ${domain.name}` : ''}`,
          read: `Read ${count(n)} ${n === 1 ? 'definition' : 'definitions'}${where}`,
          sentence: `${domain ? domain.name : 'The workspace'} has ${count(n)} ${n === 1 ? 'definition' : 'definitions'}: ${count(metrics)} ${metrics === 1 ? 'metric' : 'metrics'} and ${count(dimensions)} ${dimensions === 1 ? 'dimension' : 'dimensions'}.`,
          total: n,
          more: {
            label: domain ? `Open ${domain.name} in Definitions` : 'Open Definitions',
            to: 'definitions',
            domain: domain?.id ?? null,
            status: null,
          },
        }
      }
      const tally = (items: readonly RecordsItem[]) => [
        items.filter((i) => i.status === 'live').length,
        items.filter((i) => i.status === 'due').length,
        items.filter((i) => i.status === 'archived').length,
      ]
      const [live, due, archived] = tally(inScope)
      const n = inScope.length
      const kinds = kind ? [kind] : recordsKinds
      return {
        ...base,
        understood: `Count of ${things}${domain ? `, in ${domain.name}` : ''}`,
        sentence: `${domain ? domain.name : 'The workspace'} has ${itemsWords(n, kind)}${n ? `: ${count(live!)} live, ${count(due!)} due for a check and ${count(archived!)} archived` : ''}.`,
        columns: ['Kind', 'Live', 'Due for a check', 'Archived'],
        rows: n
          ? [
              ...kinds.map((k): RecordsRow => ({
                type: 'kind',
                kind: k,
                label: kindWords[k].label,
                cells: tally(inScope.filter((i) => i.kind === k)).map(count),
              })),
              ...(kind
                ? []
                : [
                    {
                      type: 'kind' as const,
                      kind: null,
                      label: 'All',
                      cells: [live!, due!, archived!].map(count),
                    },
                  ]),
            ]
          : [],
        total: n,
        more: {
          label: domain ? `Open ${domain.name} in Context` : 'Open Context',
          to: 'context',
          domain: domain?.id ?? null,
          status: null,
        },
        note: NOTE,
      }
    }
    case 'asked_nothing': {
      const asked = world.asked ?? { rows: [], minimum: 5 }
      const { nothing, section } = foundNothing(asked)
      const n = nothing.length
      return {
        ...base,
        understood: 'Topics agents asked about that found nothing, this week',
        read: 'Read what agents asked this week',
        sentence: n
          ? `Agents found nothing for ${count(n)} of ${count(asked.rows.length)} topics this week.`
          : `No topic agents asked about ${asked.minimum} times or more this week found nothing.`,
        columns: section?.columns ?? [],
        rows: section?.rows ?? [],
        total: n,
        shown: section?.shown ?? null,
        note: `A topic asked about fewer than ${asked.minimum} times is not shown, so no small count is given away.`,
        notSeen:
          "Not seen: what people ask in Ask, which is kept nowhere, so this counts agents' calls only.",
      }
    }
    case 'audit':
    case 'queue': {
      const read = ask.audit ?? { facets: [], of: null, kind: null, value: null }
      const queue = ask.intent === 'queue' ? (world.queue ?? []) : null
      return {
        ...auditAnswer(read, world, base, domain, queue),
        ...(ask.limit ? { limit: { reason: ask.limit, sentence: limitSaid[ask.limit] } } : {}),
      }
    }
    case 'glossary': {
      const word = world.glossary?.find((g) => g.name === ask.word)
      return {
        ...base,
        understood: `What ${ask.word} means`,
        read: 'Read the words in Definitions',
        sentence: word?.meaning ?? `${ask.word} is not in Definitions.`,
        detail: 'This word is written in this workspace, by a person, not by your source.',
        more: { label: 'Open Definitions', to: 'definitions', domain: null, status: null },
      }
    }
  }
}

function ownerAnswer(
  ask: RecordsAsk,
  world: RecordsWorld,
  base: Omit<RecordsFound, 'understood' | 'sentence'>,
  area: RecordsWorld['areas'][number] | null,
): RecordsFound {
  const names = (a: { ownerIds: readonly string[] }) =>
    a.ownerIds.map((id) => world.people[id] ?? 'Someone who left')
  const own = (who: string[], what: string) =>
    `${list(who)} ${who.length === 1 ? 'owns' : 'own'} ${what}.`
  const itemsIn = (a: { id: string }) => world.items.filter((i) => i.areaId === a.id)
  const domainLink = (a: { id: string; name: string }) => ({
    label: `Open ${a.name}`,
    to: 'domain' as const,
    domain: a.id,
    status: null,
  })
  if (ask.over) {
    const terms = auditedTerms(ask.over, world, area)
    const homes = world.areas.filter((a) => terms.some((t) => t.areaId === a.id))
    const orphans = terms.filter((t) => !t.areaId || !world.areas.some((a) => a.id === t.areaId))
    return {
      ...base,
      understood: `Owners of ${count(terms.length)} ${terms.length === 1 ? 'definition' : 'definitions'} in your last answer`,
      read: `Read ${count(terms.length)} ${terms.length === 1 ? 'definition' : 'definitions'} and their domains`,
      sentence: `Those ${count(terms.length)} are in ${count(homes.length)} ${homes.length === 1 ? 'domain' : 'domains'}${orphans.length ? `, and ${count(orphans.length)} ${orphans.length === 1 ? 'is' : 'are'} in none` : ''}.`,
      columns: ['Domain', 'Owners', 'How many'],
      rows: [
        ...homes.map((a) => ({
          type: 'area' as const,
          id: a.id,
          name: a.name,
          cells: [
            names(a).length ? list(names(a)) : 'No owner',
            count(terms.filter((t) => t.areaId === a.id).length),
          ],
        })),
        ...orphans.map((t) => ({
          type: 'term' as const,
          key: t.key,
          kind: t.kind,
          name: t.name,
          page: t.name,
          cells: ['No domain, so no owner', '1'],
        })),
      ].slice(0, RECORDS_ROWS),
      total: terms.length,
    }
  }
  if (ask.noOwner) {
    const none = world.areas.filter((a) => !a.ownerIds.length)
    const orphans = none.flatMap((a) => itemsIn(a).filter((i) => !i.owners.length))
    return {
      ...base,
      understood: 'Domains and context items with no owner',
      read: `Read ${count(world.areas.length)} ${world.areas.length === 1 ? 'domain' : 'domains'} and ${itemsWords(world.items.length)}`,
      sentence: none.length
        ? `${list(none.map((a) => a.name))} ${none.length === 1 ? 'has' : 'have'} no owner, so ${itemsWords(orphans.length)} ${orphans.length === 1 ? 'has' : 'have'} nobody to check ${orphans.length === 1 ? 'it' : 'them'}.`
        : 'Every domain has an owner, so every context item has someone to check it.',
      detail: none.length ? 'An administrator can add an owner to a domain.' : null,
      columns: ['Domain', 'Context items with no owner'],
      rows: none.slice(0, RECORDS_ROWS).map((a) => ({
        type: 'area' as const,
        id: a.id,
        name: a.name,
        cells: [count(itemsIn(a).filter((i) => !i.owners.length).length)],
      })),
      total: none.length,
      shown: none.length > RECORDS_ROWS ? `Showing ${RECORDS_ROWS} of ${none.length}` : null,
    }
  }
  if (area) {
    const who = names(area)
    const n = itemsIn(area).length
    return {
      ...base,
      understood: `Owner of ${area.name}`,
      read: `Read ${area.name} and its ${itemsWords(n)}`,
      sentence: who.length
        ? own(who, area.name)
        : `${area.name} has no owner. An administrator can add one.`,
      detail: `${itemsWords(n)} in ${area.name} ${n === 1 ? 'is' : 'are'} ${who.length ? 'theirs' : 'waiting for an owner'} to check.`,
      more: domainLink(area),
    }
  }
  const metric = ask.metric ? world.terms.find((t) => t.key === ask.metric) : undefined
  if (metric) {
    const home = metric.areaId ? world.areas.find((a) => a.id === metric.areaId) : undefined
    if (!home)
      return {
        ...base,
        understood: `Owner of ${metric.name}`,
        read: `Read ${metric.name} and ${count(world.areas.length)} domains`,
        sentence: `${metric.name} is in no domain, so nobody owns it.`,
        detail: 'A domain has owners, not a single metric. An administrator can put it in one.',
      }
    const who = names(home)
    return {
      ...base,
      domain: { id: home.id, name: home.name },
      understood: `Owner of ${metric.name}`,
      read: `Read ${metric.name} and its domain, ${home.name}`,
      sentence: who.length
        ? own(who, metric.name)
        : `${metric.name} is in ${home.name}, which has no owner. An administrator can add one.`,
      detail: `${metric.name} is a definition in ${home.name}. A domain has owners, not a single metric.`,
      more: domainLink(home),
    }
  }
  const owned = world.areas.filter((a) => a.ownerIds.length).length
  return {
    ...base,
    understood: 'Owners of every domain',
    read: `Read ${count(world.areas.length)} ${world.areas.length === 1 ? 'domain' : 'domains'}`,
    sentence:
      owned === world.areas.length
        ? `Every domain has an owner. ${count(world.areas.length)} ${world.areas.length === 1 ? 'domain is' : 'domains are'} shown.`
        : `${count(owned)} of ${count(world.areas.length)} domains have an owner.`,
    columns: ['Domain', 'Owners'],
    rows: world.areas.map((a) => ({
      type: 'area' as const,
      id: a.id,
      name: a.name,
      cells: [names(a).length ? list(names(a)) : 'No owner'],
    })),
    total: world.areas.length,
  }
}

/**
 * The conflicts as Context lists them, in a domain when one is named: a pair is in it when either
 * item is. Each row opens the pair's own page; nothing in an item's words is read.
 */
function conflictsAnswer(
  world: RecordsWorld,
  base: Omit<RecordsFound, 'understood' | 'sentence'>,
  domain: { id: string; name: string } | null,
): RecordsFound {
  const pairs = (world.conflicts ?? []).filter(
    (c) => !domain || c.holder.areaId === domain.id || c.other.areaId === domain.id,
  )
  const n = pairs.length
  const where = domain ? ` in ${domain.name}` : ''
  const conflicts = (k: number) => `${count(k)} ${k === 1 ? 'conflict' : 'conflicts'}`
  return {
    ...base,
    understood: `Conflicts${domain ? `, in ${domain.name}` : ''}`,
    read: `Read ${conflicts(n)}${where}`,
    sentence: n
      ? `There ${is(n)} ${conflicts(n)}${where}.`
      : `There are no conflicts${where}. No context items disagree.`,
    detail: n
      ? 'Agents get both items of each and say the context disagrees, until an owner settles it.'
      : null,
    columns: ['Context items that disagree', 'About', 'Since'],
    rows: pairs.slice(0, RECORDS_ROWS).map((c) => ({
      type: 'conflict' as const,
      key: c.key,
      holder: { id: c.holder.id, title: c.holder.title },
      other: { id: c.other.id, title: c.other.title },
      cells: [c.topic, c.since ? dayWords(c.since) : 'Not recorded'],
    })),
    total: n,
    shown:
      n > RECORDS_ROWS ? `Showing ${RECORDS_ROWS} of ${count(n)}, as Context lists them` : null,
    more: n
      ? {
          label: `Show all ${count(n)} in Context`,
          to: 'context',
          domain: domain?.id ?? null,
          status: 'conflicts',
        }
      : null,
    note: 'A conflict is two context items an owner said disagree. A pair kept as both, and unchanged since, is not one.',
    notSeen: 'Not seen: two items that disagree when no owner marked them.',
  }
}

/** How many names a sentence lists before it only counts them. */
const NAMED = 10

/**
 * The vocabulary as Definitions lists it: the metrics, the dimensions or both, by name, or one
 * dimension's values, each counted exactly from what the person may see there. The sentence names
 * them when there are few; the rows list at most five, and Definitions lists the rest.
 */
function catalogueAnswer(
  ask: RecordsAsk,
  world: RecordsWorld,
  base: Omit<RecordsFound, 'understood' | 'sentence'>,
  domain: { id: string; name: string } | null,
): RecordsFound {
  const c = ask.catalogue ?? { of: 'definition', dimension: null, limit: null, count: false }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en')
  const valuesOf = (key: string) =>
    world.terms.filter((t) => t.kind === 'dimension_value' && t.parentKey === key)
  const areaName = (id: string | null) =>
    (id && world.areas.find((a) => a.id === id)?.name) || 'No domain'
  const dimension =
    c.of === 'value'
      ? world.terms.find((t) => t.key === c.dimension && t.kind === 'dimension')
      : null
  const where = domain ? ` in ${domain.name}` : ''
  const owner = domain ? domain.name : 'The workspace'
  const noun = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`

  if (c.of === 'value' && !dimension)
    return {
      ...base,
      domain: null,
      understood: 'Values of a dimension',
      read: 'Read the dimensions in Definitions',
      sentence: 'That dimension is not in Definitions.',
    }

  const listed = (
    dimension
      ? valuesOf(dimension.key)
      : world.terms.filter(
          (t) =>
            (c.of === 'definition'
              ? t.kind === 'metric' || t.kind === 'dimension'
              : t.kind === c.of) &&
            (!domain || t.areaId === domain.id),
        )
  ).sort((a, b) => (a.kind === b.kind ? byName(a, b) : a.kind === 'metric' ? -1 : 1))
  const n = listed.length
  const metrics = listed.filter((t) => t.kind === 'metric').length
  const what = dimension
    ? noun(n, 'value', 'values')
    : c.of === 'metric'
      ? noun(n, 'metric', 'metrics')
      : c.of === 'dimension'
        ? noun(n, 'dimension', 'dimensions')
        : `${noun(n, 'definition', 'definitions')}: ${noun(metrics, 'metric', 'metrics')} and ${noun(n - metrics, 'dimension', 'dimensions')}`
  const names = listed.map((t) => t.name)
  const kindWord = dimension
    ? 'Value'
    : c.of === 'metric'
      ? 'Metric'
      : c.of === 'dimension'
        ? 'Dimension'
        : 'Definition'
  const subject = dimension ? dimension.name : owner
  // How many the words asked for, against how many there are and how many an answer lists.
  const asked = c.limit
  const rows = Math.min(n, RECORDS_ROWS, asked ?? RECORDS_ROWS)
  // A list of a few names says them all, when no fewer were asked for; a count, a long list and
  // both kinds together only count.
  const named =
    !c.count && n > 0 && n <= NAMED && c.of !== 'definition' && (asked === null || asked >= n)
  const sentence = n
    ? `${subject} has ${what}${named ? `: ${list(names)}` : ''}.`
    : `${subject} has no ${dimension ? 'values' : `${kindWord.toLowerCase()}s`}.`
  const detail =
    asked === null
      ? null
      : asked > n
        ? `You asked for ${count(asked)}; there ${is(n)} ${count(n)}.`
        : asked > RECORDS_ROWS && !named
          ? `You asked for ${count(asked)}; an answer lists ${RECORDS_ROWS}, and Definitions lists all ${count(n)}.`
          : null
  // A value's other names get a column when any of those shown has one.
  const aliased = listed.slice(0, rows).some((t) => t.aliases.length > 0)
  const row = (t: RecordsTerm): RecordsRow => ({
    type: 'term',
    key: t.key,
    kind: t.kind === 'metric' ? 'metric' : t.kind === 'dimension' ? 'dimension' : 'value',
    name: t.name,
    page: dimension ? dimension.name : t.name,
    cells: dimension
      ? aliased
        ? [t.aliases.length ? list(t.aliases) : 'None']
        : []
      : c.of === 'definition'
        ? [t.kind === 'metric' ? 'Metric' : 'Dimension']
        : t.kind === 'metric'
          ? domain
            ? []
            : [areaName(t.areaId)]
          : [count(valuesOf(t.key).length)],
  })
  return {
    ...base,
    domain: dimension ? null : domain,
    understood: dimension
      ? `${c.count ? 'Count of the values' : 'Values'} of ${dimension.name}`
      : `${c.count ? 'Count of ' : ''}${c.count ? kindWord.toLowerCase() : kindWord}s${where}${asked ? `, ${count(asked)} asked for` : ''}`,
    read: dimension
      ? `Read ${dimension.name} and its ${noun(n, 'value', 'values')} in Definitions`
      : `Read ${noun(n, kindWord.toLowerCase(), `${kindWord.toLowerCase()}s`)}${where} in Definitions`,
    sentence,
    detail,
    columns: !n
      ? []
      : dimension
        ? ['Value', ...(aliased ? ['Other names'] : [])]
        : c.of === 'metric'
          ? // Every metric of a domain named is in it: no column says so again.
            ['Metric', ...(domain ? [] : ['Domain'])]
          : [kindWord, c.of === 'definition' ? 'Kind' : 'Values'],
    rows: listed.slice(0, rows).map(row),
    total: n,
    shown: n > rows ? `Showing ${count(rows)} of ${count(n)}, by name` : null,
    more: dimension
      ? n > rows
        ? {
            label: `Show all ${count(n)} in Definitions`,
            to: 'definitions',
            domain: null,
            status: null,
            page: dimension.name,
          }
        : null
      : {
          label:
            n > rows
              ? `Show all ${count(n)} in Definitions`
              : domain
                ? `Open ${domain.name} in Definitions`
                : 'Open Definitions',
          to: 'definitions',
          domain: domain?.id ?? null,
          status: null,
        },
    note: 'Counted from Definitions, as it shows them to you.',
  }
}

/** A question about one person's work, refused with what Ask can say instead. */
export function refusedAnswer(world: Pick<RecordsWorld, 'areas'>): RecordsAnswer {
  const first = world.areas[0]?.name
  return {
    refused: true,
    reason: 'person',
    sentence: "Ask does not answer questions about one person's work.",
    detail:
      'It can tell you what changed this week, and who owns a domain. To see who changed one context item, open its history.',
    offers: ['What changed this week?', ...(first ? [`Who owns ${first}?`] : [])],
  }
}
