import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ContextItem } from '@domain/item'
import { ItemDetails } from '@/components/item/item-details'
import { itemState } from '@/lib/item-state'
import { generateItems } from '@/mocks/items'
import { FIXTURE_TODAY } from '@/mocks/reference-data'

const item = generateItems().find((candidate) => candidate.id === 'itm_jyfuvl07')!
function facts(record: ContextItem) {
  return {
    state: itemState(record, {
      today: FIXTURE_TODAY,
      ownerName: null,
      areaName: null,
      retired: null,
    }),
    owner: undefined,
    proposer: undefined,
    latestAccepted: null,
    historyPending: false,
    retiredRow: null,
  }
}

describe('item details', () => {
  it('names every fact without exposing identifiers or inventing missing people', () => {
    const { container } = render(<ItemDetails item={item} facts={facts(item)} />)
    expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'Status',
      'When it applies',
      'Check again by',
      'Source',
      'Cause',
      'Risk',
      'Who can see it',
      'Owner',
      'Written by',
      'Confirmed',
      'Version',
    ])
    expect(screen.getByText('Not assigned')).toBeVisible()
    expect(screen.getAllByText('Not recorded')).toHaveLength(2)
    expect(container).not.toHaveTextContent(item.id)
  })
  it('does not present an archived fact’s old check date as its next one', () => {
    const retired = { ...item, status: 'retired' as const }
    render(<ItemDetails item={retired} facts={facts(retired)} />)
    expect(
      within(screen.getByText('Check again by').parentElement!).getByRole('definition'),
    ).toHaveTextContent('Not set')
  })
  it('distinguishes loading confirmation from missing history', () => {
    render(<ItemDetails item={item} facts={{ ...facts(item), historyPending: true }} />)
    expect(
      within(screen.getByText('Confirmed').parentElement!).getByRole('definition'),
    ).toHaveTextContent('Loading')
  })
})
