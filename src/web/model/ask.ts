import { CHAT_LINE, CHAT_SOURCES, type ChatTurn, type HeldReading } from '@domain/ask-chat'
import { notLookedUp } from '@domain/say'
import type { AnswerFooter, AnswerLimit, RecordsAnswer } from '@domain/records-answer'
import { nameSimilarity, normalizeName, suggestTerms, type Term } from '@domain/vocabulary'
import type { MentionRef } from '@/lib/mentions'
import { ANSWER_LINES } from '@/lib/help-content'
import type { DomainId } from './items'

// An answer in Ask as the app reads it (src/web/api): its state, its words with numbered sources,
// and what it was read as. Pure types and the words each state is said with.

export type AnswerState = 'grounded' | 'partial' | 'missing' | 'conflict' | 'stale' | 'failed'

/** The state words people see, in the app and in agents: from the one list Help and the docs share. */
export const stateLabel = Object.fromEntries(ANSWER_LINES.map((l) => [l.state, l.label])) as Record<
  AnswerState,
  string
>
/** The one short sentence under the words, for every state but Checked. */
export const stateSentence = Object.fromEntries(
  ANSWER_LINES.map((l) => [l.state, l.sentence]),
) as Record<AnswerState, string>
/** The longer form, kept as the explanation. */
export const stateLong = Object.fromEntries(ANSWER_LINES.map((l) => [l.state, l.long])) as Record<
  AnswerState,
  string
>

/**
 * The state an answer counts under where agents' calls are counted (Asked this week,
 * Observability): a question that looked nothing up counts as Not found there, as the service
 * counts it. Ask itself never shows Not found for it.
 */
export const countedState = (a: Pick<Answer, 'state'>): AnswerState => a.state ?? 'missing'

/** An answer from a draft: the words nobody has checked yet never say "checked". */
export const DRAFT_LABEL = 'Based on this draft'

/**
 * Why nothing was looked up, from what the engine tells the person: its sentence without "Nothing
 * was looked up yet.", which the answer says on its own line.
 */
export const unreadReason = (say: string) =>
  say.startsWith(notLookedUp) ? say.slice(notLookedUp.length).trim() : say

/**
 * Why a question that names no metric and no market was not looked up, as Ask says it. Agents are
 * told the engine's own words, with its first choices (`said`); a person gets what Ask can answer
 * and the names closest to their words instead.
 */
export const NAMES_NOTHING = "The question doesn't name a metric or a market."

/** Whether the engine read nothing because the question named no name at all. */
export const namesNothing = (
  issues: readonly { field: string; input: string; meanings?: unknown }[],
  question: string,
) =>
  issues.length === 1 &&
  issues[0]!.field === 'scope' &&
  !issues[0]!.meanings &&
  issues[0]!.input.trim() === question.trim()

/**
 * The metrics and markets whose names are closest to a question's words, at most two, closest
 * first: a typo ("chrun rate") or a near name. Each run of one to three words is compared the way
 * the engine compares a name it does not know (`suggestTerms`), and only a close one is kept. A
 * name is offered as a question to ask, never read as the one asked.
 */
export function closestNames(question: string, terms: readonly Term[]): string[] {
  const words = normalizeName(question)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  const best = new Map<string, number>()
  for (let size = 1; size <= 3; size++)
    for (let at = 0; at + size <= words.length; at++) {
      const run = words.slice(at, at + size).join(' ')
      if (run.length < 4) continue
      for (const key of suggestTerms(run, terms).slice(0, 2)) {
        const term = terms.find((t) => t.key === key)!
        const score = Math.max(...[term.name, ...term.aliases].map((n) => nameSimilarity(run, n)))
        if (score >= CLOSE && score > (best.get(term.name) ?? 0)) best.set(term.name, score)
      }
    }
  return [...best]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))
    .slice(0, 2)
    .map(([name]) => name)
}
/** How alike a run of words and a name must read to be offered (see `nameSimilarity`). */
const CLOSE = 0.5

/**
 * A planner's reading in the middle of a sentence: "Read by the model as events, in the last 3
 * months". Its first word keeps its capital when it is a name ("Orders in Sweden").
 */
export const midSentence = (words: string) =>
  /^(?:Events|Guides|Warnings|Rules|Everything|What|A)\b/.test(words)
    ? `${words.charAt(0).toLowerCase()}${words.slice(1)}`
    : words

/** What a question was read as, in words: "Orders in Norway, 1 to 31 Aug 2026". Empty when nothing matched. */
export function scopeText(a: Pick<Answer, 'metric' | 'markets' | 'dates'>) {
  const what = [a.metric, a.markets.join(' and ')].filter(Boolean).join(' in ')
  return `${what}${what && a.dates ? `, ${a.dates}` : ''}`
}

export type Answer = {
  id: string
  question: string
  metric: string
  markets: string[]
  dates?: string
  /**
   * How sure the context is, or null when nothing was looked up: the question named nothing the
   * context is about, so there is no answer state (the engine's `need_more_detail`). Not found is
   * only for a question that was looked up and found nothing.
   */
  state: AnswerState | null
  note?: string
  /** Plain sentences; [n] points at sources[n - 1]. */
  text: string
  sources: string[]
  /**
   * What the answer carries of each source, by item id, when the library does not: the line its
   * owner copied from where it comes from, and what not to conclude from it.
   */
  cited?: Record<string, { quote: string; dontConclude: string }>
  said: string
  leftOut?: string
  times?: number
  /** A Heed synonym in the question, and what it was read as: "turnover" is Net revenue. */
  alias?: { asked: string; is: string; type: 'metric' | 'dimension' }
  /** Open the Something wrong? form, filled in, for the "needs correction" example. */
  correction?: { note: string; correct: string; link: string }
  /** You reported a part of this answer: when, and what the owner did, shown only in this chat. */
  report?: { on: string; outcome?: string }
  /** A Conflict's items that disagree with each other, by id: the ones an owner chooses between. */
  conflict?: string[]
  /** Items that apply to the scope but not to this question (a disagreement about something else), listed, not used. */
  related?: string[]
  /** The question as typed, with its mentions, when it had any. */
  parts?: QuestionPart[]
  /**
   * For a question about what a metric means: what its definition source says, and where that
   * comes from, as agents get it (FR-703). It changes neither the state nor the sources.
   */
  definitions?: AskedDefinition[]
  /**
   * A question that looked nothing up because it named no metric and no market: the metrics and
   * markets closest to its words (`closestNames`), named so a typo is never read as asked.
   */
  closest?: string[]
  /** What the asker scoped it to with '@'. */
  scope?: MentionRef[]
  /** What the agent followed from the answer's items with get_related, one step. */
  links?: AnswerLinks
  /**
   * A question about the context's own records, answered from them (FR-718): no answer state, no
   * sources, and agents never read it. Or a question about one person's work, refused.
   */
  records?: RecordsAnswer
  /** How it was read, as keys: what the next question in the chat carries (FR-713, FR-719). */
  keys?: AskScopeKeys
  /**
   * How Ask's planner read the question (FR-719), when it did: the reads in words, and the names
   * and dates carried from the last question. The state and the sources stay the reads' own.
   */
  reading?: {
    words: string
    carried: string[]
    /** The question as it reads alone, as the model restated it, when the chat matters. */
    standalone?: string
    /** Where the dates came from, as the service read them. */
    period?: 'asked' | 'carried' | 'today' | 'recent' | 'any' | null
    /** The part of the question these reads do not answer, as a short question (FR-720). */
    left?: string
    /** What the records say about what was read, in fixed sentences: its owners, its check dates. */
    facts?: string[]
    /** The person said which meaning of a word they meant: read by the rules, with no model. */
    settled?: { also: string | null }
    /** On the mock binding, what the working line said while the reads ran (the service sends it). */
    working?: string
  }
  /**
   * No answer from the context: a short question Ask asked back (`clarify`), a question off
   * topic, a message that asks nothing, or what Ask cannot do (`cannot`, FR-720). Nothing was
   * looked up, so there is no state; `text` says it.
   */
  reply?: 'clarify' | 'off_topic' | 'nothing_asked' | 'cannot'
  /** A question back about a word's meanings: what the next question sends back with its answer. */
  held?: HeldReading
  /** What a draft would start from, for a question that asks Ask to write context. */
  write?: { metric: string | null; market: string | null }
  /** The fixed sentence it leads with when the question reaches beyond what is written (FR-720). */
  limit?: AnswerLimit
  /** What it owes the reader: what a count is out of, what it could not see, what may be stale. */
  footer?: AnswerFooter
  /**
   * The last question, asked again because the person said so in words ("try again"): what was
   * asked. `question` and `parts` stay what they typed.
   */
  again?: { question: string; parts?: QuestionPart[]; scope?: MentionRef[] }
}

/** A scope as the engine reads it: metric keys, each dimension's value keys, and its days. */
export type AskScopeKeys = {
  metrics: string[]
  filters: Record<string, string[]>
  window: { start: string; end: string | null }
}

/** The question an answer read: the one it repeated, when it was asked again in words. */
export const askedOf = (a: Pick<Answer, 'question' | 'again'>) => a.again?.question ?? a.question

const clipped = (line: string) =>
  line.length > CHAT_LINE ? `${line.slice(0, CHAT_LINE - 1).trimEnd()}…` : line

/** How a turn was read, in words: its Understood as line. */
function understoodOf(a: Answer) {
  if (a.records && !a.records.refused) {
    const { understood, period } = a.records
    return clipped(period ? `${understood} (${period.words})` : understood)
  }
  const read = a.reading?.standalone ?? a.reading?.words ?? scopeText(a)
  return read ? clipped(read) : null
}

const items = (n: number) => (n === 1 ? '1 context item' : `${n} context items`)

/**
 * What a turn answered, in one sentence the planner may read: how much was found, from a
 * template. Never an item's words, a name or a data value.
 */
function headlineOf(a: Answer) {
  if (a.records)
    return a.records.refused
      ? null
      : a.records.total === 0
        ? 'Nothing found.'
        : `${a.records.total} found.`
  if (a.state === null || a.state === 'failed') return null
  const about = scopeText(a)
  return clipped(`${items(a.sources.length)}${about ? ` about ${about}` : ''}.`)
}

/** Whether a turn was read for dates it named or carried, not for today or for any date. */
const datedOf = (a: Answer) =>
  a.reading ? a.reading.period === 'asked' || a.reading.period === 'carried' : !!a.dates

/** The terms an analysis listed, by key, in order: what "the first one" points at. */
const rowKeysOf = (records: Extract<RecordsAnswer, { refused: false }>) =>
  [...records.rows, ...(records.sections ?? []).flatMap((s) => s.rows)].flatMap((row) =>
    row.type === 'term' ? [row.key] : [],
  )

/** What a turn sends on to the next question: none for one that asked nothing. */
export const chatTurnOf = (a: Answer): ChatTurn | undefined =>
  askedOf(a).trim() && a.reply !== 'nothing_asked'
    ? {
        question: askedOf(a),
        scope: a.keys ?? null,
        sources: a.sources.slice(0, CHAT_SOURCES),
        understood: understoodOf(a),
        state: a.state,
        headline: headlineOf(a),
        ...(datedOf(a) ? { dated: true } : {}),
        ...(a.records && !a.records.refused
          ? {
              domain: a.records.domain?.id ?? a.records.top?.id ?? null,
              period: a.records.period?.assumed === false ? a.records.period.words : null,
              ...(a.records.audit
                ? { audit: a.records.audit, rows: rowKeysOf(a.records).slice(0, CHAT_SOURCES) }
                : {}),
            }
          : {}),
        ...(a.reply === 'clarify' ? { asked: a.text } : {}),
        ...(a.held ? { held: a.held, ...(a.held.window ? { dated: true } : {}) } : {}),
      }
    : undefined

/** A records answer in Ask: nothing was looked up in the context, so it has no answer state. */
export const recordsAnswer = (
  question: string,
  records: RecordsAnswer,
  reading?: { carried: string[]; standalone?: string },
): Answer => ({
  id: 'custom',
  question,
  metric: '',
  markets: [],
  state: null,
  text: records.sentence,
  sources: [],
  said: '',
  records,
  // Its own Understood as line says how it was read: the reading adds what the model carried.
  ...(reading && !records.refused ? { reading: { words: '', ...reading } } : {}),
})

/**
 * A question answered with no look-up (FR-719): a short question back, in prose, the sentence for
 * a question off topic, or the sentence for a message that asks nothing. No state and no sources:
 * nothing was looked up.
 */
export const replyAnswer = (
  question: string,
  reply: {
    kind: NonNullable<Answer['reply']>
    text: string
    held?: HeldReading | undefined
    definitions?: readonly { name: string; words: string | null; tool: string }[]
    write?: Answer['write']
  },
): Answer => ({
  id: 'custom',
  question,
  metric: '',
  markets: [],
  state: null,
  text: reply.text,
  sources: [],
  said: '',
  reply: reply.kind,
  ...(reply.definitions?.length
    ? {
        definitions: reply.definitions.map((d) => ({ name: d.name, words: d.words, tool: d.tool })),
      }
    : {}),
  ...(reply.write ? { write: reply.write } : {}),
  ...(reply.held ? { held: reply.held } : {}),
})

/** A metric's definition, as the definition source gives it. */
export type AskedDefinition = {
  name: string
  /** The source's own words; null when it gives none. */
  words: string | null
  /** The tool the source reads, as people say it: "Cube". */
  tool: string
}

/** A link on one of the answer's items: the item it is on, and where it points. */
export type AnswerLink = {
  from: { id: string; title: string }
  rel: 'replaces' | 'disagrees' | 'mentions'
  to: MentionRef
}

/**
 * What get_related followed from an answer's items: one step from each, to a context item or a
 * term the answer did not have, and what the agent read there; a link to one that is no longer
 * there is listed and not followed. `on` is the switch in Agents and access: off, nothing is
 * followed.
 */
export type AnswerLinks = {
  on: boolean
  followed: (AnswerLink & { read: string })[]
  notFollowed: AnswerLink[]
}

/** A question as words and mentions: "Why did @Orders drop in @Norway?" */
export type QuestionPart = string | MentionRef

export type Example = {
  id: string
  label: string
  question: string
  /** One of the questions a new workspace's empty Ask starts with. */
  starter?: boolean
}

/** When a chat was, as the history groups them. */
export type Day = 'Today' | 'Yesterday' | 'Earlier'

/** A chat under Ask: the person's own, kept for them. What agents ask is kept as scopes and counts, never as conversations. */
export type Thread = {
  id: string
  title: string
  question: string
  /** The curated example this chat replays, if any. */
  example?: string
  day: Day
  /** Clock time today and yesterday, a short date before that. */
  time: string
  /** Seeded from the demo world, so hidden on a fresh install. */
  seed?: boolean
  /** What its first answer said, without the source marks: what the history search reads. */
  preview: string
}

/** What Ask is asked: typed words with their mentions and scope, or one of the curated examples. */
export type AskInput = {
  question?: string
  parts?: QuestionPart[]
  /** What the asker scoped it to with '@'. */
  scope?: MentionRef[]
  example?: string
  /** Read the question afresh (a check that failed): the dates it was read with before. */
  reread?: { dates?: string }
  /** The chat's last turns, oldest first, for a follow-up. */
  turns?: ChatTurn[]
}

/** What the owners did after a named report, the first of them. */
export type ReportOutcomeKind = 'not_a_problem' | 'checked' | 'changed' | 'archived'

/** A report the person sent from Ask: when, and what the owners did after it, in words. */
export type SentReport = {
  id: string
  /** The question it was about, as asked: the chat shows the outcome under that answer. */
  question: string
  /** When it was sent, as the chat says it: "just now", "today", "on 23 Oct". */
  on: string
  /** What the owners did, once they did: "Checked again on 16 Oct after your report: still true." */
  outcome?: string
}

const SHORT = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')
const shortDay = (at: Date) => `${at.getDate()} ${SHORT[at.getMonth()]}`

/** When a report was sent, as "You reported this ..." finishes. */
export function reportedOn(at: Date, now: Date) {
  if (now.getTime() - at.getTime() < 2 * 60_000) return 'just now'
  if (at.toDateString() === now.toDateString()) return 'today'
  return `on ${shortDay(at)}`
}

/** What the owners did after a report, as the chat says it. */
export function reportOutcomeWords(kind: ReportOutcomeKind, at: Date) {
  const on = shortDay(at)
  return {
    checked: `Checked again on ${on} after your report: still true.`,
    changed: `Changed on ${on} after your report. Agents get the new version.`,
    archived: `Archived on ${on} after your report. Agents no longer get it.`,
    not_a_problem: `Looked at on ${on} after your report: not a problem. The context item stays as it is.`,
  }[kind]
}

/** How many topics show at first; the rest open in place under More asked this week. */
export const ASKED_ROWS = 4

export type AskedRow = {
  /** The topic it is: its id, its domain when it has one, its metric and market as named, its month. */
  topic: { id: string; domain?: DomainId; metric: string; where: string; month?: string }
  /** What the row says: "Orders in Norway". */
  title: string
  /** What a click asks. */
  question: string
  /** How often, for sorting: the total, or what its shown months add up to. */
  times: number
  /** How often, as shown: "31", or "13+" when a month under 5 would be given away. */
  count: string
  /** How many of this week's calls delivered nothing; null under the minimum. */
  nothing: number | null
  state: AnswerState
  sources: number
  /** For an owner of the topic's domain, on a Not found row: the draft or the suggestion that waits. */
  next?: { label: string; href: string }
}

/** Asked this week: the topics agents asked about most, as counts only. */
export type AskedWeek = {
  /** Every topic asked 5 times or more, most asked first. */
  rows: AskedRow[]
  /** Calls about topics asked fewer than 5 times: counted, never shown. */
  hidden: number
  /**
   * Every call this week; null when fewer than 5, or when it would give a small count away beside
   * the rows (then `askedAtLeast` is what the rows show together).
   */
  asked: number | null
  askedAtLeast?: number
}
