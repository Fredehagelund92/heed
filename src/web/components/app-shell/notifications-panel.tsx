import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { proposalStates, type ProposalState } from '@domain/proposal-state'
import type { InboxItem } from '@/api'
import { useInboxEdit } from '@/api/inbox'
import { inboxPagesQuery, inboxUnreadQuery, peopleQuery, type InboxFilter } from '@/api/queries'
import {
  ArchiveIcon,
  BellIcon,
  CheckCheckIcon,
  CloudOffIcon,
  HeedSourceChangedIcon,
  RefreshCwIcon,
  type Icon,
} from '@/components/icons'
import { CountBadge, proposalStateLook } from '@/components/item/item-marks'
import { PersonAvatar } from '@/components/person-avatar'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useLiveStatus } from '@/hooks/use-live-updates'
import { formatMoment } from '@/lib/library'
import { proposalStateNames } from '@/lib/proposals'
import {
  notificationSentence,
  notificationTarget,
  sentenceText,
  sentenceWithNote,
  type NotificationTarget,
} from '@/lib/notifications'
import { showToast } from '@/lib/toast'
import { usePermissions } from '@/lib/use-session'
import { cn } from '@/lib/utils'

/*
  The notifications list under the header's bell (front end plan, slice W7): what happened to the
  person's proposals and to what they review or own, newest first. A notification opens what it
  is about and is read from then on; reading and archiving are optimistic (contract 9.3). The
  Archived view keeps what the person put away.
*/

const views: { id: Extract<InboxFilter, 'all' | 'archived'>; title: string }[] = [
  { id: 'all', title: 'Inbox' },
  { id: 'archived', title: 'Archived' },
]

/** Initials from a name, for a person the people list does not hold (an erased name is null). */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/)
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? (words.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

/** Who acted, as an avatar, or the source's glyph for a change nobody made by hand. */
function Who({ item, initials }: { item: InboxItem; initials: string | null }) {
  const sentence = notificationSentence(item)
  if (sentence.actor && initials)
    return (
      <PersonAvatar
        person={{ id: item.actor?.id, name: sentence.actor, initials }}
        size="sm"
        decorative
      />
    )
  return (
    <span
      aria-hidden="true"
      className="flex size-avatar-row shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
    >
      <HeedSourceChangedIcon className="size-icon-sm" />
    </span>
  )
}

/** The proposal's state when it happened, as its glyph and words, muted. */
function StateNote({ state }: { state: ProposalState }) {
  const Glyph: Icon = proposalStateLook[state].glyph
  return (
    <span className="inline-flex items-center gap-1">
      <Glyph aria-hidden="true" className="size-icon-sm" />
      {proposalStateNames[state]}
    </span>
  )
}

const isProposalState = (state: string): state is ProposalState =>
  (proposalStates as readonly string[]).includes(state)

function NotificationRow({
  item,
  initials,
  opensEditions,
  onOpen,
  onArchive,
}: {
  item: InboxItem
  initials: string | null
  opensEditions: boolean
  onOpen: (item: InboxItem) => void
  onArchive: (item: InboxItem) => void
}) {
  const sentence = notificationSentence(item)
  const target = notificationTarget(item.subject, opensEditions)
  const unread = !item.readAt && !item.archivedAt
  const state =
    item.subject.type === 'proposal' && item.state && isProposalState(item.state)
      ? item.state
      : null
  // What happened on one line, the subject's title under it: titles are often whole sentences.
  // The link's name is the sentence as one line of text, so it reads the same everywhere.
  // What the reviewer wrote with the decision, its first line, so the reason is read here.
  const note = item.note?.trim().split('\n')[0]?.trim() || null
  const name = `${unread ? 'Unread: ' : ''}${sentenceWithNote(sentence, note)}`
  const words = (
    <>
      <span className="block">
        {sentence.actor ? (
          <span className="font-bold text-foreground">{sentence.actor} </span>
        ) : null}
        {sentence.action}
      </span>
      {sentence.subject ? (
        <span className="line-clamp-2 font-bold text-foreground">{sentence.subject}</span>
      ) : null}
      {note ? (
        <span data-slot="notification-note" className="truncate text-muted-foreground">
          “{note}”
        </span>
      ) : null}
    </>
  )
  const text = cn(
    'flex flex-col gap-1 text-left text-dense outline-none after:absolute after:inset-0 focus-visible:outline-none',
    unread ? 'text-foreground' : 'text-muted-foreground',
  )
  return (
    <li
      data-slot="notification"
      data-unread={unread || undefined}
      className="group/note relative flex items-start gap-2 px-4 py-3 -outline-offset-2 hover:bg-accent has-[[data-row-link]:focus-visible]:outline-2 has-[[data-row-link]:focus-visible]:outline-ring"
    >
      <span className="flex h-avatar-row w-2 shrink-0 items-center" aria-hidden="true">
        {unread ? <span className="size-2 rounded-full bg-status-info-icon" /> : null}
      </span>
      <Who item={item} initials={initials} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {target ? (
          <Link
            {...(target as NotificationTarget & { to: '/proposals/$proposalId' })}
            data-row-link
            aria-label={name}
            onClick={() => onOpen(item)}
            className={text}
          >
            {words}
          </Link>
        ) : (
          <button
            type="button"
            data-row-link
            aria-label={name}
            onClick={() => onOpen(item)}
            className={text}
          >
            {words}
          </button>
        )}
        <p className="flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground tabular-nums">
          {state ? (
            <>
              <StateNote state={state} />
              <span aria-hidden="true">·</span>
            </>
          ) : null}
          <time dateTime={item.at} title={formatMoment(item.at, 'long')}>
            {formatMoment(item.at)}
          </time>
        </p>
      </div>
      {item.archivedAt ? null : (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Archive: ${sentenceText(sentence)}`}
          title="Archive"
          onClick={() => onArchive(item)}
          className="relative shrink-0 text-muted-foreground pointer-fine:opacity-0 pointer-fine:group-focus-within/note:opacity-100 pointer-fine:group-hover/note:opacity-100"
        >
          <ArchiveIcon />
        </Button>
      )}
    </li>
  )
}

function RowsLoading() {
  return (
    <div role="status" aria-label="Loading notifications" className="flex flex-col">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-start gap-2 px-4 py-3">
          <span className="w-2 shrink-0" />
          <Skeleton className="size-6 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

function Nothing({ archived }: { archived: boolean }) {
  return (
    <Empty className="gap-3 px-4 py-8">
      <EmptyHeader>
        <EmptyMedia variant="icon">{archived ? <ArchiveIcon /> : <BellIcon />}</EmptyMedia>
        <EmptyTitle>{archived ? 'Nothing archived' : "You're all caught up"}</EmptyTitle>
        <EmptyDescription>
          {archived
            ? "Notifications you archive move here, so the inbox keeps only what's new."
            : 'When someone reviews a proposal of yours, or sends you one to review, it shows here.'}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 px-4 py-6">
      <p className="text-dense">
        <span className="font-bold">We couldn't load your notifications.</span> Nothing was lost.
        Check your connection, then try again.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCwIcon />
        Try again
      </Button>
    </div>
  )
}

export type InboxView = (typeof views)[number]['id']

export type NotificationsViewProps = {
  view: InboxView
  onViewChange: (view: InboxView) => void
  /** Unread across the whole inbox. */
  unread: number
  items: readonly InboxItem[]
  /** Loading the first page, it failed with nothing to show, or the list is there. */
  state: 'loading' | 'failed' | 'ready'
  onRetry: () => void
  /** Older notifications exist past this page. */
  more: boolean
  loadingMore: boolean
  onMore: () => void
  /** Live updates paused: the app checks every minute instead. */
  offline: boolean
  initials: (item: InboxItem) => string | null
  /** Whether the person may open an edition's page, so an edition's notification links to it. */
  opensEditions: boolean
  onOpen: (item: InboxItem) => void
  onArchive: (item: InboxItem) => void
  onReadAll: () => void
}

/**
 * The bell's popover as it looks in every state: the header with the unread count and Mark all
 * read, the Inbox and Archived tabs, and the list. Data-free, so a story or a test can show any
 * state; `NotificationsPanel` connects it.
 */
export function NotificationsView({
  view,
  onViewChange,
  unread,
  items,
  state,
  onRetry,
  more,
  loadingMore,
  onMore,
  offline,
  initials,
  opensEditions,
  onOpen,
  onArchive,
  onReadAll,
}: NotificationsViewProps) {
  const body =
    state === 'loading' ? (
      <RowsLoading />
    ) : state === 'failed' ? (
      <LoadFailed onRetry={onRetry} />
    ) : items.length === 0 ? (
      <Nothing archived={view === 'archived'} />
    ) : (
      <ul
        aria-label={view === 'archived' ? 'Archived notifications' : 'Notifications'}
        className="divide-y"
      >
        {items.map((item) => (
          <NotificationRow
            key={item.id}
            item={item}
            initials={initials(item)}
            opensEditions={opensEditions}
            onOpen={onOpen}
            onArchive={onArchive}
          />
        ))}
      </ul>
    )
  return (
    <div className="flex min-h-0 flex-col" data-slot="notifications-panel">
      <div className="flex items-center gap-2 px-4 pt-3">
        <h2 className="text-body font-bold">Notifications</h2>
        {unread ? (
          <span className="inline-flex items-center gap-1 text-caption text-muted-foreground">
            <CountBadge count={unread} tone="ink" />
            unread
          </span>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-muted-foreground"
          disabled={!unread}
          onClick={onReadAll}
        >
          <CheckCheckIcon />
          Mark all read
        </Button>
      </div>
      <Tabs
        value={view}
        onValueChange={(next: InboxView) => onViewChange(next)}
        className="min-h-0 gap-0"
      >
        <TabsList variant="line" className="w-full justify-start border-b px-2">
          {views.map((option) => (
            <TabsTrigger key={option.id} value={option.id}>
              {option.title}
            </TabsTrigger>
          ))}
        </TabsList>
        {views.map((option) => (
          <TabsContent
            key={option.id}
            value={option.id}
            className="max-h-inbox-list min-h-0 overflow-y-auto overscroll-contain"
          >
            {body}
            {more ? (
              <div className="border-t px-4 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  disabled={loadingMore}
                  onClick={onMore}
                >
                  {loadingMore ? 'Loading older notifications' : 'Show older notifications'}
                </Button>
              </div>
            ) : null}
          </TabsContent>
        ))}
      </Tabs>
      {offline ? (
        <p className="flex items-center gap-2 border-t px-4 py-2 text-caption text-muted-foreground">
          <CloudOffIcon aria-hidden="true" className="size-icon-sm shrink-0" />
          Live updates are paused. We check for news every minute.
        </p>
      ) : null}
    </div>
  )
}

/** The bell's popover on the inbox: reads a page at a time, reads and archives optimistically. */
export function NotificationsPanel({ onNavigate }: { onNavigate: () => void }) {
  const [view, setView] = useState<InboxView>('all')
  const pages = useInfiniteQuery(inboxPagesQuery(view))
  const { data: bell } = useQuery(inboxUnreadQuery())
  const { data: people = [] } = useQuery(peopleQuery())
  const live = useLiveStatus()
  const opensEditions = usePermissions().isFor('administrators')
  const edit = useInboxEdit({
    onError: () =>
      showToast("Couldn't update your notifications", 'We undid the change. Try again.'),
  })
  const items = pages.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <NotificationsView
      view={view}
      onViewChange={setView}
      unread={bell?.unread ?? 0}
      items={items}
      state={pages.isPending ? 'loading' : pages.isError && !items.length ? 'failed' : 'ready'}
      onRetry={() => void pages.refetch()}
      more={pages.hasNextPage}
      loadingMore={pages.isFetchingNextPage}
      onMore={() => void pages.fetchNextPage()}
      offline={live === 'offline'}
      opensEditions={opensEditions}
      initials={(item) => {
        if (!item.actor) return null
        const person = people.find((candidate) => candidate.id === item.actor?.id)
        return person?.initials ?? initialsOf(item.actor.name)
      }}
      onOpen={(item) => {
        if (!item.readAt) edit.mutate({ action: 'read', ids: [item.id] })
        if (notificationTarget(item.subject, opensEditions)) onNavigate()
      }}
      onArchive={(item) => edit.mutate({ action: 'archive', ids: [item.id] })}
      onReadAll={() => edit.mutate({ action: 'read-all' })}
    />
  )
}
