import { useSyncExternalStore } from 'react'
import { notifyManager } from '@tanstack/react-query'

/*
  Drafts on their way out (Gmail's undo send, Linear's delete with Undo). A draft the person
  discards from a list leaves Home's Your drafts, Proposals > Mine and the Drafts counts at once,
  while the step waits 8 seconds for Undo (lib/held-action.ts) and then while the service
  discards it. When the service answers, the caches take its answer; when it refuses, or the
  step is undone, the draft is back where it was, untouched. The service keeps no way back once
  a draft is discarded, so the hold is the only Undo there is.

  Nothing here changes a cache, so a list read again in the meantime cannot bring a draft back.
*/

let marks: ReadonlyMap<string, symbol> = new Map()
let discarding: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

function change(next: Map<string, symbol>) {
  marks = next
  discarding = new Set(next.keys())
  listeners.forEach((listener) => listener())
}

/**
 * Marks drafts as on their way out until the returned release runs. Releasing twice, or after a
 * newer mark of the same draft, changes nothing. As with a decision on its way (lib/deciding.ts),
 * the release waits for the query cache's own notifications, so a list that has just taken the
 * service's answer does not show the draft again for a moment.
 */
export function markDiscarding(ids: readonly string[]): () => void {
  const mark = Symbol('discarding')
  change(new Map([...marks, ...ids.map((id) => [id, mark] as const)]))
  let released = false
  return () => {
    if (released) return
    released = true
    notifyManager.schedule(() => {
      const next = new Map(marks)
      for (const id of ids) if (next.get(id) === mark) next.delete(id)
      change(next)
    })
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The drafts on their way out. */
export function useDiscarding(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => discarding,
    () => discarding,
  )
}

/** The rows still there: the drafts on their way out are left out. */
export function keptRows<T extends { id: string }>(
  rows: readonly T[],
  gone: ReadonlySet<string>,
): T[] {
  return gone.size ? rows.filter((row) => !gone.has(row.id)) : [...rows]
}

/** The Add context form keeps an unsent copy in this browser; a discarded draft takes it along. */
export function forgetDraftBackup(personId: string, proposal: { id: string }) {
  try {
    window.localStorage.removeItem(`heed.context.${personId}.${proposal.id}`)
  } catch {
    // Storage can be blocked; there is then no copy to forget.
  }
}

const drafts = (count: number) => (count === 1 ? 'draft' : `${count.toLocaleString('en')} drafts`)

/** How many titles the confirmation names before "And 3 more". */
export const DISCARD_TITLES_SHOWN = 3

/**
 * What the confirmation says before drafts are discarded: the question, the effect in plain
 * words (nobody else saw them, a few seconds to undo, then gone for good), the button, and the
 * titles it names, the first few, then how many more.
 */
export function discardWords(titles: readonly string[]) {
  const count = titles.length
  const one = count === 1
  return {
    title: one ? 'Discard this draft?' : `Discard ${drafts(count)}?`,
    effect: one
      ? "Nobody else has seen it. You can undo for a few seconds, then it's gone for good."
      : "Nobody else has seen them. You can undo for a few seconds, then they're gone for good.",
    action: one ? 'Discard draft' : `Discard ${drafts(count)}`,
    shown: titles.slice(0, DISCARD_TITLES_SHOWN),
    more: Math.max(0, count - DISCARD_TITLES_SHOWN),
  }
}

/** The toast that holds the step for Undo: "Draft discarded", "3 drafts discarded". */
export function discardedWords(count: number) {
  return count === 1 ? 'Draft discarded' : `${drafts(count)} discarded`
}

/** One draft the service would not discard, and why, in the person's words. */
export type DiscardFailure = { title: string; message: string }

/**
 * What the toast says when the service would not discard some of the drafts: how many went, the
 * first one that did not and why, and that the rest are still there. Null when every one went.
 */
export function discardFailureWords(
  total: number,
  failures: readonly DiscardFailure[],
): { title: string; description: string } | null {
  const first = failures[0]
  if (!first) return null
  const kept = failures.length
  const title =
    kept === total
      ? total === 1
        ? "The draft wasn't discarded"
        : "The drafts weren't discarded"
      : `${(total - kept).toLocaleString('en')} of ${drafts(total)} discarded`
  const why = `${first.title}: ${first.message.replace(/\.?$/, '.')}`
  const more = kept > 1 ? ` And ${(kept - 1).toLocaleString('en')} more.` : ''
  const still = kept === 1 ? "It's still in your drafts." : "They're still in your drafts."
  return { title, description: `${why}${more} ${still}` }
}
