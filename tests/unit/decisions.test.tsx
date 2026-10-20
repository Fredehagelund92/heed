import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider, QueryObserver, useQuery } from '@tanstack/react-query'
import { act, render, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, type QueueEntry, type Review, type ReviewProposal, type StreamEvent } from '@/api'
import { ECHO_MS, expectEchoes, isEcho } from '@/api/echoes'
import { createLiveCache } from '@/api/live'
import { afterPublish, coveringKeys, invalidateAfter, queryKeys, useApiWrite } from '@/api/queries'
import { markDeciding, useDeciding, waitingRows } from '@/lib/deciding'
import { savingBar } from '@/lib/review'

/*
  A decision shows at once (the captain's pilot, 16 Oct 2026: three accepts took seconds to show,
  as every list the accept touched was read again before the screen moved on). The decision is
  done when the service answers; its own proposal and the queue take the answer at once, and the
  rest refreshes behind it, once, without the live stream's echo reading it all again.
*/

const proposal = (id: string, state: ReviewProposal['state']): ReviewProposal => ({
  id,
  number: 1,
  subject: 'item',
  action: 'create',
  state,
  areaId: 'area_commercial',
  itemId: 'itm_1',
  itemVersionId: 'v1',
  vocabularyVersionId: null,
  termKey: null,
  title: `Proposal ${id}`,
  riskLevel: 'low',
  proposerId: 'per_maria',
  channel: 'form',
  revision: 2,
  reason: null,
  claimedBy: null,
  dueAt: null,
  submittedAt: null,
  closedAt: null,
  createdAt: '2026-10-16T08:00:00Z',
})
const entry = (id: string): QueueEntry => ({ ...proposal(id, 'submitted'), checks: null })

const event = (fields: Partial<StreamEvent>): StreamEvent => ({
  id: 1,
  topic: 'proposal.decided',
  at: '2026-10-16T08:00:00Z',
  areaId: null,
  subject: { type: 'proposal', id: 'p1' },
  payload: {},
  inbox: false,
  ...fields,
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('decisions on their way', () => {
  it('leave the queue until they are released, and a newer mark outlives an older release', async () => {
    const { result } = renderHook(() => useDeciding())
    const rows = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]
    const settled = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    let first = () => {}
    act(() => {
      first = markDeciding(['p1', 'p2'], 'accept')
    })
    expect(waitingRows(rows, result.current)).toEqual([{ id: 'p3' }])
    expect(result.current.get('p1')).toBe('accept')
    let second = () => {}
    act(() => {
      second = markDeciding(['p2'], 'reject')
    })
    first()
    await settled()
    expect(waitingRows(rows, result.current)).toEqual([{ id: 'p1' }, { id: 'p3' }])
    expect(result.current.get('p2')).toBe('reject')
    first()
    second()
    await settled()
    expect(waitingRows(rows, result.current)).toEqual(rows)
  })

  it('are released only once the answer has reached the screen, so nothing flashes back', async () => {
    const client = new QueryClient()
    const key = queryKeys.reviewOf('p1')
    client.setQueryData<Review>(key, { proposal: proposal('p1', 'submitted') } as Review)
    const seen: string[] = []
    // As on the review page: the page reads the review and hands it to the bar, which reads
    // whether its decision is on its way.
    function Bar({ review }: { review: Review }) {
      const saving = useDeciding().has('p1')
      seen.push(saving ? 'saving' : review.proposal.state)
      return null
    }
    function Page() {
      const { data } = useQuery({ queryKey: key, queryFn: () => new Promise<Review>(() => {}) })
      return data ? <Bar review={data} /> : null
    }
    render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>,
    )
    let release = () => {}
    act(() => {
      release = markDeciding(['p1'], 'accept')
    })
    // The service's answer: the cache takes it, then the mark goes.
    client.setQueryData<Review>(key, { proposal: proposal('p1', 'accepted') } as Review)
    release()
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(seen.at(-1)).toBe('accepted')
    // Never back to waiting for a decision once the decision was made.
    expect(seen.slice(seen.indexOf('saving'))).not.toContain('submitted')
    client.clear()
  })

  it('show the decision being saved and offer no other', () => {
    const bar = savingBar('accept', 'create')
    expect(bar.state).toBe('saving')
    expect(bar.outcomes.accept).toMatchObject({ allowed: false, label: 'Accepting', saving: true })
    expect(bar.outcomes.reject).toBeNull()
    expect(bar.outcomes.request_changes).toBeNull()
    expect(savingBar('accept', 'retire').outcomes.accept).toMatchObject({ label: 'Archiving' })
  })
})

describe('refreshing after a decision', () => {
  it('fetches each cache once: a key a shorter one covers is left out', () => {
    expect(
      coveringKeys([
        queryKeys.proposalLists,
        queryKeys.reviewOf('p1'),
        queryKeys.review,
        queryKeys.review,
        queryKeys.proposal('p1'),
      ]),
    ).toEqual([queryKeys.proposalLists, queryKeys.review, queryKeys.proposal('p1')])
  })

  it('refreshes the proposal and the queue first, and what an accept published after them', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await invalidateAfter(
      client,
      'decide',
      { id: 'p1', revision: 2, outcome: 'accept', reason: 'Checked' },
      {
        proposal: proposal('p1', 'accepted'),
        edition: { label: '2026-10-16.4' } as never,
      },
    )
    await Promise.resolve()
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey)
    const first = coveringKeys([
      queryKeys.proposal('p1'),
      queryKeys.proposalLists,
      queryKeys.proposalEvents('p1'),
      queryKeys.reviewOf('p1'),
      queryKeys.review,
    ])
    expect(keys.slice(0, first.length)).toEqual(first)
    const later = keys.slice(first.length)
    expect(later).toEqual(coveringKeys(afterPublish))
    expect(later).toContainEqual(queryKeys.catalogue)
    client.clear()
  })
})

describe('a decision the service answered', () => {
  const wrapper = (client: QueryClient) =>
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>
    }

  it('is done without waiting for the lists it changed, which take the answer at once', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const queueKey = queryKeys.reviewQueue({ limit: 100 })
    client.setQueryData<QueueEntry[]>(queueKey, [entry('p1'), entry('p2'), entry('p3')])
    client.setQueryData<Review>(queryKeys.reviewOf('p1'), {
      proposal: proposal('p1', 'submitted'),
    } as Review)
    // The queue is on screen, and reading it again never ends: the decision must not wait for it.
    const unsubscribe = new QueryObserver(client, {
      queryKey: queueKey,
      queryFn: () => new Promise<QueueEntry[]>(() => {}),
      staleTime: Infinity,
    }).subscribe(() => {})
    vi.spyOn(api, 'decide').mockResolvedValue({
      proposal: proposal('p1', 'accepted'),
      edition: null,
    })
    const { result } = renderHook(() => useApiWrite('decide'), { wrapper: wrapper(client) })
    await act(() =>
      result.current.mutateAsync({ id: 'p1', revision: 2, outcome: 'accept', reason: 'Checked' }),
    )
    expect(client.getQueryData<QueueEntry[]>(queueKey)?.map((row) => row.id)).toEqual(['p2', 'p3'])
    expect(client.getQueryData<Review>(queryKeys.reviewOf('p1'))?.proposal.state).toBe('accepted')
    unsubscribe()
    client.clear()
  })

  it('keeps a proposal that still waits in the queue, with its new state', async () => {
    const client = new QueryClient()
    const queueKey = queryKeys.reviewQueue({ limit: 100 })
    client.setQueryData<QueueEntry[]>(queueKey, [entry('p1'), entry('p2')])
    vi.spyOn(api, 'decideMany').mockResolvedValue({
      proposals: [proposal('p1', 'in_review'), proposal('p2', 'accepted')],
      skipped: [],
      editions: [],
    })
    const { result } = renderHook(() => useApiWrite('decideMany'), { wrapper: wrapper(client) })
    await act(() =>
      result.current.mutateAsync({
        proposals: [
          { id: 'p1', revision: 1 },
          { id: 'p2', revision: 1 },
        ],
        outcome: 'accept',
        reason: 'Checked',
      }),
    )
    expect(client.getQueryData<QueueEntry[]>(queueKey)).toEqual([
      { ...entry('p1'), ...proposal('p1', 'in_review') },
    ])
    client.clear()
  })
})

describe("the live stream's echo of a decision", () => {
  it('is passed over once, and only for what this tab decided and published', () => {
    const client = new QueryClient()
    expectEchoes(client, { proposals: ['p1'], editions: ['2026-10-16.4'] }, 1_000)
    expect(isEcho(client, event({}), 1_001)).toBe(true)
    expect(isEcho(client, event({}), 1_002)).toBe(false)
    expect(isEcho(client, event({ subject: { type: 'proposal', id: 'p2' } }), 1_002)).toBe(false)
    const published = event({
      topic: 'edition.published',
      subject: { type: 'edition', id: '2026-10-16.4' },
      payload: { label: '2026-10-16.4' },
    })
    expect(isEcho(client, published, 1_000 + ECHO_MS + 1)).toBe(false)
    expect(isEcho(client, { ...published, payload: { label: '2026-10-16.5' } }, 1_003)).toBe(false)
  })

  it('waits for the answer when the stream relays the decision before it', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    let answer: (value: Awaited<ReturnType<typeof api.decide>>) => void = () => {}
    vi.spyOn(api, 'decide').mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const { result } = renderHook(() => useApiWrite('decide'), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    const cache = createLiveCache(client)
    let sent: Promise<unknown> = Promise.resolve()
    act(() => {
      sent = result.current.mutateAsync({ id: 'p1', revision: 2, outcome: 'accept', reason: 'Ok' })
    })
    // The stream is faster than the answer: its own decision, and someone else's.
    cache.event(event({ id: 7 }))
    cache.event(event({ id: 8, subject: { type: 'proposal', id: 'p9' } }))
    await act(() => new Promise((resolve) => setTimeout(resolve, 120)))
    expect(invalidate).not.toHaveBeenCalled()
    invalidate.mockClear()
    await act(async () => {
      answer({ proposal: proposal('p1', 'accepted'), edition: null })
      await sent
    })
    await act(() => new Promise((resolve) => setTimeout(resolve, 120)))
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey)
    // The decision's own refresh, once, and the other decision's.
    expect(
      keys.filter((key) => JSON.stringify(key) === JSON.stringify(queryKeys.proposal('p1'))),
    ).toHaveLength(1)
    expect(keys).toContainEqual(queryKeys.proposal('p9'))
    cache.dispose()
    client.clear()
  })

  it('is not read again by the live cache, even when it arrives just before the answer', async () => {
    vi.useFakeTimers()
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const cache = createLiveCache(client)
    cache.event(event({ id: 7 }))
    cache.event(
      event({
        id: 8,
        topic: 'edition.published',
        subject: { type: 'edition', id: '2026-10-16.4' },
        payload: { label: '2026-10-16.4' },
      }),
    )
    // The service's answer arrives within the batch.
    expectEchoes(client, { proposals: ['p1'], editions: ['2026-10-16.4'] })
    await vi.advanceTimersByTimeAsync(50)
    expect(invalidate).not.toHaveBeenCalled()
    // Someone else's decision still refreshes the lists.
    cache.event(event({ id: 9, subject: { type: 'proposal', id: 'p9' } }))
    await vi.advanceTimersByTimeAsync(50)
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toContainEqual(
      queryKeys.proposal('p9'),
    )
    cache.dispose()
  })
})
