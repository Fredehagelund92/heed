import type { AnswerState, Answer } from './ask'
import type { Topic } from './observability'

// The answer panel's Steps as the app reads them (src/web/api): a replay. Answering is fixed rules
// with no model, so a topic can be run again, step by step, on what agents get now or on what they
// got before a publish, without anything having been recorded.

export type When = 'now' | 'before'

export type ReplayStep = {
  key: 'scope' | 'looked' | 'left' | 'checked' | 'said' | 'next' | 'after'
  title: string
  /** How long the step took, in milliseconds; the last one counts what happened after, so it has none. */
  ms?: number
  text: string
  /** The scope's parts, as chips. */
  scope?: { label: string; kind: 'metric' | 'market' | 'dates' }[]
  /** Context items the step is about, with why when they were left out. */
  items?: { id: string; title: string; why?: string }[]
}

/** What an agent is told to do next, by the answer's state. */
export const NEXT: Record<AnswerState, string> = {
  grounded:
    "Relay the sentence with its source, and who checked it when. Do not add a cause it doesn't give.",
  partial: "Say which part is covered and which isn't. Do not fill in the rest.",
  missing: 'Say that nothing is written down. Do not guess a cause. Offer to report it.',
  conflict: 'Say that two items disagree, and give both. Do not pick one.',
  stale: 'Say it may be out of date, and when it was last checked.',
  failed: "Say it couldn't check just now, and to ask again.",
}

/** A topic run again: the answer, its steps, how long it took, and the steps a publish changed. */
export type Replay = {
  answer: Answer
  steps: ReplayStep[]
  ms: number
  /** The steps that read differently before the publish it is compared with. */
  changed: ReplayStep['key'][]
  /** The publish it is compared with: what agents got before it. */
  before: { label: string; title: string }
}

/**
 * What happened after the answer in the range, never who and never a count under 5: whether
 * someone reported an answer about it, and whether what found nothing made a Not found card.
 */
export function afterAnswer(t: Pick<Topic, 'in' | 'gap'>) {
  const reported = t.in.reported
    ? 'Someone reported an answer about it.'
    : 'Nobody reported an answer about it.'
  const found = t.in.notFound
    ? t.gap
      ? ` It found nothing 5 or more times, so it waits in the Inbox: ${t.gap.label.toLowerCase()}.`
      : ' It found nothing 5 or more times, so it waits in the Inbox.'
    : ''
  return `${reported}${found}`
}
