// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { allLoaded, Loadable, type LoadState } from '@/components/heed/load-state'
import { DEFINITIONS_LEAD, TableBodySkeleton, TableSkeleton } from '@/components/heed/list-skeleton'

// The loading states a list shares: the table's skeleton at the table's own heights, the same rows
// inside a table body, Loadable's timing (nothing under 150ms, then the skeleton, then the content,
// a failure with Retry, and a refresh that fails on a page already shown: the page stays, one line
// says so).

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

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
const rerender = (node: React.ReactNode) => act(() => root!.render(node))
const h = React.createElement

describe('TableSkeleton', () => {
  it('says Loading once, with its bars at their heights wide and on a phone, and table-high rows', () => {
    const el = render(h(TableSkeleton, { lead: DEFINITIONS_LEAD, rows: 5 }))
    const status = el.querySelectorAll('[role=status]')
    expect(status).toHaveLength(1)
    expect(status[0]!.getAttribute('aria-label')).toBe('Loading')
    const bars = [...status[0]!.children] as HTMLElement[]
    // Definitions' three bars as the page measures them: 41, 57 and 49px wide, 89, 97 and 81 on a phone.
    const heights = bars.slice(0, 3).map((b) => [...b.classList].filter((c) => /h-\[/.test(c)))
    expect(heights).toEqual([
      ['h-[41px]', '@max-md/main:h-[89px]'],
      ['h-[57px]', '@max-md/main:h-[97px]'],
      ['h-[49px]', '@max-md/main:h-[81px]'],
    ])
    // The header band, then the rows: 36px like the table's, two lines on a phone.
    expect(bars.slice(3).every((b) => b.classList.contains('h-9'))).toBe(true)
    expect(bars.slice(4)).toHaveLength(5)
    expect(bars.slice(4).every((b) => b.classList.contains('@max-xl/main:h-14'))).toBe(true)
  })

  it("a list's bar alone by default", () => {
    const el = render(h(TableSkeleton, { rows: 1 }))
    const first = el.querySelector('[role=status]')!.children[0]!
    expect(first.className).toContain('h-[41px]')
    expect(first.className).toContain('@max-md/main:h-[89px]')
  })

  it('says nothing of its own inside a skeleton that already says Loading', () => {
    const el = render(h(TableSkeleton, { announce: false }))
    expect(el.querySelector('[role=status]')).toBeNull()
    expect(el.querySelector('[aria-busy]')).toBeNull()
  })
})

describe('TableBodySkeleton', () => {
  it('fills a table body with rows across every column, hidden from a screen reader', () => {
    const el = render(
      h('table', null, h('tbody', null, h(TableBodySkeleton, { rows: 4, colSpan: 7 }))),
    )
    const rows = el.querySelectorAll('tbody > tr')
    expect(rows).toHaveLength(4)
    for (const r of rows) {
      expect(r.getAttribute('aria-hidden')).toBe('true')
      expect(r.hasAttribute('data-skeleton-row')).toBe(true)
      expect(r.classList.contains('h-9')).toBe(true)
      expect(r.querySelector('td')!.colSpan).toBe(7)
    }
  })
})

describe('Loadable', () => {
  const state = (s: Partial<LoadState>): LoadState => ({
    isPending: false,
    isError: false,
    isRefetchError: false,
    isFetching: false,
    refetch: () => undefined,
    ...s,
  })
  const failedRefresh = (s: Partial<LoadState> = {}) =>
    state({ isError: true, isRefetchError: true, ...s })
  const view = (query: LoadState) =>
    h(Loadable, {
      what: 'the definitions',
      skeleton: h('div', { 'data-testid': 'skeleton' }),
      query,
      children: h('p', { 'data-testid': 'rows' }, 'rows'),
    })

  it('shows nothing for 150ms, then the skeleton, and never an empty state while loading', () => {
    vi.useFakeTimers()
    const el = render(view(state({ isPending: true, isFetching: true })))
    expect(el.querySelector('[data-testid=skeleton]')).toBeNull()
    expect(el.querySelector('[data-testid=rows]')).toBeNull()
    expect(el.querySelector('[role=status]')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(160)
    })
    expect(el.querySelector('[data-testid=skeleton]')).not.toBeNull()
    expect(el.querySelector('[data-testid=rows]')).toBeNull()
  })

  it('holds the skeleton at least 300ms, then shows the content', () => {
    vi.useFakeTimers()
    const el = render(view(state({ isPending: true, isFetching: true })))
    act(() => {
      vi.advanceTimersByTime(160)
    })
    rerender(view(state({})))
    expect(el.querySelector('[data-testid=skeleton]')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(310)
    })
    expect(el.querySelector('[data-testid=skeleton]')).toBeNull()
    expect(el.querySelector('[data-testid=rows]')).not.toBeNull()
  })

  it('a fast load shows the content without a skeleton', () => {
    vi.useFakeTimers()
    const el = render(view(state({ isPending: true, isFetching: true })))
    act(() => {
      vi.advanceTimersByTime(80)
    })
    rerender(view(state({})))
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(el.querySelector('[data-testid=skeleton]')).toBeNull()
    expect(el.querySelector('[data-testid=rows]')).not.toBeNull()
  })

  it('a reading again keeps the content on screen', () => {
    vi.useFakeTimers()
    const el = render(view(state({})))
    rerender(view(state({ isFetching: true })))
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(el.querySelector('[data-testid=rows]')).not.toBeNull()
    expect(el.querySelector('[data-testid=skeleton]')).toBeNull()
  })

  it('a failed load says what did not load, and Retry reads again', () => {
    const refetch = vi.fn()
    const el = render(view(state({ isError: true, refetch })))
    const alert = el.querySelector('[role=alert]')!
    expect(alert.textContent).toContain("Couldn't load the definitions.")
    expect(el.querySelector('[data-testid=rows]')).toBeNull()
    act(() => alert.querySelector('button')!.click())
    expect(refetch).toHaveBeenCalledOnce()
  })

  describe('a refresh that fails on a page already shown', () => {
    it('keeps the page, with what was typed in it, and says the refresh failed', () => {
      const el = render(view(state({})))
      const rows = el.querySelector('[data-testid=rows]')!
      expect(el.querySelector('[role=status]')).toBeNull()
      rerender(view(failedRefresh()))
      // The same element: nothing was unmounted, so a half-written comment is still there.
      expect(el.querySelector('[data-testid=rows]')).toBe(rows)
      expect(el.querySelector('[role=alert]')).toBeNull()
      expect(el.querySelector('[role=status]')!.textContent).toContain(
        "Couldn't refresh the definitions.",
      )
    })

    it('Retry reads again, and the line goes once the page is read', () => {
      const refetch = vi.fn()
      const el = render(view(failedRefresh({ refetch })))
      const line = el.querySelector('[role=status]')!
      act(() => line.querySelector('button')!.click())
      expect(refetch).toHaveBeenCalledOnce()
      // Reading again: no skeleton in place of the page, and no line while it reads.
      rerender(view(failedRefresh({ isFetching: true })))
      expect(el.querySelector('[data-testid=rows]')).not.toBeNull()
      expect(el.querySelector('[data-testid=skeleton]')).toBeNull()
      expect(el.querySelector('[role=status]')).toBeNull()
      rerender(view(state({})))
      expect(el.querySelector('[data-testid=rows]')).not.toBeNull()
      expect(el.querySelector('[role=status]')).toBeNull()
    })

    it('shows no skeleton, even after the delay, while the page is read again', () => {
      vi.useFakeTimers()
      const el = render(view(failedRefresh({ isFetching: true })))
      act(() => {
        vi.advanceTimersByTime(400)
      })
      expect(el.querySelector('[data-testid=skeleton]')).toBeNull()
      expect(el.querySelector('[data-testid=rows]')).not.toBeNull()
    })

    it('a side region stays quiet: the main region says it', () => {
      const el = render(
        h(Loadable, {
          what: 'the side',
          skeleton: h('div'),
          quiet: true,
          query: failedRefresh(),
          children: h('p', { 'data-testid': 'rows' }, 'rows'),
        }),
      )
      expect(el.querySelector('[data-testid=rows]')).not.toBeNull()
      expect(el.querySelector('[role=status]')).toBeNull()
    })

    it('a load that failed with nothing to show is still the error, not the line', () => {
      const el = render(view(state({ isError: true, isRefetchError: false })))
      expect(el.querySelector('[role=alert]')).not.toBeNull()
      expect(el.querySelector('[data-testid=rows]')).toBeNull()
      expect(el.querySelector('[role=status]')).toBeNull()
    })
  })

  describe('allLoaded', () => {
    it('is a failed refresh only when every read that failed has data to show', () => {
      const ok = state({})
      const refresh = failedRefresh()
      const first = state({ isError: true })
      expect(allLoaded(ok, refresh).isRefetchError).toBe(true)
      expect(allLoaded(refresh, first).isRefetchError).toBe(false)
      expect(allLoaded(ok, first).isRefetchError).toBe(false)
      expect(allLoaded(ok, ok).isRefetchError).toBe(false)
      expect(allLoaded(ok, refresh).isError).toBe(true)
    })

    it('Retry reads again only what failed', () => {
      const a = vi.fn()
      const b = vi.fn()
      allLoaded(state({ refetch: a }), failedRefresh({ refetch: b })).refetch()
      expect(a).not.toHaveBeenCalled()
      expect(b).toHaveBeenCalledOnce()
    })
  })
})
