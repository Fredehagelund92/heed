import type { Answer, AskInput, Thread } from './ask'
import { isLive, type Turn } from './ask-turn'

// Which chat a thread in Ask is, and whether it has joined the history. One value per mounted
// thread: it is made when the thread mounts and goes with it, so a thread that was left and comes
// back (Back, a reload, a chat opened from the history) is worked out again from the address and
// the kept chats alone. Pure: the page feeds it the address and the answers as they come
// (src/web/pages/ask.tsx).
//
//   fresh   an empty thread: nothing is answered yet
//   example an example, opened on its own answer; it is in the history already
//   history a chat opened from the history, a reload, Back or Forward: its kept answers, or else
//           its first question asked again
//   live    a thread in which a turn was answered: the thread shows itself, nothing is read for it

/** Where the address points: an example, a chat, or neither (a new chat). */
export type Place = { example: string | null; chat: string | null }

export type Session =
  | { kind: 'fresh' }
  | { kind: 'example'; example: string }
  | {
      kind: 'history'
      chat: string
      question: string
      /** What Ask's loop kept with the chat; none, and its first question is asked again. */
      answers: Answer[] | null
    }
  | { kind: 'live'; chat: string }

/** The place a chat opens at: an example's own address, or the chat's. */
export const placeOf = (thread: Pick<Thread, 'id' | 'example'>): Place =>
  thread.example ? { example: thread.example, chat: null } : { example: null, chat: thread.id }

/** What the thread is when it mounts, from where the address points and the chats kept. */
export function sessionOf(place: Place, threads: readonly Thread[]): Session {
  if (place.example) return { kind: 'example', example: place.example }
  const thread = threads.find((t) => t.id === place.chat)
  if (!thread) return { kind: 'fresh' }
  if (thread.example) return { kind: 'example', example: thread.example }
  return {
    kind: 'history',
    chat: thread.id,
    question: thread.question,
    answers: thread.answers?.length ? thread.answers : null,
  }
}

/** What Ask is asked for the thread's first answer, when the session does not already hold it. */
export function firstRead(session: Session): AskInput | null {
  if (session.kind === 'example') return { example: session.example }
  if (session.kind === 'history' && !session.answers) return { question: session.question }
  return null
}

/** The answers a thread opens on, given its first read; none until that has come. */
export function openingAnswers(session: Session, first: Answer | undefined): Answer[] {
  if (session.kind === 'history' && session.answers) return session.answers
  return first ? [first] : []
}

/** Whether the thread can show: a session that reads its first answer waits for it. */
export const ready = (session: Session, first: Answer | undefined) =>
  firstRead(session) === null || !!first

export type SessionEvent = {
  /** A turn was answered, whichever button asked it: the first question, Ask again, a follow-up. */
  type: 'answered'
  /** The question of that turn. */
  question: string
  /** The chats now, so a question a chat already asks joins that chat. */
  threads: readonly Thread[]
  /** The id a chat that starts here gets. */
  mint: string
}

/** A chat joining the history: its id, and whether the history already has it. */
export type Join = { chat: string; question: string; known: boolean }

/**
 * The session after an event, and the chat it joins to the history, if any. A thread joins once:
 * on its first answered turn, and not before, so a first question that was stopped or failed
 * leaves it fresh. The same session comes back when nothing changed.
 */
export function reduce(
  session: Session,
  event: SessionEvent,
): { session: Session; join: Join | null } {
  switch (session.kind) {
    case 'fresh': {
      const asking = event.threads.find(
        (t) => t.question.toLowerCase() === event.question.toLowerCase(),
      )
      const chat = asking?.id ?? event.mint
      return {
        session: { kind: 'live', chat },
        join: { chat, question: event.question, known: !!asking },
      }
    }
    case 'history':
      return { session: { kind: 'live', chat: session.chat }, join: null }
    case 'example':
    case 'live':
      return { session, join: null }
  }
}

/**
 * Ask's loop keeps a chat's answers with it, so it opens again as it was: every turn that is done,
 * once none is on its way. A stopped or failed turn is left out and does not stop the rest being
 * kept. None when a done turn is not the loop's: the chat then opens on its first question.
 */
export function keptAnswers(turns: readonly Turn[]): Answer[] | null {
  if (turns.some(isLive)) return null
  const done = turns.filter((t) => t.stage === 'done' && !t.error && !t.stopped)
  return done.length > 0 && done.every((t) => !!t.answer.loop) ? done.map((t) => t.answer) : null
}

/** The id for the next turn: `t<n>`, past every id the chat already holds (kept turns can skip). */
export function nextTurnId(turns: readonly Pick<Turn, 'answer'>[]) {
  const taken = new Set(turns.map((t) => t.answer.id))
  let n = turns.length
  while (taken.has(`t${n}`)) n++
  return `t${n}`
}
