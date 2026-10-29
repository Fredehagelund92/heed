/**
 * Live updates (front end plan, slice W7): the service's event stream keeps every open screen
 * current without a reload. Events carry ids and states, never content, so the app does not
 * apply them: it marks the caches each event makes stale and the open screens fetch again,
 * through the same `queryKeys` the writes use.
 *
 *   stream -> liveStep (replay, reset) -> liveInvalidations (topic -> query keys) -> refetch
 *
 * The stream resumes after the last event read (`Last-Event-ID`), so a dropped connection
 * misses nothing; when the service no longer holds those events it says `stream.reset` and every
 * live cache is fetched again. While the stream is down, the same caches are fetched every 60
 * seconds instead.
 */
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { StreamEvent, StreamOptions } from './client'
import { awaitingDecision, ECHO_MS, isEcho, mayEcho } from './echoes'
import { toApiError } from './errors'
import { setInboxUnread } from './inbox'
import { afterPublish, queryKeys } from './queries'

/**
 * Every topic the service puts on the stream (src/server: proposals, review, editions,
 * connectors, evals and notifications). A test reads the service's code and fails when it posts
 * a topic missing here, so both registries below stay complete.
 */
export const streamTopics = [
  'stream.ready',
  'stream.reset',
  'proposal.created',
  'proposal.saved',
  'proposal.submitted',
  'proposal.checked',
  'proposal.claimed',
  'proposal.handed_over',
  'proposal.edited',
  'proposal.commented',
  'proposal.withdrawn',
  'proposal.withdrawn_in_comments',
  'proposal.withdrawal_taken_back',
  'proposal.discarded',
  'proposal.restored',
  'proposal.approved',
  'proposal.decided',
  'proposal.undone',
  'edition.published',
  'item.flagged',
  'item.unflagged',
  'item.links_stale',
  'vocabulary.domain_changed',
  'serving.changed',
  'eval.scorecard',
  'gap.verified',
  'area.deleted',
  'inbox.changed',
] as const
export type StreamTopic = (typeof streamTopics)[number]

export const isStreamTopic = (topic: string): topic is StreamTopic =>
  (streamTopics as readonly string[]).includes(topic)

const subjectId = (event: StreamEvent) => event.subject?.id ?? ''

/** A step of one proposal: its record, its timeline, its review and every list it is in. */
const aroundProposal = (event: StreamEvent): QueryKey[] => [
  queryKeys.proposalLists,
  queryKeys.proposal(subjectId(event)),
  queryKeys.proposalEvents(subjectId(event)),
  queryKeys.review,
]

/** A draft changed: the lists, and the draft on a status page open in another tab. */
const aroundDraft = (event: StreamEvent): QueryKey[] => [
  queryKeys.proposalLists,
  queryKeys.proposal(subjectId(event)),
]

/** What each topic makes stale. Stream markers and the scorecard change nothing on screen yet. */
export const liveInvalidations: Record<StreamTopic, (event: StreamEvent) => QueryKey[]> = {
  'stream.ready': () => [],
  'stream.reset': () => [],
  'proposal.created': aroundDraft,
  'proposal.saved': aroundDraft,
  'proposal.discarded': aroundDraft,
  'proposal.restored': aroundDraft,
  'proposal.submitted': aroundProposal,
  'proposal.checked': (event) => [
    queryKeys.proposalEvents(subjectId(event)),
    queryKeys.reviewOf(subjectId(event)),
  ],
  'proposal.claimed': aroundProposal,
  'proposal.handed_over': aroundProposal,
  'proposal.edited': aroundProposal,
  'proposal.commented': aroundProposal,
  'proposal.withdrawn': aroundProposal,
  'proposal.withdrawn_in_comments': aroundProposal,
  'proposal.withdrawal_taken_back': aroundProposal,
  'proposal.approved': aroundProposal,
  'proposal.decided': aroundProposal,
  'proposal.undone': aroundProposal,
  'edition.published': () => afterPublish,
  'item.flagged': () => [queryKeys.library, queryKeys.items, queryKeys.catalogue],
  'item.unflagged': () => [queryKeys.library, queryKeys.items, queryKeys.catalogue],
  'item.links_stale': () => [queryKeys.library, queryKeys.items],
  'vocabulary.domain_changed': () => [queryKeys.vocabulary, queryKeys.catalogue],
  'serving.changed': () => [queryKeys.stops, queryKeys.tryIt],
  // A new scorecard is a finished run: a gap's linked tests have a newest result.
  'eval.scorecard': () => [queryKeys.gaps],
  'gap.verified': () => [queryKeys.gaps],
  // Its drafts and proposals now read as in a deleted domain, and the domain lists changed.
  'area.deleted': () => [queryKeys.areas, queryKeys.proposalLists, queryKeys.archivedAreas],
  'inbox.changed': () => [queryKeys.inbox],
}

/** The caches an event makes stale; one that also reached the reader's inbox refreshes it too. */
export function eventInvalidations(event: StreamEvent): QueryKey[] {
  const keys = isStreamTopic(event.topic) ? liveInvalidations[event.topic](event) : []
  return event.inbox ? [...keys, queryKeys.inbox] : keys
}

/** What a reset makes stale: everything the stream keeps current. */
export const resetKeys: QueryKey[] = [
  queryKeys.proposals,
  queryKeys.review,
  queryKeys.inbox,
  queryKeys.stops,
  queryKeys.vocabulary,
  ...afterPublish,
]

/**
 * What a poll fetches while the stream is down: the work in motion. The library index (the
 * largest read) keeps its own freshness, and the replay or reset on reconnect catches it up.
 */
export const pollKeys: QueryKey[] = [
  queryKeys.proposals,
  queryKeys.review,
  queryKeys.inbox,
  queryKeys.editions,
]

/** Connecting (first open), live (reading the stream), or offline (polling until it reconnects). */
export type LiveStatus = 'connecting' | 'live' | 'offline'

export type LiveState = {
  status: LiveStatus
  /** The newest event read: the stream resumes after it. */
  lastEventId: number | null
  /** The stream dropped before any event was read, so a fresh start may have missed some. */
  missed: boolean
}

export const initialLiveState: LiveState = {
  status: 'connecting',
  lastEventId: null,
  missed: false,
}

export type LiveInput =
  { type: 'event'; event: StreamEvent } | { type: 'opened' } | { type: 'dropped' }

/** The next state, the event to apply (if any) and whether everything must be fetched again. */
export type LiveStep = { state: LiveState; apply: StreamEvent | null; refetch: boolean }

/**
 * The replay and reset rules, as a pure function of the state and what arrived:
 *
 * - `stream.ready` starts a stream with nothing to replay. After a drop with no event read, what
 *   happened in between is unknown, so everything is fetched again.
 * - `stream.reset`: the events since the last one read are gone, so everything is fetched again.
 * - A stream that opened is live, whether or not it has anything to say yet.
 * - An event at or before the last one read was already applied (a replay overlaps): skipped.
 */
export function liveStep(state: LiveState, input: LiveInput): LiveStep {
  if (input.type === 'opened')
    return { state: { ...state, status: 'live' }, apply: null, refetch: false }
  if (input.type === 'dropped')
    return {
      state: { ...state, status: 'offline', missed: state.missed || state.lastEventId === null },
      apply: null,
      refetch: false,
    }
  const { event } = input
  const live = { status: 'live' as const, lastEventId: event.id, missed: false }
  if (event.topic === 'stream.ready') return { state: live, apply: null, refetch: state.missed }
  if (event.topic === 'stream.reset') return { state: live, apply: null, refetch: true }
  if (state.lastEventId !== null && event.id <= state.lastEventId)
    return { state: { ...state, status: 'live' }, apply: null, refetch: false }
  return { state: live, apply: event, refetch: false }
}

/** How long to wait before the next attempt: 1, 2, 4 ... seconds, at most a minute. */
export const reconnectDelay = (attempt: number) => Math.min(60_000, 1000 * 2 ** attempt)

/** How often the caches are fetched while the stream is down. */
export const POLL_MS = 60_000

export type LiveOptions = {
  open: (options: StreamOptions) => Promise<AsyncIterable<StreamEvent>>
  signal: AbortSignal
  onEvent: (event: StreamEvent) => void
  /** Fetch everything again: after a reset, a fresh start that may have missed events, a poll. */
  onRefetch: (reason: 'reset' | 'poll') => void
  onStatus?: (status: LiveStatus) => void
  /** The stream refused because nobody is signed in. */
  onSignedOut?: () => void
  pollMs?: number
  delay?: (attempt: number) => number
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

/**
 * Reads the stream until `signal` aborts: reconnects with growing waits after a drop, resuming
 * after the last event read, and fetches every `pollMs` while it is down.
 */
export async function runLiveUpdates({
  open,
  signal,
  onEvent,
  onRefetch,
  onStatus,
  onSignedOut,
  pollMs = POLL_MS,
  delay = reconnectDelay,
}: LiveOptions): Promise<void> {
  let state = initialLiveState
  let poll: ReturnType<typeof setInterval> | undefined
  const stopPolling = () => {
    clearInterval(poll)
    poll = undefined
  }
  const take = (input: LiveInput) => {
    const before = state.status
    const step = liveStep(state, input)
    state = step.state
    if (state.status !== before) onStatus?.(state.status)
    if (state.status === 'live') stopPolling()
    else poll ??= setInterval(() => onRefetch('poll'), pollMs)
    if (step.refetch) onRefetch('reset')
    if (step.apply) onEvent(step.apply)
  }
  onStatus?.(state.status)
  let attempt = 0
  try {
    while (!signal.aborted) {
      try {
        const events = await open({
          ...(state.lastEventId === null ? {} : { lastEventId: String(state.lastEventId) }),
          signal,
        })
        if (signal.aborted) break
        attempt = 0
        take({ type: 'opened' })
        for await (const event of events) {
          if (signal.aborted) break
          take({ type: 'event', event })
        }
      } catch (error) {
        if (signal.aborted) break
        if (toApiError(error).kind === 'signed-out') {
          onSignedOut?.()
          break
        }
      }
      if (signal.aborted) break
      take({ type: 'dropped' })
      await wait(delay(attempt++), signal)
    }
  } finally {
    stopPolling()
  }
}

/**
 * Applies live events to the query cache. Events come in bursts (a replay, a decision that also
 * publishes), so the caches they make stale are collected for a moment and refreshed once. An
 * event that only announces a change this tab made itself is passed over (echoes.ts). While a
 * decision of this tab's own is on its way, the announcements it may make wait for its answer, so
 * one that the stream relays before the answer arrives is told apart too.
 */
export function createLiveCache(queryClient: QueryClient, { batchMs = 50 } = {}) {
  const events: StreamEvent[] = []
  const pending = new Map<string, QueryKey>()
  let timer: ReturnType<typeof setTimeout> | undefined
  const add = (keys: readonly QueryKey[]) => {
    for (const key of keys) pending.set(JSON.stringify(key), key)
  }
  // Announcements that may echo a decision of this tab's own that is still on its way, held
  // until it is answered, and since when.
  let held: StreamEvent[] = []
  let heldSince = 0
  const flush = () => {
    timer = undefined
    const arrived = [...held, ...events.splice(0)]
    held = []
    const now = Date.now()
    const waiting = awaitingDecision(queryClient) && now - (heldSince || now) < ECHO_MS
    for (const event of arrived) {
      if (waiting && mayEcho(event)) {
        if (!held.length) heldSince ||= now
        held.push(event)
      } else
        add(
          isEcho(queryClient, event)
            ? event.inbox
              ? [queryKeys.inbox]
              : []
            : eventInvalidations(event),
        )
    }
    if (!held.length) heldSince = 0
    const keys = [...pending.values()]
    pending.clear()
    for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey })
    // Look again soon: the decision's answer says which of them were its own.
    if (held.length) timer = setTimeout(flush, batchMs)
  }
  const schedule = () => {
    timer ??= setTimeout(flush, batchMs)
  }
  return {
    event(event: StreamEvent) {
      // Another tab read or archived something: the count is in the event, so show it at once.
      const unread = event.payload.unread
      if (event.topic === 'inbox.changed' && typeof unread === 'number')
        setInboxUnread(queryClient, unread)
      events.push(event)
      schedule()
    },
    refetch(reason: 'reset' | 'poll') {
      add(reason === 'reset' ? resetKeys : pollKeys)
      schedule()
    },
    dispose() {
      clearTimeout(timer)
      events.length = 0
      held = []
      pending.clear()
    },
  }
}
