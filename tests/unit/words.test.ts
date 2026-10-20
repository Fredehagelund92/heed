import { describe, expect, it } from 'vitest'
import {
  bannedWords,
  concepts,
  internalToPlain,
  plainName,
  usesWord,
  wordsToChange,
  type Concept,
  type ConceptKey,
} from '@domain/words'

/*
  The glossary's own consistency (src/domain/words.ts, docs/design/voice.md): one concept per
  name, one name per internal word, every banned word with something to write instead and a
  concept that exists, and no name, definition, phrase or replacement that uses a banned word.
*/

const entries = Object.entries(concepts) as [ConceptKey, Concept][]

/** The banned words that `text`, written for `owner`, uses. A concept may use its own word. */
function bannedIn(text: string, owner: ConceptKey | null): string[] {
  return bannedWords
    .filter((banned) => !(banned.concept !== null && banned.concept === owner && banned.allowedOn))
    .filter((banned) => usesWord(text, banned.word))
    .map((banned) => banned.word)
}

describe('the glossary', () => {
  it('gives every concept its own name', () => {
    const names = entries.map(([, concept]) => concept.name.toLowerCase())
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([])
  })

  it('maps every internal word to one name only', () => {
    const internal = entries.flatMap(([, concept]) => concept.internal.map((w) => w.toLowerCase()))
    expect(internal.filter((word, index) => internal.indexOf(word) !== index)).toEqual([])
    expect(internalToPlain.size).toBe(internal.length)
  })

  it('defines every concept in one or two sentences', () => {
    for (const [key, concept] of entries) {
      expect(concept.definition, key).toMatch(/^[A-Z].*\.$/)
      expect(concept.definition.split(/(?<=\.) /).length, key).toBeLessThanOrEqual(2)
    }
  })

  it('keeps the renames the product owner decided on 18 October 2026', () => {
    expect(plainName('context item')).toBe('fact')
    expect(plainName('item')).toBe('fact')
    expect(bannedWords.find((banned) => banned.word === 'steward')?.write).toBe('owner')
    expect(plainName('retire')).toBe('archive')
    expect(plainName('administrator')).toBe('admin')
    expect(plainName('area')).toBe('domain')
    expect(concepts.edition.only).toMatch(/^the Editions page/)
    expect(concepts.whatNotToConclude.name).toBe('What not to conclude')
  })

  it('maps the words of the specification to plain names', () => {
    expect(plainName('scope')).toBe('where it applies')
    expect(plainName('agent')).toBe('AI app')
    expect(plainName('Delivery')).toBe('what AI apps get')
    expect(plainName('review date')).toBe('check date')
    expect(plainName('held-out')).toBe('hidden test question')
    expect(plainName('a word nobody uses')).toBeNull()
  })
})

describe('the banned words', () => {
  it('lists each word once', () => {
    const words = bannedWords.map((banned) => banned.word.toLowerCase())
    expect(words.filter((word, index) => words.indexOf(word) !== index)).toEqual([])
  })

  it('give every banned word something to write instead', () => {
    for (const banned of bannedWords) expect(banned.write.trim(), banned.word).not.toBe('')
  })

  it('point every banned word at a concept that exists', () => {
    for (const banned of bannedWords)
      if (banned.concept !== null) expect(concepts, banned.word).toHaveProperty(banned.concept)
  })

  it('never write a banned word as the replacement', () => {
    for (const banned of bannedWords)
      expect(bannedIn(banned.write, banned.concept), banned.word).toEqual([])
  })

  it('stay out of every name, definition and phrase', () => {
    for (const [key, concept] of entries) {
      const texts = [concept.name, concept.definition, ...(concept.phrases ?? [])]
      for (const text of texts) expect(bannedIn(text, key), `${key}: ${text}`).toEqual([])
    }
  })

  it('allow a word only where its concept says it shows', () => {
    for (const banned of bannedWords.filter((b) => b.allowedOn))
      expect(banned.concept, banned.word).not.toBeNull()
  })
})

describe('usesWord', () => {
  it('matches a whole word or phrase, in any case, alone or plus "s"', () => {
    expect(usesWord('Items appear here', 'item')).toBe(true)
    expect(usesWord('the Steward of Commercial', 'steward')).toBe(true)
    expect(usesWord('Which scope?', 'scope')).toBe(true)
    expect(usesWord('the live edition today', 'live edition')).toBe(true)
  })

  it('leaves other words that contain it alone', () => {
    expect(usesWord('itemised', 'item')).toBe(false)
    expect(usesWord('stewardship', 'steward')).toBe(false)
    expect(usesWord('a context-item key', 'item')).toBe(false)
    expect(usesWord('telescope', 'scope')).toBe(false)
  })
})

describe('wordsToChange', () => {
  const found = (text: string, allowed: string[] = []) =>
    wordsToChange(text, allowed).map((change) => `${change.found} > ${change.write}`)

  it('names each banned word with what to write, in the order they come, plurals as plurals', () => {
    expect(found('Retire the item, then tell the stewards.')).toEqual([
      'Retire > archive',
      'item > fact',
      'stewards > owners',
    ])
    expect(found('Agents read it')).toEqual(['Agents > AI apps'])
  })

  it('tells a longer phrase once', () => {
    expect(found('The live edition holds every context item.')).toEqual([
      'live edition > what AI apps get today',
      'context item > fact',
    ])
  })

  it('leaves a word where the glossary allows it', () => {
    expect(found('Compare two editions', ['edition'])).toEqual([])
    expect(found('The live edition', ['edition'])).toEqual([
      'live edition > what AI apps get today',
    ])
  })

  it('says a negative short, keeping its capital, unless "not" carries the sentence', () => {
    expect(found('Do not share it. It cannot load, and it will not wait.')).toEqual([
      "Do not > Don't",
      "cannot > can't",
      "will not > won't",
    ])
    expect(found('This cannot be undone. What it is not.')).toEqual([])
  })

  it('asks for an unclear or stacked contraction in full', () => {
    expect(found("We'd like it; it shouldn't've changed.")).toEqual([
      "We'd > We would, or We had",
      "shouldn't've > shouldn't have",
    ])
    expect(found("You'll see it. It's here, and it isn't late.")).toEqual([])
  })

  it('leaves code inside a sentence alone, but not a code word people read', () => {
    expect(
      found('Open /library/items, set item_id or call getItem(), or run `heed scope`.'),
    ).toEqual([])
    expect(found('It says no_match.')).toEqual(['no_match > nothing is written down for this'])
  })
})
