import { describe, expect, it } from 'vitest'
import { asksAgain, asksNothing, nothingAskedSaid } from '../../../src/domain/ask-again.ts'
import {
  CHAT_CHARS,
  CHAT_TURNS,
  chatSources,
  fitChat,
  type ChatTurn,
} from '../../../src/domain/ask-chat.ts'

// What Ask remembers of a chat (FR-719): the last turns within two caps, and what is settled
// about a message before any model is called.

const turn = (question: string, over: Partial<ChatTurn> = {}): ChatTurn => ({
  question,
  sources: [],
  ...over,
})

describe('a message that asks again', () => {
  it.each([
    'try again',
    'Try again.',
    'try again please',
    'please try again',
    'again',
    'again!',
    'retry',
    'once more',
    'one more time',
    'same question',
    'the same question again',
    'ask again',
    'ask that again',
    'do it again',
    'can you try that again',
    'redo',
    'repeat',
    'repeat that',
    'another try',
  ])('%s', (message) => {
    expect(asksAgain(message)).toBe(true)
  })

  it.each([
    'try again with Sweden',
    'again in Sweden',
    'same question for Norway',
    'why did orders drop again?',
    'what changed again last week?',
    'repeat customers',
    'try',
  ])('%s has a subject of its own', (message) => {
    expect(asksAgain(message)).toBe(false)
  })
})

describe('a message that asks nothing', () => {
  const chat = [turn('why did orders drop in Norway?')]

  it.each(['', '?', '...', 'hmm', 'ok', 'ok thanks', 'thank you', 'what?', 'yes please'])(
    '%j asks nothing, with or without a chat',
    (message) => {
      expect(asksNothing(message, [])).toBe(true)
      expect(asksNothing(message, chat)).toBe(true)
    },
  )

  it.each(['why?', 'and?', 'tell me more', 'go on', 'what about it?', 'explain'])(
    '%j leans on the chat: it asks nothing only with no chat',
    (message) => {
      expect(asksNothing(message, [])).toBe(true)
      expect(asksNothing(message, chat)).toBe(false)
    },
  )

  it('takes any word as the answer to a question Ask asked back', () => {
    const asked = [turn('how is Sweden doing?', { asked: 'Do you mean Orders or Net revenue?' })]
    expect(asksNothing('yes', asked)).toBe(false)
    expect(asksNothing('orders', asked)).toBe(false)
  })

  it('leaves a question with a subject alone', () => {
    for (const message of ['orders', 'give me a summary', 'what happened in August?'])
      expect(asksNothing(message, [])).toBe(false)
  })

  it('asks in one plain sentence, what to look at or what to repeat', () => {
    expect(nothingAskedSaid('try again', [])).toBe(
      'There is no earlier question to repeat, so what should Ask look at?',
    )
    expect(nothingAskedSaid('hmm', [])).toBe('What should Ask look at?')
    expect(nothingAskedSaid('thanks', chat)).toBe(
      'What should Ask look at, or which question should it repeat?',
    )
  })
})

describe('the caps on a chat', () => {
  it('keeps the last six turns: past that the oldest drops out whole', () => {
    const turns = Array.from({ length: 9 }, (_, i) => turn(`question ${i + 1}`))
    const fitted = fitChat(turns)
    expect(CHAT_TURNS).toBe(6)
    expect(fitted.map((t) => t.question)).toEqual([4, 5, 6, 7, 8, 9].map((n) => `question ${n}`))
  })

  it('drops the oldest turns until they fit the size cap, never the newest', () => {
    const long = (n: number) => turn(`${n} ${'word '.repeat(300)}`)
    const fitted = fitChat([long(1), long(2), long(3), long(4), turn('short')])
    expect(fitted.at(-1)?.question).toBe('short')
    expect(fitted.length).toBeLessThan(5)
    expect(fitted.reduce((sum, t) => sum + t.question.length, 0)).toBeLessThanOrEqual(CHAT_CHARS)
    expect(fitChat([turn('x'.repeat(CHAT_CHARS * 2))])).toHaveLength(1)
  })

  it('numbers each source once, the last answer first', () => {
    expect(
      chatSources([
        turn('one', { sources: ['a', 'b', 'c', 'd'] }),
        turn('two', { sources: ['b', 'e'] }),
      ]),
    ).toEqual(['b', 'e', 'a', 'c'])
  })
})
