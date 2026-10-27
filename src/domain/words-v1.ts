import { codeMarks, pluralOf, readableWords, usesWord, wordPattern } from './words.ts'

/*
  The earlier glossary (glossary v1), kept for the old front end in src/web, the server's
  sentences for people (the MCP `say`, notifications, error messages and the assistant) and the
  help pages until each moves to glossary v2 (src/domain/words.ts, docs/design/copy.md). The switch
  to the new web app deletes this file. Until then docs/design/voice.md says how to write with it,
  and heed/plain-words with the ratchet in plain-words.baseline.json holds the old front end to it.

  It names one plain name for each concept, the sentence that explains it, the words not to use on
  screen with what to write instead, and the map from the specification's and the code's words to
  the names on screen. Only what people read changes. The specification, code, database, API
  fields and addresses keep their own words (item, edition, scope, area, retire), and `internal`
  below maps each of them to the name on screen (requirements 2.1, "Name on screen"). Renames
  decided by the product owner carry the date in `decided`, so a later change does not reopen them.

  The program that connects over MCP is the agent (decided 21 October 2026). It is always software
  outside this app, never a person and never the assistant, which is the helper inside it. Write
  "AI agent" where a reader meets the word first (the README, the first mention on a help page,
  the consent screen, what an agent says to a person, the assistant's replies) and "agent" after
  that, on buttons, tabs, headers, toasts and table cells. "AI app" is the retired name: it stays
  findable in search (`currentWords` in src/domain/words.ts) and is not written on a screen. A
  person who works as an agent is named by the role.

  tests/unit/words-v1.test.ts keeps the list consistent: one concept per name, every banned word
  with something to write instead, and no name, definition or replacement that uses a banned word.
  `wordsToChange` reads a text against it, with the negatives people say short: the lint rule
  heed/plain-words reads the old screens with it and the docs check the help pages (voice guide,
  "The guard rail").
*/

/** One concept as people read it. */
export type Concept = {
  /** The one name on every surface, as it reads mid-sentence (a screen capitalises a label). */
  readonly name: string
  /** One or two plain sentences people can read, in the voice of docs/design/voice.md. */
  readonly definition: string
  /** The words the specification, the code, the database and the API keep for it. */
  readonly internal: readonly string[]
  /** Where the name shows, when it is not every surface. */
  readonly only?: string
  /** Fixed phrases built on the name, written as screens write them. */
  readonly phrases?: readonly string[]
  /** When the product owner decided the name. */
  readonly decided?: string
}

const decided18Oct = '18 October 2026'
const decided21Oct = '21 October 2026'

/** The glossary: every concept people read about, by a stable key. */
export const concepts = {
  fact: {
    name: 'fact',
    definition:
      'A short, checked statement about your numbers: what happened, where, when, and how we know.',
    internal: ['context item', 'item', 'caveat'],
    phrases: ['Add a fact', 'Archive fact'],
    decided: decided18Oct,
  },
  kind: {
    name: 'kind',
    definition: 'The type of a fact: an Event, a Note, a Guide, an Example or an Issue.',
    internal: ['kind'],
  },
  library: {
    name: 'library',
    definition: 'All the facts you can read.',
    internal: ['context library'],
    phrases: ['Library'],
  },
  agent: {
    name: 'agent',
    definition:
      'An AI agent is a program outside this app, such as Claude, ChatGPT or Claude Code, that answers questions and uses tools. It can check these facts before it answers.',
    internal: ['client', 'AI client', 'AI app'],
    decided: decided21Oct,
  },
  whatAgentsGet: {
    name: 'what agents get',
    definition: 'The facts an agent gets when it asks about a metric, a market or a period.',
    internal: ['delivery', 'served', 'delivered', 'published'],
    phrases: ['Agents get it', 'Agents get this fact from today', 'shared with agents'],
  },
  domain: {
    name: 'domain',
    definition: 'A part of the business, such as Sales, with its own owners.',
    internal: ['area', 'business area'],
    decided: decided18Oct,
  },
  owner: {
    name: 'owner',
    definition: 'The person who looks after a domain and accepts its facts.',
    internal: ['owner'],
    phrases: ['the owner of Sales', 'Jon Abara, who owns Sales'],
    decided: decided18Oct,
  },
  approver: {
    name: 'approver',
    definition: 'The person who gives a second yes before agents get a high-risk fact.',
    internal: ['approver'],
  },
  admin: {
    name: 'admin',
    definition: 'The person who sets up domains, people and which agents can connect.',
    internal: ['administrator'],
    decided: decided18Oct,
  },
  proposal: {
    name: 'proposal',
    definition:
      'A new fact, or a change to one, that waits for the owner of its domain. Agents get it only once it is accepted.',
    internal: ['proposal'],
  },
  draft: {
    name: 'draft',
    definition: 'A proposal that is still yours. Nobody else sees it until you send it.',
    internal: ['draft'],
    phrases: ['Send for review'],
  },
  whereItApplies: {
    name: 'where it applies',
    definition: 'The metrics and markets a fact is about.',
    internal: ['scope', 'applicability'],
    phrases: ['Where it applies', 'Agents get this fact when a question is about these.'],
  },
  whenItApplies: {
    name: 'when it applies',
    definition: 'From a date, until a date, or still going on.',
    internal: ['validity'],
    phrases: ['From 15 June 2026, still going on', 'From 4 August to 30 September 2026'],
  },
  checkDate: {
    name: 'check date',
    definition: 'The day by which the owner checks the fact again.',
    internal: ['review date', 'next check'],
    phrases: ['Check again by 31 January 2027'],
  },
  needsChecking: {
    name: 'needs checking',
    definition: 'The check date has passed, or the source the fact is based on changed.',
    internal: ['stale', 'needs_check', 'source_missing', 'unverified'],
    phrases: ['Needs checking', 'Check due', 'Agents are told this fact may be out of date.'],
  },
  whatNotToConclude: {
    name: 'What not to conclude',
    definition:
      'A line on what someone might wrongly conclude from a fact, or who to ask first. Agents get it with the fact.',
    internal: ['notToConclude'],
    decided: decided18Oct,
  },
  archive: {
    name: 'archive',
    definition: 'Agents stop getting the fact. You can still read it and its history.',
    internal: ['retire', 'retired'],
    phrases: ['Archive fact', 'Archived', 'Fact archived. Agents no longer get it.'],
    decided: decided18Oct,
  },
  edition: {
    name: 'edition',
    definition: 'A saved set of all accepted facts, with its date.',
    internal: ['edition', 'live edition', 'candidate edition'],
    only: 'the Editions page, and the review stamp next to the edition id; everywhere else, write "what agents get today"',
    phrases: ['what agents get today', 'what agents will get'],
    decided: decided18Oct,
  },
  gap: {
    name: 'gap',
    definition: 'A question agents asked that no fact could answer.',
    internal: ['gap', 'no_match'],
  },
  checks: {
    name: 'checks',
    definition: 'The tests we run on a proposal before the owner accepts it.',
    internal: ['gate', 'levels'],
    phrases: ['Complete', 'Finds the right questions', 'Reaches agents', 'Answers stay right'],
  },
  testQuestion: {
    name: 'test question',
    definition: 'A question with a known right answer. We ask it to check that answers stay right.',
    internal: ['test question', 'golden question', 'probe'],
    phrases: ['All 5 test questions find it when they should.', 'No test answer got worse.'],
  },
  hiddenTestQuestion: {
    name: 'hidden test question',
    definition:
      'A test question that the people who write facts, and the assistant, never see. It shows how good answers really are.',
    internal: ['held-out test question', 'held-out', 'sealed'],
  },
  names: {
    name: 'names',
    definition:
      'The metrics, markets and products we know by name. Write the name itself where you can: Orders, Norway.',
    internal: ['vocabulary', 'term', 'member', 'dimension value'],
  },
  dimension: {
    name: 'dimension',
    definition:
      'A way to split a number, such as market, product or brand. Elsewhere, write the dimension\'s own name: "the market".',
    internal: ['dimension'],
    only: 'the Catalogue and Administration',
  },
  definitionChanged: {
    name: 'definition changed',
    definition:
      'What a metric or a market means changed at its source. Facts written before the change wait for a check.',
    internal: [],
    phrases: ['Definition changed', 'Changed in Cube, 7 Oct 2026'],
  },
  source: {
    name: 'where this comes from',
    definition: 'A link and one sentence copied from it, so the owner can check the fact.',
    internal: ['evidence'],
    phrases: ['Where this comes from', 'source'],
  },
  whoCanSeeIt: {
    name: 'who can see it',
    definition: 'Everyone, or only the groups named.',
    internal: ['audience'],
    phrases: ['Who can see it: Everyone'],
  },
  mcp: {
    name: 'MCP',
    definition: 'The connection AI agents use to check these facts. MCP is a standard for it.',
    internal: ['MCP', 'MCP gateway'],
    only: 'Connect and the help pages, always with "the connection AI agents use"',
  },
  accessKey: {
    name: 'access key',
    definition: "What an agent uses to connect when it can't sign in.",
    internal: ['token'],
  },
  tryAQuestion: {
    name: 'Try a question',
    definition: 'See what an agent gets for a question, before anyone asks it.',
    internal: ['Try it', 'agent view', 'What an agent would get'],
  },
  connectAnAgent: {
    name: 'Connect an agent',
    definition: 'Let Claude or another AI agent check these facts before it answers.',
    internal: ['Connect your AI'],
  },
  assistant: {
    name: 'assistant',
    definition:
      'The helper built into the app. It finds and explains facts, and drafts new ones for you to check and send.',
    internal: ['assistant'],
  },
  dataTeam: {
    name: 'data team',
    definition: "The team that runs the company's data tools and answers data questions.",
    internal: ['data platform team'],
  },
} as const satisfies Record<string, Concept>

export type ConceptKey = keyof typeof concepts

/** A word not to use where people read, with what to write instead. */
export type BannedWord = {
  /**
   * The word or phrase, matched as a whole word in any case. The plural that adds "s" is meant
   * too, so the list holds base forms.
   */
  readonly word: string
  /** What to write instead: the words, or for a word to leave out, what to say in its place. */
  readonly write: string
  /** The concept whose name replaces it, or null for a word of style. */
  readonly concept: ConceptKey | null
  /** Where the word may still show, when somewhere may. */
  readonly allowedOn?: string
}

/**
 * Banned on screens, in the help pages, in the assistant's replies and in the sentence an MCP
 * reply gives people to read. Code names, the specification, Administration's technical fields
 * and the MCP text meant for models keep their words.
 */
export const bannedWords: readonly BannedWord[] = [
  { word: 'context item', write: 'fact', concept: 'fact' },
  { word: 'item', write: 'fact', concept: 'fact' },
  { word: 'piece of context', write: 'fact', concept: 'fact' },
  { word: 'caveat', write: 'fact', concept: 'fact' },
  { word: 'context library', write: 'library', concept: 'library' },
  // An AI agent is software; a person who works as an agent is named by the role (`agent` above).
  { word: 'AI app', write: 'agent', concept: 'agent' },
  { word: 'client', write: 'agent', concept: 'agent' },
  { word: 'human agent', write: 'the role itself, such as the support team', concept: 'agent' },
  { word: 'support agent', write: 'the role itself, such as the support team', concept: 'agent' },
  { word: 'sales agent', write: 'the role itself, such as the sales team', concept: 'agent' },
  { word: 'service agent', write: 'the role itself, such as the service team', concept: 'agent' },
  // Administration picks the AI model each feature uses, by the name its provider lists.
  {
    word: 'model',
    write: 'agent; the assistant says "I"',
    concept: 'agent',
    allowedOn: 'Administration',
  },
  { word: 'served', write: 'agents get it', concept: 'whatAgentsGet' },
  { word: 'delivered', write: 'agents get it', concept: 'whatAgentsGet' },
  { word: 'delivery', write: 'what agents get', concept: 'whatAgentsGet' },
  { word: 'published', write: 'shared with agents', concept: 'whatAgentsGet' },
  { word: 'goes live', write: 'agents get it', concept: 'whatAgentsGet' },
  { word: 'area', write: 'domain', concept: 'domain' },
  { word: 'steward', write: 'owner', concept: 'owner' },
  { word: 'deputy', write: 'owner', concept: 'owner' },
  { word: 'reviewer', write: 'owner; approver for the second yes', concept: 'owner' },
  { word: 'administrator', write: 'admin', concept: 'admin' },
  { word: 'submission', write: 'proposal', concept: 'proposal' },
  { word: 'change request', write: 'proposal', concept: 'proposal' },
  { word: 'scope', write: 'where it applies', concept: 'whereItApplies' },
  { word: 'applicability', write: 'where it applies', concept: 'whereItApplies' },
  { word: 'validity', write: 'when it applies', concept: 'whenItApplies' },
  { word: 'review date', write: 'check date; "Check again by"', concept: 'checkDate' },
  { word: 'next check', write: '"Check again by"', concept: 'checkDate' },
  { word: 're-check', write: 'check again; "Check due"', concept: 'checkDate' },
  { word: 'valid until', write: '"Check again by"', concept: 'checkDate' },
  { word: 'needs a look', write: 'needs checking', concept: 'needsChecking' },
  { word: 'unverified', write: 'needs checking; "may be out of date"', concept: 'needsChecking' },
  { word: 'verified', write: 'checked', concept: 'checks' },
  { word: 'governed', write: 'checked', concept: 'checks' },
  { word: 'gate', write: 'checks', concept: 'checks' },
  { word: 'flip', write: 'the answer got worse (or better)', concept: 'testQuestion' },
  { word: 'retire', write: 'archive', concept: 'archive' },
  { word: 'retired', write: 'archived', concept: 'archive' },
  { word: 'take out of service', write: 'archive', concept: 'archive' },
  {
    word: 'edition',
    write: 'what agents get today',
    concept: 'edition',
    // The review stamp names the edition that served a fact: its id is the provenance link (FR-326).
    allowedOn: 'the Editions page and the review stamp',
  },
  { word: 'live edition', write: 'what agents get today', concept: 'edition' },
  { word: 'missing context', write: 'gap; "nothing is written down"', concept: 'gap' },
  { word: 'no_match', write: 'nothing is written down for this', concept: 'gap' },
  { word: 'need_more_detail', write: 'I need the metric, the market or the dates', concept: null },
  { word: 'matched', write: 'found', concept: null },
  { word: 'probe', write: 'test question', concept: 'testQuestion' },
  { word: 'impact set', write: 'the test questions it could change', concept: 'testQuestion' },
  { word: 'golden question', write: 'test question', concept: 'testQuestion' },
  { word: 'eval case', write: 'test question', concept: 'testQuestion' },
  { word: 'rubric', write: 'what a right answer says', concept: 'testQuestion' },
  { word: 'held-out', write: 'hidden test question', concept: 'hiddenTestQuestion' },
  { word: 'sealed', write: 'hidden', concept: 'hiddenTestQuestion' },
  { word: 'vocabulary', write: 'the names we know', concept: 'names' },
  { word: 'term', write: 'the name itself: the metric, the market', concept: 'names' },
  { word: 'member', write: 'the name itself: the market, the product', concept: 'names' },
  { word: 'dimension value', write: 'the name itself: the market, the product', concept: 'names' },
  {
    word: 'dimension',
    write: 'the dimension\'s own name: "the market", "the product"',
    concept: 'dimension',
    allowedOn: 'the Catalogue and Administration',
  },
  { word: 'evidence', write: 'where this comes from; source', concept: 'source' },
  { word: 'source tool', write: "the tool's own name, such as Cube", concept: null },
  { word: 'audience', write: 'who can see it', concept: 'whoCanSeeIt' },
  { word: 'MCP gateway', write: 'MCP', concept: 'mcp', allowedOn: 'Administration' },
  { word: 'token', write: 'access key', concept: 'accessKey', allowedOn: 'Administration' },
  { word: 'Try it', write: 'Try a question', concept: 'tryAQuestion' },
  { word: 'Connect your AI', write: 'Connect an agent', concept: 'connectAnAgent' },
  { word: 'data platform team', write: 'data team', concept: 'dataTeam' },
  { word: 'deterministic', write: 'the same every time', concept: null },
  { word: 'language model', write: 'AI', concept: null },
  { word: 'in plain words', write: 'leave it out, and write plainly', concept: null },
  { word: 'initiate', write: 'start', concept: null },
  { word: 'utilise', write: 'use', concept: null },
  { word: 'ensure', write: 'make sure', concept: null },
  { word: 'leverage', write: 'use', concept: null },
  { word: 'facilitate', write: 'help', concept: null },
  { word: 'oops', write: 'leave it out, and say what happened', concept: null },
  { word: 'sorry', write: 'leave it out, and say what happened and what to do', concept: null },
  { word: 'please note', write: 'leave it out, and say the thing itself', concept: null },
  { word: 'it is important to', write: 'leave it out, and say the thing itself', concept: null },
]

/**
 * The specification's and the code's words, each mapped to the name people read: "area" to
 * "domain", "scope" to "where it applies". Built from `internal`, so it never disagrees with it.
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

export { usesWord }

/** A negative written in full, and how people say it. */
export type Contraction = { readonly full: string; readonly short: string }

/**
 * The negatives people say short, as Notion writes them (decided 18 October 2026, voice guide
 * principle 5). Matched as whole words in any case; the short form takes the text's first capital.
 */
export const contractions: readonly Contraction[] = [
  { full: 'cannot', short: "can't" },
  { full: 'can not', short: "can't" },
  { full: 'do not', short: "don't" },
  { full: 'does not', short: "doesn't" },
  { full: 'did not', short: "didn't" },
  { full: 'is not', short: "isn't" },
  { full: 'are not', short: "aren't" },
  { full: 'was not', short: "wasn't" },
  { full: 'were not', short: "weren't" },
  { full: 'has not', short: "hasn't" },
  { full: 'have not', short: "haven't" },
  { full: 'had not', short: "hadn't" },
  { full: 'could not', short: "couldn't" },
  { full: 'would not', short: "wouldn't" },
  { full: 'should not', short: "shouldn't" },
  { full: 'will not', short: "won't" },
]

/**
 * The phrases that keep "not" in full, because it carries the weight of the sentence and nobody
 * may misread it (principle 5). A new one is added here, in a reviewed pull request.
 */
export const fullNegatives: readonly string[] = [
  'cannot be undone',
  // The heading every concept page of the help has (docs/old-help/README.md).
  'what it is not',
]

/** One thing to change in words people read: the words as written, and what to write instead. */
export type WordToChange = {
  /** The words as the text has them, in their case. */
  readonly found: string
  /** What to write instead. */
  readonly write: string
  /**
   * `glossary`: a banned word (`bannedWords`). `contraction`: a negative people say short.
   * `unclear`: a contraction to write in full, such as "you'd" or "wouldn't've".
   */
  readonly rule: 'glossary' | 'contraction' | 'unclear'
}

/** The banned words that are themselves codes, such as `no_match`: wrong in a sentence too. */
const bannedCodes = new Set(
  bannedWords.filter((banned) => codeMarks.test(banned.word)).map((b) => b.word.toLowerCase()),
)
/** Stands in for a negative that keeps "not" in full, so it is not told. */
const gap = '·'

/** Contractions to write in full: "you'd" (would or had?) and stacked ones ("wouldn't've"). */
const unclearContractions: readonly { pattern: RegExp; write: (stem: string) => string }[] = [
  {
    pattern: /(?<![\p{L}\p{N}_-])(\p{L}+n['’]t)['’]ve(?![\p{L}\p{N}_-])/giu,
    write: (stem) => `${stem} have`,
  },
  {
    pattern: /(?<![\p{L}\p{N}_-])(\p{L}+)['’]d(?![\p{L}\p{N}_-])/giu,
    write: (stem) => `${stem} would, or ${stem} had`,
  },
]

/** `short` with the first capital of `full`, so "Do not" becomes "Don't". */
const sameCase = (full: string, short: string) =>
  /^\p{Lu}/u.test(full) ? short[0]!.toUpperCase() + short.slice(1) : short

/**
 * What to change in `text`, a text people read, before it matches the voice guide: every banned
 * word but those `allowed` where the text shows, every negative people say short, and every
 * unclear contraction, in the order they come. Words of code inside the text are left alone, and
 * a word inside a longer banned phrase is told once ("live edition", not also "edition").
 */
export function wordsToChange(text: string, allowed: readonly string[] = []): WordToChange[] {
  const words = readableWords(text, bannedCodes)
  const ok = new Set(allowed.map((word) => word.toLowerCase()))
  const found: (WordToChange & { at: number })[] = []
  for (const banned of bannedWords) {
    if (ok.has(banned.word.toLowerCase())) continue
    for (const match of words.matchAll(wordPattern(banned.word)))
      found.push({
        found: match[0],
        write: match[0].length > banned.word.length ? pluralOf(banned.write) : banned.write,
        rule: 'glossary',
        at: match.index,
      })
  }
  let said = words
  for (const phrase of fullNegatives)
    said = said.replace(wordPattern(phrase, false), (match) => gap.repeat(match.length))
  for (const { full, short } of contractions)
    for (const match of said.matchAll(wordPattern(full, false)))
      found.push({
        found: match[0],
        write: sameCase(match[0], short),
        rule: 'contraction',
        at: match.index,
      })
  for (const { pattern, write } of unclearContractions)
    for (const match of said.matchAll(pattern))
      found.push({ found: match[0], write: write(match[1]!), rule: 'unclear', at: match.index })
  const end = (change: { found: string; at: number }) => change.at + change.found.length
  return found
    .filter(
      (change) =>
        !found.some(
          (longer) =>
            longer.found.length > change.found.length &&
            longer.at <= change.at &&
            end(longer) >= end(change),
        ),
    )
    .sort((a, b) => a.at - b.at)
    .map(({ found: words, write, rule }) => ({ found: words, write, rule }))
}
