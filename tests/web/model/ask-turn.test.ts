import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MOCK_LOOK_MS, MOCK_READ_MS, MOCK_SENTENCE_MS, playAnswer } from '@/api/mock/ask-live'
import type { Answer } from '@/model/ask'
import {
  askedTurn,
  doneTurn,
  isLive,
  shownText,
  turnReducer,
  type AskEvent,
  type Turn,
  type TurnAction,
} from '@/model/ask-turn'

// One question and its answer in Ask, as the look-up's events arrive: the question at once, the
// real steps, the state and sources with the engine's answer, then the words a sentence at a time.

const engine: Answer = {
  id: 'custom',
  question: 'Why did orders in Norway drop in August?',
  metric: 'Orders',
  markets: ['Norway'],
  state: 'grounded',
  text: 'Online sales to Norway stopped on 4 August [1]. Store credit counts [2].',
  sources: ['fct-1', 'fct-2'],
  said: '2 context items apply to Orders in Norway.',
}

const run = (turn: Turn, ...actions: TurnAction[]) => actions.reduce(turnReducer, turn)
const asked = () => askedTurn('t0', engine.question, { parts: [engine.question] })

describe('a turn as its answer arrives', () => {
  it('shows the question at once, looking up, with no answer yet', () => {
    const turn = asked()
    expect(turn).toMatchObject({ stage: 'looking', answered: false, found: null, sentences: [] })
    expect(turn.answer).toMatchObject({ id: 't0', question: engine.question, state: null })
    expect(isLive(turn)).toBe(true)
    expect(shownText(turn)).toBe('')
  })

  it('reads what the look-up found, then takes the state and sources from the engine', () => {
    const found = run(asked(), { type: 'found', items: 2 })
    expect(found).toMatchObject({ stage: 'reading', found: 2, answered: false })
    const answered = run(found, { type: 'answer', answer: engine })
    expect(answered).toMatchObject({ stage: 'writing', answered: true, found: 2 })
    // The engine's answer, under the question's own id and as it was typed.
    expect(answered.answer).toMatchObject({
      id: 't0',
      state: 'grounded',
      sources: ['fct-1', 'fct-2'],
      parts: [engine.question],
    })
    // Its words are not shown while a model may still write its own.
    expect(shownText(answered)).toBe('')
  })

  it('grows the words a sentence at a time, then shows the finished answer', () => {
    const writing = run(
      asked(),
      { type: 'answer', answer: engine },
      { type: 'sentence', text: 'Online sales stopped [1].' },
    )
    expect(shownText(writing)).toBe('Online sales stopped [1].')
    const more = run(writing, { type: 'sentence', text: 'Credit counts [2].' })
    expect(shownText(more)).toBe('Online sales stopped [1]. Credit counts [2].')
    const done = run(more, {
      type: 'done',
      answer: { ...engine, text: 'Online sales stopped [1]. Credit counts [2].' },
    })
    expect(done).toMatchObject({ stage: 'done', answered: true })
    expect(isLive(done)).toBe(false)
    expect(shownText(done)).toBe('Online sales stopped [1]. Credit counts [2].')
  })

  it("shows the engine's own words when no sentence came", () => {
    const done = run(asked(), { type: 'answer', answer: engine }, { type: 'done', answer: engine })
    expect(shownText(done)).toBe(engine.text)
  })

  it('keeps what it showed when stopped, and takes nothing after', () => {
    const stopped = run(
      asked(),
      { type: 'answer', answer: engine },
      { type: 'sentence', text: 'Online sales stopped [1].' },
      { type: 'stop' },
      { type: 'sentence', text: 'Credit counts [2].' },
      { type: 'done', answer: engine },
    )
    expect(stopped).toMatchObject({ stopped: true, stage: 'writing', answered: true })
    expect(isLive(stopped)).toBe(false)
    expect(shownText(stopped)).toBe('Online sales stopped [1].')
  })

  it('stopped before the answer, names no state and no source', () => {
    const stopped = run(asked(), { type: 'found', items: 2 }, { type: 'stop' })
    expect(stopped).toMatchObject({ stopped: true, stage: 'reading', answered: false })
    expect(stopped.answer.state).toBeNull()
    expect(stopped.answer.sources).toEqual([])
  })

  it('opens an answer that is already in as finished', () => {
    const turn = doneTurn(engine)
    expect(turn).toMatchObject({ stage: 'done', answered: true, found: 2 })
    expect(shownText(turn)).toBe(engine.text)
    expect(run(turn, { type: 'stop' })).toBe(turn)
  })
})

describe("the mock's answers in a live chat", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('come as the service sends them: found, the answer, then each sentence in time', async () => {
    const events: [number, AskEvent['type'], string?][] = []
    const start = Date.now()
    const played = playAnswer(engine, {
      onEvent: (e) =>
        events.push([Date.now() - start, e.type, e.type === 'sentence' ? e.text : undefined]),
    })
    await vi.runAllTimersAsync()
    expect(await played).toEqual(engine)
    const answered = MOCK_LOOK_MS + MOCK_READ_MS
    expect(events).toEqual([
      [MOCK_LOOK_MS, 'found', undefined],
      [answered, 'answer', undefined],
      [answered + MOCK_SENTENCE_MS, 'sentence', 'Online sales to Norway stopped on 4 August [1].'],
      [answered + 2 * MOCK_SENTENCE_MS, 'sentence', 'Store credit counts [2].'],
    ])
  })

  it('send no sentence for an answer a model writes no words for', async () => {
    const events: string[] = []
    const missing = { ...engine, state: 'missing' as const, sources: [] }
    const played = playAnswer(missing, { onEvent: (e) => events.push(e.type) })
    await vi.runAllTimersAsync()
    expect(await played).toEqual(missing)
    expect(events).toEqual(['found', 'answer'])
  })

  it('stop when the person stops them', async () => {
    const stop = new AbortController()
    const events: string[] = []
    const played = playAnswer(engine, {
      signal: stop.signal,
      onEvent: (e) => {
        events.push(e.type)
        if (e.type === 'sentence') stop.abort()
      },
    })
    const failed = expect(played).rejects.toMatchObject({ name: 'AbortError' })
    await vi.runAllTimersAsync()
    await failed
    expect(events).toEqual(['found', 'answer', 'sentence'])
  })
})
