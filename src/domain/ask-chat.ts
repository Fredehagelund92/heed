import type { AnswerState } from './answer.ts'
import type { ResolvedScope } from './scope.ts'

/*
  What Ask's planner remembers of a chat (FR-719): the last turns, each a compact record of how it
  was asked, read and answered, never its full words or a data value. The browser builds them and
  sends them with each question; the service reads them in memory and keeps them nowhere (FR-602,
  FR-717), and no model summarizes them. Past `CHAT_TURNS`, the oldest turn drops out whole. Apart
  from the patterns of src/domain/ask-again.ts, so the API's contract, which the web app loads
  first, carries the shape and the caps and not the patterns.
*/

/** The most turns of a chat the planner reads. */
export const CHAT_TURNS = 6
/** The most sources one turn carries. */
export const CHAT_SOURCES = 10
/** The most sources of an earlier turn the planner is shown; the last turn shows them all. */
export const EARLIER_SOURCES = 3
/** The longest a turn's line of what it was read as, or of what it answered, may be. */
export const CHAT_LINE = 200
/** The most characters a chat's turns may hold together; one turn at its largest always fits. */
export const CHAT_CHARS = 4_000

/** One turn of a chat, as the browser sends it with the next question. Never stored. */
export type ChatTurn = {
  /** Its question, as asked. */
  question: string
  /** How it was read, as keys: what a follow-up carries. Null when nothing was looked up. */
  scope?: ResolvedScope | null | undefined
  /** Its sources, by item id, in the order the answer numbered them; at most 10. */
  sources: string[]
  /** The question Ask asked back, when the turn was one. */
  asked?: string | undefined
  /** How it was read, in words: its Understood as line. */
  understood?: string | null | undefined
  /** The domain a records question was about, by id. */
  domain?: string | null | undefined
  /** The period a records question was about, in words: "this week". */
  period?: string | null | undefined
  /** Whether it was read for dates it named or carried, not for today. */
  dated?: boolean | undefined
  /** Its answer state. Null when nothing was looked up or the records answered. */
  state?: AnswerState | null | undefined
  /** What it answered in one sentence, from a template: never an item's words or a data value. */
  headline?: string | null | undefined
}

const charsOf = (t: ChatTurn) =>
  t.question.length +
  (t.understood?.length ?? 0) +
  (t.headline?.length ?? 0) +
  (t.asked?.length ?? 0) +
  t.sources.join('').length

/** The turns the planner may read, oldest first: the newest that fit both caps. */
export function fitChat<T extends ChatTurn>(turns: readonly T[]): T[] {
  const fitted = turns.slice(-CHAT_TURNS)
  let chars = fitted.reduce((sum, t) => sum + charsOf(t), 0)
  while (chars > CHAT_CHARS && fitted.length > 1) chars -= charsOf(fitted.shift()!)
  return fitted
}

/**
 * The sources of a chat as the planner numbers them, at most one number each: the last answer's
 * all first, so "the first one" is its first, then each earlier answer's first few, newest first.
 */
export function chatSources(turns: readonly ChatTurn[]): string[] {
  const newestFirst = [...turns].reverse()
  return [
    ...new Set(
      newestFirst.flatMap((t, i) => (i === 0 ? t.sources : t.sources.slice(0, EARLIER_SOURCES))),
    ),
  ]
}
