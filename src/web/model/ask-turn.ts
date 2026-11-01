import type { Answer, QuestionPart } from './ask'
import type { MentionRef } from '@/lib/mentions'

// One question and its answer in Ask's chat, as the look-up's events arrive (docs/product.md,
// section 5): the question shows the moment it is sent, the look-up's real steps say what it is
// doing, the state and the sources come with the engine's answer, and the words grow a checked
// sentence at a time. Pure: the page feeds it the events (src/web/pages/ask.tsx).

/** Where an answer has got to: looking up, reading what it found, writing its words, or done. */
export type Stage = 'looking' | 'reading' | 'writing' | 'done'

/** What a look-up tells the chat as it runs. */
export type AskEvent =
  /** The look-up found its context items: how many. */
  | { type: 'found'; items: number }
  /** The engine's answer, with its own words: the state and the sources are final from here. */
  | { type: 'answer'; answer: Answer }
  /** A sentence of a model's words that passed the check. */
  | { type: 'sentence'; text: string }

/** The calls a live answer gets: its events as they come, and a signal that stops it. */
export type AskLive = { signal?: AbortSignal; onEvent?: (event: AskEvent) => void }

export type Turn = {
  /** The question, and once it is in, the engine's answer to it. */
  answer: Answer
  /** Whether `answer` is the engine's answer yet, or only the question. */
  answered: boolean
  stage: Stage
  /** Stopped by the person: it keeps what it showed and says it is not finished. */
  stopped: boolean
  /** How many context items the look-up found, once it has. */
  found: number | null
  /** A model's words so far, a sentence at a time; with none, the answer's own words show. */
  sentences: string[]
}

/** A question just sent: it shows at once, looking up. */
export const askedTurn = (
  id: string,
  question: string,
  extra: { parts?: QuestionPart[]; scope?: MentionRef[] } = {},
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
  answered: false,
  stage: 'looking',
  stopped: false,
  found: null,
  sentences: [],
})

/** An answer that is already in, shown finished: a chat opened again, or a draft's. */
export const doneTurn = (answer: Answer): Turn => ({
  answer,
  answered: true,
  stage: 'done',
  stopped: false,
  found: answer.sources.length,
  sentences: [],
})

/** Whether the turn is still on its way: neither done nor stopped. */
export const isLive = (turn: Turn) => turn.stage !== 'done' && !turn.stopped

export type TurnAction =
  | AskEvent
  /** The look-up is over: its finished answer, the words a model wrote or the engine's own. */
  | { type: 'done'; answer: Answer }
  /** The person pressed Stop. */
  | { type: 'stop' }

/** The turn after one more event. Nothing changes a stopped or finished turn. */
export function turnReducer(turn: Turn, action: TurnAction): Turn {
  if (!isLive(turn)) return turn
  // The question as it was sent: its id in the chat, and the mentions it was asked with.
  const { id, parts, scope } = turn.answer
  const keep = { id, ...(parts ? { parts } : {}), ...(scope ? { scope } : {}) }
  switch (action.type) {
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
    case 'done':
      return {
        ...turn,
        answer: { ...action.answer, ...keep },
        answered: true,
        stage: 'done',
        found: action.answer.sources.length,
      }
    case 'stop':
      return { ...turn, stopped: true }
  }
}

/**
 * The words the turn shows: the finished answer's once it is done, else the sentences a model has
 * written so far (a stopped answer keeps only those).
 */
export const shownText = (turn: Turn) =>
  turn.stage === 'done' ? turn.answer.text : turn.sentences.join(' ')
