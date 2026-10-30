import type { AnswerState } from '@/model/ask'
import { SLUG } from '@/lib/brand'
import { answerLines } from '@domain/words'

// One source for what Help and the docs say about the product's own words. The in-app Help page, the
// answer line's card in Ask, Ask's own labels and the docs' "Answer lines" article draw from these
// lists, so they can never disagree. Ten words is the ceiling: a "how do I" belongs in the docs. The
// answer lines' own words come from the glossary (src/domain/words.ts).

/**
 * The six answer states, in one or two plain words, because many readers are not native English
 * speakers: no idioms, no contractions. The word never shows alone: its icon and tint always go with
 * it, and when the state is not Checked one short sentence goes under it. `long` is the older, longer
 * form, kept as the explanation (in a tooltip, in Help, in the answer line's card).
 */
export const ANSWER_LINES: {
  state: AnswerState
  label: string
  long: string
  sentence: string
  means: string
  todo: string
}[] = [
  {
    state: 'grounded',
    label: answerLines.grounded.label,
    long: answerLines.grounded.long,
    sentence: answerLines.grounded.sentence,
    means: 'Context applies, and its owner published it with a source and a check date.',
    todo: 'Nothing to do.',
  },
  {
    state: 'partial',
    label: answerLines.partial.label,
    long: answerLines.partial.long,
    sentence: answerLines.partial.sentence,
    means:
      'Context covers part of the question, or the dates were assumed. The answer says which part.',
    todo: 'Write the missing part, or tell the owner.',
  },
  {
    state: 'missing',
    label: answerLines.missing.label,
    long: answerLines.missing.long,
    sentence: answerLines.missing.sentence,
    means: 'Nobody has written anything down for this. It does not mean there is no explanation.',
    todo: 'Write context, or tell the owner.',
  },
  {
    state: 'conflict',
    label: answerLines.conflict.label,
    long: answerLines.conflict.long,
    sentence: answerLines.conflict.sentence,
    means: 'Two items that apply say different things. Agents give both and say so.',
    todo: 'An owner keeps one, narrows one, or keeps both.',
  },
  {
    state: 'stale',
    label: answerLines.stale.label,
    long: answerLines.stale.long,
    sentence: answerLines.stale.sentence,
    means: "An item's check date has passed, or a definition it relies on changed.",
    todo: 'The owner checks it: Still true, or Edit.',
  },
  {
    state: 'failed',
    label: answerLines.failed.label,
    long: answerLines.failed.long,
    sentence: answerLines.failed.sentence,
    means: 'The check could not run just now. It is not the same as Not found.',
    todo: 'Ask again in a minute.',
  },
]

export const WORDS: [string, string][] = [
  [
    'Context item',
    'One thing agents should know about the numbers: an event, a warning, a rule or a guide. It has a source and a check date.',
  ],
  [
    'Domain',
    'An area of the business, such as Sales or Marketing. Every context item belongs to one.',
  ],
  [
    'Owner',
    "The person who publishes and checks a domain's context. Agents read only what an owner has published.",
  ],
  [
    'Suggestion',
    'A change someone else sends to an owner, from the editor or through their agent. Nothing changes until the owner publishes it.',
  ],
  [
    'Definition',
    'A metric, a dimension or a term, and what it means here. Metrics and dimensions come from your definitions source; terms are written here.',
  ],
  [
    'Synonym',
    'Another name for a metric or a dimension, such as GMV for Gross sales. Agents read it as that definition.',
  ],
  [
    'Not found',
    'A question agents asked several times and found nothing written down for. Its card brings a draft.',
  ],
  ['Reported', 'Someone said a context item is wrong or unclear. The owner sees it in the Inbox.'],
  [
    'Due for a check',
    'A context item whose check date has passed. The owner confirms it is still true, or edits it.',
  ],
  ["Don't conclude", 'A line on a context item that stops an agent from reading a cause into it.'],
]

/** Four facts on how agents use what people write, which Help shows under its words. */
export const HOW_AGENTS_USE_IT: {
  key: 'write' | 'line' | 'offer' | 'kept'
  lead: string
  rest: string
}[] = [
  {
    key: 'write',
    lead: 'You write, an owner publishes.',
    rest: 'Agents read only what the owner of a domain has published. A suggestion changes nothing until it is published.',
  },
  {
    key: 'line',
    lead: 'Every answer starts with an answer line.',
    rest: 'It says what the answer rests on, in Ask and in your own agent.',
  },
  {
    key: 'offer',
    lead: 'Agents offer, people decide.',
    rest: 'When something is missing or wrong, an agent offers to tell the owner. It sends only after the person says yes.',
  },
  {
    key: 'kept',
    lead: 'What is kept about questions.',
    rest: 'How often a topic was asked about, never the words or who asked. Words are kept only when someone sends a suggestion or a report, with their name.',
  },
]

export type Keys = { keys: string[]; then?: string[]; label: string; or?: string[] }
export const SHORTCUTS: { group: string; rows: Keys[] }[] = [
  {
    group: 'Anywhere',
    rows: [
      { keys: ['⌘', 'K'], label: 'Search, or go anywhere' },
      { keys: ['⌘', 'B'], label: 'Show or hide the sidebar' },
      { keys: ['?'], label: 'Show these shortcuts' },
      { keys: ['Esc'], label: 'Close, or go back' },
    ],
  },
  {
    group: 'Lists',
    rows: [
      { keys: ['J'], or: ['K'], label: 'Move down, or up' },
      { keys: ['↵'], label: 'Open' },
      { keys: ['X'], label: 'Select' },
      { keys: ['⇧', '↓'], label: 'Select a run, as Shift and a click does' },
      { keys: ['/'], label: 'Search the list' },
    ],
  },
  {
    group: 'Review',
    rows: [
      { keys: ['J'], or: ['K'], label: 'Next, or previous suggestion' },
      { keys: ['N'], or: ['P'], label: 'Next, or previous change' },
      { keys: ['⌘', '↵'], label: 'Publish, when it is ready' },
      { keys: ['Esc'], label: 'Close the note, keeping it' },
    ],
  },
  {
    group: 'Ask',
    rows: [
      { keys: ['/'], label: 'Start typing a question' },
      { keys: ['⌥', 'H'], label: 'Show or hide history' },
    ],
  },
]

/**
 * Where people write to support: Contact support and Report a problem open a mail to it. Set
 * CL_SUPPORT_EMAIL when the app is built; without it, an address that goes nowhere stands in.
 */
const configured = (import.meta as { env?: { CL_SUPPORT_EMAIL?: string } }).env?.CL_SUPPORT_EMAIL
export const SUPPORT_EMAIL = configured?.trim() || `support@${SLUG}.example`

/** A mail to support, with its subject and words filled in. */
export const supportMail = (subject?: string, body?: string) => {
  const q = new URLSearchParams()
  if (subject) q.set('subject', subject)
  if (body) q.set('body', body)
  // Mail apps read %20, not +, as a space.
  const s = q.toString().replace(/\+/g, '%20')
  return `mailto:${SUPPORT_EMAIL}${s ? `?${s}` : ''}`
}

/**
 * Report a problem, as a mail to support: what happened, and the page it happened on. Only the
 * page's address goes with it, never its query, which can hold the words of a question.
 */
export const reportMail = (what: string, page: { origin: string; pathname: string }) =>
  supportMail('Report a problem', `${what.trim()}\n\nPage: ${page.origin}${page.pathname}`)
