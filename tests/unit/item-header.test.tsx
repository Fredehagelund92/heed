import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ContextItem } from '@domain/item'
import { ItemHeader } from '@/components/item/item-header'
import { itemState } from '@/lib/item-state'
import { generateItems } from '@/mocks/items'
import { areas, FIXTURE_TODAY } from '@/mocks/reference-data'

const items = generateItems()

describe('the item header', () => {
  it('keeps the human title before the compact badges and validity note', () => {
    const item = items.find((candidate) => candidate.id === 'itm_jyfuvl07')!
    const area = areas.find((candidate) => candidate.id === item.areaId)
    const state = itemState(item, {
      today: FIXTURE_TODAY,
      ownerName: null,
      areaName: area?.name ?? null,
      retired: null,
    })
    const { container } = render(<ItemHeader item={item} area={area} state={state} />)
    expect(container.querySelector('header')?.firstElementChild).toBe(
      screen.getByRole('heading', { name: item.title }),
    )
    expect(container.querySelector('[data-slot="item-note"]')).toHaveTextContent(state.chip.label)
    expect(container).not.toHaveTextContent(item.id)
    expect(container.querySelector('[data-slot="kind-badge"]')).toHaveAttribute('data-size', 'sm')
  })
  it('keeps the withholding warning visible for a high-risk source failure', () => {
    const item = items.find((candidate) => candidate.id === 'itm_gjdvl50x')!
    const state = itemState(item, {
      today: FIXTURE_TODAY,
      ownerName: 'Jon Abara',
      areaName: null,
      retired: null,
    })
    render(<ItemHeader item={item} area={undefined} state={state} />)
    expect(screen.getByText('High risk')).toBeVisible()
    expect(screen.getByText('Source missing')).toBeVisible()
    expect(screen.getByText('Agents may not get it until Jon Abara checks it.')).toBeVisible()
  })
})

const base = items.find((item) => item.id === 'itm_jyfuvl07')!
const summaryCases: { name: string; patch: Partial<ContextItem>; expected: string }[] = [
  {
    name: 'accepted',
    patch: { validity: { start: '2026-06-12', end: null }, reviewDate: '2027-01-20' },
    expected: 'Accepted · From 12 June 2026, still going on · Check again by 20 January 2027',
  },
  {
    name: 'resolved',
    patch: { kind: 'issue', validity: { start: '2026-09-29', end: '2026-10-11' } },
    expected: 'Resolved · Applied 29 September to 10 October 2026',
  },
  {
    name: 'resolved on one day',
    patch: { kind: 'issue', validity: { start: '2026-10-10', end: '2026-10-11' } },
    expected: 'Resolved · Applied on 10 October 2026',
  },
  {
    name: 'ended',
    patch: { validity: { start: '2026-09-29', end: '2026-10-11' } },
    expected: 'Ended · Applied 29 September to 10 October 2026',
  },
  {
    name: 'active issue',
    patch: { kind: 'issue', validity: { start: '2026-10-02', end: null }, reviewDate: null },
    expected: 'Active issue · Active since 2 October 2026',
  },
  {
    name: 'future',
    patch: { validity: { start: '2026-10-15', end: null }, reviewDate: null },
    expected: 'Not started yet · Starts 15 October 2026, in 4 days',
  },
  { name: 'archived', patch: { status: 'retired' }, expected: 'Archived' },
]

it.each(summaryCases)('names the lifecycle once for $name', ({ patch, expected }) => {
  const item = { ...base, ...patch }
  const state = itemState(item, {
    today: '2026-10-11',
    ownerName: null,
    areaName: null,
    retired: null,
  })
  const { container } = render(<ItemHeader item={item} area={undefined} state={state} />)
  expect(container.querySelector('[data-slot="item-note"]')).toHaveTextContent(expected)
})

it('keeps a known archive date without repeating Archived', () => {
  const item = { ...base, status: 'retired' as const }
  const state = itemState(item, {
    today: FIXTURE_TODAY,
    ownerName: null,
    areaName: null,
    retired: { by: 'Jon Abara', date: '2026-09-01' },
  })
  const { container } = render(<ItemHeader item={item} area={undefined} state={state} />)
  expect(container.querySelector('[data-slot="item-note"]')).toHaveTextContent(
    /^Archived 1 September 2026$/,
  )
})
