/*
  The words people read in the web app, in one place (glossary v2): one plain name for each
  concept, the sentence that explains it, the fixed vocabularies screens draw from (the four
  kinds, the six answer lines and the two roles), and the words not to write with what to write
  instead. docs/design/copy.md says how to write; docs/product.md (section 15) lists the names;
  this file holds them in code, so a screen, a help page and a check all read one list.

  Only what people read changes. The specification, code, database, API fields and addresses keep
  their own words (item, area, retire, edition, scope, proposal), and `internal` maps each of them
  to the name on screen.

  The web app in src/app follows this glossary, checked by the lint rule heed/plain-words
  (eslint.plain-words.js) with no baseline. The server's sentences and the help pages the in-app
  assistant reads keep the earlier glossary (src/domain/words-v1.ts, docs/design/voice.md) until
  each moves to this one.

  tests/server/domain/words.test.ts keeps the list consistent: one concept per name, every banned word with
  something to write instead, no name, definition or replacement that uses a banned word, and the
  vocabularies short enough for people who read English as a second language.
*/

/** One concept as people read it. */
export type Concept = {
  /** The one name on every surface, as it reads mid-sentence (a screen capitalises a label). */
  readonly name: string
  /** One or two plain sentences people can read, in the words of docs/design/copy.md. */
  readonly definition: string
  /** The words the specification, the code, the database and the API keep for it. */
  readonly internal: readonly string[]
  /** Where the name shows, when it is not every surface. */
  readonly only?: string
  /** Fixed phrases built on the name, written as screens write them. */
  readonly phrases?: readonly string[]
}

/** The glossary: every concept people read about, by a stable key (docs/product.md, section 15). */
export const concepts = {
  context: {
    name: 'context',
    definition:
      'The area of the app, and everything agents read. People write it down, and owners check it.',
    internal: ['library', 'context library'],
    phrases: ['Context', 'Write context'],
  },
  contextItem: {
    name: 'context item',
    definition:
      'One entry of context: an event, a warning, a rule or a guide, with a source and a check date.',
    internal: ['item', 'fact'],
    phrases: ['3 context items'],
  },
  kind: {
    name: 'kind',
    definition: 'The type of a context item: an Event, a Warning, a Rule or a Guide.',
    internal: ['kind'],
  },
  definition: {
    name: 'definition',
    definition: 'A metric, a dimension or a term, and what it means here.',
    internal: ['catalogue entry'],
    phrases: ['Definitions'],
  },
  term: {
    name: 'term',
    definition: 'A word with its own meaning, written here, such as Peak season.',
    internal: ['person-written definition'],
  },
  synonym: {
    name: 'synonym',
    definition:
      'Another name for a metric or a dimension, such as GMV for Gross sales. Agents read it as that definition.',
    internal: ['alias'],
  },
  domain: {
    name: 'domain',
    definition: 'An area of the business, such as Sales. Every context item belongs to one.',
    internal: ['area', 'business area'],
  },
  owner: {
    name: 'owner',
    definition:
      "A person who publishes and checks a domain's context. Ownership belongs to the domain, not to a role.",
    internal: ['steward'],
  },
  admin: {
    name: 'Admin',
    definition: 'The role that can do everything: people, roles, domains, agents and integrations.',
    internal: ['administrator'],
  },
  member: {
    name: 'Member',
    definition: 'The role that writes context, sends suggestions, asks and comments.',
    internal: ['member'],
  },
  people: {
    name: 'people',
    definition: 'Everyone in the workspace, with their role and the domains they own.',
    internal: ['users'],
    phrases: ['People', 'Invite people', 'Remove from the workspace'],
  },
  suggestion: {
    name: 'suggestion',
    definition:
      'A change sent to an owner, from the editor or by an agent. Nothing changes until the owner publishes it.',
    internal: ['proposal'],
  },
  publish: {
    name: 'publish',
    definition: 'An owner makes context available to agents.',
    internal: ['accept'],
    phrases: ['Publish', 'Published. Agents now say'],
  },
  archive: {
    name: 'archive',
    definition: 'Take published context out of what agents get. Its history stays.',
    internal: ['retire', 'retired'],
    phrases: ['Archive', 'Archived'],
  },
  inbox: {
    name: 'Inbox',
    definition: 'What needs you, ordered by need.',
    internal: ['notifications', 'queue'],
  },
  card: {
    name: 'card',
    definition: 'One row in the Inbox, such as Not found, Reported or a Suggestion.',
    internal: ['inbox item'],
  },
  notFound: {
    name: 'Not found',
    definition:
      'A question agents asked several times and found nothing written down for. Its card brings a draft.',
    internal: ['gap', 'no_match'],
  },
  reported: {
    name: 'Reported',
    definition: 'Someone said a context item is wrong or unclear.',
    internal: ['flag'],
  },
  dueForACheck: {
    name: 'Due for a check',
    definition: 'A context item whose check date has passed.',
    internal: ['review due'],
  },
  savedQuestion: {
    name: 'saved question',
    definition:
      'A question an owner or admin keeps. It is checked again after every change: Same, Changed or Needs a look.',
    internal: ['saved view', 'test question'],
    phrases: ['Save question', 'Same', 'Changed', 'Needs a look'],
  },
  tryIt: {
    name: 'Try it',
    definition:
      'What agents would say for a question, on a draft or on live context, without asking an AI.',
    internal: [],
  },
  ask: {
    name: 'Ask',
    definition: 'The page where a person asks and sees the same answer line an agent gets.',
    internal: ['assistant'],
  },
  topic: {
    name: 'topic',
    definition: 'The exact scope agents asked about: domain, metric, market and the month.',
    internal: ['topic'],
  },
  edition: {
    name: 'edition',
    definition: 'A sealed snapshot of what agents get.',
    internal: ['edition', 'live edition'],
    only: 'Settings, Advanced, and the agent reply; never in success copy',
  },
  dontConclude: {
    name: "Don't conclude",
    definition: 'A line on a context item that stops an agent from reading a cause into it.',
    internal: ['caveat', 'what not to conclude', 'notToConclude'],
  },
  integration: {
    name: 'integration',
    definition:
      'A connected tool: where definitions live, where documents live, where figures come from.',
    internal: ['source', 'connector'],
  },
  agent: {
    name: 'agent',
    definition:
      'Software outside this app, such as Claude Code or Cursor, that reads context over MCP. Never a person.',
    internal: ['AI app', 'client'],
  },
  whatAgentsGet: {
    name: 'what agents get',
    definition: 'The text an agent receives for a context item or a question.',
    internal: ['served', 'delivered'],
  },
} as const satisfies Record<string, Concept>

export type ConceptKey = keyof typeof concepts

/** A kind as people read it: a label in a tooltip and in Details, and a hint of 14 words or fewer. */
export type KindWords = { readonly label: string; readonly hint: string }

/**
 * The four kinds, by the value stored for each (docs/product.md, section 7). A kind shows as a
 * neutral icon; the label is in its tooltip and in Details. The earlier fifth kind, `example`,
 * is no longer offered.
 */
export const kinds = {
  event: { label: 'Event', hint: 'Something that happened on a date, like a stop or a new rule.' },
  issue: {
    label: 'Warning',
    hint: 'A limit or problem agents should know, like late or missing data.',
  },
  note: {
    label: 'Rule',
    hint: 'A fixed way to read the numbers, like a definition or a house rule.',
  },
  guide: { label: 'Guide', hint: 'What to check before you explain a change.' },
} as const satisfies Record<string, KindWords>

export type Kind = keyof typeof kinds

/**
 * The words of one answer line: a label of one or two words, a sentence of eight words or fewer,
 * and the long form for a tooltip and Help. None has a contraction.
 */
export type AnswerLineWords = {
  readonly label: string
  readonly sentence: string
  readonly long: string
}

/**
 * The six answer lines, by the state in the code (docs/product.md, section 6). The line shows the
 * sentence under every label but Checked. A draft answer says `draftAnswer` and is never Checked.
 * The long forms are the only place the earlier labels still show.
 */
export const answerLines = {
  grounded: {
    label: 'Checked',
    sentence: 'This is written down and checked.',
    long: 'Based on checked context',
  },
  partial: {
    label: 'Partial',
    sentence: 'Only part of this is written down.',
    long: 'Covers part of it',
  },
  missing: {
    label: 'Not found',
    sentence: 'Nothing is written about this yet.',
    long: 'Nothing written down',
  },
  conflict: {
    label: 'Conflict',
    sentence: 'Two items say different things.',
    long: 'Context disagrees',
  },
  stale: { label: 'Outdated', sentence: 'Some of this may be old.', long: 'May be out of date' },
  failed: { label: 'Not checked', sentence: 'The check did not run.', long: 'Could not check' },
} as const satisfies Record<string, AnswerLineWords>

export type AnswerState = keyof typeof answerLines

/** What a draft answer says in place of an answer line's label. */
export const draftAnswer = 'Based on this draft'

/** The two roles (docs/product.md, section 11). Owning a domain is not a role. */
export const roles = { admin: 'Admin', member: 'Member' } as const

/** How Settings and Observability lead back: to the app, never to the workspace's name. */
export const backToApp = 'Back to app'

/** A place a banned word may show, or the only place it is banned: `appSurfaces` lists its files. */
export type Place = 'Integrations' | 'Settings' | 'the agent reply' | 'the review'

/** A word not to write where people read, with what to write instead. */
export type BannedWord = {
  /**
   * The word or phrase, matched as a whole word, in any case unless `matchCase`. The plural that
   * adds "s" is meant too, so the list holds base forms.
   */
  readonly word: string
  /** What to write instead: the words, or for a word to leave out, what to say in its place. */
  readonly write: string
  /** The concept whose name replaces it, or null for a word of style. */
  readonly concept: ConceptKey | null
  /** Only the word as written here, such as Gap as a card's name, not the word gap. */
  readonly matchCase?: boolean
  /** Where the word may still show. */
  readonly allowedOn?: readonly Place[]
  /** The only places the word is banned, when it is fine elsewhere. */
  readonly onlyOn?: readonly Place[]
}

/**
 * Banned in the words people read in the web app (docs/design/copy.md, section 4, and the checks
 * of the approved mockup). The product's name is checked by its own rule (brand/no-product-name).
 */
export const bannedWords: readonly BannedWord[] = [
  // "fact" for one entry; the word in its everyday sense ("after the fact") is a different word.
  { word: 'Fact', write: 'Context item', concept: 'contextItem', matchCase: true },
  { word: 'facts', write: 'context items', concept: 'contextItem' },
  { word: 'a fact', write: 'a context item', concept: 'contextItem' },
  { word: 'this fact', write: 'this context item', concept: 'contextItem' },
  { word: 'piece of context', write: 'context item', concept: 'contextItem' },
  { word: 'caveat', write: "Don't conclude", concept: 'dontConclude' },
  // A connected tool is named only on its own integration; generic copy names what it does.
  {
    word: 'Cube',
    write: 'your definitions source; the name only on its integration',
    concept: 'integration',
    matchCase: true,
    allowedOn: ['Integrations'],
  },
  {
    word: 'edition',
    write: 'what agents get now',
    concept: 'edition',
    allowedOn: ['Settings', 'the agent reply'],
  },
  // Nothing promises anonymity: say what is kept instead.
  { word: 'anonymous', write: 'what is kept: scopes and counts', concept: null },
  { word: 'nobody sees who', write: 'what is kept: scopes and counts', concept: null },
  // Card names say what happened.
  { word: 'Gap', write: 'Not found', concept: 'notFound', matchCase: true },
  { word: 'Flag', write: 'Reported', concept: 'reported', matchCase: true },
  // The earlier answer labels stay only as the long form, in `answerLines`. As labels they are
  // capitalised; the same words inside a sentence are plain English.
  ...[
    ['Based on checked context', 'Checked'],
    ['Covers part of it', 'Partial'],
    ['Nothing written down', 'Not found'],
    ['Context disagrees', 'Conflict'],
    ['May be out of date', 'Outdated'],
    ["Couldn't check", 'Not checked'],
    ['Not covered', 'Not found'],
  ].map(([word, write]): BannedWord => ({
    word: word!,
    write: write!,
    concept: null,
    matchCase: true,
  })),
  // The earlier kind names, as labels.
  ...[
    ['Something happened', 'Event'],
    ['A problem with the data', 'Warning'],
    ['Good to know', 'Rule'],
    ['How to look into it', 'Guide'],
  ].map(([word, write]): BannedWord => ({
    word: word!,
    write: write!,
    concept: 'kind',
    matchCase: true,
  })),
  { word: 'Users', write: 'People', concept: 'people', matchCase: true },
  { word: 'administrator', write: 'Admin', concept: 'admin' },
  { word: 'auditor', write: 'Admin', concept: 'admin' },
  { word: 'approver', write: 'owner', concept: 'owner' },
  { word: 'steward', write: 'owner', concept: 'owner' },
  { word: 'AI app', write: 'agent', concept: 'agent' },
  { word: 'client', write: 'agent', concept: 'agent' },
  // An agent is software; a person who works as one is named by the role.
  { word: 'human agent', write: 'the support team, someone on our team', concept: 'agent' },
  { word: 'support agent', write: 'the support team, someone on our team', concept: 'agent' },
  { word: 'sales agent', write: 'the sales team, someone on our team', concept: 'agent' },
  // The review names what changed, never the tool an agent ran in.
  ...['Claude', 'Cursor', 'ChatGPT', 'Codex'].map((word): BannedWord => ({
    word,
    write: 'an agent; where a suggestion came from is source data',
    concept: 'agent',
    matchCase: true,
    onlyOn: ['the review'],
  })),
  { word: 'Try a question', write: 'Try it', concept: 'tryIt' },
  { word: 'proposal', write: 'suggestion', concept: 'suggestion' },
  { word: 'accept', write: 'publish', concept: 'publish' },
  { word: 'retire', write: 'archive', concept: 'archive' },
  { word: 'retired', write: 'archived', concept: 'archive' },
  { word: 'Back to your workspace', write: backToApp, concept: null },
  { word: 'Back to Larchwood', write: backToApp, concept: null },
  { word: '\u2014', write: 'a plain dash, a comma or a full stop', concept: null },
  // Plain English for people who read it as a second language: short words, no idioms.
  { word: 'utilise', write: 'use', concept: null },
  { word: 'initiate', write: 'start', concept: null },
  { word: 'leverage', write: 'use', concept: null },
  { word: 'facilitate', write: 'help', concept: null },
  { word: 'ensure', write: 'make sure', concept: null },
  { word: 'ballpark', write: 'about', concept: null },
  { word: 'in the loop', write: 'say who is told', concept: null },
  { word: 'heads up', write: 'say the thing itself', concept: null },
  { word: 'reach out', write: 'write to, or ask', concept: null },
  { word: 'oops', write: 'leave it out, and say what happened', concept: null },
  { word: 'please note', write: 'leave it out, and say the thing itself', concept: null },
]

/**
 * The specification's and the code's words, each mapped to the name people read: "item" to
 * "context item", "area" to "domain". Built from `internal`, so it never disagrees with it.
 */
export const internalToPlain: ReadonlyMap<string, string> = new Map(
  Object.values(concepts).flatMap((concept: Concept) =>
    concept.internal.map((word) => [word.toLowerCase(), concept.name] as const),
  ),
)

/** The name people read for a word of the specification or the code, or null when it has none. */
export function plainName(internal: string): string | null {
  return internalToPlain.get(internal.toLowerCase()) ?? null
}

/**
 * The pattern of `word` as a whole word or phrase: alone, or plus "s" when `plural`; in any case
 * unless `matchCase`.
 */
export function wordPattern(word: string, plural = true, matchCase = false): RegExp {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // A mark such as the em dash is wrong wherever it stands, even between two words.
  const starts = /^[\p{L}\p{N}]/u.test(word) ? '(?<![\\p{L}\\p{N}_-])' : ''
  const ends = /[\p{L}\p{N}]$/u.test(word)
  return new RegExp(
    `${starts}${escaped}${ends ? `${plural ? 's?' : ''}(?![\\p{L}\\p{N}_-])` : ''}`,
    matchCase ? 'gu' : 'giu',
  )
}

/** Whether `text` holds `word` as a whole word or phrase, in any case, alone or plus "s". */
export function usesWord(text: string, word: string): boolean {
  return wordPattern(word).test(text)
}

/** A word that holds code's marks: a path, an address, a key, an id, a flag, a code name. */
export const codeMarks = /[/\\_=<>{}[\]@#$|~^*`]|\p{Ll}\p{Lu}|\w[.:]\w|^-{1,2}\p{L}/u
/** Sentence marks and quotes around a word, which are not part of it. */
const around = /^["'“”‘’(]+|["'“”‘’),.;:!?]+$/gu
/** Stands in for what is not words, so a phrase never runs across it. */
const gap = '·'

/**
 * The words of `text` a person reads as words: spaces evened out, and each code span and each
 * word made of code's marks (`/library`, `item_id`, `getContext`, `--flag`) replaced. A word in
 * `codes`, such as `no_match`, is a banned word made of code's marks, so it stays.
 */
export function readableWords(text: string, codes: ReadonlySet<string> = new Set()): string {
  return text
    .replace(/`[^`]*`/g, gap)
    .split(/\s+/)
    .map((word) => {
      const core = word.replace(around, '')
      return codeMarks.test(core) && !codes.has(core.toLowerCase()) ? gap : word
    })
    .join(' ')
}

/**
 * A replacement for a plural: "owners" for "stewards". A label ("Reported"), a phrase or an
 * instruction stays as written.
 */
export const pluralOf = (write: string) =>
  /^\p{Ll}+$/u.test(write) && !write.endsWith('s') ? `${write}s` : write

/** One banned word found in a text: the words as written, and what to write instead. */
export type WordToChange = { readonly found: string; readonly write: string }

/** One match of a banned word, with where it starts. */
type WordMatch = WordToChange & { readonly at: number }

/**
 * Every match of `banned` in `words` (text already through `readableWords`), a plural told as a
 * plural, with a word inside a longer match told once ("live edition", not also "edition") and
 * a word two entries match told once, in the order they come.
 */
function matchWords(
  words: string,
  banned: readonly Pick<BannedWord, 'word' | 'write' | 'matchCase'>[],
): WordMatch[] {
  const found: WordMatch[] = []
  for (const { word, write, matchCase } of banned)
    for (const match of words.matchAll(wordPattern(word, true, matchCase)))
      found.push({
        found: match[0],
        write: match[0].length > word.length ? pluralOf(write) : write,
        at: match.index,
      })
  const end = (change: WordMatch) => change.at + change.found.length
  return found
    .filter(
      (change, index) =>
        !found.some(
          (other, at) =>
            other.at <= change.at &&
            end(other) >= end(change) &&
            (other.found.length > change.found.length || (other.at === change.at && at < index)),
        ),
    )
    .sort((a, b) => a.at - b.at)
}

/** The banned words that apply on `places`: the ones not allowed there, and those banned only there. */
export function bannedOn(places: readonly Place[]): readonly BannedWord[] {
  return bannedWords.filter(
    (banned) =>
      !banned.allowedOn?.some((place) => places.includes(place)) &&
      (!banned.onlyOn || banned.onlyOn.some((place) => places.includes(place))),
  )
}

/**
 * What to change in `text`, a text people read in the web app, shown on `places`: every banned
 * word that applies there, in the order they come. Words of code inside the text are left alone.
 */
export function wordsToChange(text: string, places: readonly Place[] = []): WordToChange[] {
  return matchWords(readableWords(text), bannedOn(places)).map(({ found, write }) => ({
    found,
    write,
  }))
}
