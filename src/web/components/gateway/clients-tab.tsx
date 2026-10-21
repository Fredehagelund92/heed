import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { ClientPolicy } from '@/api'
import { clientsQuery, connectQuery, toolsQuery } from '@/api/queries'
import { LoadError } from '@/components/editions/load-error'
import {
  BotIcon,
  CircleCheckIcon,
  CircleSlashIcon,
  FileTextIcon,
  ListChecksIcon,
  PencilIcon,
  PlugIcon,
  PlusIcon,
  TimerIcon,
  type Icon,
} from '@/components/icons'
import { gridCell, gridRowControl } from '@/components/page/grid'
import { Badge } from '@/components/ui/badge'
import { BlockedButton } from '@/components/ui/blocked-button'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { useElementWidth } from '@/hooks/use-element-size'
import { answerSizeWords, clientToolsWords, limitsWords, rateWords } from '@/lib/gateway'
import { cn } from '@/lib/utils'
import { CopyBlock } from '@/components/try-it/copy-block'
import { ClientEditor } from './client-editor'

/*
  The width budget of the grid, on the content box: the client takes at least 200, its tools
  200 (column-about), requests a minute 128 (column-optional), answer size 156 (column-owner),
  the switch 128 (column-status) and the row button 40. Below that the clients are a list, one
  row each with its facts under the name, as on a phone.
*/
const GRID_MIN = 852

function HeaderCell({
  icon: Glyph,
  title,
  className,
}: {
  icon: Icon
  title: string
  className: string
}) {
  return (
    <div role="columnheader" className={cn(gridCell, className)}>
      <span className="inline-flex min-w-0 items-center gap-2">
        <Glyph aria-hidden className="size-icon-sm shrink-0 heed-ink" />
        <span className="truncate">{title}</span>
      </span>
    </div>
  )
}

/** Allowed to connect, or switched off: a calm fact either way. */
function ClientSwitch({ client, size = 'md' }: { client: ClientPolicy; size?: 'sm' | 'md' }) {
  return client.enabled ? (
    <Badge form="bare" tone="success" icon={CircleCheckIcon} size={size}>
      Allowed
    </Badge>
  ) : (
    <Badge form="bare" icon={CircleSlashIcon} size={size} quiet>
      Switched off
    </Badge>
  )
}

/** The client's name and label share the regular-weight grid and phone row roles. */
function ClientName({ client, phone = false }: { client: ClientPolicy; phone?: boolean }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className={cn('truncate font-normal', phone ? 'text-row-phone' : 'text-body')}>
        {client.displayName}
      </span>
      <span className="truncate font-mono text-dense text-muted-foreground" translate="no">
        {client.label}
      </span>
    </span>
  )
}

function EditButton({
  client,
  onEdit,
  className,
}: {
  client: ClientPolicy
  onEdit: () => void
  className?: string
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Edit ${client.displayName}`}
      onClick={onEdit}
      className={className}
    >
      <PencilIcon aria-hidden />
    </Button>
  )
}

/** The clients as the bordered grid (direction A). */
function ClientsGrid({
  clients,
  onEdit,
}: {
  clients: ClientPolicy[]
  onEdit: (client: ClientPolicy) => void
}) {
  return (
    <div
      role="table"
      aria-label="Agents"
      data-slot="clients-grid"
      className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card text-dense"
    >
      <div role="rowgroup">
        <div
          role="row"
          className="flex h-table-header items-stretch border-b border-border-subtle bg-background text-caption text-muted-foreground"
        >
          <HeaderCell icon={BotIcon} title="Agent" className="min-w-0 flex-1" />
          <HeaderCell icon={ListChecksIcon} title="Tools" className="w-column-about" />
          <HeaderCell icon={TimerIcon} title="Per minute" className="w-column-optional" />
          <HeaderCell icon={FileTextIcon} title="Answer size" className="w-column-owner" />
          <HeaderCell icon={PlugIcon} title="Status" className="w-column-status" />
          <div role="columnheader" className={cn(gridCell, 'w-row-button')}>
            <span className="sr-only">Actions</span>
          </div>
        </div>
      </div>
      <div role="rowgroup" className="flex flex-col divide-y divide-border-subtle">
        {clients.map((client) => (
          <div
            key={client.label}
            role="row"
            data-client={client.label}
            className="group/row flex h-row items-stretch hover:bg-muted/50"
          >
            <div role="cell" className={cn(gridCell, 'min-w-0 flex-1')}>
              <ClientName client={client} />
            </div>
            <div role="cell" className={cn(gridCell, 'w-column-about')}>
              <span className="truncate">{clientToolsWords(client)}</span>
            </div>
            <div role="cell" className={cn(gridCell, 'w-column-optional tabular-nums')}>
              <span className="truncate">{rateWords(client)}</span>
            </div>
            <div role="cell" className={cn(gridCell, 'w-column-owner tabular-nums')}>
              <span className="truncate">{answerSizeWords(client)}</span>
            </div>
            <div role="cell" className={cn(gridCell, 'w-column-status')}>
              <ClientSwitch client={client} size="sm" />
            </div>
            <div role="cell" className={cn(gridCell, 'w-row-button justify-center px-0')}>
              <EditButton
                client={client}
                onEdit={() => onEdit(client)}
                className={gridRowControl}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** One row per client on a narrow page: the name, then its switch, tools and limits. */
function ClientsList({
  clients,
  onEdit,
}: {
  clients: ClientPolicy[]
  onEdit: (client: ClientPolicy) => void
}) {
  return (
    <ul
      aria-label="Agents"
      data-slot="clients-list"
      className="flex flex-col divide-y rounded-lg border bg-card"
    >
      {clients.map((client) => (
        <li
          key={client.label}
          data-client={client.label}
          className="flex min-h-row-phone items-center gap-3 py-3 pr-2 pl-4"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <ClientName client={client} phone />
            <ClientSwitch client={client} size="sm" />
            <p className="text-dense text-muted-foreground">
              {clientToolsWords(client)} · {limitsWords(client)}
            </p>
          </div>
          <EditButton client={client} onEdit={() => onEdit(client)} />
        </li>
      ))}
    </ul>
  )
}

function ClientsSkeleton() {
  return (
    <div role="status" aria-label="Loading the agents" className="flex flex-col gap-2">
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton key={index} className="h-row-comfortable w-full" />
      ))}
    </div>
  )
}

type Editing = { client: ClientPolicy | null } | null

/**
 * The MCP server's public address, as the service is configured to give it to AI clients
 * (FR-404). It is set where the service runs, not here; without one, clients cannot connect.
 */
function ServerAddress() {
  const connect = useQuery(connectQuery())
  if (connect.isPending)
    return (
      <Skeleton role="status" aria-label="Loading the address" className="h-control-lg w-full" />
    )
  if (connect.isError) return null
  return connect.data.address ? (
    <div className="flex min-w-0 flex-col gap-2" data-slot="server-address">
      <p className="text-dense text-muted-foreground">Agents connect to this address:</p>
      <CopyBlock text={connect.data.address} label="the address for agents" />
    </div>
  ) : (
    <p className="text-dense text-muted-foreground" data-slot="server-address">
      Agents can&apos;t connect yet, because there&apos;s no public address. The data team sets it
      where the app is installed.
    </p>
  )
}

/**
 * The clients that may connect (FR-408): a closed list of labels, each with the tools it may
 * call, its request rate, the largest answer it gets and its switch. An administrator adds a
 * client or edits one with a reason; a label is never removed, only switched off, so its past
 * requests keep their meaning.
 */
export function ClientsTab() {
  const clients = useQuery(clientsQuery())
  // The editor lists the tools; reading them now lets it open with them in place.
  useQuery(toolsQuery())
  const [content, setContent] = useState<HTMLElement | null>(null)
  const width = useElementWidth(content)
  const [editing, setEditing] = useState<Editing>(null)
  const edit = (client: ClientPolicy | null) => setEditing({ client })
  const takenLabels = useMemo(
    () => clients.data?.map((client) => client.label) ?? null,
    [clients.data],
  )

  return (
    <div ref={setContent} className="flex min-w-0 flex-col gap-8">
      <section aria-labelledby="clients-title" className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="clients-title" className="text-large font-bold">
              Agents that can connect
            </h2>
            <p className="max-w-reading text-dense text-muted-foreground">
              Only the agents listed and allowed here can connect. Each one gets the tools and
              limits you set, and is known by the label on its access key. Every agent a person
              connects by signing in, Claude Code included, has the label{' '}
              <code className="font-mono text-dense" translate="no">
                signed-in
              </code>
              , so that one row covers them all. Each person disconnects their own agents in Connect
              an agent, and you can disconnect anyone&apos;s on the Connections tab.
            </p>
          </div>
          {takenLabels ? (
            <Button variant="outline" onClick={() => edit(null)}>
              <PlusIcon aria-hidden />
              Add an agent
            </Button>
          ) : (
            <BlockedButton
              reason={
                clients.isError
                  ? "We couldn't load the agents, so we can't check the label is free. Try again below."
                  : 'The agents are still loading. You can add one once they have.'
              }
            >
              <PlusIcon aria-hidden />
              Add an agent
            </BlockedButton>
          )}
        </div>
        {clients.isPending ? (
          <ClientsSkeleton />
        ) : clients.isError ? (
          <LoadError
            what="the agents"
            onRetry={() => void clients.refetch()}
            detail={clients.error.message}
          />
        ) : clients.data.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BotIcon />
              </EmptyMedia>
              <EmptyTitle>No agents can connect yet</EmptyTitle>
              <EmptyDescription>
                An agent gets answers once you add it here, with the label on its access key.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : width >= GRID_MIN ? (
          <ClientsGrid clients={clients.data} onEdit={edit} />
        ) : (
          <ClientsList clients={clients.data} onEdit={edit} />
        )}
      </section>

      <section aria-labelledby="connect-title" className="flex min-w-0 flex-col gap-3">
        <h2 id="connect-title" className="text-large font-bold">
          How agents connect
        </h2>
        <ServerAddress />
        <p className="text-dense text-muted-foreground">
          Each person sets up their own agent in Connect an agent, in their Settings. It has the
          address, a setup to paste for each agent that&apos;s on, and the tools it gets. Open it
          from Home or the user menu.
        </p>
        <Button
          variant="outline"
          className="w-fit"
          render={<Link to="/settings" search={{ section: 'connect' }} />}
        >
          <PlugIcon />
          Go to Connect an agent
        </Button>
      </section>

      {editing ? (
        <ClientEditor
          client={editing.client}
          takenLabels={takenLabels}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
        />
      ) : null}
    </div>
  )
}
