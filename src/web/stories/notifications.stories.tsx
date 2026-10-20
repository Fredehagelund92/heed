import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import type { InboxItem } from '@/api'
import {
  NotificationsView,
  type InboxView,
  type NotificationsViewProps,
} from '@/components/app-shell/notifications-panel'
import { RouterFrame } from './router-frame'
import { StoryApp } from './story-app'

/*
  The notifications under the header's bell (slice W7) in every state: unread and read, long
  titles, a change from the definition source, an edition, the archive, nothing yet, loading,
  a failed load, more to load and live updates paused. Then the bell in the app, on the mock:
  open it and follow a notification. Use the viewport menu for 1440, 1024 and 390 and the theme
  menu for light and dark.
*/

const meta = {
  title: 'Notifications/Inbox',
  parameters: { layout: 'padded' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const jon = { id: 'per_jon', name: 'Jon Abara' }
const maria = { id: 'per_maria', name: 'Maria Lindqvist' }

const at = (n: number) => `00000000-0000-4000-9000-${n.toString(16).padStart(12, '0')}`
const proposal = (id: number) => ({ type: 'proposal', id: `00000000-0000-4000-8000-${id}` })

const items: InboxItem[] = [
  {
    id: at(9),
    kind: 'proposal.decided',
    at: '2026-10-07T09:12:00.000Z',
    areaId: 'area_sales',
    subject: proposal(1),
    state: 'changes_requested',
    title: 'Online sales to Norway stopped on 4 August 2026 after a new customs rule.',
    actor: jon,
    note: 'Add the customs notice as the source, and say which markets the stop covers.\nThe press article alone is not enough.',
    readAt: null,
    archivedAt: null,
  },
  {
    id: at(8),
    kind: 'proposal.claimed',
    at: '2026-10-07T08:40:00.000Z',
    areaId: 'area_sales',
    subject: proposal(2),
    state: 'in_review',
    title: 'Units sold lags by two days in the source tool',
    actor: jon,
    note: null,
    readAt: null,
    archivedAt: null,
  },
  {
    id: at(7),
    kind: 'item.flagged',
    at: '2026-10-06T16:02:00.000Z',
    areaId: 'area_sales',
    subject: { type: 'item', id: 'itm_jyfuvl07' },
    state: 'source_changed',
    title: 'Net revenue excludes discount costs from the week of a campaign launch',
    actor: null,
    note: null,
    readAt: null,
    archivedAt: null,
  },
  {
    id: at(6),
    kind: 'proposal.commented',
    at: '2026-10-06T10:30:00.000Z',
    areaId: 'area_sales',
    subject: proposal(1),
    state: 'in_review',
    title: 'Online sales to Norway stopped on 4 August 2026 after a new customs rule.',
    actor: maria,
    note: null,
    readAt: '2026-10-06T11:00:00.000Z',
    archivedAt: null,
  },
  {
    id: at(5),
    kind: 'proposal.decided',
    at: '2026-10-02T11:52:00.000Z',
    areaId: 'area_sales',
    subject: proposal(3),
    state: 'accepted',
    title: 'First-time buyers excludes test accounts and accounts closed within a day.',
    actor: jon,
    note: null,
    readAt: '2026-10-02T12:00:00.000Z',
    archivedAt: null,
  },
  {
    id: at(4),
    kind: 'proposal.handed_over',
    at: '2026-10-01T14:05:00.000Z',
    areaId: 'area_sandbox',
    subject: proposal(4),
    state: 'in_review',
    title: null,
    actor: { id: 'per_sofia', name: 'Sofia Brandt' },
    note: null,
    readAt: '2026-10-01T15:00:00.000Z',
    archivedAt: null,
  },
]

const initials = (item: InboxItem) =>
  item.actor
    ? item.actor.name
        .split(' ')
        .map((word) => word[0])
        .join('')
    : null

/** The popover's frame, as the header opens it, around the data-free view. */
function Inbox({ start, ...props }: Partial<NotificationsViewProps> & { start?: InboxView }) {
  const [view, setView] = useState<InboxView>(start ?? 'all')
  const [shown, setShown] = useState(props.items ?? items)
  const unread = props.unread ?? shown.filter((item) => !item.readAt && !item.archivedAt).length
  return (
    <RouterFrame>
      <div
        role="dialog"
        aria-label="Notifications"
        className="w-inbox max-w-full overflow-hidden rounded-lg bg-popover text-dense text-popover-foreground shadow-raised ring-1 ring-foreground/10"
      >
        <NotificationsView
          view={view}
          onViewChange={setView}
          unread={unread}
          items={shown}
          state="ready"
          onRetry={() => undefined}
          more={false}
          loadingMore={false}
          onMore={() => undefined}
          offline={false}
          initials={initials}
          opensEditions
          onOpen={(item) =>
            setShown((current) =>
              current.map((other) =>
                other.id === item.id ? { ...other, readAt: '2026-10-07T12:00:00.000Z' } : other,
              ),
            )
          }
          onArchive={(item) =>
            setShown((current) => current.filter((other) => other.id !== item.id))
          }
          onReadAll={() =>
            setShown((current) =>
              current.map((item) => ({ ...item, readAt: item.readAt ?? '2026-10-07T12:00:00Z' })),
            )
          }
          {...props}
        />
      </div>
    </RouterFrame>
  )
}

export const Unread: Story = { render: () => <Inbox /> }

export const AllRead: Story = {
  render: () => (
    <Inbox items={items.map((item) => ({ ...item, readAt: item.readAt ?? item.at }))} />
  ),
}

export const Archived: Story = {
  render: () => (
    <Inbox
      start="archived"
      unread={2}
      items={items
        .slice(3)
        .map((item) => ({ ...item, archivedAt: '2026-10-07T12:00:00.000Z', readAt: item.at }))}
    />
  ),
}

export const NothingYet: Story = { render: () => <Inbox items={[]} /> }
export const NothingArchived: Story = {
  render: () => <Inbox start="archived" items={[]} unread={2} />,
}
export const Loading: Story = { render: () => <Inbox state="loading" items={[]} /> }
export const LoadFailed: Story = { render: () => <Inbox state="failed" items={[]} /> }
export const MoreToLoad: Story = { render: () => <Inbox more /> }
export const LoadingMore: Story = { render: () => <Inbox more loadingMore /> }
export const LiveUpdatesPaused: Story = { render: () => <Inbox offline /> }

/** Reading and archiving with the keyboard: Mark all read clears the count, Archive removes. */
export const ReadAndArchive: Story = {
  render: () => <Inbox />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', {
        name: /^Archive: Jon Abara claimed the review/,
      }),
    )
    await waitFor(() =>
      expect(canvas.queryByText('Units sold lags by two days in the source tool')).toBeNull(),
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Mark all read' }))
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Mark all read' })).toBeDisabled(),
    )
  },
}

/** The bell in the app on the mock, as Maria: open it to see her week's notifications. */
export const InTheApp: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => <StoryApp path="/proposals" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const bell = await canvas.findByRole('button', { name: /^Notifications, \d+ unread$/ })
    await userEvent.click(bell)
    const body = within(canvasElement.ownerDocument.body)
    await body.findByRole('heading', { name: 'Notifications' })
    await body.findAllByText(/claimed the review/)
  },
}

/** Jon, an owner: the sidebar counts the proposals that wait for him. */
export const OwnerCount: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => <StoryApp path="/library" person="per_jon" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByLabelText(/^\d+ to review$/)
  },
}
