import type { MentionRef } from '@/lib/mentions'
import { ANSWER_LINES } from '@/lib/help-content'
import type { DomainId } from './items'

// An answer in Ask as the app reads it (src/app/api): its state, its words with numbered sources,
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

/** An answer from a draft: the words nobody has checked yet never say "checked". */
export const DRAFT_LABEL = 'Based on this draft'

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
  state: AnswerState
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
  /** Items that apply to the scope but not to this question (a disagreement about something else), listed, not used. */
  related?: string[]
  /** The question as typed, with its mentions, when it had any. */
  parts?: QuestionPart[]
  /** What the asker scoped it to with '@'. */
  scope?: MentionRef[]
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
