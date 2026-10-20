import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CircleDashedIcon, ShapesIcon } from '@/components/icons'
import { FilterMenu, type FilterMenuField } from '@/components/page/filter-menu'

function fields(onChange = vi.fn()): FilterMenuField[] {
  const option = (key: string, name: string) => ({
    key,
    name,
    checked: false,
    count: 3,
    onChange,
    children: <span>{name}</span>,
  })
  return [
    {
      id: 'kind',
      title: 'Kind',
      icon: ShapesIcon,
      on: 0,
      options: [option('note', 'Note'), option('event', 'Event')],
    },
    {
      id: 'status',
      title: 'Status',
      icon: CircleDashedIcon,
      on: 0,
      options: [option('accepted', 'Accepted'), option('review', 'Check due')],
    },
  ]
}

describe('the Filter menu', () => {
  it('shows the fields as tabs and the chosen field’s values', () => {
    render(<FilterMenu fields={fields()} activeCount={0} open onOpenChange={() => {}} />)
    expect(screen.getByRole('tablist', { name: 'Filter by' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /^Note/ })).toBeInTheDocument()
  })

  it('lists the matching values of every field while a search is typed', () => {
    const onChange = vi.fn()
    render(<FilterMenu fields={fields(onChange)} activeCount={0} open onOpenChange={() => {}} />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a filter' }), {
      target: { value: 'ev' },
    })
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    const kind = screen.getByRole('region', { name: 'Kind' })
    expect(within(kind).getByRole('checkbox', { name: /^Event/ })).toBeInTheDocument()
    expect(within(kind).queryByRole('checkbox', { name: /^Note/ })).not.toBeInTheDocument()
    // "Check due" holds "ev" nowhere, so Status is left out.
    expect(screen.queryByRole('region', { name: 'Status' })).not.toBeInTheDocument()
    fireEvent.click(within(kind).getByRole('checkbox', { name: /^Event/ }))
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('lists a whole field when its name matches, and says when nothing does', () => {
    render(<FilterMenu fields={fields()} activeCount={0} open onOpenChange={() => {}} />)
    const field = screen.getByRole('searchbox', { name: 'Find a filter' })
    fireEvent.change(field, { target: { value: 'status' } })
    const status = screen.getByRole('region', { name: 'Status' })
    expect(within(status).getAllByRole('checkbox')).toHaveLength(2)
    fireEvent.change(field, { target: { value: 'zzz' } })
    expect(screen.getByRole('status')).toHaveTextContent('No filter matches “zzz”.')
  })

  it('names how many filters are on in its button', () => {
    render(<FilterMenu fields={fields()} activeCount={2} open={false} onOpenChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Filter, 2 on' })).toBeInTheDocument()
  })
})
