// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { FilterBar, type Field } from '@/components/obs/filter-bar'
import { FacetRail } from '@/components/obs/facet-rail'
import type { FacetValue, FilterKey, Filters } from '@/lib/obs-views'

// Overview's filter bar as a person uses it from the keyboard: F opens the fields, Enter picks a
// field and then a value, Backspace in the empty box takes the last chip off, a chip moves with
// Alt and the arrows, and the box names the list and its active row for screen readers. The
// facets beside it: a tick adds a value, a count looks at only that value.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia
  Element.prototype.scrollIntoView = () => {}
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  document.body.innerHTML = ''
})

const fields: Field[] = [
  { key: 'answer', values: ['grounded', 'missing'] },
  { key: 'market', values: ['Norway', 'Spain'] },
  { key: 'month', values: ['2026-10'] },
]
const counts: Record<string, FacetValue[]> = {
  answer: [
    { value: 'grounded', topics: 4, count: { visible: 94, shown: 94 } },
    { value: 'missing', topics: 2, count: { visible: null, shown: 0 } },
  ],
  market: [
    { value: 'Norway', topics: 3, count: { visible: null, shown: 88 } },
    { value: 'Spain', topics: 1, count: { visible: null, shown: 0 } },
  ],
  month: [{ value: '2026-10', topics: 4, count: { visible: 120, shown: 120 } }],
}
const words = (key: FilterKey, v: string) =>
  key === 'answer'
    ? ({ grounded: 'Checked', missing: 'Not found' } as Record<string, string>)[v]!
    : v

function mount(chips: Filters) {
  const onChange = vi.fn<(chips: Filters, said: string, instant?: boolean) => void>()
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  act(() =>
    root!.render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(FilterBar, {
          chips,
          onChange,
          fields,
          facet: (k: FilterKey) => counts[k] ?? [],
          words,
          facets: { on: true, toggle: () => {}, sheet: false },
        }),
        React.createElement(FacetRail, {
          chips,
          onChange,
          fields,
          facet: (k: FilterKey) => counts[k] ?? [],
          words,
          folded: false,
        }),
      ),
    ),
  )
  const box = document.querySelector<HTMLInputElement>('[role=combobox]')!
  return { onChange, box }
}

const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }))
    await Promise.resolve()
  })
const options = () => [...document.querySelectorAll('[role=option]')].map((o) => o.textContent)

describe('the filter bar', () => {
  it('F opens the fields; Enter picks one, then a value, which becomes a chip', async () => {
    const { onChange, box } = mount([])
    await key(document.body, 'f')
    expect(document.activeElement).toBe(box)
    expect(box.getAttribute('aria-expanded')).toBe('true')
    expect(options()).toEqual(['Answer', 'Market', 'Month asked about'])
    // The box names the list and its active row.
    const list = document.getElementById(box.getAttribute('aria-controls')!)
    expect(list?.getAttribute('role')).toBe('listbox')
    expect(document.getElementById(box.getAttribute('aria-activedescendant')!)?.textContent).toBe(
      'Answer',
    )
    await key(box, 'ArrowDown')
    await key(box, 'Enter')
    // Market's values, with what they count, hidden ones in the disclosure rules' words.
    expect(options()[0]).toMatch(/^Norway88\+/)
    expect(options()[1]).toMatch(/^SpainFewer than 5/)
    await key(box, 'Enter')
    expect(onChange).toHaveBeenLastCalledWith(
      [{ key: 'market', values: ['Norway'] }],
      'Added Norway: Market is Norway',
      undefined,
    )
  })

  it('/ starts typing; a value matches across fields, and the words are a topic', async () => {
    const { onChange, box } = mount([])
    await key(document.body, '/')
    // As typing does: the value through the input's own setter, then the input event.
    const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!
    act(() => {
      value.set!.call(box, 'nor')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(options()).toEqual([expect.stringMatching(/^Market is Norway/), 'Topic has “nor”'])
    await key(box, 'ArrowUp')
    await key(box, 'Enter')
    expect(onChange).toHaveBeenLastCalledWith(
      [{ key: 'topic', values: ['nor'] }],
      'Added the filter Topic has “nor”',
      undefined,
    )
  })

  it('Backspace in the empty box takes the last chip off; Esc closes the list', async () => {
    const chips: Filters = [
      { key: 'answer', values: ['missing'] },
      { key: 'market', not: true, values: ['Norway'] },
    ]
    const { onChange, box } = mount(chips)
    act(() => box.focus())
    await key(box, 'Backspace')
    expect(onChange).toHaveBeenLastCalledWith(
      [chips[0]],
      'Removed the filter Market is not Norway',
      undefined,
    )
    await key(box, 'Escape')
    expect(box.getAttribute('aria-expanded')).toBe('false')
  })

  it('reads each chip as a sentence, and moves it with Alt and the arrows at once', async () => {
    const chips: Filters = [
      { key: 'answer', values: ['missing', 'grounded'] },
      { key: 'month', values: ['2026-10'] },
    ]
    const { onChange } = mount(chips)
    const month = document.querySelector<HTMLElement>('[data-chip=month]')!
    expect(month.getAttribute('aria-label')).toMatch(/^Month asked about is 2026-10\. /)
    expect(document.querySelector('[data-chip=answer]')!.textContent).toBe(
      'Answer is any of Not found, Checked',
    )
    await key(month, 'ArrowLeft', { altKey: true })
    expect(onChange).toHaveBeenLastCalledWith(
      [chips[1], chips[0]],
      'Moved Month asked about is 2026-10 to place 1 of 2',
      true,
    )
    // Delete takes it off, from the chip itself.
    await key(month, 'Delete')
    expect(onChange).toHaveBeenLastCalledWith(
      [chips[0]],
      'Removed the filter Month asked about is 2026-10',
      undefined,
    )
  })
})

describe('the facets', () => {
  it('tick a value into its chip, and a count looks at only that value', () => {
    const { onChange } = mount([{ key: 'market', values: ['Spain'] }])
    const norway = document.querySelector('label[for="facet-market-Norway"]')!
    const tick = norway.previousElementSibling as HTMLElement
    act(() => tick.click())
    expect(onChange).toHaveBeenLastCalledWith(
      [{ key: 'market', values: ['Spain', 'Norway'] }],
      'Added Norway',
    )
    const drill = [...document.querySelectorAll('button')].find((b) =>
      b.getAttribute('aria-label')?.startsWith('Norway: 3 topics, asked at least 88 times'),
    )!
    act(() => drill.click())
    expect(onChange).toHaveBeenLastCalledWith(
      [{ key: 'market', values: ['Norway'] }],
      'Looking at only Norway',
    )
  })
})
