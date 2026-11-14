import { QueryClient, QueryObserver, type QueryObserverResult } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { readOf } from '@/lib/read'

// readOf over each state a real TanStack read goes through (#198): pending, failed, failed while
// it is tried again, ready, a refresh that fails on what was read, and an answer with nothing in it.

type Topic = { id: string; rows: number[] } | null

/** A read of `answers`, one per fetch, as the app's queries make it. */
function readOfAnswers(answers: (() => Topic)[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let n = 0
  const observer = new QueryObserver<Topic>(client, {
    queryKey: ['topic'],
    queryFn: () => Promise.resolve().then(answers[Math.min(n++, answers.length - 1)]),
  })
  // An observer reads only while someone listens, as a mounted screen does.
  observer.subscribe(() => {})
  const settled = () =>
    new Promise<QueryObserverResult<Topic>>((resolve) => {
      const r = observer.getCurrentResult()
      if (!r.isFetching) return resolve(r)
      const off = observer.subscribe((next) => {
        if (next.isFetching) return
        off()
        resolve(next)
      })
    })
  return { observer, settled }
}

const fail = () => {
  throw new Error('502')
}
const topic = () => ({ id: 'orders-spain', rows: [3, 1] })

describe('readOf', () => {
  it('is loading while the first read is out', () => {
    const { observer } = readOfAnswers([topic])
    expect(readOf(observer.getCurrentResult()).state).toBe('loading')
  })

  it('is ready with the data once it answers', async () => {
    const { settled } = readOfAnswers([topic])
    expect(readOf(await settled())).toEqual({ state: 'ready', data: topic() })
  })

  it('is failed when the first read fails, and Retry reads again', async () => {
    const { observer, settled } = readOfAnswers([fail, topic])
    const read = readOf(await settled())
    expect(read.state).toBe('failed')
    if (read.state !== 'failed') return
    read.retry()
    // Tried again, it is loading until the answer, then ready.
    expect(readOf(observer.getCurrentResult()).state).toBe('loading')
    expect(readOf(await settled())).toEqual({ state: 'ready', data: topic() })
  })

  it('stays ready when a refresh fails: what was read is kept', async () => {
    const { observer, settled } = readOfAnswers([topic, fail])
    await settled()
    void observer.refetch()
    const after = await settled()
    expect(after.isError).toBe(true)
    expect(readOf(after)).toEqual({ state: 'ready', data: topic() })
  })

  it('is missing when the read answers that nothing is there', async () => {
    const { settled } = readOfAnswers([() => null])
    expect(readOf(await settled())).toEqual({ state: 'missing' })
  })

  it('is missing when the answer has nothing in it, as the screen counts it', async () => {
    const { settled } = readOfAnswers([() => ({ id: 'orders-spain', rows: [] })])
    expect(readOf(await settled(), (t) => t.rows.length === 0)).toEqual({ state: 'missing' })
  })
})
