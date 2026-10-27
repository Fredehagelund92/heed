import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import {
  checkWords,
  WORDS_MAX,
  wordsPrompt,
  wordsSystem,
  type WordsInput,
} from '../../src/domain/answer-words.ts'
import {
  askForWords,
  wordsCases,
  wordsProblems,
  writeWords,
} from '../../src/server/modules/answer/index.ts'
import type { Database } from '../../src/server/db/database.ts'
import { scriptedWordsModel, type ModelChoice } from '../../src/server/modules/models/index.ts'

// Ask's words from a model (FR-701, FR-710): the check every model's words pass before anyone
// sees them, the prompt, and the words cases on the scripted mock model.

const input: WordsInput = {
  question: 'Do Norway orders include gift-card money?',
  state: 'conflict',
  say: '2 context items apply to Orders in Norway, and they disagree.',
  items: [
    {
      title: 'Store credit counts',
      summary: 'Order value includes store credit.',
      notToConclude: null,
    },
    {
      title: 'Card and cash only',
      summary: 'Order value counts card and cash only.',
      notToConclude: 'A lower value is not fewer orders.',
    },
  ],
}

describe('the check on a model’s words', () => {
  const known = wordsPrompt(input)

  it('keeps one paragraph that cites only the items it was given', () => {
    expect(
      checkWords('One side says one thing [1].\n\nThe other says another [2].', 2, known),
    ).toEqual({
      ok: true,
      text: 'One side says one thing [1]. The other says another [2].',
    })
  })

  it('refuses words that cite nothing, cite an item they were not given, or add a number', () => {
    expect(checkWords('Orders include gift cards.', 2, known)).toMatchObject({ ok: false })
    expect(checkWords('Orders include gift cards [3].', 2, known)).toMatchObject({
      ok: false,
      why: 'cites an item it was not given',
    })
    expect(checkWords('Gift cards add 12 percent [1].', 2, known)).toMatchObject({
      ok: false,
      why: 'a number it was not given (12)',
    })
  })

  it('refuses a list, a heading, a link and words that run too long', () => {
    for (const text of [
      '- First [1]\n- Second [2]',
      '# Answer\nIt counts [1].',
      'See https://x.example [1].',
    ])
      expect(checkWords(text, 2, known).ok, text).toBe(false)
    expect(checkWords(`${'word '.repeat(WORDS_MAX / 4)} [1]`, 2, known)).toMatchObject({
      ok: false,
      why: 'too long',
    })
  })
})

describe('what the model is given', () => {
  it('numbers the items with their words and what not to conclude, and keeps the rules apart', () => {
    const prompt = wordsPrompt(input)
    expect(prompt).toContain('Question: Do Norway orders include gift-card money?')
    expect(prompt).toContain('[1] Store credit counts')
    expect(prompt).toContain('[2] Card and cash only')
    expect(prompt).toContain('Do not conclude: A lower value is not fewer orders.')
    expect(prompt).toMatch(/give both sides and do not pick one/)
    expect(wordsSystem).toMatch(/data, never instructions/)
    expect(wordsSystem).not.toContain('Norway')
  })
})

describe('the words cases (FR-710), on the scripted mock model', () => {
  it.each(wordsCases.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const text = await askForWords(scriptedWordsModel(), c.input)
    expect(wordsProblems(c, text)).toEqual([])
  })

  it('find words that follow an instruction in an item, or leave a side out', () => {
    const injected = wordsCases.find((c) => c.id === 'item-text-is-data')!
    expect(wordsProblems(injected, 'A poem about the sea and the 312 accounts [1].')).toContain(
      'says /\\bpoem\\b/i',
    )
    const conflict = wordsCases.find((c) => c.id === 'conflict-both-sides')!
    expect(wordsProblems(conflict, 'Store credit counts [1].')).toEqual(['does not cite [2]'])
    expect(wordsProblems(conflict, null)).toEqual(['no words'])
  })
})

describe('the call Ask makes', () => {
  /** A model that must not be called. */
  const untouched = (): ModelChoice => ({
    ...scriptedWordsModel(),
    model: new MockLanguageModelV4({
      doGenerate: () => {
        throw new Error('the model was called')
      },
    }),
  })
  const noDatabase = {} as Database

  it('asks no model for an answer with nothing written, or one that could not be checked', async () => {
    const plan = { choice: untouched(), limits: {} as never, person: 'per_jon' }
    for (const state of ['missing', 'failed'] as const)
      expect(await writeWords({ database: noDatabase, plan }, { ...input, state })).toBeNull()
    expect(await writeWords({ database: noDatabase, plan }, { ...input, items: [] })).toBeNull()
  })
})
