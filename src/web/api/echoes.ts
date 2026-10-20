import type { QueryClient } from '@tanstack/react-query'
import type { StreamEvent } from './client'

/*
  The live stream announces every change, a person's own included. A decision made in this tab
  refreshes what it changed itself (`useApiWrite`), so when its own announcements arrive a moment
  later, refreshing the same lists again would only send the same large reads twice and cancel the
  ones in flight. The change notes what it expects to hear; the live cache passes over those
  events once. Anything else, from anyone, is applied as before.
*/

/** How long an expected announcement is waited for: the stream relays within seconds. */
export const ECHO_MS = 30_000

type Expected = { proposals: Map<string, number>; editions: Map<string, number> }

const expected = new WeakMap<QueryClient, Expected>()

function of(queryClient: QueryClient): Expected {
  let held = expected.get(queryClient)
  if (!held) expected.set(queryClient, (held = { proposals: new Map(), editions: new Map() }))
  return held
}

function forget(map: Map<string, number>, now: number) {
  for (const [key, until] of map) if (until < now) map.delete(key)
}

/** A change of this tab's own: the proposals it decided and the editions it published. */
export function expectEchoes(
  queryClient: QueryClient,
  { proposals, editions }: { proposals: readonly string[]; editions: readonly string[] },
  now = Date.now(),
) {
  const held = of(queryClient)
  forget(held.proposals, now)
  forget(held.editions, now)
  for (const id of proposals) held.proposals.set(id, now + ECHO_MS)
  for (const label of editions) held.editions.set(label, now + ECHO_MS)
}

/** The decision events and the editions a change of this tab's own announces. */
const decisionTopics = new Set(['proposal.decided', 'proposal.approved'])

/**
 * Whether an event only announces a change this tab made and refreshed already. Each expected
 * announcement is passed over once.
 */
export function isEcho(queryClient: QueryClient, event: StreamEvent, now = Date.now()): boolean {
  const held = expected.get(queryClient)
  if (!held) return false
  const take = (map: Map<string, number>, key: unknown) => {
    if (typeof key !== 'string') return false
    const until = map.get(key)
    if (until === undefined || until < now) return false
    map.delete(key)
    return true
  }
  if (decisionTopics.has(event.topic)) return take(held.proposals, event.subject?.id)
  if (event.topic === 'edition.published') return take(held.editions, event.payload.label)
  return false
}

/** The changes whose announcements may be echoes: a decision made in this tab. */
const deciding = new Set(['decide', 'decideMany', 'decideTermBatch'])

/** Whether this tab has a decision on its way to the service, whose echo may arrive first. */
export function awaitingDecision(queryClient: QueryClient): boolean {
  return (
    queryClient.isMutating({
      predicate: (mutation) => {
        const [scope, operation] = mutation.options.mutationKey ?? []
        return scope === 'write' && typeof operation === 'string' && deciding.has(operation)
      },
    }) > 0
  )
}

/** Whether an event may be the echo of a decision: one the stream may relay before its answer. */
export const mayEcho = (event: StreamEvent) =>
  decisionTopics.has(event.topic) || event.topic === 'edition.published'
