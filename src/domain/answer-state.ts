/*
  The six answer states (FR-349): every answer, for an agent and for a person, starts with one
  answer line, and its words are fixed. This is the one list: the MCP server's replies and
  instructions read it now, and Ask, Try it, Help, the docs and the charts read it as they are
  built (docs/product.md, section 6). The words are plain, for readers who are not native English
  speakers: one or two words, no idioms, no contractions.

  An agent reads the state in a reply's `status`, in the MCP names it already knows: the six
  states map one to one to six statuses, and `need_more_detail` (the question could not be read,
  so nothing was looked up) is the seventh status, which is no answer state.
*/

/** The six answer states, as the code names them (docs/product.md, section 6). */
export const answerStates = [
  'grounded',
  'partial',
  'missing',
  'conflict',
  'stale',
  'failed',
] as const
export type AnswerState = (typeof answerStates)[number]

/** What a reply of get_context says in `status`: one per answer state, and `need_more_detail`. */
export const replyStatuses = [
  'matched',
  'partial',
  'no_match',
  'conflict',
  'stale',
  'check_failed',
  'need_more_detail',
] as const
export type ReplyStatus = (typeof replyStatuses)[number]

export type AnswerLine = {
  state: AnswerState
  /** The status a reply carries for this state. */
  status: Exclude<ReplyStatus, 'need_more_detail'>
  /** The words on the answer line. */
  label: string
  /** The longer form, for a tooltip, Help and the answer line's card. */
  long: string
  /** The one short sentence under the label; Checked shows none on screen. */
  sentence: string
  /** What it means. */
  means: string
  /** What to do about it. */
  todo: string
}

/** The answer lines, in the order Help lists them. */
export const ANSWER_LINES: readonly AnswerLine[] = [
  {
    state: 'grounded',
    status: 'matched',
    label: 'Checked',
    long: 'Based on checked context',
    sentence: 'This is written down and checked.',
    means: 'Context applies, and its owner published it with a source and a check date.',
    todo: 'Nothing to do.',
  },
  {
    state: 'partial',
    status: 'partial',
    label: 'Partial',
    long: 'Covers part of it',
    sentence: 'Only part of this is written down.',
    means:
      'Context covers part of the question, or the dates were assumed. The answer says which part.',
    todo: 'Write the missing part, or tell the owner.',
  },
  {
    state: 'missing',
    status: 'no_match',
    label: 'Not found',
    long: 'Nothing written down',
    sentence: 'Nothing is written about this yet.',
    means: 'Nobody has written anything down for this. It does not mean there is no explanation.',
    todo: 'Write context, or tell the owner.',
  },
  {
    state: 'conflict',
    status: 'conflict',
    label: 'Conflict',
    long: 'Context disagrees',
    sentence: 'Two items say different things.',
    means: 'Two items that apply say different things. Agents give both and say so.',
    todo: 'An owner keeps one, narrows one, or keeps both.',
  },
  {
    state: 'stale',
    status: 'stale',
    label: 'Outdated',
    long: 'May be out of date',
    sentence: 'Some of this may be old.',
    means: "An item's check date has passed, or a definition it relies on changed.",
    todo: 'The owner checks it: Still true, or Edit.',
  },
  {
    state: 'failed',
    status: 'check_failed',
    label: 'Not checked',
    long: 'Could not check',
    sentence: 'The check did not run.',
    means: 'The check could not run just now. It is not the same as Not found.',
    todo: 'Ask again in a minute.',
  },
]

/** The answer line of a state. */
export const answerLine = (state: AnswerState): AnswerLine =>
  ANSWER_LINES.find((line) => line.state === state)!

/** The answer state a reply's status carries, or null for `need_more_detail` and any other. */
export function stateOfStatus(status: string): AnswerState | null {
  return ANSWER_LINES.find((line) => line.status === status)?.state ?? null
}

/** What the resolver found, and what each delivered item is, as the state reads them. */
export type StateInput = {
  /** The resolver's status (src/domain/resolver.ts). */
  status: 'matched' | 'conflict' | 'no_match' | 'need_more_detail' | 'check_failed'
  /** The items the reply gives. */
  items: readonly { match: 'exact' | 'partial'; unverified: boolean }[]
  /** The metrics and values asked that no item given covers in full (`uncoveredParts`). */
  uncovered: { metrics: readonly string[]; values: readonly string[] }
  /** The question gave no dates and no window, so the server read it at today. */
  assumed: boolean
}

/**
 * The one rule for the answer state (FR-349), which get_context, Ask, Try it, the replay and
 * planned answers all use. Not checked when the checks could not run; Not found when nothing was
 * given, or the question could not be read; Conflict when given items disagree; Partial when an
 * asked metric or value has no item that covers it in full, every item applies to only part of
 * the question, or the dates were assumed; Outdated when a given item may be out of date, because
 * its check date passed or its source changed; otherwise Checked. The order is deliberate, so the
 * label names what an owner must do first.
 */
export function answerStateOf(input: StateInput): AnswerState {
  if (input.status === 'check_failed') return 'failed'
  if (input.status !== 'matched' && input.status !== 'conflict') return 'missing'
  if (!input.items.length) return 'missing'
  if (input.status === 'conflict') return 'conflict'
  if (
    input.uncovered.metrics.length ||
    input.uncovered.values.length ||
    input.assumed ||
    input.items.every((item) => item.match === 'partial')
  )
    return 'partial'
  if (input.items.some((item) => item.unverified)) return 'stale'
  return 'grounded'
}

/** A reply's status, from the same facts as the state. Not found keeps the resolver's own word. */
export function replyStatus(input: StateInput): ReplyStatus {
  // A size cut that left no item is still a match the reply says it cut (check_report), not Not found.
  if (input.status === 'matched' && !input.items.length) return 'matched'
  const state = answerStateOf(input)
  if (state === 'missing')
    return input.status === 'need_more_detail' ? 'need_more_detail' : 'no_match'
  return answerLine(state).status
}

/**
 * The answer line as an agent relays it, first in `say`: the label, and its sentence for every
 * state but Checked ("Partial. Only part of this is written down.").
 */
export function stateWords(state: AnswerState): string {
  const line = answerLine(state)
  return state === 'grounded' ? `${line.label}.` : `${line.label}. ${line.sentence}`
}

/**
 * What the resolver found, from a reply's status: Partial and Outdated are matches with something
 * to say about them. A test question and the request log keep the resolver's outcome.
 */
export const resolverStatusOf = (status: string): string =>
  status === 'partial' || status === 'stale' ? 'matched' : status
