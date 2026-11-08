import type { HeedApi } from '@/api/client'
import type { AnswerState } from '@/model/ask'

/*
  Ask's evaluation harness (docs/evaluations.md, "Ask's evaluation harness"): conversations asked
  as a person through whatever answers them, graded by code on the promises Ask makes and, on a
  real run, by a judge that can only fail a turn. Nothing here knows how an answer is made: today's
  router is one answerer, a model in a tool loop will be another, and both are graded the same way.
*/

/** Who asks: their name, and the app's own binding signed in as them. */
export type Reader = { name: string; api: HeedApi }

/** One reply, as the person reads it, with what the answerer read to write it. */
export type Reply = {
  /** Every line the person reads under their message: words, tables, footers, in plain text. */
  text: string
  /** The answer's state chip, or null for none. */
  state: AnswerState | null
  /** The context items the reply cites, by id, in order: [n] in the text is sources[n - 1]. */
  sources: string[]
  /**
   * What tools and records gave the answerer, as text: a number in the reply must be in it, in
   * the person's own words or in the fixed facts.
   */
  evidence: string[]
  /** Whether a model wrote any of the words: only those turns go to the judge. */
  modelWords: boolean
}

/** A conversation as one person has it: each message is answered before the next is sent. */
export interface Chat {
  send(message: string): Promise<Reply>
}

/** Anything that answers a conversation for a reader. */
export interface Answerer {
  readonly name: string
  open(reader: Reader): Chat
}

/** Words a reply must or must not hold: a string matches as written, a pattern as it says. */
export type Pattern = string | RegExp

/**
 * The classes a case is scored in. R, S, D, A and X are the gate's: an analysis of the records, a
 * synthesis of what is written, what a definition says, a question beyond what is written, and one
 * Ask must decline or ask back. F is a follow-up whose turn reads the ones before it, and V an
 * adversarial turn.
 */
export type CaseClass = 'R' | 'S' | 'D' | 'A' | 'X' | 'F' | 'V'

export const classNames: Record<CaseClass, string> = {
  R: 'records',
  S: 'synthesis',
  D: 'definitions',
  A: 'beyond what is written',
  X: 'declines or asks back',
  F: 'follow-ups',
  V: 'adversarial',
}

/** What one turn's reply must do. A turn with none is still held to every promise. */
export type TurnExpect = {
  /** Facts the reply must hold, as data rather than wording. */
  says?: readonly Pattern[]
  /** What it must never hold: a wrong number, a hidden count, a side taken. */
  never?: readonly Pattern[]
  /** The state chip, or null for none. Left out where it is not scored. */
  state?: AnswerState | null
  /** Whether it must ask one question back. */
  asksBack?: boolean
}

export type EvalTurn = { ask: string; expect?: TurnExpect }

export type EvalCase = {
  id: string
  class: CaseClass
  /** Who asks, by name. */
  as: string
  turns: readonly EvalTurn[]
  /** Where it comes from: a burned gate, a panel, the maintainer's own chats, or written here. */
  source: 'gate 1' | 'gate 2' | 'gate 3' | 'panel 1' | 'panel 2' | 'panel 3' | 'captain' | 'harness'
  /** What it tests, in plain words. */
  what?: string
}

/**
 * The promises every turn is held to (requirements section 1.8 and FR-720), each zero tolerance:
 * code grades the first six; on a real run a judge may also fail advice, a verdict or an
 * unsupported sentence. `never` is a case's own must-not.
 */
export const PROMISES = [
  'numbers',
  'citations',
  'hidden',
  'advice',
  'state',
  'stored',
  'verdict',
  'unsupported',
  'never',
] as const
export type AskPromise = (typeof PROMISES)[number]

export const promiseNames: Record<AskPromise, string> = {
  numbers: 'every number from a tool, a record or the person',
  citations: 'every citation resolves for the reader',
  hidden: 'no hidden count or item for the reader',
  advice: "no advice in Ask's own voice",
  state: 'the state matches the items found',
  stored: 'no question stored',
  verdict: 'no side taken between items',
  unsupported: 'no unsupported sentence',
  never: "the case's own must-nots",
}

/** How one turn did: each promise it broke with why, and what it missed of its case. */
export type TurnGrade = {
  breaches: Partial<Record<AskPromise, string[]>>
  misses: string[]
}

/** One try of one case. */
export type CaseRun = {
  id: string
  try: number
  turns: { ask: string; reply: Reply; grade: TurnGrade }[]
  /** Why the answerer gave no reply, twice, to the next message: the try ended there. */
  unanswered?: string
}
