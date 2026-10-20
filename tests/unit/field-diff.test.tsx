import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FieldDiff } from '@/components/review/field-diff'
import { TermDiff } from '@/components/review/term-diff'
import { areas } from '@/mocks/reference-data'
import { RouterFrame } from '@/stories/router-frame'

const lookups = { targets: new Map(), areas, nameOf: () => null }

describe('the field diff', () => {
  it('keeps a field the screen does not know in view, so no change goes unseen', async () => {
    render(
      <RouterFrame>
        <FieldDiff
          diff={[
            { field: 'title', before: 'A', after: 'B' },
            { field: 'somethingNew', before: 1, after: 2 },
          ]}
          lookups={lookups}
          issue={false}
          liveVersion={1}
          change
        />
      </RouterFrame>,
    )
    const table = await screen.findByRole('table', { name: 'What changed, field by field' })
    const row = within(table).getByRole('row', { name: /somethingNew/ })
    expect(row).toHaveTextContent('1')
    expect(row).toHaveTextContent('2')
  })

  it('shows a new item without empty rows, and names what was left empty', async () => {
    render(
      <RouterFrame>
        <FieldDiff
          diff={[
            { field: 'title', before: null, after: 'Orders dropped' },
            // The stored default is no line of the proposer's own.
            { field: 'notToConclude', before: null, after: 'cause not proven' },
          ]}
          lookups={lookups}
          issue={false}
          liveVersion={null}
          change={false}
        />
      </RouterFrame>,
    )
    const table = await screen.findByRole('table', { name: 'What changed, field by field' })
    expect(within(table).queryByText('Not filled in')).toBeNull()
    expect(screen.getByText(/Not filled in: what not to conclude/)).toBeInTheDocument()
  })
})

describe('the term diff', () => {
  const live = {
    key: 'metric:net_revenue',
    kind: 'metric' as const,
    parentKey: null,
    name: 'Net revenue',
    aliases: ['Revenue'],
    areaId: null,
    definitionRefs: ['cube:revenue.net_revenue'],
  }

  it('shows only what changed, side by side, with the domain as a badge', async () => {
    render(
      <RouterFrame>
        <TermDiff
          term={{ before: live, after: { ...live, aliases: ['Net sales'], areaId: 'area_sales' } }}
          areas={areas}
          targets={new Map()}
        />
      </RouterFrame>,
    )
    const table = await screen.findByRole('table', { name: 'What changed' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Field', 'Today', 'Proposed'])
    expect(within(table).queryByRole('row', { name: /^Name/ })).toBeNull()
    const domain = within(table).getByRole('row', { name: /Domain/ })
    expect(within(domain).getByText('No domain')).toBeInTheDocument()
    expect(within(domain).getByText('Sales')).toBeInTheDocument()
    expect(screen.getByText(/2 fields stayed the same: name, linked to/)).toBeVisible()
    // The model link reads as the member, never the stored reference.
    expect(screen.queryByText('cube:revenue.net_revenue')).toBeNull()
  })

  it('shows a new term in one column', async () => {
    render(
      <RouterFrame>
        <TermDiff term={{ before: null, after: live }} areas={areas} targets={new Map()} />
      </RouterFrame>,
    )
    const table = await screen.findByRole('table', { name: 'The new name' })
    expect(within(table).getAllByRole('columnheader')).toHaveLength(2)
    expect(within(table).getByText('revenue.net_revenue')).toBeInTheDocument()
  })
})
