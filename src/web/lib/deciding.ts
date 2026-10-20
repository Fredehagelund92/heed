import { useSyncExternalStore } from 'react'
import { notifyManager } from '@tanstack/react-query'
import type { DecisionOutcome } from '@/lib/review'

/*
  Decisions on their way (contract 9.3, FR-223). A proposal the person has decided shows it at
  once: it leaves To review and the counts, and its own page says the decision is being saved,
  while the service still checks and publishes it, and while a bulk step waits for Undo. When the
  service answers, the caches take its answer and the proposal leaves this list; when it refuses,
  or the step is undone, the proposal leaves this list too and is back where it was, untouched.

  Nothing here changes a cache, so a list read again in the meantime cannot undo it.
*/

type Mark = { outcome: DecisionOutcome; mark: symbol }
let marks: ReadonlyMap<string, Mark> = new Map()
let deciding: ReadonlyMap<string, DecisionOutcome> = new Map()
const listeners = new Set<() => void>()

function change(next: Map<string, Mark>) {
  marks = next
  deciding = new Map([...next].map(([id, { outcome }]) => [id, outcome]))
  listeners.forEach((listener) => listener())
}

/**
 * Marks proposals as decided with `outcome` until the returned release runs. Releasing twice, or
 * after a newer mark of the same proposal, changes nothing.
 *
 * The release waits for the query cache's own notifications: a cache that has just taken the
 * service's answer tells the screens on its next tick, and a release before it would show the
 * proposal as it was for a moment (its decision buttons back, its row back in To review).
 */
export function markDeciding(ids: readonly string[], outcome: DecisionOutcome): () => void {
  const mark = Symbol('deciding')
  change(new Map([...marks, ...ids.map((id) => [id, { outcome, mark }] as const)]))
  let released = false
  return () => {
    if (released) return
    released = true
    notifyManager.schedule(() => {
      const next = new Map(marks)
      for (const id of ids) if (next.get(id)?.mark === mark) next.delete(id)
      change(next)
    })
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The proposals whose decision is on its way, each with the decision. */
export function useDeciding(): ReadonlyMap<string, DecisionOutcome> {
  return useSyncExternalStore(
    subscribe,
    () => deciding,
    () => deciding,
  )
}

/** The rows that still wait for the person: the ones whose decision is on its way are left out. */
export function waitingRows<T extends { id: string }>(
  rows: readonly T[],
  decided: ReadonlyMap<string, DecisionOutcome>,
): T[] {
  return decided.size ? rows.filter((row) => !decided.has(row.id)) : [...rows]
}
