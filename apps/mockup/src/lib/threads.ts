import * as React from "react"
import { examples } from "@/data/ask"

// The chats under Ask, kept in memory until the page reloads: the seeded ones from the demo world
// and the chats the person starts, renames and deletes. Only the person's own chats in Ask: what
// agents ask is kept as scopes and counts, never as conversations.

export type Day = "Today" | "Yesterday" | "Earlier"

export type Thread = {
  id: string
  title: string
  question: string
  /** The curated example this chat replays, if any. */
  example?: string
  day: Day
  /** Clock time today and yesterday, a short date before that. */
  time: string
  /** Seeded from the demo world, so hidden on a fresh install. */
  seed?: boolean
}

const question = (id: string) => examples.find((e) => e.id === id)!.question
const seeded = (id: string, day: Day, time: string): Thread => ({ id, title: question(id), question: question(id), example: id, day, time, seed: true })

const LONG = "Before the weekly note goes out: has anything changed in how gross margin is counted for Spain since the price promotions came back?"

let threads: Thread[] = [
  seeded("synonym", "Today", "09:40"),
  seeded("grounded", "Today", "09:12"),
  seeded("conflict", "Today", "08:40"),
  seeded("missing", "Today", "08:05"),
  seeded("partial", "Yesterday", "16:30"),
  seeded("correction", "Yesterday", "14:02"),
  { id: "margin-spain", title: LONG, question: LONG, day: "Yesterday", time: "11:47", seed: true },
  seeded("stale", "Earlier", "Tue"),
  seeded("failed", "Earlier", "19 Oct"),
]

const listeners = new Set<() => void>()
const set = (next: Thread[]) => {
  threads = next
  listeners.forEach((l) => l())
}

export function useThreads() {
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => threads
  )
}

export const findThread = (id: string | null | undefined) => threads.find((t) => t.id === id)

/** A chat the person just started, at the top of Today. */
export function addThread(id: string, q: string) {
  const now = new Date()
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
  set([{ id, title: q, question: q, day: "Today", time }, ...threads.filter((t) => t.id !== id)])
}

export function renameThread(id: string, title: string) {
  set(threads.map((t) => (t.id === id ? { ...t, title } : t)))
}

/** Deletes a chat and returns a function that puts it back where it was. */
export function deleteThread(id: string) {
  const index = threads.findIndex((t) => t.id === id)
  const gone = threads[index]
  set(threads.filter((t) => t.id !== id))
  return () => {
    if (!gone || threads.some((t) => t.id === id)) return
    set([...threads.slice(0, index), gone, ...threads.slice(index)])
  }
}
