// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Answer } from '@/model/ask'
import type { Fact } from '@/model/items'

// The page of an Ask answer: the related items it names but did not use, the next step under an
// Outdated answer that cites nothing it can show, and the line of a look-up that takes long.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const world = vi.hoisted(() => ({
  facts: [] as unknown[],
  me: { name: 'Mia', owns: ['sales'], admin: false },
}))

vi.mock('@/lib/workspace', () => ({
  useFacts: () => world.facts,
  useMe: () => world.me,
  useDomains: () => ({ sales: { name: 'Sales' }, finance: { name: 'Finance' } }),
  // What Ask hands its loop's answer (loop-parts.ts); never called here.
  usePeople: () => [],
}))
vi.mock('@/api/queries', () => ({ useWrite: () => vi.fn() }))
// Reading items ahead needs the app's query cache, which a static drawing has not.
vi.mock('@/lib/read-ahead', () => ({ useReadAhead: () => () => ({}), useReadCitedAhead: () => {} }))

const { NextStep, Related } = await import('@/components/heed/answer')
const { useStillLooking } = await import('@/lib/ask-motion')

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  vi.useRealTimers()
})

function render(node: React.ReactNode) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(node))
  return host
}

const fact = (id: string, title: string, over: Partial<Fact> = {}) =>
  ({ id, title, domain: 'sales', checkedOn: '22 Oct 2026', ...over }) as unknown as Fact

describe('the related items an answer names', () => {
  const switched = 'Payment provider switched in France on 12 May 2026'

  it('lists an item once, and tells two items of one title apart', () => {
    world.facts = [
      fact('a', switched, { domain: 'finance', checkedOn: '1 Jun 2026' }),
      fact('b', switched, { checkedOn: '2 Jul 2026' }),
      fact('c', 'Orders in Norway'),
    ]
    const page = render(React.createElement(Related, { ids: ['a', 'b', 'a', 'c'] }))
    const rows = [...page.querySelectorAll('li')].map((li) => li.textContent)
    expect(rows).toEqual([
      `${switched}Finance - checked 1 Jun 2026`,
      `${switched}Sales - checked 2 Jul 2026`,
      'Orders in Norway',
    ])
  })

  it('leaves out whichever part of the telling is missing', () => {
    world.facts = [
      fact('a', switched, { domain: 'nowhere' }),
      fact('b', switched, { checkedOn: '' }),
    ]
    const page = render(React.createElement(Related, { ids: ['a', 'b'] }))
    const rows = [...page.querySelectorAll('li')].map((li) => li.textContent)
    expect(rows).toEqual([`${switched}checked 22 Oct 2026`, `${switched}Sales`])
  })

  it('shows four, and the rest in place with Show N more', () => {
    world.facts = Array.from({ length: 7 }, (_, n) => fact(`f${n}`, `Item ${n}`))
    const page = render(
      React.createElement(Related, { ids: world.facts.map((f) => (f as Fact).id) }),
    )
    expect(page.querySelectorAll('li')).toHaveLength(4)
    const more = [...page.querySelectorAll('button')].find((b) =>
      /^Show 3 more$/.test(b.textContent),
    )!
    act(() => more.click())
    expect(page.querySelectorAll('li')).toHaveLength(7)
    expect(page.textContent).not.toContain('Show 3 more')
  })
})

describe('the next step under an Outdated answer', () => {
  const stale = { state: 'stale', metric: '', markets: [] } as unknown as Answer

  it('shows nothing, and does not throw, when the answer has no item to check', () => {
    world.me = { name: 'Mia', owns: ['sales'], admin: false }
    const page = render(React.createElement(NextStep, { answer: stale, facts: [] }))
    expect(page.textContent).toBe('')
  })

  it('offers to mark an item still true when the answer has one', () => {
    const page = render(
      React.createElement(NextStep, {
        answer: stale,
        facts: [fact('a', 'Orders', { outOfDate: 'x' })],
      }),
    )
    expect(page.textContent).toContain('Mark it still true')
  })
})

describe('the still-looking line', () => {
  function Probe({ progress }: { progress?: string }) {
    return React.createElement('p', null, String(useStillLooking(true, progress)))
  }

  it('waits 9 seconds again after each new progress line', () => {
    vi.useFakeTimers()
    const page = render(React.createElement(Probe, { progress: 'Looked up Orders' }))
    act(() => void vi.advanceTimersByTime(8000))
    expect(page.textContent).toBe('false')
    act(() => root!.render(React.createElement(Probe, { progress: 'Read “Orders in Norway”' })))
    act(() => void vi.advanceTimersByTime(8000))
    expect(page.textContent).toBe('false')
    act(() => void vi.advanceTimersByTime(1500))
    expect(page.textContent).toBe('true')
    act(() => root!.render(React.createElement(Probe, { progress: 'Searched wider' })))
    expect(page.textContent).toBe('false')
  })

  it('keeps its way when there is no progress line to change', () => {
    vi.useFakeTimers()
    const page = render(React.createElement(Probe))
    act(() => void vi.advanceTimersByTime(9100))
    expect(page.textContent).toBe('true')
  })
})
