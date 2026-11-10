// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { bindApi, type HeedApi, type ObsValuesInput } from '@/api'
import { dimensionValuesQuery } from '@/api/queries'
import { FilterBar, type Field } from '@/components/obs/filter-bar'
import { FacetRail } from '@/components/obs/facet-rail'
import { nameOf } from '@/lib/obs-names'
import {
  isDim,
  type FacetValue,
  type FieldKey,
  type FilterKey,
  type Filters,
} from '@/lib/obs-views'

// Overview's filter bar as a person uses it from the keyboard: F opens the picker, the arrows and
// Enter open a dimension, then tick its values, which the service counts; typing finds a value in
// any dimension; Backspace in the empty first step takes the last chip off; a chip moves with Alt
// and the arrows, and the box names the list and its active row for screen readers. The facets
// beside it: a tick adds a value, a count looks at only that value.

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

const sum = (total: number | null, atLeast = total ?? 0, topics = 1) => ({ total, atLeast, topics })
const market = { key: 'dim:market', name: 'Market' }
const values = [
  { key: 'val:market/norway', name: 'Norway', asked: sum(null, 88, 3) },
  { key: 'val:market/spain', name: 'Spain', asked: sum(null, 0) },
]
/** The service's reads, as a test answers them: two dimensions, Market with two values. */
const service = {
  obsDimensions: vi.fn(() =>
    Promise.resolve({
      state: 'normal' as const,
      dimensions: [
        { ...market, values: 12, valuesAsked: 2, asked: sum(120, 120, 4) },
        { key: 'dim:store', name: 'Store', values: 300, valuesAsked: 0, asked: sum(null, 0, 0) },
      ],
    }),
  ),
  obsValues: vi.fn((input: ObsValuesInput) => Promise.resolve(valuesFor(input))),
}
function valuesFor(input: ObsValuesInput) {
  const found = values.filter((v) => v.name.toLowerCase().startsWith(input.q.toLowerCase()))
  return {
    state: 'normal' as const,
    groups: [
      {
        dimension: market,
        asked: sum(120, 120, 4),
        values: found,
        matched: found.length,
        notAsked: 0,
        nextCursor: null,
      },
    ],
    notAsked: input.dimension ? 0 : 2,
    nextCursor: null,
  }
}

const fields: Field[] = [
  { key: 'answer', values: ['grounded', 'missing'] },
  { key: 'month', values: ['2026-10'] },
]
const counts: Record<string, FacetValue[]> = {
  answer: [
    { value: 'grounded', topics: 4, count: { visible: 94, shown: 94 } },
    { value: 'missing', topics: 2, count: { visible: null, shown: 0 } },
  ],
  month: [
    { value: '2026-10', topics: 3, count: { visible: null, shown: 88 } },
    { value: '2026-09', topics: 1, count: { visible: null, shown: 0 } },
  ],
}
const words = (key: FilterKey, v: string) =>
  isDim(key)
    ? nameOf(v)
    : key === 'answer'
      ? ({ grounded: 'Checked', missing: 'Not found' } as Record<string, string>)[v]!
      : v

function mount(chips: Filters, seed?: (client: QueryClient) => void) {
  bindApi(service as unknown as HeedApi)
  const onChange = vi.fn<(chips: Filters, said: string, instant?: boolean) => void>()
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  seed?.(client)
  act(() =>
    root!.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(FilterBar, {
          chips,
          onChange,
          fields,
          facet: (k: FieldKey) => counts[k] ?? [],
          words,
          view: { range: 30, filters: [] },
          days: 30,
          left: [],
          pinned: [],
          recent: [],
          facets: { on: true, toggle: () => {}, sheet: false },
        }),
        React.createElement(FacetRail, {
          chips,
          onChange,
          fields,
          facet: (k: FieldKey) => counts[k] ?? [],
          words,
          folded: false,
        }),
      ),
    ),
  )
  return { onChange }
}

/** Lets the reads answer and the list draw them. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  })
const box = () => document.querySelector<HTMLInputElement>('[role=combobox]')!
const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }))
    await Promise.resolve()
  })
const options = () => [...document.querySelectorAll('[role=option]')].map((o) => o.textContent)
/** The rows of places the list keeps for values on their way (two skeletons a row). */
const places = () => document.querySelectorAll('[role=listbox] [data-slot=skeleton]').length / 2
/** The bar over a step's values: how many, and their order. */
const orderBar = () => document.querySelector('[aria-label="Order the values of Market"]')
const openMarket = async () => {
  await key(document.body, 'f')
  await settle()
  await key(box(), 'ArrowDown')
  await key(box(), 'ArrowDown')
  await key(box(), 'Enter')
}

describe('the filter bar', () => {
  it('F opens the picker; a dimension, then a value ticked, which becomes its chip', async () => {
    const { onChange } = mount([])
    await key(document.body, 'f')
    await settle()
    expect(document.activeElement).toBe(box())
    expect(options()).toEqual([
      'Answer',
      'Month asked about',
      expect.stringMatching(/^Market120 · 12 values/),
      'All 2 dimensions1 asked about in 30 days',
    ])
    // The box names the list and its active row.
    const list = document.getElementById(box().getAttribute('aria-controls')!)
    expect(list?.getAttribute('role')).toBe('listbox')
    expect(document.getElementById(box().getAttribute('aria-activedescendant')!)?.textContent).toBe(
      'Answer',
    )
    await key(box(), 'ArrowDown')
    await key(box(), 'ArrowDown')
    await key(box(), 'Enter')
    await settle()
    // Market's values, the most asked first, with what they count in the disclosure rules' words.
    expect(service.obsValues).toHaveBeenLastCalledWith(
      expect.objectContaining({ dimension: 'dim:market', q: '', sort: 'asked' }),
    )
    expect(options()[0]).toMatch(/^Any value · asked about market at all120/)
    expect(options()[1]).toMatch(/^Norway88\+/)
    expect(options()[2]).toMatch(/^SpainFewer than 5/)
    await key(box(), 'ArrowDown')
    await key(box(), ' ')
    expect(onChange).toHaveBeenLastCalledWith(
      [{ key: 'dim:market', values: ['val:market/norway'] }],
      'Added Norway, Market',
      undefined,
    )
    // Escape goes back a step, then closes.
    await key(box(), 'Escape')
    expect(options()[0]).toBe('Answer')
    await key(box(), 'Escape')
    expect(document.querySelector('[role=combobox]')).toBeNull()
  })

  it('opens a dimension its facet already read with its values, in the same frame', async () => {
    // Its facet's read: the picker's first page is the same read, so the step never draws empty.
    mount([], (client) =>
      client.setQueryData(
        dimensionValuesQuery({ range: 30, filters: [] }, 'dim:market').queryKey,
        valuesFor({ range: 30, filters: [], dimension: 'dim:market', q: '', sort: 'asked' }),
      ),
    )
    service.obsValues.mockImplementation(() => new Promise(() => {}))
    try {
      await openMarket()
      expect(options()).toEqual([
        expect.stringMatching(/^Any value · asked about market at all120/),
        expect.stringMatching(/^Norway88\+/),
        expect.stringMatching(/^SpainFewer than 5/),
      ])
      expect(places()).toBe(0)
    } finally {
      service.obsValues.mockImplementation((input) => Promise.resolve(valuesFor(input)))
    }
  })

  it('keeps the count bar and a place for each value asked about while they load', async () => {
    let answer: (() => void) | undefined
    service.obsValues.mockImplementation(
      (input) => new Promise((done) => (answer = () => done(valuesFor(input)))),
    )
    try {
      mount([])
      await openMarket()
      // Before the read: the bar is there, and a row of places for each of the 2 values asked
      // about, so the values take those places and nothing under them moves.
      expect(orderBar()).not.toBeNull()
      expect(options()).toEqual(['Any value · asked about market at all'])
      expect(places()).toBe(2)
      act(() => answer?.())
      await settle()
      expect(orderBar()).not.toBeNull()
      expect(options()).toEqual([
        expect.stringMatching(/^Any value · asked about market at all120/),
        expect.stringMatching(/^Norway/),
        expect.stringMatching(/^Spain/),
      ])
      expect(places()).toBe(0)
    } finally {
      service.obsValues.mockImplementation((input) => Promise.resolve(valuesFor(input)))
    }
  })

  it('/ starts typing: a value in any dimension, by group, and the words as a topic', async () => {
    const { onChange } = mount([])
    await key(document.body, '/')
    await settle()
    // As typing does: the value through the input's own setter, then the input event.
    const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!
    act(() => {
      value.set!.call(box(), 'nor')
      box().dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => await new Promise((r) => setTimeout(r, 200)))
    await settle()
    expect(service.obsValues).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'nor', sort: 'asked' }),
    )
    expect(options()).toEqual([expect.stringMatching(/^Norway88\+/), 'Topic has “nor”'])
    expect(document.body.textContent).toContain(
      '2 more values match, but no agent asked about them in 30 days.',
    )
    await key(box(), 'Enter')
    expect(onChange).toHaveBeenLastCalledWith(
      [{ key: 'dim:market', values: ['val:market/norway'] }],
      'Added Norway, Market',
      undefined,
    )
  })

  it('Backspace in the empty first step takes the last chip off', async () => {
    const chips: Filters = [
      { key: 'answer', values: ['missing'] },
      { key: 'dim:market', not: true, values: ['val:market/norway'] },
    ]
    const { onChange } = mount(chips)
    await key(document.body, 'f')
    await settle()
    await key(box(), 'Backspace')
    expect(onChange).toHaveBeenLastCalledWith(
      [chips[0]],
      'Removed the filter Market is not Norway',
      undefined,
    )
  })

  it('reads each chip as a sentence in parts, and moves it with Alt and the arrows at once', async () => {
    const chips: Filters = [
      { key: 'answer', values: ['missing', 'grounded'] },
      { key: 'month', values: ['2026-10'] },
      { key: 'dim:store', values: ['*'] },
    ]
    const { onChange } = mount(chips)
    const month = document.querySelector<HTMLElement>('[data-chip=month]')!
    expect(month.getAttribute('aria-label')).toMatch(/^Month asked about is 2026-10\. /)
    expect(month.closest('li')!.textContent).toBe('Month asked aboutis2026-10')
    expect(document.querySelector('[data-chip=answer]')!.closest('li')!.textContent).toBe(
      'Answeris any ofNot found, Checked',
    )
    expect(document.querySelector('[data-chip="dim:store"]')!.getAttribute('aria-label')).toMatch(
      /^Store has any value\. /,
    )
    await key(month, 'ArrowLeft', { altKey: true })
    expect(onChange).toHaveBeenLastCalledWith(
      [chips[1], chips[0], chips[2]],
      'Moved Month asked about is 2026-10 to place 1 of 3',
      true,
    )
    // Delete takes it off, from the chip itself.
    await key(month, 'Delete')
    expect(onChange).toHaveBeenLastCalledWith(
      [chips[0], chips[2]],
      'Removed the filter Month asked about is 2026-10',
      undefined,
    )
  })

  it('opens the picker on a chip, at its values, and flips how it matches', async () => {
    const chips: Filters = [{ key: 'dim:market', values: ['val:market/norway'] }]
    const { onChange } = mount(chips)
    act(() => document.querySelector<HTMLElement>('[data-chip="dim:market"]')!.click())
    await settle()
    // The value chosen comes first, ticked.
    expect(options()[1]).toMatch(/^Norway/)
    expect(document.querySelectorAll('[role=option]')[1]!.getAttribute('aria-selected')).toBe(
      'true',
    )
    const not = [...document.querySelectorAll('[role=radio]')].find(
      (r) => r.textContent === 'is not',
    )!
    act(() => (not as HTMLElement).click())
    expect(onChange).toHaveBeenLastCalledWith(
      [{ key: 'dim:market', not: true, values: ['val:market/norway'] }],
      'Market is not',
      undefined,
    )
  })
})

describe('the facets', () => {
  it('tick a value into its chip, and a count looks at only that value', () => {
    const { onChange } = mount([{ key: 'month', values: ['2026-09'] }])
    const october = document.querySelector('label[for="facet-month-2026-10"]')!
    const tick = october.previousElementSibling as HTMLElement
    act(() => tick.click())
    expect(onChange).toHaveBeenLastCalledWith(
      [{ key: 'month', values: ['2026-09', '2026-10'] }],
      'Added 2026-10',
    )
    const drill = [...document.querySelectorAll('button')].find((b) =>
      b.getAttribute('aria-label')?.startsWith('2026-10: 3 topics, asked at least 88 times'),
    )!
    act(() => drill.click())
    expect(onChange).toHaveBeenLastCalledWith(
      [{ key: 'month', values: ['2026-10'] }],
      'Looking at only 2026-10',
    )
  })
})
