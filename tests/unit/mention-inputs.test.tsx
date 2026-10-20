import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Scope } from '@domain/item'
import { createQueryClient } from '@/api/query-client'
import { MentionChip } from '@/components/item/mention-chip'
import { MentionText } from '@/components/mentions/mention-text'
import { ScopeInput } from '@/components/mentions/scope-input'
import { buildMentionTargets, targetsByKey } from '@/lib/mention-targets'
import { areas, vocabulary } from '@/mocks/reference-data'

const targets = buildMentionTargets({ vocabulary, areas })
const empty: Scope = { metrics: [], dimensions: [], dimensionValues: [] }

function Harness({
  initial = empty,
  onScope,
  onRequestTerm,
}: {
  initial?: Scope
  onScope?: (scope: Scope) => void
  onRequestTerm?: (words: string) => void
}) {
  const [scope, setScope] = useState(initial)
  return (
    <QueryClientProvider client={createQueryClient()}>
      <ScopeInput
        aria-label="Where it applies"
        value={scope}
        onRequestTerm={onRequestTerm}
        onChange={(next) => {
          setScope(next)
          onScope?.(next)
        }}
      />
    </QueryClientProvider>
  )
}

/** The picker searches the (mock) service, so its rows arrive after typing rests. */
const findOption = (name: RegExp | string) =>
  screen.findByRole('option', { name }, { timeout: 5000 })

describe('ScopeInput', () => {
  it('lists nothing until the person types', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const field = screen.getByRole('combobox', { name: 'Where it applies' })
    await user.click(field)
    expect(field).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('option')).toBeNull()
  })

  it('adds a value by another name and says which name it is', async () => {
    const user = userEvent.setup()
    const onScope = vi.fn()
    render(<Harness onScope={onScope} />)
    const field = screen.getByRole('combobox', { name: 'Where it applies' })
    await user.type(field, 'Norge')
    const option = await findOption(/^Norway/)
    expect(field).toHaveAttribute('aria-expanded', 'true')
    expect(option).toHaveTextContent('also called Norge')
    await user.click(option)
    expect(onScope).toHaveBeenLastCalledWith({
      metrics: [],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
    })
    expect(field).toHaveValue('')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Added Market Norway. Norge is another name for Norway.',
    )
    const chips = screen.getByRole('list', { name: 'Chosen' })
    expect(within(chips).getByText('Norway')).toBeInTheDocument()
  })

  it('picks a dimension on its own as any value, and reads the chip naturally', async () => {
    const user = userEvent.setup()
    const onScope = vi.fn()
    render(<Harness onScope={onScope} />)
    await user.type(screen.getByRole('combobox'), 'market')
    const group = await screen.findByRole('group', { name: /Market, 12 values/ }, { timeout: 5000 })
    await user.click(within(group).getByRole('option', { name: /Any market/ }))
    expect(onScope).toHaveBeenLastCalledWith({
      metrics: [],
      dimensions: ['dim:market'],
      dimensionValues: [],
    })
    const chips = screen.getByRole('list', { name: 'Chosen' })
    expect(chips).toHaveTextContent('Any market')
    expect(screen.getByRole('button', { name: 'Remove any market' })).toBeInTheDocument()
  })

  it('moves through the rows with the arrows and adds by Enter', async () => {
    const user = userEvent.setup()
    const onScope = vi.fn()
    render(<Harness onScope={onScope} />)
    const field = screen.getByRole('combobox')
    await user.type(field, 'orders')
    await findOption(/^Orders/)
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(field).toHaveAttribute('aria-activedescendant', options[0]!.id)
    await user.keyboard('{Enter}')
    expect(onScope).toHaveBeenLastCalledWith({
      metrics: ['metric:orders'],
      dimensions: [],
      dimensionValues: [],
    })
  })

  it('groups thousands of values by dimension with a count and searches inside one', async () => {
    const user = userEvent.setup()
    const onScope = vi.fn()
    render(<Harness onScope={onScope} />)
    const field = screen.getByRole('combobox')
    await user.type(field, 'spring')
    const more = await findOption(/Search all 240 in Campaign/)
    expect(screen.getByRole('group', { name: /Campaign, 240 matches/ })).toBeInTheDocument()
    // A few values per dimension, never the whole list.
    expect(screen.getAllByRole('option').length).toBeLessThanOrEqual(14)
    await user.click(more)
    expect(screen.getByRole('listbox', { name: 'Values of Campaign' })).toBeInTheDocument()
    // The words that matched the values keep searching them inside the dimension.
    expect(field).toHaveValue('spring')
    await findOption(/Next page/)
    expect(screen.getByRole('listbox')).toHaveTextContent('1 to 12 of 240 matches')
    await user.click(screen.getByRole('option', { name: /Next page/ }))
    await waitFor(() =>
      expect(screen.getByRole('listbox')).toHaveTextContent('13 to 24 of 240 matches'),
    )
    await user.type(field, ' norway 2026 video')
    await user.click(await findOption(/^Norway Spring Sale 2026 Video/))
    expect(onScope).toHaveBeenLastCalledWith({
      metrics: [],
      dimensions: [],
      dimensionValues: [
        { dimension: 'dim:campaign', value: 'val:campaign/norway_spring_sale_2026_video' },
      ],
    })
    // Inside a dimension the list stays open for the next value; Backspace leaves it.
    await user.clear(field)
    await user.keyboard('{Backspace}')
    expect(screen.getByRole('status')).toHaveTextContent('Left Campaign. Searching everything.')
  })

  it('opens a dimension from its row with the right arrow', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const field = screen.getByRole('combobox')
    await user.type(field, 'product')
    await findOption(/Any product/)
    await user.keyboard('{ArrowRight}')
    expect(await screen.findByRole('listbox', { name: 'Values of Product' })).toBeInTheDocument()
    expect(await findOption(/^Footwear/)).toBeInTheDocument()
  })

  it('adds a pasted list and names what it could not find', async () => {
    const user = userEvent.setup()
    const onScope = vi.fn()
    render(<Harness onScope={onScope} />)
    const field = screen.getByRole('combobox')
    await user.click(field)
    await user.paste('Norway\nHispania\nPolska, Orders; Xland')
    await waitFor(() =>
      expect(onScope).toHaveBeenLastCalledWith({
        metrics: ['metric:orders'],
        dimensions: [],
        dimensionValues: [
          { dimension: 'dim:market', value: 'val:market/norway' },
          { dimension: 'dim:market', value: 'val:market/poland' },
        ],
      }),
    )
    expect(screen.getByText('Added 3 names.')).toBeInTheDocument()
    expect(screen.getByText('Not found (2)')).toBeInTheDocument()
    expect(screen.getByText('Hispania, Xland')).toBeInTheDocument()
  })

  it('adds a typed list from Add a list', async () => {
    const user = userEvent.setup()
    const onScope = vi.fn()
    render(<Harness onScope={onScope} />)
    await user.click(screen.getByRole('button', { name: 'Add a list' }))
    await user.type(screen.getByRole('textbox', { name: 'Names to add' }), 'Units sold, Germany')
    await user.click(screen.getByRole('button', { name: 'Add these' }))
    await waitFor(() =>
      expect(onScope).toHaveBeenLastCalledWith({
        metrics: ['metric:units_sold'],
        dimensions: [],
        dimensionValues: [{ dimension: 'dim:market', value: 'val:market/germany' }],
      }),
    )
  })

  it('folds chips after eight into +N more', async () => {
    const user = userEvent.setup()
    const markets = vocabulary.dimensions[0]!.values.slice(0, 11)
    render(
      <Harness
        initial={{
          metrics: [],
          dimensions: [],
          dimensionValues: markets.map((market) => ({
            dimension: 'dim:market',
            value: `val:market/${market.id}`,
          })),
        }}
      />,
    )
    const chips = screen.getByRole('list', { name: 'Chosen' })
    expect(within(chips).getAllByRole('listitem')).toHaveLength(8)
    await user.click(screen.getByRole('button', { name: '+3 more' }))
    expect(within(chips).getAllByRole('listitem')).toHaveLength(11)
    expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('never accepts an unknown word and offers to ask an owner', async () => {
    const user = userEvent.setup()
    const onRequestTerm = vi.fn()
    const onScope = vi.fn()
    render(<Harness onScope={onScope} onRequestTerm={onRequestTerm} />)
    await user.type(screen.getByRole('combobox'), 'Narnia')
    await findOption(/Ask an owner to add/)
    await user.keyboard('{Enter}')
    expect(onScope).not.toHaveBeenCalled()
    expect(onRequestTerm).toHaveBeenCalledWith('Narnia')
  })

  it('says a term is already chosen instead of offering to ask for it', async () => {
    const user = userEvent.setup()
    const onRequestTerm = vi.fn()
    render(
      <Harness
        onRequestTerm={onRequestTerm}
        initial={{ metrics: ['metric:units_sold'], dimensions: [], dimensionValues: [] }}
      />,
    )
    await user.type(screen.getByRole('combobox'), 'Units sold')
    await waitFor(() =>
      expect(screen.getByRole('listbox')).toHaveTextContent('Units sold is already chosen.'),
    )
    // The message is the listbox's one option, and it cannot be chosen.
    expect(screen.getByRole('option')).toHaveAttribute('aria-disabled', 'true')
  })

  it('says there is no match when nobody can be asked', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByRole('combobox'), 'Narnia')
    await waitFor(() =>
      expect(screen.getByRole('listbox')).toHaveTextContent(
        'Nothing matches. This lists only the names in the catalogue. An admin adds them in Administration › Sources.',
      ),
    )
    expect(screen.getByRole('option')).toHaveAttribute('aria-disabled', 'true')
  })

  it('selects the last chip on Backspace and removes it on the second', async () => {
    const user = userEvent.setup()
    const onScope = vi.fn()
    render(
      <Harness
        onScope={onScope}
        initial={{
          metrics: ['metric:units_sold'],
          dimensions: [],
          dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
        }}
      />,
    )
    await screen.findByText('Norway', {}, { timeout: 5000 })
    await user.click(screen.getByRole('combobox'))
    await user.keyboard('{Backspace}')
    expect(onScope).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Market Norway selected. Press Backspace again to remove it.',
    )
    await user.keyboard('{Backspace}')
    expect(onScope).toHaveBeenLastCalledWith({
      metrics: ['metric:units_sold'],
      dimensions: [],
      dimensionValues: [],
    })
  })

  it('removes a chip with its button and reads each chip with its type', async () => {
    const user = userEvent.setup()
    const onScope = vi.fn()
    render(
      <Harness
        onScope={onScope}
        initial={{ metrics: ['metric:units_sold'], dimensions: [], dimensionValues: [] }}
      />,
    )
    await screen.findByText('Units sold', {}, { timeout: 5000 })
    expect(screen.getByText(', metric')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove Units sold' }))
    expect(onScope).toHaveBeenLastCalledWith(empty)
  })

  it('keeps a chip the vocabulary no longer holds and says its source is missing', async () => {
    render(
      <Harness
        initial={{ metrics: ['metric:gone_metric'], dimensions: [], dimensionValues: [] }}
      />,
    )
    expect(await screen.findByText('Source missing', {}, { timeout: 5000 })).toBeInTheDocument()
  })
})

describe('MentionChip states', () => {
  it('tells a screen reader the type and a state that is not current, without copying it', () => {
    const { container } = render(
      <>
        <MentionChip target={{ type: 'metric' }} name="Net revenue" />
        <MentionChip target={{ type: 'item', kind: 'note' }} name="Old note" status="retired" />
        <MentionChip target={{ type: 'val' }} name="Norway" status="source_changed" />
      </>,
    )
    const chips = container.querySelectorAll('[data-slot="mention-chip"]')
    expect(chips[0]).toHaveTextContent('Net revenue, metric')
    expect(chips[1]).toHaveTextContent('Old note, fact, archived')
    expect(chips[1]).toHaveClass('border-dashed')
    expect(chips[1]?.querySelector('.line-through')).toBeNull()
    expect(chips[2]).toHaveAttribute('data-status', 'source_changed')
    expect(chips[2]?.querySelector('[data-slot="mention-state"]')).not.toBeNull()
    expect(chips[0]?.querySelector('.sr-inline')).toHaveClass('select-none')
  })

  it('strikes a target whose source definition is missing', () => {
    render(<MentionChip target={{ type: 'metric' }} name="Net revenue" status="source_missing" />)
    expect(screen.getByText('Net revenue')).toHaveClass('line-through')
    expect(screen.getByTitle('Metric: Net revenue (its source definition is missing)')).toHaveClass(
      'border-dashed',
    )
  })
})

describe('MentionText', () => {
  it('renders tokens as chips with the author words and leaves malformed tokens as text', () => {
    const { container } = render(
      <p>
        <MentionText
          lookup={targetsByKey(targets)}
          markup="In @[the north](val:market/norway), see @[Gone](item:itm_missing01) and @[bad](cube:x)."
          statuses={{}}
        />
      </p>,
    )
    const chips = container.querySelectorAll('[data-slot="mention-chip"]')
    expect(chips).toHaveLength(2)
    expect(chips[0]).toHaveTextContent('the north, value')
    expect(chips[1]).toHaveAttribute('data-missing', 'true')
    expect(container).toHaveTextContent('and @[bad](cube:x).')
  })
})
