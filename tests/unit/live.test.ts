import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StreamEvent } from '@/api'
import { ApiError } from '@/api/errors'
import {
  createLiveCache,
  eventInvalidations,
  initialLiveState,
  liveInvalidations,
  liveStep,
  pollKeys,
  reconnectDelay,
  resetKeys,
  runLiveUpdates,
  streamTopics,
  type LiveState,
  type LiveStatus,
} from '@/api/live'
import { queryKeys, type InboxUnread } from '@/api/queries'
import { topicPhrases } from '@/lib/notifications'

/*
  Live updates (slice W7): the registries cover every topic the service posts, the replay and
  reset rules, the reconnecting reader with its polling fallback, and how events reach the query
  cache. The stream against the real service is tested in tests/integration/api-live.test.ts and
  tests/e2e-api/live.spec.ts.
*/

function sources(dir: string, extension: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path, extension)
    return entry.name.endsWith(extension) ? [readFileSync(path, 'utf8')] : []
  })
}

/**
 * The topics the service puts on the stream, read from its code: the literal topics of every
 * `insert into outbox_events`, the steps of a proposal (posted as `proposal.<kind>` by
 * `event`, `proposalEvent` and `moved`) and the stream's own two markers.
 */
function serverTopics(): Set<string> {
  const code = [...sources('src/server', '.ts'), ...sources('db/migrations', '.sql')]
    .join('\n')
    .replace(/\s+/g, ' ')
  const topics = new Set<string>()
  const add = (topic: string | undefined) => topic && topics.add(topic)
  for (const [window] of code.matchAll(/insert into outbox_events.{0,400}/g))
    for (const [, topic] of window.matchAll(
      /'((?:item|edition|vocabulary|serving|eval|inbox|area|gap)\.[a-z_]+)'/g,
    ))
      add(topic)
  const kind = String.raw`(?:[\w.!]+ \? )?'([a-z_]+)'(?: : '([a-z_]+)')?`
  for (const pattern of [
    new RegExp(String.raw`\bevent\( ?(?:[\w!]+|\{[^}]*\}), ?${kind}`, 'g'),
    new RegExp(String.raw`\bproposalEvent\( ?tx, ?[^,()]+(?:\([^)]*\))?[^,]*, ?${kind}`, 'g'),
    new RegExp(String.raw`\bmoved\( ?\w+, ?[^,]+, ?${kind}`, 'g'),
  ])
    for (const [, first, second] of code.matchAll(pattern)) {
      add(first && `proposal.${first}`)
      add(second && `proposal.${second}`)
    }
  for (const [, topic] of code.matchAll(/marker\('(stream\.[a-z]+)'/g)) add(topic)
  return topics
}

const event = (overrides: Partial<StreamEvent> = {}): StreamEvent => ({
  id: 1,
  topic: 'proposal.claimed',
  at: '2026-10-07T12:00:00.000Z',
  areaId: 'area_commercial',
  subject: { type: 'proposal', id: 'p1' },
  payload: { id: 'p1', state: 'in_review', revision: 3 },
  inbox: false,
  ...overrides,
})

describe('the topic registries', () => {
  it('know every topic the service posts, and no other', () => {
    const posted = serverTopics()
    // The scan itself must find the topics of each kind of emitter.
    expect(posted).toContain('proposal.decided')
    expect(posted).toContain('proposal.handed_over')
    expect(posted).toContain('item.flagged')
    expect(posted).toContain('inbox.changed')
    expect([...posted].sort()).toEqual([...streamTopics].sort())
  })

  it('have a sentence and an invalidation for every topic', () => {
    expect(Object.keys(topicPhrases).sort()).toEqual([...streamTopics].sort())
    expect(Object.keys(liveInvalidations).sort()).toEqual([...streamTopics].sort())
  })

  it('refresh a proposal, its timeline, its review and the lists after a step', () => {
    expect(eventInvalidations(event({ topic: 'proposal.decided' }))).toEqual([
      queryKeys.proposalLists,
      queryKeys.proposal('p1'),
      queryKeys.proposalEvents('p1'),
      queryKeys.review,
    ])
    expect(eventInvalidations(event({ topic: 'proposal.saved' }))).toEqual([
      queryKeys.proposalLists,
      queryKeys.proposal('p1'),
    ])
  })

  it('refresh the library after a publication or a source flag', () => {
    const published = eventInvalidations(
      event({ topic: 'edition.published', subject: { type: 'edition', id: '2026-10-07.2' } }),
    )
    expect(published).toEqual(
      expect.arrayContaining([queryKeys.editions, queryKeys.library, queryKeys.items]),
    )
    expect(
      eventInvalidations(event({ topic: 'item.flagged', subject: { type: 'item', id: 'i1' } })),
    ).toEqual(expect.arrayContaining([queryKeys.library, queryKeys.items]))
  })

  it('refresh the inbox when an event also reached it, and ignore an unknown topic', () => {
    expect(eventInvalidations(event({ inbox: true }))).toContainEqual(queryKeys.inbox)
    expect(eventInvalidations(event({ topic: 'proposal.claimed' }))).not.toContainEqual(
      queryKeys.inbox,
    )
    expect(eventInvalidations(event({ topic: 'gap.opened' }))).toEqual([])
    expect(eventInvalidations(event({ topic: 'gap.opened', inbox: true }))).toEqual([
      queryKeys.inbox,
    ])
  })

  it('poll the work in motion and reset everything the stream keeps current', () => {
    expect(pollKeys).not.toContainEqual(queryKeys.library)
    for (const key of pollKeys) expect(resetKeys).toContainEqual(key)
    expect(resetKeys).toContainEqual(queryKeys.library)
  })
})

describe('liveStep: replay and reset', () => {
  const take = (state: LiveState, ...inputs: Parameters<typeof liveStep>[1][]) =>
    inputs.reduce<{ state: LiveState; applied: number[]; refetches: number }>(
      (acc, input) => {
        const step = liveStep(acc.state, input)
        return {
          state: step.state,
          applied: step.apply ? [...acc.applied, step.apply.id] : acc.applied,
          refetches: acc.refetches + Number(step.refetch),
        }
      },
      { state, applied: [], refetches: 0 },
    )
  const ready = (id: number) => ({
    type: 'event' as const,
    event: event({ id, topic: 'stream.ready' }),
  })
  const reset = (id: number) => ({
    type: 'event' as const,
    event: event({ id, topic: 'stream.reset' }),
  })
  const at = (id: number) => ({ type: 'event' as const, event: event({ id }) })
  const dropped = { type: 'dropped' as const }

  it('starts live at stream.ready without fetching again', () => {
    const result = take(initialLiveState, ready(40), at(41), at(42))
    expect(result.state).toEqual({ status: 'live', lastEventId: 42, missed: false })
    expect(result.applied).toEqual([41, 42])
    expect(result.refetches).toBe(0)
  })

  it('resumes after a drop and skips the events it already applied', () => {
    const result = take(initialLiveState, ready(40), at(41), at(42), dropped, at(42), at(43))
    expect(result.applied).toEqual([41, 42, 43])
    expect(result.refetches).toBe(0)
    expect(result.state.lastEventId).toBe(43)
  })

  it('goes offline on a drop and keeps where it was', () => {
    const result = take(initialLiveState, ready(40), at(41), dropped)
    expect(result.state).toEqual({ status: 'offline', lastEventId: 41, missed: false })
  })

  it('fetches everything again on stream.reset, then carries on from its id', () => {
    const result = take(initialLiveState, ready(40), at(41), dropped, reset(90), at(91))
    expect(result.refetches).toBe(1)
    expect(result.applied).toEqual([41, 91])
    expect(result.state.lastEventId).toBe(91)
  })

  it('takes a reset to a lower id, when the service started over', () => {
    const result = take(initialLiveState, ready(40), at(41), reset(3), at(4))
    expect(result.applied).toEqual([41, 4])
    expect(result.state.lastEventId).toBe(4)
  })

  it('fetches everything again when it starts after a drop with nothing read', () => {
    const result = take(initialLiveState, dropped, dropped, ready(40))
    expect(result.refetches).toBe(1)
    expect(result.state).toEqual({ status: 'live', lastEventId: 40, missed: false })
  })
})

/**
 * A scripted stream: each `open` takes the next script. A list of events is read and then the
 * connection drops; `{ hold }` reads its events and stays open, as the service's stream does; an
 * error fails the connection.
 */
type Script = StreamEvent[] | { hold: StreamEvent[] } | Error
function scriptedStreams(scripts: Script[], calls: (string | undefined)[] = []) {
  let index = 0
  const open = vi.fn(
    ({
      lastEventId,
      signal,
    }: {
      lastEventId?: string
      signal: AbortSignal
    }): Promise<AsyncIterable<StreamEvent>> => {
      calls.push(lastEventId)
      const script = scripts[index++] ?? { hold: [] }
      if (script instanceof Error) return Promise.reject(script)
      return Promise.resolve(
        (async function* () {
          for (const item of Array.isArray(script) ? script : script.hold) yield item
          if (!Array.isArray(script))
            await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()))
        })(),
      )
    },
  )
  return { open, calls }
}

describe('runLiveUpdates', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reconnects with Last-Event-ID after a drop, with growing waits', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const calls: (string | undefined)[] = []
    const { open } = scriptedStreams(
      [
        [event({ id: 7, topic: 'stream.ready' }), event({ id: 8 })],
        new Error('network'),
        [event({ id: 9 })],
      ],
      calls,
    )
    const applied: number[] = []
    const statuses: LiveStatus[] = []
    const run = runLiveUpdates({
      open,
      signal: controller.signal,
      onEvent: (e) => applied.push(e.id),
      onRefetch: () => undefined,
      onStatus: (status) => statuses.push(status),
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(applied).toEqual([8])
    // First reconnect after 1 second, the next after 2.
    await vi.advanceTimersByTimeAsync(reconnectDelay(0))
    expect(calls).toEqual([undefined, '8'])
    await vi.advanceTimersByTimeAsync(reconnectDelay(1))
    expect(calls).toEqual([undefined, '8', '8'])
    expect(applied).toEqual([8, 9])
    expect(statuses).toEqual(['connecting', 'live', 'offline', 'live', 'offline'])
    controller.abort()
    await vi.runAllTimersAsync()
    await run
  })

  it('is live once a resumed stream opens, even if it yields nothing', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const calls: (string | undefined)[] = []
    const { open } = scriptedStreams(
      [[event({ id: 7, topic: 'stream.ready' })], [], new Error('network'), { hold: [] }],
      calls,
    )
    const statuses: LiveStatus[] = []
    const run = runLiveUpdates({
      open,
      signal: controller.signal,
      onEvent: () => undefined,
      onRefetch: () => undefined,
      onStatus: (status) => statuses.push(status),
    })
    await vi.advanceTimersByTimeAsync(0)
    // Dropped after one event; the resumed stream opens and stays silent, then drops again.
    await vi.advanceTimersByTimeAsync(reconnectDelay(0))
    expect(calls).toEqual([undefined, '7'])
    expect(statuses.at(-1)).toBe('offline')
    expect(statuses.slice(0, 5)).toEqual(['connecting', 'live', 'offline', 'live', 'offline'])
    // The silent open reset the backoff: the next wait is the first one again.
    await vi.advanceTimersByTimeAsync(reconnectDelay(0) - 1)
    expect(calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toHaveLength(3)
    controller.abort()
    await vi.runAllTimersAsync()
    await run
  })

  it('stops polling when a resumed stream opens without an event', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const { open } = scriptedStreams([[event({ id: 7, topic: 'stream.ready' })], { hold: [] }])
    const refetches: string[] = []
    const run = runLiveUpdates({
      open,
      signal: controller.signal,
      onEvent: () => undefined,
      onRefetch: (reason) => refetches.push(reason),
      pollMs: 500,
    })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(reconnectDelay(0))
    expect(refetches).toEqual(['poll'])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(refetches).toEqual(['poll'])
    controller.abort()
    await vi.runAllTimersAsync()
    await run
  })

  it('polls every minute while the stream is down, and stops once it is back', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const down = Array.from({ length: 8 }, () => new Error('down'))
    const { open } = scriptedStreams([
      [event({ id: 1, topic: 'stream.ready' })],
      ...down,
      { hold: [event({ id: 2 })] },
    ])
    const refetches: string[] = []
    const run = runLiveUpdates({
      open,
      signal: controller.signal,
      onEvent: () => undefined,
      onRefetch: (reason) => refetches.push(reason),
      delay: () => 20_000,
    })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(130_000)
    expect(refetches).toEqual(['poll', 'poll'])
    // Back after 9 attempts of 20 seconds: no more polls.
    await vi.advanceTimersByTimeAsync(60_000)
    const polls = refetches.length
    await vi.advanceTimersByTimeAsync(300_000)
    expect(refetches.length).toBe(polls)
    controller.abort()
    await vi.runAllTimersAsync()
    await run
  })

  it('stops and says so when nobody is signed in', async () => {
    const controller = new AbortController()
    const { open } = scriptedStreams([new ApiError('signed-out', 'Sign in', { status: 401 })])
    const onSignedOut = vi.fn()
    await runLiveUpdates({
      open,
      signal: controller.signal,
      onEvent: () => undefined,
      onRefetch: () => undefined,
      onSignedOut,
    })
    expect(onSignedOut).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledOnce()
  })

  it('ends when its signal aborts', async () => {
    const controller = new AbortController()
    const { open } = scriptedStreams([{ hold: [] }])
    const run = runLiveUpdates({
      open,
      signal: controller.signal,
      onEvent: () => undefined,
      onRefetch: () => undefined,
    })
    await Promise.resolve()
    controller.abort()
    await expect(run).resolves.toBeUndefined()
  })
})

describe('createLiveCache', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('refreshes what a burst of events made stale once', async () => {
    vi.useFakeTimers()
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const cache = createLiveCache(queryClient)
    cache.event(event({ id: 1, topic: 'proposal.claimed' }))
    cache.event(event({ id: 2, topic: 'proposal.decided' }))
    expect(invalidate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(50)
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey)
    expect(keys).toEqual([
      queryKeys.proposalLists,
      queryKeys.proposal('p1'),
      queryKeys.proposalEvents('p1'),
      queryKeys.review,
    ])
    cache.dispose()
  })

  it('shows the unread count of another tab at once', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData<InboxUnread>(queryKeys.inboxUnread, { unread: 3, latest: null })
    const cache = createLiveCache(queryClient)
    cache.event(
      event({
        topic: 'inbox.changed',
        subject: { type: 'inbox', id: 'per_maria' },
        payload: { unread: 1 },
      }),
    )
    expect(queryClient.getQueryData<InboxUnread>(queryKeys.inboxUnread)?.unread).toBe(1)
    cache.dispose()
  })
})
