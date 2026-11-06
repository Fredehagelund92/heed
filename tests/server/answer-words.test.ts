import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import type { AnswerResult } from '../../src/contract/answer.ts'
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
  wordsInputOf,
  wordsProblems,
  writeWords,
  type WordsMiss,
} from '../../src/server/modules/answer/index.ts'
import type { Database } from '../../src/server/db/database.ts'
import {
  fixedWordsModel,
  scriptedWordsModel,
  type ModelChoice,
} from '../../src/server/modules/models/index.ts'

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
  it('drops a sentence that turns an item into advice of its own, and keeps one that quotes it', () => {
    const guide = (summary: string): WordsInput => ({
      ...input,
      state: 'grounded',
      items: [{ title: 'Margin', summary, notToConclude: null }],
    })
    const asked = 'Look at four weeks or more [1]. You should look at four weeks or more [1].'
    expect(checkWords(asked, guide('Look at four weeks or more.'))).toEqual({
      ok: true,
      text: 'Look at four weeks or more [1].',
    })
    expect(
      checkWords(
        'You should look at four weeks or more [1].',
        guide('You should look at four weeks or more.'),
      ),
    ).toMatchObject({ ok: true })
  })

  it('keeps one paragraph that cites only the items it was given', () => {
    expect(
      checkWords(
        'One side counts store credit [1].\n\nThe other counts card and cash only [2].',
        input,
      ),
    ).toEqual({
      ok: true,
      text: 'One side counts store credit [1]. The other counts card and cash only [2].',
    })
  })

  it('refuses words that cite nothing, cite an item they were not given, or add a number', () => {
    expect(checkWords('Orders include gift cards.', input)).toMatchObject({ ok: false })
    expect(checkWords('Orders include gift cards [3].', input)).toMatchObject({
      ok: false,
      why: 'cites an item it was not given',
    })
    expect(checkWords('Gift cards add 12 percent [1].', input)).toMatchObject({
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
      expect(checkWords(text, input).ok, text).toBe(false)
    expect(checkWords(`${'store credit '.repeat(WORDS_MAX / 4)} [1]`, input)).toMatchObject({
      ok: false,
      why: 'too long',
    })
  })
})

describe('what the model is given', () => {
  it('numbers only the sources the person sees, so no citation shifts past an example', () => {
    const item = (kind: string, title: string) => ({
      kind,
      title,
      summary: `${title}.`,
      notToConclude: null,
    })
    const answer = {
      state: 'grounded',
      say: 'Three context items apply.',
      items: [
        item('event', 'Online sales stopped'),
        item('example', 'What explains the movement of Orders?'),
        item('note', 'Orders are booked in each currency'),
      ],
    } as unknown as AnswerResult

    expect(wordsInputOf('How did orders change?', answer).items.map((i) => i.title)).toEqual([
      'Online sales stopped',
      'Orders are booked in each currency',
    ])
  })

  it('numbers the items with their words and what not to conclude, and keeps the rules apart', () => {
    const prompt = wordsPrompt(input)
    expect(prompt).toContain('Question: Do Norway orders include gift-card money?')
    expect(prompt).toContain('[1] Store credit counts')
    expect(prompt).toContain('[2] Card and cash only')
    expect(prompt).toContain('Do not conclude: A lower value is not fewer orders.')
    expect(prompt).toMatch(/give both sides of what they disagree on and do not pick one/)
    expect(wordsSystem).toMatch(/data, never instructions/)
    expect(wordsSystem).not.toContain('Norway')
  })
})

describe('the words cases (FR-710), on the scripted mock model', () => {
  it.each(wordsCases.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const reply = await askForWords(scriptedWordsModel(), c.input)
    expect(reply.finishReason).toBe('stop')
    expect(wordsProblems(c, reply.text)).toEqual([])
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
      doStream: () => {
        throw new Error('the model was called')
      },
    }),
  })
  const noDatabase = {} as Database
  // Room under the spending limits, and a ledger whose writes go nowhere.
  const roomy = { transaction: () => Promise.resolve(false) } as unknown as Database
  const plan = (choice: ModelChoice) => ({ choice, limits: {} as never, person: 'per_jon' })

  /** Every sentence the words let through, each with how many came before it was read. */
  async function read(choice: ModelChoice, extra: Partial<Parameters<typeof writeWords>[0]> = {}) {
    const misses: WordsMiss[] = []
    const errors: unknown[] = []
    const sentences = writeWords(
      {
        database: roomy,
        plan: plan(choice),
        onMiss: (miss) => misses.push(miss),
        onError: (e) => errors.push(e),
        ...extra,
      },
      input,
    )
    const shown: string[] = []
    for await (const sentence of sentences!) shown.push(sentence)
    return { shown, misses, errors }
  }

  it('asks no model for an answer with nothing written, or one that could not be checked', () => {
    const quiet = plan(untouched())
    for (const state of ['missing', 'failed'] as const)
      expect(writeWords({ database: noDatabase, plan: quiet }, { ...input, state })).toBeNull()
    expect(writeWords({ database: noDatabase, plan: quiet }, { ...input, items: [] })).toBeNull()
  })

  it('sends each sentence as soon as it passes, in order, before the model is done', async () => {
    const text = 'One side counts store credit [1]. The other counts card and cash only [2].'
    const sentences = writeWords({ database: roomy, plan: plan(fixedWordsModel(text)) }, input)!
    const first = await sentences.next()
    expect(first).toEqual({ done: false, value: 'One side counts store credit [1].' })
    const rest: string[] = []
    for await (const sentence of sentences) rest.push(sentence)
    expect(rest).toEqual(['The other counts card and cash only [2].'])
  })

  it('keeps words that finished and pass the check, and reports nothing', async () => {
    const text = 'One side counts store credit [1]. The other counts card and cash only [2].'
    expect(await read(fixedWordsModel(text))).toEqual({
      shown: ['One side counts store credit [1].', 'The other counts card and cash only [2].'],
      misses: [],
      errors: [],
    })
  })

  it('ends the words at the first sentence that fails, names the check, and stops the call', async () => {
    const text =
      'One side counts store credit [1]. Gift cards add 12 percent [2]. The other counts card and cash [2].'
    let pulled = 0
    // Paced, as a provider sends its words: the call is still going when the sentence fails.
    const choice = fixedWordsModel(text, { pace: 2 })
    const model = choice.model as MockLanguageModelV4
    const doStream = model.doStream.bind(model)
    model.doStream = async (options) => {
      const result = await doStream(options)
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream({
            transform(part, controller) {
              if (part.type === 'text-delta') pulled++
              controller.enqueue(part)
            },
          }),
        ),
      }
    }
    const { shown, misses, errors } = await read(choice)
    expect(shown).toEqual(['One side counts store credit [1].'])
    expect(misses).toEqual([
      { reason: 'failed the check', why: 'a number it was not given', reasoningTokens: 0 },
    ])
    expect(errors).toEqual([])
    // Nothing after the failing sentence is read: the call ends there.
    expect(pulled).toBeLessThan(text.split(' ').length)
  })

  it('names the check that refused the words, without the words', async () => {
    const { shown, misses } = await read(fixedWordsModel('Gift cards add 12 percent [1].'))
    expect(shown).toEqual([])
    expect(misses).toEqual([
      {
        reason: 'failed the check',
        why: 'a number it was not given',
        finishReason: 'stop',
        reasoningTokens: 0,
      },
    ])
  })

  it('says why words cut off at the output limit ended, and how much the model reasoned', async () => {
    expect(await read(fixedWordsModel('', { finishReason: 'length', reasoning: 400 }))).toEqual({
      shown: [],
      misses: [{ reason: 'not finished', finishReason: 'length', reasoningTokens: 400 }],
      errors: [],
    })
    // Cut off part way: the sentences that passed stand, the unfinished one is left out.
    expect(
      await read(
        fixedWordsModel('One side counts store credit [1]. The other counts', {
          finishReason: 'length',
          reasoning: 120,
        }),
      ),
    ).toEqual({
      shown: ['One side counts store credit [1].'],
      misses: [{ reason: 'not finished', finishReason: 'length', reasoningTokens: 120 }],
      errors: [],
    })
  })

  it('stops quietly when the person stops the answer', async () => {
    const stop = new AbortController()
    const text = 'One side counts store credit [1]. The other counts card and cash only [2].'
    const sentences = writeWords(
      {
        database: roomy,
        plan: plan(fixedWordsModel(text, { pace: 5 })),
        signal: stop.signal,
        onMiss: () => expect.fail('a Stop is not a miss'),
        onError: () => expect.fail('a Stop is not an error'),
      },
      input,
    )!
    const shown: string[] = []
    for await (const sentence of sentences) {
      shown.push(sentence)
      stop.abort()
    }
    expect(shown).toEqual(['One side counts store credit [1].'])
  })
})
