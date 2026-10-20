import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ReactNode } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { ApiError } from '@/api'
import { noteServiceVersion, resetOutdated } from '@/api/api-version'
import { CircleDashedIcon, LinkIcon, ShapesIcon } from '@/components/icons'
import { KindMark, StatusMark } from '@/components/item/item-marks'
import { defaultColumns } from '@/components/library/columns'
import { ColumnHeader } from '@/components/library/item-list'
import {
  ListEmpty,
  ListError,
  ListLoading,
  ListNoResults,
  ListStale,
} from '@/components/library/list-state'
import { SelectionBar, SelectionBarButton } from '@/components/page/selection-bar'
import { FilterMenu, type FilterMenuField } from '@/components/page/filter-menu'
import { Button } from '@/components/ui/button'

/**
 * The states of a list (contract 9.5) on their own. The first-run state needs the router; see
 * Library page, First run and Nearly empty. Each list state also shows in the real page there.
 */
const meta = {
  title: 'Library/List states',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** The grid's own header stays over the pulsing rows, so nothing moves when the rows arrive. */
export const Loading: Story = {
  render: () => {
    const columns = defaultColumns.filter((id) => id !== 'about')
    return (
      <ListLoading
        columns={columns}
        narrow={false}
        header={
          <ColumnHeader
            columns={columns}
            sortState={{ sort: 'updated', dir: 'desc' }}
            onSort={() => undefined}
            selection={{ selected: 0, total: 0, onToggleAll: () => undefined }}
          />
        }
      />
    )
  },
}

export const LoadingPhone: Story = {
  render: () => <ListLoading columns={[]} narrow rows={6} />,
  globals: { viewport: { value: 'phone', isRotated: false } },
}

export const EmptyView: Story = {
  render: () => (
    <ListEmpty title="Nothing to check" action={<Button variant="outline">Show all items</Button>}>
      Every fact is within its check date and its sources are in place.
    </ListEmpty>
  ),
}

export const NoResults: Story = {
  render: () => (
    <ListNoResults
      description="Nothing in Needs checking matches “closing date” with Kind: Event, Note; Domain: Sales."
      onClear={() => undefined}
    />
  ),
}

export const Error: Story = {
  render: () => <ListError onRetry={() => undefined} />,
}

/** The service answered with a failure of its own, so the connection is not to blame. */
export const ErrorOnTheService: Story = {
  render: () => (
    <ListError
      error={new ApiError('unavailable', 'Failed', { status: 500 })}
      onRetry={() => undefined}
    />
  ),
}

/**
 * The service runs other code than the app (api/api-version.ts): the advice replaces the
 * connection, here for a service started before an update.
 */
export const ErrorAfterAnUpdate: Story = {
  beforeEach: () => {
    noteServiceVersion('other', 'own', () => Promise.resolve(null))
    return resetOutdated
  },
  render: () => (
    <ListError
      title="We couldn't load your proposals"
      safe="Your proposals are safe."
      error={new ApiError('outdated', 'The app was updated.')}
      onRetry={() => undefined}
    />
  ),
}

export const Stale: Story = {
  render: () => <ListStale loadedAt="2026-10-07T12:02:00Z" onRetry={() => undefined} />,
}

export const SelectionBarStates: Story = {
  render: () => (
    <div className="flex h-dvh flex-col justify-end gap-16 pb-6">
      {[1, 12345].map((count) => (
        <SelectionBar key={count} count={count} onClear={() => undefined}>
          <SelectionBarButton onClick={() => undefined}>
            <LinkIcon />
            Copy links
          </SelectionBarButton>
        </SelectionBar>
      ))}
    </div>
  ),
}

function FilterMenuSample() {
  const [open, setOpen] = useState(false)
  const [on, setOn] = useState<string[]>(['event'])
  const toggle = (key: string) =>
    setOn((now) => (now.includes(key) ? now.filter((value) => value !== key) : [...now, key]))
  const option = (key: string, name: string, count: number, children: ReactNode) => ({
    key,
    name,
    checked: on.includes(key),
    count,
    onChange: () => toggle(key),
    children,
  })
  const fields: FilterMenuField[] = [
    {
      id: 'kind',
      title: 'Kind',
      icon: ShapesIcon,
      on: on.filter((key) => !key.startsWith('status:')).length,
      options: [
        option('note', 'Note', 433, <KindMark kind="note" className="text-foreground" />),
        option('event', 'Event', 470, <KindMark kind="event" className="text-foreground" />),
        option('guide', 'Guide', 296, <KindMark kind="guide" className="text-foreground" />),
      ],
    },
    {
      id: 'status',
      title: 'Status',
      icon: CircleDashedIcon,
      on: on.filter((key) => key.startsWith('status:')).length,
      options: [
        option(
          'status:accepted',
          'Accepted',
          1180,
          <StatusMark status="accepted" className="text-foreground" />,
        ),
      ],
    },
  ]
  return (
    <div className="p-6">
      <FilterMenu fields={fields} activeCount={on.length} open={open} onOpenChange={setOpen} />
    </div>
  )
}

/** The list pages' one Filter menu: a search field on top lists the matching values of every field. */
export const FilterMenuSearch: Story = {
  render: () => <FilterMenuSample />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Filter, 1 on' }))
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.type(await body.findByRole('searchbox', { name: 'Find a filter' }), 'ev')
    await expect(body.getByRole('region', { name: 'Kind' })).toBeInTheDocument()
    await expect(body.queryByRole('tablist', { name: 'Filter by' })).not.toBeInTheDocument()
  },
}
