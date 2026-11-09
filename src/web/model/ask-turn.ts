import type { LookupEvent } from '@contract/answer'
import type { Answer } from './ask'

// One question and its answer in Ask's chat, as the look-up's events arrive (docs/product.md,
// section 5): the question shows the moment it is sent, the look-up's real steps say what it is
// doing, the state and the sources come with the engine's answer, and the words grow a checked
// sentence at a time. Pure: the page feeds it the events (src/web/pages/ask.tsx).

/** Where an answer has got to: looking up, reading what it found, writing its words, or done. */
export type Stage = 'looking' | 'reading' | 'writing' | 'done'

/** What a look-up tells the chat as it runs. */
export type AskEvent =
  /** Ask's planner chose what to look up (FR-719): what the working line says while it runs. */
  | { type: 'plan'; working: string }
  /** The look-up found its context items: how many. */
  | { type: 'found'; items: number }
  /** The engine's answer, with its own words: the state and the sources are final from here. */
  | { type: 'answer'; answer: Answer }
  /** A sentence of a model's words that passed the check. */
  | { type: 'sentence'; text: string }
  /** Ask's loop: each read so far, by code, and the nouns they named. */
  | { type: 'reads'; reads: LoopReads }

/** What Ask's loop has read so far in a turn: each read's step, and the nouns its chips draw. */
export type LoopReads = Required<
  Pick<Extract<LookupEvent, { type: 'progress' }>, 'steps' | 'nouns'>
>

/** The calls a live answer gets: its events as they come, and a signal that stops it. */
export type AskLive = { signal?: AbortSignal; onEvent?: (event: AskEvent) => void }

export type Turn = {
  /** The question, and once it is in, the engine's answer to it. */
  answer: Answer
  /** When it was asked, in this page's time (0 for an answer already in): asked again, it starts over. */
  asked: number
  /** Whether `answer` is the engine's answer yet, or only the question. */
  answered: boolean
  stage: Stage
  /** Stopped by the person: it keeps what it showed and says it is not finished. */
  stopped: boolean
  /** Nothing came back: why, in a sentence. The question stays, to ask again. */
  error: string | null
  /** How many context items the look-up found, once it has. */
  found: number | null
  /** What the planner chose to look up, in the working line's words, once it has. */
  working: string | null
  /** A model's words so far, a sentence at a time; with none, the answer's own words show. */
  sentences: string[]
  /** What Ask's loop has read so far, while it reads. */
  reads?: LoopReads
}

/** A question just sent: it shows at once, looking up. */
export const askedTurn = (
  id: string,
  question: string,
  extra: Pick<Answer, 'parts' | 'scope' | 'again'> = {},
): Turn => ({
  answer: {
    id,
    question,
    metric: '',
    markets: [],
    state: null,
    text: '',
    sources: [],
    said: '',
    ...extra,
  },
  asked: performance.now(),
  answered: false,
  stage: 'looking',
  stopped: false,
  error: null,
  found: null,
  working: null,
  sentences: [],
})

/** An answer that is already in, shown finished: a chat opened again, or a draft's. */
export const doneTurn = (answer: Answer): Turn => ({
  answer,
  asked: 0,
  answered: true,
  stage: 'done',
  stopped: false,
  error: null,
  found: answer.sources.length,
  working: null,
  sentences: [],
})

/** Whether the turn is still on its way: neither done, stopped nor failed. */
export const isLive = (turn: Turn) => turn.stage !== 'done' && !turn.stopped && !turn.error

export type TurnAction =
  | AskEvent
  /** The look-up is over: its finished answer, the words a model wrote or the engine's own. */
  | { type: 'done'; answer: Answer }
  /** The person pressed Stop. */
  | { type: 'stop' }
  /** Nothing came back: why, in a sentence. */
  | { type: 'error'; message: string }

/**
 * The turn after one more event. Nothing changes a stopped or failed turn, and a finished one
 * takes only Stop: its last words can still be on their way to the screen.
 */
export function turnReducer(turn: Turn, action: TurnAction): Turn {
  if (turn.stopped || turn.error) return turn
  if (action.type === 'stop') return { ...turn, stopped: true }
  if (turn.stage === 'done') return turn
  // The question as it was sent: its id in the chat, and the mentions it was asked with. Asked
  // again in words, the chat keeps what was typed and what it repeated.
  const { id, parts, scope, again, question } = turn.answer
  const keep = {
    id,
    ...(again ? { question, parts, again } : {}),
    ...(parts ? { parts } : {}),
    ...(scope ? { scope } : {}),
  }
  switch (action.type) {
    case 'plan':
      return { ...turn, working: action.working }
    case 'found':
      return { ...turn, stage: 'reading', found: action.items }
    case 'answer':
      return {
        ...turn,
        answer: { ...action.answer, ...keep },
        answered: true,
        stage: 'writing',
        found: action.answer.sources.length,
      }
    case 'sentence':
      return { ...turn, stage: 'writing', sentences: [...turn.sentences, action.text] }
    case 'reads':
      return { ...turn, reads: action.reads }
    case 'done':
      return {
        ...turn,
        answer: { ...action.answer, ...keep },
        answered: true,
        stage: 'done',
        found: action.answer.sources.length,
      }
    case 'error':
      return { ...turn, error: action.message }
  }
}

/**
 * The words the turn shows: the finished answer's once it is done, else the sentences a model has
 * written so far (a stopped answer keeps only those).
 */
export const shownText = (turn: Turn) =>
  turn.stage === 'done' ? turn.answer.text : turn.sentences.join(' ')
