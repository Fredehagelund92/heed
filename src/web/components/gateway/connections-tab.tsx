import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import type { PersonConnection } from '@/api'
import { ApiError } from '@/api/errors'
import { aiConnectionsQuery, connectQuery, useApiWrite } from '@/api/queries'
import { ConfirmDialog } from '@/components/form/confirm-dialog'
import { HelpLink } from '@/components/help/help-link'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BotIcon,
  CalendarIcon,
  ClockIcon,
  HistoryIcon,
  ListChecksIcon,
  ListFilterIcon,
  PlugIcon,
  UnlinkIcon,
  UserRoundIcon,
  XIcon,
  type Icon,
} from '@/components/icons'
import { gridCell } from '@/components/page/grid'
import { PersonAvatar } from '@/components/person-avatar'
import {
  GridFailed,
  GridLoading,
  GridMessage,
  GridTable,
  gridRowClass,
} from '@/components/page/grid-table'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldItem,
  FieldItemContent,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { TruncatedText } from '@/components/ui/truncated-text'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useElementWidth } from '@/hooks/use-element-size'
import {
  appListWords,
  connectionCountWords,
  endsWords,
  connectionSortDefaults,
  connectionSortWords,
  disconnectReasons,
  scopeSummary,
  searchConnections,
  sortConnections,
} from '@/lib/connections'
import { connectionSorts, type ConnectionSort, type SortDirection } from '@/lib/connection-sorts'
import { formatDay, formatMoment } from '@/lib/library'
import type { AdminSearch } from '@/lib/search-params'
import { showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'

/*
  Every person's agents (FR-403, FR-807; security check F3), for an administrator. Each agent a
  person connects by signing in carries the one client label `signed-in`, so the Clients tab can
  only stop them all at once: here each connection is one agent for one person, with what it may
  do, when it connected and ends, and when it last got a token. Disconnect ends one, or every
  agent of that person, with a reason the history log keeps; the agent is refused from its next
  request, through the same path as the person's own Disconnect in Connect your AI.

  The search and the order are in the address (`q`, `sort`, `dir`), so a list is linkable. Rows
  are two lines: the person over their email address, the agent over where it came from, the day
  it connected over the day it ends. The grid's width budget, on the content box: the person and
  the agent take at least 160 each, the days 120, last used 120 and the button 128. Narrower, each
  connection is a row of a list, as on a phone. Below the table's 5xl width what an agent may do
  leaves its column for the line under the agent.
*/

const SLOT = 'ai-connections'
const GRID_MIN = 688
const wide = '@max-5xl:hidden'

type Column = { sort: ConnectionSort; icon: Icon; className: string }
const columns: Column[] = [
  { sort: 'person', icon: UserRoundIcon, className: 'min-w-0 flex-1' },
  { sort: 'app', icon: BotIcon, className: 'min-w-0 flex-1' },
  { sort: 'connected', icon: CalendarIcon, className: 'w-column-until' },
  { sort: 'used', icon: ClockIcon, className: 'w-column-changed' },
]

/** The order in the address, with the default left out of it. */
function orderOf(search: AdminSearch): { sort: ConnectionSort; dir: SortDirection } {
  const sort = search.sort ?? 'used'
  return { sort, dir: search.dir ?? connectionSortDefaults[sort] }
}

export function ConnectionsTab({ search }: { search: AdminSearch }) {
  const navigate = useNavigate()
  const connections = useQuery(aiConnectionsQuery())
  const connect = useQuery(connectQuery())
  const [content, setContent] = useState<HTMLElement | null>(null)
  const width = useElementWidth(content)
  const searchRef = useRef<HTMLInputElement>(null)
  const [disconnecting, setDisconnecting] = useState<PersonConnection | null>(null)
  const { sort, dir } = orderOf(search)

  const update = (patch: Partial<AdminSearch>, replace = false) =>
    void navigate({
      to: '/admin',
      search: { ...search, section: 'gateway', tab: 'connections', ...patch },
      replace,
      resetScroll: false,
    })
  const sortBy = (next: ConnectionSort, direction?: SortDirection) => {
    const nextDir =
      direction ?? (next === sort ? (dir === 'asc' ? 'desc' : 'asc') : connectionSortDefaults[next])
    const isDefault = next === 'used' && nextDir === connectionSortDefaults.used
    update(
      isDefault
        ? { sort: undefined, dir: undefined }
        : { sort: next, dir: nextDir === connectionSortDefaults[next] ? undefined : nextDir },
      true,
    )
  }

  // The words go to the address once typing rests; each key replaces the entry, so Back skips it.
  const [text, setText] = useState(search.q ?? '')
  const words = useDebouncedValue(text)
  const typedRef = useRef(search.q ?? '')
  useEffect(() => {
    if (words === typedRef.current) return
    typedRef.current = words
    update({ q: words.trim() ? words : undefined }, true)
    // Only when the words settle; `update` reads the address it was made with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words])
  const clear = () => {
    setText('')
    typedRef.current = ''
    update({ q: undefined }, true)
    searchRef.current?.focus()
  }

  const all = useMemo(() => connections.data ?? [], [connections.data])
  const shown = useMemo(
    () => sortConnections(searchConnections(all, search.q ?? ''), sort, dir),
    [all, search.q, sort, dir],
  )
  const appsOf = (personId: string) =>
    sortConnections(
      all.filter((connection) => connection.person.id === personId),
      'connected',
      'asc',
    )

  let body
  if (connections.isPending) body = <GridLoading slot={SLOT} label="Loading the agents" />
  else if (connections.isError)
    body = <GridFailed slot={SLOT} what="the agents" retry={() => void connections.refetch()} />
  else if (all.length === 0)
    body = (
      <GridMessage slot={SLOT} icon={PlugIcon} title="No agents are connected">
        {connect.data && !connect.data.signIn
          ? "Agents can't sign in here yet, so nobody can connect one by signing in."
          : 'An agent shows here once someone connects it by signing in.'}
      </GridMessage>
    )
  else if (shown.length === 0)
    body = (
      <GridMessage
        slot={SLOT}
        icon={ListFilterIcon}
        title="No agent matches"
        action={
          <Button variant="outline" onClick={clear}>
            <XIcon aria-hidden />
            Clear the search
          </Button>
        }
      >
        Try part of a name or an email address, or an agent&apos;s name or address.
      </GridMessage>
    )
  else
    body =
      width >= GRID_MIN ? (
        <ConnectionsGrid
          connections={shown}
          sort={sort}
          dir={dir}
          onSort={(next) => sortBy(next)}
          onDisconnect={setDisconnecting}
        />
      ) : (
        <ConnectionsList connections={shown} onDisconnect={setDisconnecting} />
      )

  return (
    <section
      ref={setContent}
      aria-labelledby="connections-title"
      className="flex min-w-0 flex-col gap-3"
      data-slot="settings-ai-connections"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="connections-title" className="text-large font-bold">
            Agents people connected
          </h2>
          <p className="max-w-reading text-dense text-muted-foreground">
            Every agent someone connected by signing in. An agent picks its own name, so check the
            address under it. A disconnected agent stops working from its next call.{' '}
            <HelpLink to="connect-an-agent">How connecting works</HelpLink>
          </p>
        </div>
        <Button
          variant="outline"
          render={<Link to="/admin" search={{ section: 'audit', action: 'ai_client' }} />}
        >
          <HistoryIcon aria-hidden />
          See the history
        </Button>
      </div>

      {/* The search and, where the column headers are hidden, the order. Each is 40 high. */}
      <div className="flex flex-wrap items-end gap-3" data-slot="ai-connections-filters">
        <Field name="q" className="min-w-0 flex-1 basis-column-about @3xl:max-w-column-title-min">
          <FieldLabel>Find a person or an agent</FieldLabel>
          <Input
            ref={searchRef}
            type="search"
            size="lg"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && text) {
                event.stopPropagation()
                setText('')
              }
            }}
            placeholder="Name, email or agent"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        {width < GRID_MIN ? (
          <Field
            name="sort"
            className="min-w-0 flex-1 basis-column-about @3xl:max-w-column-title-min"
          >
            <FieldLabel>Sort by</FieldLabel>
            <NativeSelect
              size="lg"
              value={`${sort} ${dir}`}
              onChange={(event) => {
                const [next, direction] = event.target.value.split(' ') as [
                  ConnectionSort,
                  SortDirection,
                ]
                sortBy(next, direction)
              }}
            >
              {connectionSorts.flatMap((option) =>
                (['asc', 'desc'] as const)
                  .toSorted((a) => (a === connectionSortDefaults[option] ? -1 : 1))
                  .map((direction) => (
                    <NativeSelectOption
                      key={`${option} ${direction}`}
                      value={`${option} ${direction}`}
                    >
                      {sortOptionWords(option, direction)}
                    </NativeSelectOption>
                  )),
              )}
            </NativeSelect>
          </Field>
        ) : null}
      </div>

      {body}
      {connections.data && all.length > 0 ? (
        <p
          className="text-dense text-muted-foreground"
          role="status"
          data-slot="ai-connections-count"
        >
          {connectionCountWords(shown, all)}
        </p>
      ) : null}

      {disconnecting ? (
        <DisconnectDialog
          connection={disconnecting}
          theirs={appsOf(disconnecting.person.id)}
          onClose={() => setDisconnecting(null)}
          onEnded={() => searchRef.current}
        />
      ) : null}
    </section>
  )
}

/** An order in the sort select's words: "Last used, newest first". */
function sortOptionWords(sort: ConnectionSort, dir: SortDirection) {
  const name = connectionSortWords[sort]
  if (sort === 'person' || sort === 'app') return `${name}, ${dir === 'asc' ? 'A to Z' : 'Z to A'}`
  return `${name}, ${dir === 'desc' ? 'newest first' : 'oldest first'}`
}

/** A column header that sorts the list (contract 8.1), with `aria-sort` on the sorted one. */
function SortHeader({
  column,
  sort,
  dir,
  onSort,
}: {
  column: Column
  sort: ConnectionSort
  dir: SortDirection
  onSort: (sort: ConnectionSort) => void
}) {
  const active = column.sort === sort
  const Glyph = column.icon
  return (
    <div
      role="columnheader"
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cn(gridCell, column.className)}
    >
      <button
        type="button"
        onClick={() => onSort(column.sort)}
        className={cn(
          'inline-flex h-control-sm min-w-0 items-center gap-2 rounded-sm -outline-offset-2 hover:text-foreground',
          active && 'text-foreground',
        )}
      >
        <Glyph aria-hidden="true" className="size-icon-sm shrink-0" />
        <span className="truncate">{connectionSortWords[column.sort]}</span>
        {active ? (
          dir === 'asc' ? (
            <ArrowUpIcon aria-hidden="true" className="size-icon-sm shrink-0" />
          ) : (
            <ArrowDownIcon aria-hidden="true" className="size-icon-sm shrink-0" />
          )
        ) : null}
      </button>
    </div>
  )
}

function ConnectionsGrid({
  connections,
  sort,
  dir,
  onSort,
  onDisconnect,
}: {
  connections: PersonConnection[]
  sort: ConnectionSort
  dir: SortDirection
  onSort: (sort: ConnectionSort) => void
  onDisconnect: (connection: PersonConnection) => void
}) {
  const [person, app, connected, used] = columns as [Column, Column, Column, Column]
  return (
    <GridTable
      slot={SLOT}
      label="Agents people connected"
      header={
        <>
          <SortHeader column={person} sort={sort} dir={dir} onSort={onSort} />
          <SortHeader column={app} sort={sort} dir={dir} onSort={onSort} />
          <div role="columnheader" className={cn(gridCell, 'w-column-about gap-2', wide)}>
            <ListChecksIcon aria-hidden="true" className="size-icon-sm shrink-0" />
            <span className="truncate">Can</span>
          </div>
          <SortHeader column={connected} sort={sort} dir={dir} onSort={onSort} />
          <SortHeader column={used} sort={sort} dir={dir} onSort={onSort} />
          <div role="columnheader" className={cn(gridCell, 'w-column-status')}>
            <span className="sr-only">Disconnect</span>
          </div>
        </>
      }
    >
      {connections.map((connection) => {
        const can = scopeSummary(connection.scopes)
        return (
          <div
            key={connection.id}
            role="row"
            data-row-id={connection.id}
            data-person={connection.person.id}
            className={gridRowClass}
          >
            <div role="cell" className={cn(gridCell, 'min-w-0 flex-1 gap-2 py-2')}>
              <span className={cn('inline-flex shrink-0', wide)}>
                <PersonAvatar person={connection.person} size="sm" decorative />
              </span>
              <span className="flex min-w-0 flex-col">
                <TruncatedText text={connection.person.name} className="text-body" />
                <TruncatedText
                  text={connection.person.email ?? 'No email address'}
                  className="text-muted-foreground"
                />
              </span>
            </div>
            <div role="cell" className={cn(gridCell, 'min-w-0 flex-1 py-2')}>
              <span className="flex min-w-0 flex-col">
                <TruncatedText text={connection.clientName} className="text-body" />
                <TruncatedText
                  text={`${connection.clientHost} · ${can}`}
                  className="text-muted-foreground"
                >
                  {connection.clientHost}
                  <span className="@5xl:hidden"> · {can}</span>
                </TruncatedText>
              </span>
            </div>
            <div role="cell" className={cn(gridCell, 'w-column-about py-2', wide)}>
              <span className="line-clamp-2">{can}</span>
            </div>
            <div role="cell" className={cn(gridCell, 'w-column-until py-2 tabular-nums')}>
              <span className="flex min-w-0 flex-col">
                <span title={formatMoment(connection.connectedAt, 'long')}>
                  {formatDay(connection.connectedAt)}
                </span>
                <span
                  className="text-muted-foreground"
                  title={formatMoment(connection.expiresAt, 'long')}
                >
                  {endsWords(connection.expiresAt)}
                </span>
              </span>
            </div>
            <div role="cell" className={cn(gridCell, 'w-column-changed tabular-nums')}>
              <span title={formatMoment(connection.lastUsedAt, 'long')}>
                {formatMoment(connection.lastUsedAt)}
              </span>
            </div>
            <div role="cell" className={cn(gridCell, 'w-column-status justify-end')}>
              <DisconnectButton connection={connection} onDisconnect={onDisconnect} />
            </div>
          </div>
        )
      })}
    </GridTable>
  )
}

/** One row per connection on a narrow page: the person, the agent, then what it may do and when. */
function ConnectionsList({
  connections,
  onDisconnect,
}: {
  connections: PersonConnection[]
  onDisconnect: (connection: PersonConnection) => void
}) {
  return (
    <ul
      aria-label="Agents people connected"
      data-slot={`${SLOT}-list`}
      className="flex flex-col divide-y rounded-lg border bg-card"
    >
      {connections.map((connection) => (
        <li
          key={connection.id}
          data-row-id={connection.id}
          data-person={connection.person.id}
          className="flex min-h-row-phone flex-col gap-1 py-3 pr-2 pl-4"
        >
          {/* The facts run under the agent and its button, in line with the agent's name. */}
          <div className="flex min-w-0 items-start gap-2">
            <PersonAvatar person={connection.person} size="sm" decorative />
            <p className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-row-phone">{connection.clientName}</span>
              <span className="truncate text-dense text-muted-foreground">
                {connection.person.name} · {connection.clientHost}
              </span>
            </p>
            <DisconnectButton connection={connection} onDisconnect={onDisconnect} />
          </div>
          <p className="flex flex-col pr-2 pl-8 text-dense text-muted-foreground">
            <span>{scopeSummary(connection.scopes)}</span>
            <span>
              Last used {formatMoment(connection.lastUsedAt)} · {endsWords(connection.expiresAt)}
            </span>
          </p>
        </li>
      ))}
    </ul>
  )
}

function DisconnectButton({
  connection,
  onDisconnect,
}: {
  connection: PersonConnection
  onDisconnect: (connection: PersonConnection) => void
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Disconnect ${connection.clientName} for ${connection.person.name}`}
      onClick={() => onDisconnect(connection)}
      data-slot="disconnect"
    >
      <UnlinkIcon aria-hidden />
      Disconnect
    </Button>
  )
}

/**
 * Disconnect one agent, or every agent of its person when they have more than one, with a reason
 * the history log keeps. The common reasons are chips; the words stay the administrator's.
 */
function DisconnectDialog({
  connection,
  theirs,
  onClose,
  onEnded,
}: {
  connection: PersonConnection
  /** Every agent of the person, in the order they connected them. */
  theirs: PersonConnection[]
  onClose: () => void
  /** Where the focus goes once the row is gone. */
  onEnded: () => HTMLElement | null
}) {
  const one = useApiWrite('disconnectAiConnection')
  const every = useApiWrite('disconnectPersonAiConnections')
  const [scope, setScope] = useState<'one' | 'all'>('one')
  // Read when the dialog closes, after the action: a ref, so the close sees what it just did.
  const ended = useRef(false)
  const person = connection.person.name
  const app = connection.clientName
  const many = theirs.length > 1
  const all = many && scope === 'all'
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={all ? `Disconnect all of ${person}’s agents?` : `Disconnect ${app} for ${person}?`}
      effect={
        all
          ? `${appListWords(theirs)} stop working for ${person} from their next call. ${person} can connect each again from the app.`
          : `${app} stops working for ${person} from its next call. ${person} can connect it again from the app.`
      }
      action={all ? `Disconnect ${theirs.length} agents` : 'Disconnect'}
      actionIcon={UnlinkIcon}
      tone="destructive"
      reason={{
        label: all ? 'Why are you disconnecting them?' : 'Why are you disconnecting it?',
        required: true,
        hint: `The history log keeps it with the disconnect. ${person} doesn’t see it.`,
        suggestions: disconnectReasons,
      }}
      finalFocus={() => (ended.current ? (onEnded() ?? true) : true)}
      onConfirm={async ({ reason }) => {
        try {
          if (all) {
            const { disconnected } = await every.mutateAsync({
              personId: connection.person.id,
              reason,
            })
            showToast(
              `${disconnected.toLocaleString('en')} ${disconnected === 1 ? 'Agent' : 'Agents'} disconnected`,
              `${person}’s agents stop working from their next call.`,
            )
          } else {
            await one.mutateAsync({ id: connection.id, reason })
            showToast(`${app} disconnected`, `It stops working for ${person} from its next call.`)
          }
        } catch (error) {
          // Someone else ended it first: the list catches up, and nothing is left to do.
          if (!(error instanceof ApiError && error.kind === 'not-found')) throw error
          showToast(`${app} was already disconnected`, "The list now shows what's still connected.")
        }
        ended.current = true
      }}
    >
      {many ? (
        <Field>
          <FieldSet
            render={
              <RadioGroup value={scope} onValueChange={(next) => setScope(next as 'one' | 'all')} />
            }
          >
            <FieldLegend>What to disconnect</FieldLegend>
            <FieldItem>
              <RadioGroupItem value="one" />
              <FieldItemContent>
                <FieldLabel>Only {app}</FieldLabel>
                <FieldDescription>{connection.clientHost}</FieldDescription>
              </FieldItemContent>
            </FieldItem>
            <FieldItem>
              <RadioGroupItem value="all" />
              <FieldItemContent>
                <FieldLabel>
                  All {theirs.length} of {person}’s agents
                </FieldLabel>
                <FieldDescription>{appListWords(theirs)}</FieldDescription>
              </FieldItemContent>
            </FieldItem>
          </FieldSet>
        </Field>
      ) : null}
    </ConfirmDialog>
  )
}
