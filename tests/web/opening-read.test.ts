// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/api/query-client'
import { invalidateAfter } from '@/api/queries'
import type { Answer, AskInput } from '@/model/ask'
import type { Opening } from '@/lib/opening-read'

// Reopening a chat reads its first answer once. The read is a look-up that costs a model call, so
// no write (every item write and Undo marks the reads stale), no regain of focus and no remount of
// the thread asks it again; while it is on its way the thread says so, and when it fails the thread
// says why. The audit's reproduction: a chat opened from History, then one write, asked twice.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const lookups = vi.hoisted(() => ({ asked: [] as unknown[], next: [] as Array<() => unknown> }))
vi.mock('@/api', () => ({
  api: {
    ask: (input: unknown) => {
      lookups.asked.push(input)
      return Promise.resolve().then(() => lookups.next.shift()!())
    },
  },
}))

const { useOpeningRead } = await import('@/lib/opening-read')

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  lookups.asked.length = 0
  lookups.next.length = 0
})

const answer = (question: string): Answer => ({
  id: 't0',
  question,
  metric: 'Orders',
  markets: [],
  state: 'grounded',
  text: 'Orders fell. [1]',
  sources: ['itm_a'],
  said: '',
})
const read: AskInput = { question: 'Why did orders fall in Norway?' }

let latest: Opening
function Probe({ input }: { input: AskInput | null }) {
  latest = useOpeningRead(input)
  return null
}
async function mount(client: QueryClient, input: AskInput | null) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(() =>
    Promise.resolve(
      root!.render(
        React.createElement(QueryClientProvider, { client }, React.createElement(Probe, { input })),
      ),
    ),
  )
}
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))

describe('the opening read of a chat', () => {
  it('asks once, and no write asks it again', async () => {
    const client = createQueryClient()
    lookups.next.push(() => answer(read.question ?? ''))
    await mount(client, read)
    await settle()
    expect(latest).toEqual({ state: 'read', answer: answer(read.question ?? '') })
    expect(lookups.asked).toHaveLength(1)

    // Any item write or Undo marks every read stale; a subscribed read would ask again, unseen.
    await act(async () => {
      await invalidateAfter(client, 'undo', { token: 'x' }, undefined as never)
    })
    await settle()
    expect(lookups.asked).toHaveLength(1)
  })

  it('says it is reading, and then why it could not', async () => {
    const client = createQueryClient()
    let fail: () => void = () => {}
    const held = new Promise<void>((resolve) => (fail = resolve))
    lookups.next.push(() =>
      held.then(() => {
        throw Object.assign(new Error('The model took too long.'), { status: 504 })
      }),
    )
    await mount(client, read)
    expect(latest).toEqual({ state: 'reading' })
    fail()
    await settle()
    expect(latest).toEqual({ state: 'failed', message: 'The model took too long.' })
  })

  it('uses an answer already kept for these words, and asks nothing', async () => {
    const client = createQueryClient()
    const { askQuery } = await import('@/api/queries')
    client.setQueryData(askQuery(read).queryKey, answer(read.question ?? ''))
    await mount(client, read)
    await settle()
    expect(latest.state).toBe('read')
    expect(lookups.asked).toHaveLength(0)
  })

  it('has nothing to read for a thread that holds its answers', async () => {
    await mount(createQueryClient(), null)
    expect(latest).toEqual({ state: 'none' })
    expect(lookups.asked).toHaveLength(0)
  })
})
