import { describe, expect, it } from 'vitest'
import type { Answer, Thread } from '@/model/ask'
import {
  firstRead,
  keptAnswers,
  nextTurnId,
  openingAnswers,
  placeOf,
  openingQuestion,
  reduce,
  sessionOf,
  type SessionEvent,
} from '@/model/ask-session'
import { askedTurn, doneTurn, turnReducer, type Turn } from '@/model/ask-turn'

// Which chat a thread in Ask is, and when it joins the history: worked out from the address and the
// kept chats alone, and once from the first turn that is answered, however it was asked.

const answer = (id: string, question: string, loop = false): Answer => ({
  id,
  question,
  metric: 'Orders',
  markets: [],
  state: 'grounded',
  text: 'Fine [1].',
  sources: ['fct-1'],
  said: '',
  ...(loop ? { loop: {} as Answer['loop'] } : {}),
})
const thread = (id: string, question: string, extra: Partial<Thread> = {}): Thread => ({
  id,
  title: question,
  question,
  preview: '',
  day: 'Today',
  time: '09:00',
  ...extra,
})
const none = { example: null, chat: null }
const event = (question: string, threads: Thread[] = []): SessionEvent => ({
  type: 'answered',
  question,
  threads,
  mint: 'chat-new',
})

describe('what a thread is when it mounts', () => {
  it('is fresh at a new chat, and at a chat the kept ones do not have', () => {
    expect(sessionOf(none, [])).toEqual({ kind: 'fresh' })
    expect(sessionOf({ example: null, chat: 'gone' }, [thread('a', 'Q?')])).toEqual({
      kind: 'fresh',
    })
  })

  it('is the example when the address names one, or the chat is an example', () => {
    expect(sessionOf({ example: 'grounded', chat: null }, [])).toEqual({
      kind: 'example',
      example: 'grounded',
    })
    expect(
      sessionOf({ example: null, chat: 'x' }, [thread('x', 'Q?', { example: 'missing' })]),
    ).toEqual({ kind: 'example', example: 'missing' })
  })

  it('is history for a chat from the history, with its kept answers or none', () => {
    const kept = [answer('t0', 'Q?', true)]
    expect(sessionOf({ example: null, chat: 'a' }, [thread('a', 'Q?', { answers: kept })])).toEqual(
      { kind: 'history', chat: 'a', question: 'Q?', answers: kept },
    )
    expect(sessionOf({ example: null, chat: 'a' }, [thread('a', 'Q?')])).toMatchObject({
      kind: 'history',
      answers: null,
    })
  })

  it('opens a chat at its own address, an example at the example', () => {
    expect(placeOf({ id: 'a' })).toEqual({ example: null, chat: 'a' })
    expect(placeOf({ id: 'a', example: 'e' })).toEqual({ example: 'e', chat: null })
  })

  it('reads the first answer only for an example or a chat with nothing kept', () => {
    expect(firstRead(sessionOf(none, []))).toBeNull()
    expect(firstRead({ kind: 'example', example: 'e' })).toEqual({ example: 'e' })
    expect(firstRead({ kind: 'history', chat: 'a', question: 'Q?', answers: null })).toEqual({
      question: 'Q?',
    })
    const kept = [answer('t0', 'Q?')]
    const history = { kind: 'history', chat: 'a', question: 'Q?', answers: kept } as const
    expect(firstRead(history)).toBeNull()
    expect(openingAnswers(history, undefined)).toBe(kept)
    expect(openingQuestion(history, [])).toBe(history.question)
    expect(
      openingQuestion({ kind: 'example', example: 'e' }, [{ id: 'e', question: 'Why E?' }]),
    ).toBe('Why E?')
    expect(openingAnswers({ kind: 'example', example: 'e' }, answer('x', 'Q?'))).toHaveLength(1)
  })
})

describe('joining the history', () => {
  it('a fresh thread joins on its first answered turn, whichever button asked it', () => {
    const got = reduce({ kind: 'fresh' }, event('Why?'))
    expect(got.session).toEqual({ kind: 'live', chat: 'chat-new' })
    expect(got.join).toEqual({ chat: 'chat-new', question: 'Why?', known: false })
  })

  it('joins once: a turn after it changes nothing', () => {
    const live = reduce({ kind: 'fresh' }, event('Why?')).session
    const again = reduce(live, event('And?'))
    expect(again.session).toBe(live)
    expect(again.join).toBeNull()
  })

  it('a question a chat already asks joins that chat, so the history never has it twice', () => {
    const got = reduce({ kind: 'fresh' }, event('why?', [thread('old', 'Why?')]))
    expect(got.session).toEqual({ kind: 'live', chat: 'old' })
    expect(got.join).toEqual({ chat: 'old', question: 'why?', known: true })
  })

  it('a chat from the history goes live without joining again', () => {
    const history = { kind: 'history', chat: 'a', question: 'Q?', answers: null } as const
    expect(reduce(history, event('More?'))).toEqual({
      session: { kind: 'live', chat: 'a' },
      join: null,
    })
  })

  it('an example stays the example', () => {
    const example = { kind: 'example', example: 'e' } as const
    expect(reduce(example, event('More?')).session).toBe(example)
  })

  it('a thread that is left is made again from the address, never from what it was', () => {
    // Asked here, joined as chat-new ...
    const live = reduce(sessionOf(none, []), event('Why?')).session
    expect(live).toEqual({ kind: 'live', chat: 'chat-new' })
    // ... then left and come back to (Back): the session is the history's, as for any chat.
    const back = sessionOf({ example: null, chat: 'chat-new' }, [thread('chat-new', 'Why?')])
    expect(back).toMatchObject({ kind: 'history', chat: 'chat-new' })
  })
})

describe('what a chat keeps (Ask loop)', () => {
  const done = (id: string, loop = true) => doneTurn(answer(id, `Q ${id}?`, loop))
  const run = (turn: Turn, ...actions: Parameters<typeof turnReducer>[1][]) =>
    actions.reduce(turnReducer, turn)

  it('keeps every done turn once none is on its way', () => {
    const got = keptAnswers([done('t0'), done('t1')])
    expect(got?.map((a) => a.id)).toEqual(['t0', 't1'])
  })

  it('keeps nothing while a turn is on its way', () => {
    expect(keptAnswers([done('t0'), askedTurn('t1', 'More?')])).toBeNull()
  })

  it('a stopped turn does not stop the rest being kept', () => {
    const stopped = run(askedTurn('t1', 'More?'), { type: 'stop' })
    expect(keptAnswers([done('t0'), stopped, done('t2')])?.map((a) => a.id)).toEqual(['t0', 't2'])
  })

  it('a failed turn does not either, and a chat whose first turn failed keeps the later ones', () => {
    const failed = run(askedTurn('t0', 'Q?'), { type: 'error', message: 'no' })
    expect(keptAnswers([failed, done('t1')])?.map((a) => a.id)).toEqual(['t1'])
  })

  it('keeps nothing when no turn is done, or a done turn is not the loop’s', () => {
    expect(keptAnswers([])).toBeNull()
    expect(keptAnswers([run(askedTurn('t0', 'Q?'), { type: 'stop' })])).toBeNull()
    expect(keptAnswers([done('t0'), done('t1', false)])).toBeNull()
  })

  it('names the next turn past every id held, so kept turns that skipped one never clash', () => {
    expect(nextTurnId([])).toBe('t0')
    expect(nextTurnId([done('t0'), done('t1')])).toBe('t2')
    expect(nextTurnId([done('t0'), done('t2')])).toBe('t3')
  })
})
