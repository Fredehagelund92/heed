import { useState, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { createQueryClient } from '@/api/query-client'
import { PreviewBody } from '@/components/preview/preview-card'
import { PersonPreview, PreviewLink } from '@/components/preview/preview-link'
import { previewSheet } from '@/components/preview/preview-trigger'
import {
  firstValues,
  personAreas,
  personRole,
  previewListSearch,
  previewPage,
  previewTargetOf,
  previewTargetOfAbout,
  shelfLine,
  termMeta,
} from '@/lib/preview'
import { areas } from '@/mocks/reference-data'

/*
  The chip previews (the editor design, section 6): where a chip goes, what its card says, and
  that a page of chips asks for nothing until a card opens, and a card asks once per read.
*/

describe('preview targets', () => {
  it('reads every spelling a chip uses', () => {
    expect(previewTargetOf('metric:orders')).toEqual({ type: 'metric', id: 'orders' })
    expect(previewTargetOf('dim:market')).toEqual({ type: 'dim', id: 'market' })
    expect(previewTargetOf('val:market/norway')).toEqual({
      type: 'val',
      dimension: 'market',
      value: 'norway',
    })
    expect(previewTargetOf('item:itm_1')).toEqual({ type: 'item', id: 'itm_1' })
    expect(previewTargetOfAbout('orders')).toEqual({ type: 'metric', id: 'orders' })
    expect(previewTargetOfAbout('market:norway')).toEqual({
      type: 'val',
      dimension: 'market',
      value: 'norway',
    })
    expect(previewTargetOfAbout('market:*')).toEqual({ type: 'dim', id: 'market' })
  })

  it('has no preview for a domain, a metric group or a broken key', () => {
    expect(previewTargetOf('area:area_sales')).toBeNull()
    expect(previewTargetOf('group:payments')).toBeNull()
    expect(previewTargetOf('val:market')).toBeNull()
    expect(previewTargetOf('metric:')).toBeNull()
    expect(previewTargetOf('orders')).toBeNull()
    expect(previewTargetOfAbout('')).toBeNull()
  })

  it('opens a term on its catalogue page and a value on its dimension, picked out', () => {
    expect(previewPage({ type: 'metric', id: 'orders' })).toEqual({
      to: '/catalogue/metric/$id',
      params: { id: 'orders' },
    })
    expect(previewPage({ type: 'dim', id: 'market' })).toEqual({
      to: '/catalogue/dimension/$id',
      params: { id: 'market' },
    })
    expect(previewPage({ type: 'val', dimension: 'market', value: 'norway' })).toEqual({
      to: '/catalogue/dimension/$id',
      params: { id: 'market' },
      search: { value: 'norway' },
    })
    expect(previewPage({ type: 'item', id: 'itm_1' })).toEqual({
      to: '/library/$itemId',
      params: { itemId: 'itm_1' },
    })
    expect(previewPage({ type: 'person', id: 'per_jon' })).toBeNull()
  })

  it('keeps the library list a metric or a value chip opened before', () => {
    expect(previewListSearch({ type: 'metric', id: 'orders' })).toEqual({
      about: 'orders',
      ended: 'show',
    })
    expect(previewListSearch({ type: 'val', dimension: 'market', value: 'norway' })).toEqual({
      about: 'market:norway',
      ended: 'show',
    })
    expect(previewListSearch({ type: 'dim', id: 'market' })).toBeNull()
    expect(previewListSearch({ type: 'item', id: 'itm_1' })).toBeNull()
  })
})

describe('preview words', () => {
  it('says what the library holds in one line', () => {
    expect(shelfLine({ items: 92, mentionedBy: 9, needsALook: 7 })).toEqual({
      strong: '92 facts',
      rest: ', 9 mention it. 7 need checking.',
    })
    expect(shelfLine({ items: 1, mentionedBy: 1, needsALook: 1 })).toEqual({
      strong: '1 fact',
      rest: ', 1 mentions it. 1 needs checking.',
    })
    expect(shelfLine({ items: 1407, mentionedBy: 179 }, 'Market')).toEqual({
      strong: '1,407 facts',
      rest: ' apply to a market, 179 mention it.',
    })
    expect(shelfLine({ items: 0, mentionedBy: 0 })).toEqual({
      strong: '',
      rest: 'Nothing in the library is about it yet.',
    })
  })

  it('names the type and what it belongs to', () => {
    expect(termMeta({ kind: 'metric', group: { key: 'payments', name: 'Payments' } })).toBe(
      'Metric · group Payments',
    )
    expect(termMeta({ kind: 'metric', group: null })).toBe('Metric')
    expect(termMeta({ kind: 'dimension', group: null }, 12)).toBe('Dimension · 12 values')
    expect(termMeta({ kind: 'dimension', group: null }, 1)).toBe('Dimension · 1 value')
    expect(termMeta({ kind: 'dimension', group: null })).toBe('Dimension')
  })

  it('names the first values and counts the rest', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => ({ name }))
    expect(firstValues(names)).toEqual({ shown: ['A', 'B', 'C', 'D'], more: 2 })
    expect(firstValues(names.slice(0, 2))).toEqual({ shown: ['A', 'B'], more: 0 })
  })

  it('gives a person the role their domains give them, and nothing else', () => {
    expect(personRole({ id: 'per_jon' }, areas)).toBe('Owner of Sales and Sandbox')
    expect(personRole({ id: 'per_sofia' }, areas)).toBe('Owner of Sales')
    expect(personRole({ id: 'per_maria' }, areas)).toBeNull()
    expect(personAreas({ id: 'per_jon' }, areas).map((area) => area.name)).toEqual([
      'Sales',
      'Sandbox',
    ])
  })
})

function Frame({ children }: { children: ReactNode }) {
  const [client] = useState(() => createQueryClient())
  const [router] = useState(() =>
    createRouter({
      routeTree: createRootRoute({ component: () => <>{children}</> }),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    }),
  )
  return (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

describe('chip previews', () => {
  // The mock binding builds its fixtures on its first call; do that once, outside the tests' time.
  beforeAll(async () => {
    await api.listCatalogue()
  }, 60_000)

  afterEach(() => {
    vi.restoreAllMocks()
    act(() => previewSheet.close())
  })

  it('makes each chip a link to its page and asks for nothing until a card opens', async () => {
    const catalogue = vi.spyOn(api, 'listCatalogue')
    const term = vi.spyOn(api, 'getCatalogueTerm')
    const library = vi.spyOn(api, 'listLibrary')
    render(
      <Frame>
        <PreviewLink preview={{ type: 'metric', id: 'orders' }}>Orders</PreviewLink>
        <PreviewLink preview={{ type: 'val', dimension: 'market', value: 'norway' }}>
          Norway
        </PreviewLink>
        <PreviewLink preview={{ type: 'item', id: 'itm_jyfuvl07' }}>An item</PreviewLink>
        <PersonPreview personId="per_jon">Jon Abara</PersonPreview>
      </Frame>,
    )
    expect(await screen.findByRole('link', { name: 'Orders' })).toHaveAttribute(
      'href',
      '/catalogue/metric/orders',
    )
    expect(screen.getByRole('link', { name: 'Norway' })).toHaveAttribute(
      'href',
      '/catalogue/dimension/market?value=norway',
    )
    expect(screen.getByRole('link', { name: 'An item' })).toHaveAttribute(
      'href',
      '/library/itm_jyfuvl07',
    )
    // A person has no page: the chip is focusable so a keyboard can open the card.
    expect(screen.getByText('Jon Abara')).toHaveAttribute('tabindex', '0')
    expect(catalogue).not.toHaveBeenCalled()
    expect(term).not.toHaveBeenCalled()
    expect(library).not.toHaveBeenCalled()
  })

  it('reads the catalogue once for every term card and a dimension once for its values', async () => {
    const catalogue = vi.spyOn(api, 'listCatalogue')
    const term = vi.spyOn(api, 'getCatalogueTerm')
    render(
      <Frame>
        <PreviewBody target={{ type: 'metric', id: 'orders' }} variant="card" />
        <PreviewBody target={{ type: 'metric', id: 'net_revenue' }} variant="card" />
        <PreviewBody target={{ type: 'dim', id: 'market' }} variant="card" />
        <PreviewBody
          target={{ type: 'val', dimension: 'market', value: 'norway' }}
          variant="card"
        />
        <PreviewBody
          target={{ type: 'val', dimension: 'market', value: 'netherlands' }}
          variant="card"
        />
      </Frame>,
    )
    expect(await screen.findByText('Orders', {}, { timeout: 10_000 })).toBeInTheDocument()
    expect(await screen.findByText('Norge', { exact: false })).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByRole('link', { name: /^Open / })).toHaveLength(5))
    expect(catalogue).toHaveBeenCalledTimes(1)
    expect(term).toHaveBeenCalledTimes(1)
    expect(term).toHaveBeenCalledWith('dimension', 'market')
  })

  it('shows a metric with its status, domain, definition, counts and actions', async () => {
    render(
      <Frame>
        <PreviewBody target={{ type: 'metric', id: 'orders' }} variant="card" />
      </Frame>,
    )
    expect(await screen.findByText('Orders', {}, { timeout: 10_000 })).toBeInTheDocument()
    expect(screen.getByText('Metric · group Payments')).toBeInTheDocument()
    expect(screen.getByText('Sales')).toBeInTheDocument()
    expect(screen.getByText(/active issue/)).toBeInTheDocument()
    expect(
      screen.getByText(/The value of orders customers completed and paid for/),
    ).toBeInTheDocument()
    // People read where the words come from, never the member's view (one term, many views).
    expect(screen.getByText(/^Copy from Cube, read /)).toBeInTheDocument()
    expect(screen.queryByText('orders.orders')).toBeNull()
    expect(screen.getByRole('link', { name: 'Open Orders' })).toHaveAttribute(
      'href',
      '/catalogue/metric/orders',
    )
    expect(screen.getByRole('link', { name: /\d+ facts/ })).toHaveAttribute(
      'href',
      '/library?about=orders&ended=show',
    )
    expect(screen.getByRole('button', { name: 'Copy a link to Orders' })).toBeInTheDocument()
  })

  it('shows a fact, a person and says when a target is gone', async () => {
    render(
      <Frame>
        <PreviewBody target={{ type: 'item', id: 'itm_jyfuvl07' }} variant="card" />
        <PreviewBody target={{ type: 'person', id: 'per_jon' }} variant="card" />
        <PreviewBody target={{ type: 'item', id: 'itm_missing' }} variant="card" />
        <PreviewBody target={{ type: 'metric', id: 'no_such_metric' }} variant="card" />
      </Frame>,
    )
    expect(
      await screen.findByText(
        'Comparing Units per order between the Netherlands and other markets',
        {},
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Guide')).toBeInTheDocument()
    expect(screen.getByText(/^From /)).toBeInTheDocument()
    expect(await screen.findByText('Owner of Sales and Sandbox')).toBeInTheDocument()
    expect(screen.getByText(/This fact is no longer in the library/)).toBeInTheDocument()
    expect(await screen.findByText("It's no longer in the Catalogue.")).toBeInTheDocument()
    // There is no people page, so a person's card has no Open.
    expect(screen.getAllByRole('link', { name: /^Open / })).toHaveLength(1)
  })

  it('opens the bottom sheet on a tap instead of following the link', async () => {
    render(
      <Frame>
        <PreviewLink preview={{ type: 'metric', id: 'orders' }}>Orders</PreviewLink>
      </Frame>,
    )
    const chip = await screen.findByRole('link', { name: 'Orders' })
    fireEvent.pointerDown(chip, { pointerType: 'touch' })
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => void chip.dispatchEvent(click))
    expect(click.defaultPrevented).toBe(true)
    expect(previewSheet.get()).toEqual({ target: { type: 'metric', id: 'orders' }, open: true })

    // A mouse click follows the link as before.
    act(() => previewSheet.close())
    fireEvent.pointerDown(chip, { pointerType: 'mouse' })
    const mouse = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    act(() => void chip.dispatchEvent(mouse))
    expect(previewSheet.get().open).toBe(false)
  })
})
