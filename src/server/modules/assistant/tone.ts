import { metaKind } from '../../../domain/assistant-meta.ts'
import { bannedWords, usesWord } from '../../../domain/words-v1.ts'
import { productName } from '../../brand.ts'
import { assistantToolNames } from './tools.ts'

/*
  The assistant's tone, checked by code on every answer of a test run (the voice review, section
  7.5): cheap, the same every time, and run with the scripted model in every build. It flags the
  old voice the review measured: the specification's words ("context item", "owner",
  "edition"), the machinery (tool names, ids, ISO dates, edition labels), long sentences, a menu
  of what it can do in reply to a greeting or a thank-you, and the product's name where the
  person never asked about it. What the person said first may be said back, and words copied
  from a source (in quotation marks) are the source's, so neither is held against the answer.

  What a judge model grades, such as whether the first sentence answers, is in the rubrics of
  the cases (cases.ts), not here.
*/

/** The longest sentence an answer may have, in words. */
export const TONE_SENTENCE_MAX = 30
/** The longest reply to a greeting, a thank-you or a goodbye, in words. */
export const TONE_SOCIAL_MAX = 25
/** The most points a reply to "what can you do" lists. */
export const TONE_ABILITIES_MAX = 4

/** The answer as people read it, without what the check never holds against it. */
export function prose(answer: string): string {
  return (
    answer
      // A citation, which the app draws as a link: [itm_...].
      .replace(/\[(?:itm_[a-z0-9]+(?:,\s*)?)+\]/g, '')
      // A link to a page: its name is the page's name, and its path is not words.
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '')
      // Words copied from a source or from the person, in quotation marks of any kind.
      .replace(/"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|(?<![\p{L}])'[^'\n]*'(?![\p{L}])/gu, '')
      .replace(/`[^`\n]*`/g, '')
  )
}

/** The sentences of a text: a stop, a line break or a list item ends one. */
export function sentencesOf(text: string): string[] {
  return text
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '\n')
    .replace(/^\s*\|.*\|\s*$/gm, '\n')
    .split(/(?<=[.!?:])\s+|\n+/)
    .map((sentence) => sentence.replace(/[*_#>]/g, '').trim())
    .filter((sentence) => /\p{L}/u.test(sentence))
}

export const wordsOf = (sentence: string) =>
  sentence.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w))

/** The points of a Markdown list in a text. */
const listItems = (text: string) => text.match(/^\s*(?:[-*+]|\d+[.)])\s+\S/gm)?.length ?? 0

/**
 * What in an answer speaks the old voice, one problem each, or none. `said` is what the person
 * said in the conversation so far, turn by turn, this turn last, and `read` the text of the facts
 * and help pages the turn read (`readText`) and of the records it was told, such as what a domain
 * is: a word either used first may be said back.
 */
export function toneProblems(answer: string, said: readonly string[], read = ''): string[] {
  const problems: string[] = []
  const heard = [...said, read].join('\n')
  const text = prose(answer)
  for (const banned of bannedWords)
    if (usesWord(text, banned.word) && !usesWord(heard, banned.word))
      problems.push(`said "${banned.word}": write ${banned.write}`)
  for (const tool of assistantToolNames)
    if (new RegExp(`\\b${tool}\\b`).test(text)) problems.push(`named the tool ${tool}`)
  // The machinery, anywhere outside a citation: an edition label, an ISO date, a fact's id.
  const bare = answer.replace(/\[(?:itm_[a-z0-9]+(?:,\s*)?)+\]/g, '').replace(/\]\([^)]*\)/g, ']')
  if (/\b\d{4}-\d{2}-\d{2}\.\d+\b/.test(bare)) problems.push('showed an edition label')
  else if (/\b\d{4}-\d{2}-\d{2}\b/.test(bare)) problems.push('showed an ISO date')
  if (/\bitm_[a-z0-9]+/.test(bare)) problems.push("showed a fact's id outside a citation")
  const sentences = sentencesOf(text)
  // A sentence copied whole from a fact or a help page is that page's (and its own check's).
  const long = sentences.filter(
    (sentence) => wordsOf(sentence).length > TONE_SENTENCE_MAX && !read.includes(sentence),
  )
  if (long.length)
    problems.push(
      `wrote a sentence of ${Math.max(...long.map((s) => wordsOf(s).length))} words (at most ${TONE_SENTENCE_MAX}): "${long[0]!.slice(0, 80)}"`,
    )
  const kind = metaKind(said.at(-1) ?? '')
  // Speak as "I": the product's name only when the person names it or asks what it is.
  if (usesWord(text, productName) && !usesWord(heard, productName) && kind !== 'how')
    problems.push(`named ${productName}, which the person did not ask about`)
  const words = wordsOf(text).length
  if (kind === 'greeting' || kind === 'thanks') {
    if (words > TONE_SOCIAL_MAX)
      problems.push(`answered a ${kind} in ${words} words (at most ${TONE_SOCIAL_MAX})`)
    if (listItems(answer)) problems.push(`answered a ${kind} with a list`)
  }
  if (kind === 'abilities' && listItems(answer) > TONE_ABILITIES_MAX)
    problems.push(`listed ${listItems(answer)} things it can do (at most ${TONE_ABILITIES_MAX})`)
  return problems
}

/** The keys of a tool result that hold a fact's or a help page's own words. */
const ownWords = new Set([
  'title',
  'summary',
  'body',
  'notToConclude',
  'not_to_conclude',
  'text',
  'quote',
])

/**
 * The words of the facts and help pages in a turn's tool results: a fact's title or a help page's
 * sentence may be said as it is, whatever words it uses (they are rewritten where they live).
 */
export function readText(outputs: readonly unknown[]): string {
  const found: string[] = []
  const walk = (value: unknown, key: string | null) => {
    if (typeof value === 'string') {
      if (key !== null && ownWords.has(key)) found.push(value)
    } else if (Array.isArray(value)) for (const entry of value) walk(entry, key)
    else if (value && typeof value === 'object')
      for (const [name, entry] of Object.entries(value)) walk(entry, name)
  }
  for (const output of outputs) walk(output, null)
  return found.join('\n')
}

/** How a run's answers read together: the review's bars for sentences and for "you" and "I". */
export type ToneSummary = {
  answers: number
  /** Mean words per sentence over every answer: at most 16. */
  meanSentenceWords: number
  /** The longest sentence of any answer, in words: at most 30. */
  longestSentenceWords: number
  /** Answers that say "you" or "I", of `answers`: at least half. */
  personal: number
  /** Answers with any tone problem. */
  flagged: number
}

export const TONE_MEAN_MAX = 16

export function toneSummary(answers: readonly { answer: string; problems: number }[]): ToneSummary {
  const lengths = answers.flatMap(({ answer }) =>
    sentencesOf(prose(answer)).map((s) => wordsOf(s).length),
  )
  return {
    answers: answers.length,
    meanSentenceWords: lengths.length
      ? Math.round((lengths.reduce((a, b) => a + b, 0) / lengths.length) * 10) / 10
      : 0,
    longestSentenceWords: lengths.length ? Math.max(...lengths) : 0,
    personal: answers.filter(({ answer }) =>
      /\b(?:you|your|you're|you'll|I|I'm|I've|I'll|me|my)\b/i.test(prose(answer)),
    ).length,
    flagged: answers.filter(({ problems }) => problems > 0).length,
  }
}

/** Whether a run's answers meet the review's bars together, and what falls short. */
export function toneShortfalls(summary: ToneSummary): string[] {
  if (!summary.answers) return []
  return [
    ...(summary.meanSentenceWords > TONE_MEAN_MAX
      ? [`sentences average ${summary.meanSentenceWords} words (at most ${TONE_MEAN_MAX})`]
      : []),
    ...(summary.personal * 2 < summary.answers
      ? [`only ${summary.personal} of ${summary.answers} answers say "you" or "I"`]
      : []),
  ]
}
