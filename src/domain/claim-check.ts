/*
  The claim check of the review (docs/product.md, section 4): each claim a suggestion makes,
  against the sentence its writer copied from the source. An agent's suggestion and a draft for a
  Not found card come with that sentence; a person's own edit is the owner's to read.

  It never says more than it compared. A claim is a date, a number with what it counts, or a
  clause of plain words. A date or a number the sentence holds too reads as the same; one the
  sentence gives another value for reads as different; anything else, a clause whose words are not
  all in the sentence included, reads as one to check. Words are compared by their stem, so
  "failed" and "fails" are one word, but "Poland" and "Polish" are not: the check says to look,
  never that two words mean the same.

  Pure: no clock, no input or output.
*/
import { matchForm } from './quote-match.ts'

/** How a claim reads against the copied sentence. */
export const claimVerdicts = ['same', 'different', 'check'] as const
export type ClaimVerdict = (typeof claimVerdicts)[number]

/** One claim: its words, the part of the sentence it was compared with (null: none), and how it reads. */
export type ClaimRow = { claim: string; source: string | null; verdict: ClaimVerdict }

/** A review lists this many claims, in the order the text makes them; all of them are counted. */
export const CLAIMS_SHOWN = 12

const months = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]
const monthOf = (word: string) => {
  const w = word.toLowerCase().replace(/\.$/, '')
  const index = months.findIndex((m) => m === w || (w.length >= 3 && m.startsWith(w)))
  return index < 0 ? null : index + 1
}
const pad = (n: number) => String(n).padStart(2, '0')

const monthWord =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?'
const lead = '(?:(?:from|since|between|until|till|to|on|after|before)\\s+)?'
/** A date as text names it: a day, a range of days, a month, with or without the year. */
const datePhrase = new RegExp(
  [
    `${lead}\\b\\d{4}-\\d{2}-\\d{2}\\b`,
    `${lead}\\b\\d{1,2}(?:st|nd|rd|th)?(?:\\s*(?:to|-|–|and)\\s*\\d{1,2}(?:st|nd|rd|th)?)?\\s+${monthWord}(?:\\s+\\d{4})?\\b`,
    `${lead}\\b${monthWord}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`,
    `${lead}\\b${monthWord}\\s+\\d{4}\\b`,
  ].join('|'),
  'giu',
)

/** The days a date phrase names, as ISO days (a month as its first day); none when it names no year. */
export function daysOf(phrase: string, year: number | null = null): string[] {
  const text = phrase.toLowerCase()
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (iso) return [`${iso[1]}-${iso[2]}-${iso[3]}`]
  const yearFound = /\b(\d{4})\b/.exec(text)
  const y = yearFound ? Number(yearFound[1]) : year
  if (y === null) return []
  const words = text.match(/[a-z]+|\d+/g) ?? []
  const month = words.map(monthOf).find((m) => m !== null) ?? null
  if (month === null) return []
  const days = words
    .filter((w) => /^\d{1,2}$/.test(w))
    .map(Number)
    .filter((d) => d >= 1 && d <= 31)
  if (!days.length) return [`${y}-${pad(month)}-01`]
  return days.map((d) => `${y}-${pad(month)}-${pad(d)}`)
}

const numberWords: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  twenty: 20,
  thirty: 30,
  hundred: 100,
}
/** A number and the word after it, which says what it counts: "340 accounts", "two days". */
const numberPhrase = new RegExp(
  `(?:(?:up to|about|around|over|under|at least|at most|nearly|almost)\\s+)?\\b(\\d+(?:[.,]\\d+)*(?:\\s?%)?|${Object.keys(numberWords).join('|')})\\b(?:\\s+([\\p{L}]+))?`,
  'giu',
)

const stopWords = new Set(
  (
    'a an the of in on at to for from by with and or but is are was were be been being it its ' +
    'this that these those there here their they them as up down out into onto over than then so ' +
    'do does did has have had will would can could may might must shall should our we you ' +
    'your us until since between within after before each every all any some more most least ' +
    'also too very just which who whom whose what when where why how if while because about ' +
    'per via own same other such'
  ).split(' '),
)

/**
 * A word's stem, crudely and the same every time: lower case, without its common endings, a
 * doubled last letter or a final e, so "stopped", "stops" and "stop", or "taking" and "take", meet.
 */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/['’]s$/, '')
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`
  else if (w.length > 4 && /(?:ss|sh|ch|x|z)es$/.test(w)) w = w.slice(0, -2)
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1)
  let cut = false
  if (w.length > 5 && w.endsWith('ing')) {
    w = w.slice(0, -3)
    cut = true
  } else if (w.length > 4 && w.endsWith('ed')) {
    w = w.slice(0, -2)
    cut = true
  }
  if (cut && /([b-df-hj-np-tv-z])\1$/.test(w) && !/(?:ll|ss|zz)$/.test(w)) w = w.slice(0, -1)
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1)
  return w
}

/** Words that turn or narrow what a clause says: never plain filler, so a flipped claim is read. */
const negators = new Set(['not', 'no', 'never', 'nor', 'without', 'only', 'less'])

const negatorsIn = (text: string) =>
  [...new Set((matchForm(text).match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => negators.has(w)))]
    .sort()
    .join()

const contentWords = (text: string) =>
  (matchForm(text).match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !stopWords.has(w))

type Found = { text: string; start: number; end: number }

const phrases = (text: string, pattern: RegExp): Found[] =>
  [...text.matchAll(pattern)].map((m) => ({
    text: m[0].trim(),
    start: m.index,
    end: m.index + m[0].length,
  }))

/** The shortest part of the sentence that holds every one of these word stems, in its own words. */
function windowOf(sentence: string, stems: readonly string[]): string | null {
  const words = [...sentence.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu)].map((m) => ({
    stem: stem(m[0]),
    start: m.index,
    end: m.index + m[0].length,
  }))
  const wanted = new Set(stems)
  let best: { start: number; end: number } | null = null
  for (let i = 0; i < words.length; i++) {
    if (!wanted.has(words[i]!.stem)) continue
    const seen = new Set<string>()
    for (let j = i; j < words.length; j++) {
      if (wanted.has(words[j]!.stem)) seen.add(words[j]!.stem)
      if (seen.size === wanted.size) {
        const span = { start: words[i]!.start, end: words[j]!.end }
        if (!best || span.end - span.start < best.end - best.start) best = span
        break
      }
    }
  }
  return best ? sentence.slice(best.start, best.end) : null
}

const numberValue = (raw: string) => {
  const word = numberWords[raw.toLowerCase()]
  return word === undefined ? raw.replace(/[\s,]/g, '').replace('%', ' %').trim() : String(word)
}

/**
 * Each claim of `text` against `sentence`, the sentence copied from the source: its dates, its
 * numbers with what they count, and its clauses of plain words, in the order the text makes them.
 */
export function claimCheck(text: string, sentence: string): ClaimRow[] {
  const source = sentence.trim()
  if (!source) return []
  const yearOf = (s: string) => {
    const y = /\b(20\d{2}|19\d{2})\b/.exec(s)
    return y ? Number(y[1]) : null
  }
  const sourceYear = yearOf(source)
  const sourceDates = phrases(source, datePhrase).map((d) => ({
    ...d,
    days: daysOf(d.text, sourceYear),
  }))
  const sourceNumbers = phrases(
    source.replace(datePhrase, (m) => ' '.repeat(m.length)),
    numberPhrase,
  ).map((n) => {
    const m = new RegExp(numberPhrase.source, 'iu').exec(n.text)!
    return { ...n, value: numberValue(m[1]!), unit: m[2] ? stem(m[2]) : null }
  })
  const sourceStems = new Set(contentWords(source).map(stem))
  const rows: { at: number; row: ClaimRow }[] = []
  let offset = 0
  for (const part of text.split(/(?<=[.!?])\s+/)) {
    const at = text.indexOf(part, offset)
    offset = at + part.length
    const year = yearOf(part) ?? sourceYear
    const dates = phrases(part, datePhrase)
    for (const date of dates) {
      const days = daysOf(date.text, year)
      const same = sourceDates.find((d) => d.days.length && d.days.join() === days.join())
      const other = sourceDates.find((d) => d.days.length)
      rows.push({
        at: at + date.start,
        row: same
          ? { claim: date.text, source: same.text, verdict: 'same' }
          : other && days.length
            ? { claim: date.text, source: other.text, verdict: 'different' }
            : { claim: date.text, source: null, verdict: 'check' },
      })
    }
    const masked = part.replace(datePhrase, (m) => ' '.repeat(m.length))
    const numbers = phrases(masked, numberPhrase)
    for (const number of numbers) {
      const m = new RegExp(numberPhrase.source, 'iu').exec(number.text)!
      const value = numberValue(m[1]!)
      const unit = m[2] ? stem(m[2]) : null
      const same = sourceNumbers.find(
        (n) => n.value === value && (unit === null || n.unit === null || n.unit === unit),
      )
      const other = sourceNumbers.find((n) => unit !== null && n.unit === unit && n.value !== value)
      rows.push({
        at: at + number.start,
        row: same
          ? { claim: number.text, source: same.text, verdict: 'same' }
          : other
            ? { claim: number.text, source: other.text, verdict: 'different' }
            : { claim: number.text, source: null, verdict: 'check' },
      })
    }
    // What is left: clauses of plain words.
    const words = numbers.reduce(
      (s, n) => s.slice(0, n.start) + ' '.repeat(n.end - n.start) + s.slice(n.end),
      masked,
    )
    let from = 0
    for (const clause of words.split(/[,;:]|\b(?:and|but|so|because|while|which)\b|\s[-–]\s/i)) {
      const start = words.indexOf(clause, from)
      from = start + clause.length
      const stems = [...new Set(contentWords(clause).map(stem))]
      if (stems.length < 2) continue
      const found = stems.filter((s) => sourceStems.has(s))
      const claim = clause
        .replace(/\s+/g, ' ')
        .replace(/[.!?]\s*$/, '')
        .trim()
      const plain = stems.filter((s) => !negators.has(s))
      const window = found.length === stems.length ? windowOf(source, plain) : null
      const same = window !== null && negatorsIn(window) === negatorsIn(clause)
      rows.push({
        at: at + start,
        row: same
          ? { claim, source: window, verdict: 'same' }
          : {
              claim,
              source: window ?? (found.length ? windowOf(source, found) : null),
              verdict: 'check',
            },
      })
    }
  }
  return rows.sort((a, b) => a.at - b.at).map((r) => r.row)
}

/** How many claims the copied sentence does not plainly say: different, or to check. */
export const claimsToCheck = (rows: readonly ClaimRow[]) =>
  rows.filter((r) => r.verdict !== 'same').length
