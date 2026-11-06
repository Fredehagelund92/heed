import type { AnswerState } from '@/model/ask'
import { CONFLICT_KEYS } from '@/lib/conflict'
import { REPOSITORY_URL } from '@domain/brand'
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
    'A context item whose check date has passed, or whose definition changed at its source. The owner confirms it is still true, or edits it.',
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

/** A key as the sheet shows it: an arrow as an arrow, a letter as a capital. */
const keyName = (key: string) =>
  (({ ArrowLeft: '←', ArrowRight: '→' }) as Record<string, string>)[key] ?? key.toUpperCase()

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
      { keys: ['X'], or: ['⇧', '↓'], label: 'Select, or select a run as Shift and a click does' },
      { keys: ['/'], or: ['F'], label: 'Search the list; on Overview, add a filter' },
    ],
  },
  {
    group: 'Review',
    rows: [
      { keys: ['J'], or: ['K'], label: 'Next, or previous suggestion' },
      { keys: ['N'], or: ['P'], label: 'Next, or previous change' },
      { keys: ['↓'], or: ['↑'], label: 'Next, or previous line' },
      { keys: ['C'], label: 'Comment on the line or field in focus' },
      { keys: ['⌘', '↵'], label: 'Publish, when it is ready' },
      { keys: ['Esc'], label: 'Close the note, keeping it' },
    ],
  },
  {
    group: 'Overview',
    rows: [
      {
        keys: ['B'],
        label: 'Go to the chart: Shift and ← or → select days, Esc clears them',
      },
    ],
  },
  {
    group: 'Conflict',
    // The view's own keys, so the sheet cannot drift from what the view does.
    rows: [
      ...CONFLICT_KEYS.map(({ key, label }) => ({ keys: [keyName(key)], label })),
      { keys: ['⌘', '↵'], label: 'Confirm, once you say why' },
    ],
  },
  {
    group: 'Ask',
    rows: [
      { keys: ['/'], label: 'Start typing a question' },
      { keys: ['@'], label: 'Mention a domain, a definition, an item or a market' },
      { keys: ['Esc'], label: 'Stop the answer being written' },
      { keys: ['⌥', 'H'], label: 'Show or hide history' },
    ],
  },
]

// Mail apps read %20, not +, as a space.
const queryOf = (params: Record<string, string | undefined>) =>
  new URLSearchParams(
    Object.entries(params).filter((entry): entry is [string, string] => !!entry[1]),
  )
    .toString()
    .replace(/\+/g, '%20')

/**
 * Where people go for help: a mail to the install's support address, or without one the project's
 * GitHub issues, which someone reads, rather than an address that goes nowhere.
 */
export function supportAt(email: string | null) {
  /** Where to tell support something, with its subject and words filled in. */
  const href = (subject?: string, body?: string) => {
    if (email) {
      const q = queryOf({ subject, body })
      return `mailto:${email}${q ? `?${q}` : ''}`
    }
    if (!subject && !body) return `${REPOSITORY_URL}/issues/new/choose`
    // The issue form (.github/ISSUE_TEMPLATE/bug.yml) fills in a field by its id.
    const q = queryOf({ template: 'bug.yml', title: subject, 'what-happened': body })
    return `${REPOSITORY_URL}/issues/new?${q}`
  }
  return {
    supportByMail: email !== null,
    /** A mail stays on the page for the mail app to open; GitHub opens beside it. */
    supportTarget: email ? {} : ({ target: '_blank', rel: 'noreferrer' } as const),
    supportHref: href,
    /**
     * Report a problem: what happened, and the page it happened on. Only the page's address goes
     * with it, never its query, which can hold the words of a question; and an issue, which anyone
     * can read, leaves out where this install is.
     */
    reportHref: (what: string, page: { origin: string; pathname: string }) =>
      href(
        'Report a problem',
        `${what.trim()}\n\nPage: ${email ? page.origin : ''}${page.pathname}`,
      ),
  }
}

/** HEED_SUPPORT_EMAIL, read when the app is built. */
const configured = (import.meta as { env?: { HEED_SUPPORT_EMAIL?: string } }).env
  ?.HEED_SUPPORT_EMAIL
export const { supportByMail, supportTarget, supportHref, reportHref } = supportAt(
  configured?.trim() || null,
)
