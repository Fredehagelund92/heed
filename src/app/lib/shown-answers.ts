import * as React from 'react'
import type { Answer } from '@/data/ask'
import type { Fact } from '@/data/world'

// The answers on screen, kept by a key the dock's address carries, so the right panel can share an
// answer or show where it says that while the chat stays beside it. In memory only, like the chats.

export type ShownAnswer = { answer: Answer; facts: Fact[] }

const shown = new Map<string, ShownAnswer>()
const listeners = new Set<() => void>()

/** A key for an answer in a chat: its turn and its question, so two chats never share one. */
export function answerKey(a: Pick<Answer, 'id' | 'question'>) {
  let h = 7
  for (const c of a.question) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return `${a.id}-${h.toString(36)}`
}

export function keepShown(key: string, entry: ShownAnswer) {
  if (shown.get(key)?.answer === entry.answer) return
  shown.set(key, entry)
  listeners.forEach((l) => l())
}

/** An answer on screen, or undefined until its chat shows it. */
export function useShownAnswer(key: string | undefined) {
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => (key ? shown.get(key) : undefined),
  )
}
