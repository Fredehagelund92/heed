import { describe, expect, it } from 'vitest'
import {
  answerLines,
  backToApp,
  bannedOn,
  bannedWords,
  concepts,
  draftAnswer,
  internalToPlain,
  kinds,
  plainName,
  roles,
  usesWord,
  wordsToChange,
  type Concept,
  type ConceptKey,
  type Place,
} from '../../../src/domain/words.ts'

/*
  Glossary v2's own consistency (src/domain/words.ts, docs/design/copy.md, docs/product.md): one
  concept per name, one name per internal word, every banned word with something to write instead
  and a concept that exists, no name, definition, phrase or replacement that uses a banned word,
  and the vocabularies in the words and lengths the approved mockup checks.
*/

const entries = Object.entries(concepts) as [ConceptKey, Concept][]
/** A contraction, which labels, state lines and hints never use (copy, plain English 5). */
const contraction = /\w['’]\w/

/** The banned words that `text`, written for `owner`, uses everywhere. A concept may use its own. */
function bannedIn(text: string, owner: ConceptKey | null): string[] {
  return wordsToChange(text, ['Integrations', 'Settings', 'the agent reply'])
    .filter((change) => {
      const banned = bannedWords.find((b) => usesWord(change.found, b.word))
      return !(banned?.concept === owner && owner !== null)
    })
    .map((change) => change.found)
}

describe('the glossary v2', () => {
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

  it('names one entry a context item, and maps the code words to the names on screen', () => {
    expect(concepts.contextItem.name).toBe('context item')
    expect(plainName('item')).toBe('context item')
    expect(plainName('fact')).toBe('context item')
    expect(plainName('proposal')).toBe('suggestion')
    expect(plainName('accept')).toBe('publish')
    expect(plainName('retire')).toBe('archive')
    expect(plainName('area')).toBe('domain')
    expect(plainName('steward')).toBe('owner')
    expect(plainName('gap')).toBe('Not found')
    expect(plainName('flag')).toBe('Reported')
    expect(plainName('users')).toBe('people')
    expect(plainName('caveat')).toBe("Don't conclude")
    expect(plainName('AI app')).toBe('agent')
    expect(plainName('a word nobody uses')).toBeNull()
  })

  it('keeps People, Member and Save question as the screens write them', () => {
    expect(concepts.people.phrases).toContain('People')
    expect(roles).toEqual({ admin: 'Admin', member: 'Member' })
    expect([concepts.admin.name, concepts.member.name]).toEqual(['Admin', 'Member'])
    expect(concepts.savedQuestion.phrases).toContain('Save question')
    expect(backToApp).toBe('Back to app')
  })
})

describe('the four kinds', () => {
  it('names them Event, Warning, Rule and Guide, by the value stored for each', () => {
    expect(Object.fromEntries(Object.entries(kinds).map(([kind, w]) => [kind, w.label]))).toEqual({
      event: 'Event',
      issue: 'Warning',
      note: 'Rule',
      guide: 'Guide',
    })
  })

  it('gives each a hint of fourteen words or fewer, with no contraction', () => {
    for (const { label, hint } of Object.values(kinds)) {
      expect(hint.split(' ').length, label).toBeLessThanOrEqual(14)
      expect(hint, label).not.toMatch(contraction)
    }
  })
})

describe('the six answer lines', () => {
  it('names them in one or two plain words, from one list', () => {
    expect(
      Object.fromEntries(Object.entries(answerLines).map(([state, l]) => [state, l.label])),
    ).toEqual({
      grounded: 'Checked',
      partial: 'Partial',
      missing: 'Not found',
      conflict: 'Conflict',
      stale: 'Outdated',
      failed: 'Not checked',
    })
  })

  it('keeps labels to two words and sentences to eight, with no contraction', () => {
    for (const { label, sentence, long } of Object.values(answerLines)) {
      expect(label.split(' ').length, label).toBeLessThanOrEqual(2)
      expect(sentence.split(' ').length, sentence).toBeLessThanOrEqual(8)
      for (const text of [label, sentence, long]) expect(text, text).not.toMatch(contraction)
    }
  })

  it('bans the earlier labels as labels, which stay only as the long form', () => {
    for (const { label, long } of Object.values(answerLines)) {
      if (long === 'Could not check') continue
      expect(
        wordsToChange(long).map((c) => c.write),
        long,
      ).toEqual([label])
    }
    expect(wordsToChange("Couldn't check")).toEqual([
      { found: "Couldn't check", write: 'Not checked' },
    ])
    expect(wordsToChange('Not covered')).toEqual([{ found: 'Not covered', write: 'Not found' }])
    expect(wordsToChange('Some of it may be out of date, and nothing written down.')).toEqual([])
  })

  it('never calls a draft answer checked', () => {
    expect(draftAnswer).toBe('Based on this draft')
    expect(Object.values(answerLines).map((l) => l.label)).not.toContain(draftAnswer)
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

  it('stay out of every name, definition, phrase and vocabulary', () => {
    for (const [key, concept] of entries) {
      const texts = [concept.name, concept.definition, ...(concept.phrases ?? [])]
      for (const text of texts) expect(bannedIn(text, key), `${key}: ${text}`).toEqual([])
    }
    const vocabulary = [
      ...Object.values(kinds).flatMap((k) => [k.label, k.hint]),
      ...Object.values(answerLines).flatMap((l) => [l.label, l.sentence]),
      ...Object.values(roles),
      draftAnswer,
      backToApp,
    ]
    for (const text of vocabulary) expect(bannedIn(text, null), text).toEqual([])
  })

  it('say where a word is allowed, or the only place it is banned, never both', () => {
    for (const banned of bannedWords)
      expect(Boolean(banned.allowedOn && banned.onlyOn), banned.word).toBe(false)
  })
})

describe('wordsToChange', () => {
  const found = (text: string, ...places: Place[]) =>
    wordsToChange(text, places).map((change) => `${change.found} > ${change.write}`)

  it('names each banned word with what to write, in the order they come, plurals as plurals', () => {
    expect(found('Retire a fact, then tell the stewards.')).toEqual([
      'Retire > archive',
      'a fact > a context item',
      'stewards > owners',
    ])
    expect(found('Facts and proposals')).toEqual([
      'Facts > Context item',
      'proposals > suggestions',
    ])
  })

  it('leaves "fact" in its everyday sense, and the words the mockup uses', () => {
    expect(
      found('A change after the fact shows. Every name, fact and number is mock data.'),
    ).toEqual([])
    expect(found('3 context items. An item, a term and a Member.')).toEqual([])
  })

  it('reads Gap and Flag as card names only', () => {
    expect(found('Gap')).toEqual(['Gap > Not found'])
    expect(found('Flags')).toEqual(['Flags > Reported'])
    expect(found('A gap in the data. Flag it for the owner.')).toEqual(['Flag > Reported'])
  })

  it('allows a word where the glossary allows it', () => {
    expect(found('Editions are sealed.')).toEqual(['Editions > what agents get now'])
    expect(found('Editions are sealed.', 'Settings')).toEqual([])
    expect(found('Where metrics are defined in Cube', 'Integrations')).toEqual([])
    expect(found('Where metrics are defined in Cube')).toEqual([
      'Cube > your definitions source; the name only on its integration',
    ])
  })

  it('keeps agent tools out of the review only', () => {
    expect(found('An agent in Cursor suggested this.')).toEqual([])
    expect(found('An agent in Cursor suggested this.', 'the review')).toEqual([
      'Cursor > an agent; where a suggestion came from is source data',
    ])
    expect(bannedOn(['the review']).some((b) => b.word === 'Claude')).toBe(true)
    expect(bannedOn([]).some((b) => b.word === 'Claude')).toBe(false)
  })

  it('finds an em dash wherever it stands', () => {
    expect(found('Checked\u2014two items')).toEqual([
      '\u2014 > a plain dash, a comma or a full stop',
    ])
    expect(found('Checked - two items')).toEqual([])
  })

  it('leaves code inside a sentence alone', () => {
    expect(found('Open /library/facts, set fact_id or call getFact().')).toEqual([])
  })
})
