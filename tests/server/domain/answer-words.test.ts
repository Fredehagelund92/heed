import { describe, expect, it } from 'vitest'
import {
  checkSentence,
  checkWords,
  WORDS_MAX,
  wordsGate,
  wordsPrompt,
  type WordsInput,
} from '../../../src/domain/answer-words.ts'

// Ask's words as they stream (FR-701): each sentence is checked before anyone sees it, a sentence
// that fails ends the words there, and with no sentence let through the engine's words stand.

const input: WordsInput = {
  question: 'Why did orders in Norway drop in August 2026?',
  state: 'grounded',
  say: '2 context items apply to Orders in Norway in August 2026.',
  items: [
    {
      title: 'Online sales to Norway stopped',
      summary: 'A customs rule stopped online sales to Norway from 4 August 2026.',
      notToConclude: null,
    },
    {
      title: 'Store credit counts',
      summary: 'Order value includes store credit.',
      notToConclude: null,
    },
  ],
}
const known = wordsPrompt(input)

/** The words streamed in chunks of `size` characters: what each chunk let through, then the end. */
function stream(text: string, size: number, finished = true) {
  const gate = wordsGate(input.items.length, known)
  const shown: string[][] = []
  for (let at = 0; at < text.length; at += size) shown.push(gate.push(text.slice(at, at + size)))
  const last = gate.end(finished)
  return { gate, shown: shown.filter((s) => s.length), last }
}

describe('one sentence', () => {
  it('passes a sentence that cites a given item, on one line', () => {
    expect(checkSentence('Online sales\n stopped on 4 August 2026 [1].', 2, known)).toEqual({
      ok: true,
      text: 'Online sales stopped on 4 August 2026 [1].',
      cites: true,
    })
    expect(checkSentence('Both are kept.', 2, known)).toEqual({
      ok: true,
      text: 'Both are kept.',
      cites: false,
    })
  })

  it('refuses a list item or a heading', () => {
    for (const raw of ['- Sales stopped [1].', '# Why', '1. Sales stopped [1].', '> Quoted [1].'])
      expect(checkSentence(raw, 2, known), raw).toEqual({ ok: false, why: 'a list or a heading' })
  })

  it('refuses a link', () => {
    expect(checkSentence('See https://x.example [1].', 2, known)).toEqual({
      ok: false,
      why: 'a link',
    })
    expect(checkSentence('See www.example.com [1].', 2, known)).toEqual({
      ok: false,
      why: 'a link',
    })
  })

  it('refuses a citation of an item it was not given', () => {
    expect(checkSentence('Sales stopped [3].', 2, known)).toEqual({
      ok: false,
      why: 'cites an item it was not given',
    })
    expect(checkSentence('Sales stopped [0].', 2, known)).toMatchObject({ ok: false })
  })

  it('refuses a number it was not given, and keeps one it was', () => {
    expect(checkSentence('Orders fell 12 percent [1].', 2, known)).toEqual({
      ok: false,
      why: 'a number it was not given (12)',
    })
    expect(checkSentence('Sales stopped on 4 August 2026 [1].', 2, known).ok).toBe(true)
  })
})

describe('the words as they stream', () => {
  const words =
    'Online sales to Norway stopped on 4 August 2026 [1]. Order value includes store credit [2]. Both apply.'

  it('lets each sentence through once it is complete, in order, whatever the chunks', () => {
    for (const size of [1, 3, 7, 200]) {
      const { gate, shown, last } = stream(words, size)
      expect([...shown.flat(), ...last]).toEqual([
        'Online sales to Norway stopped on 4 August 2026 [1].',
        'Order value includes store credit [2].',
        'Both apply.',
      ])
      expect(gate.failed).toBeNull()
    }
    // A sentence shows before the words are done: the first one with the second's start.
    expect(stream(words, 1).shown[0]).toEqual([
      'Online sales to Norway stopped on 4 August 2026 [1].',
    ])
  })

  it('keeps a citation that follows the stop with its sentence', () => {
    const { shown, last } = stream('Sales stopped. [1] Store credit counts. [2] ', 1)
    expect([...shown.flat(), ...last]).toEqual(['Sales stopped. [1]', 'Store credit counts. [2]'])
  })

  it('does not end a sentence inside a number or an abbreviation', () => {
    const { shown, last } = stream('It covers 4 August 2026, e.g. online sales [1]. It stands.', 2)
    expect([...shown.flat(), ...last]).toEqual([
      'It covers 4 August 2026, e.g. online sales [1].',
      'It stands.',
    ])
  })

  it('ends the words at the first sentence that fails, and shows nothing after it', () => {
    const { gate, shown, last } = stream(
      'Online sales stopped [1]. Orders fell 12 percent [1]. Store credit counts [2].',
      4,
    )
    expect([...shown.flat(), ...last]).toEqual(['Online sales stopped [1].'])
    expect(gate.failed).toBe('a number it was not given (12)')
    expect(gate.passed).toEqual(['Online sales stopped [1].'])
  })

  it('lets nothing through when the first sentence fails', () => {
    const { gate, shown, last } = stream('- Online sales stopped [1].\n- Credit counts [2].', 5)
    expect([...shown.flat(), ...last]).toEqual([])
    expect(gate.failed).toBe('a list or a heading')
  })

  it('holds sentences that cite nothing until one that does passes', () => {
    const { shown, last } = stream(
      'Here is what is known. Online sales stopped [1]. Both stand.',
      1,
    )
    expect(shown[0]).toEqual(['Here is what is known.', 'Online sales stopped [1].'])
    expect([...shown.flat(), ...last]).toHaveLength(3)
  })

  it('shows nothing for words that never cite an item', () => {
    const { gate, shown, last } = stream('Orders fell. Nobody knows why.', 3)
    expect([...shown.flat(), ...last]).toEqual([])
    expect(gate.failed).toBe('cites no item')
    expect(stream('   ', 1).gate.failed).toBe('no words')
  })

  it('leaves out the unfinished sentence of words that were cut off', () => {
    const { gate, shown, last } = stream('Online sales stopped [1]. Store credit cou', 5, false)
    expect([...shown.flat(), ...last]).toEqual(['Online sales stopped [1].'])
    expect(gate.failed).toBeNull()
    expect(stream('Online sales stopped [1', 5, false).gate.failed).toBe('no words')
  })

  it('ends the words where they would run past the longest answer', () => {
    const sentence = `${'Online sales stopped '.repeat(10).trim()} [1]. `
    const { gate, last, shown } = stream(sentence.repeat(Math.ceil(WORDS_MAX / 200) + 2), 50)
    const kept = [...shown.flat(), ...last].join(' ')
    expect(kept.length).toBeLessThanOrEqual(WORDS_MAX)
    expect(kept.length).toBeGreaterThan(WORDS_MAX - sentence.length)
    expect(gate.failed).toBe('too long')
  })
})

describe('the words whole, as the words cases check them', () => {
  it('stands only when every sentence passes', () => {
    expect(checkWords('Online sales stopped [1].\n\nCredit counts [2].', 2, known)).toEqual({
      ok: true,
      text: 'Online sales stopped [1]. Credit counts [2].',
    })
    expect(checkWords('Online sales stopped [1]. It fell 12 percent.', 2, known)).toEqual({
      ok: false,
      why: 'a number it was not given (12)',
    })
  })
})
