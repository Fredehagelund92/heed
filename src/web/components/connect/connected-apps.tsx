import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Connection } from '@/api'
import { connectionsQuery, useApiWrite } from '@/api/queries'
import { ConfirmDialog } from '@/components/form/confirm-dialog'
import { HelpLink } from '@/components/help/help-link'
import {
  BotIcon,
  CalendarIcon,
  ClockIcon,
  ListChecksIcon,
  PlugIcon,
  UnlinkIcon,
} from '@/components/icons'
import { gridCell } from '@/components/page/grid'
import {
  GridFailed,
  GridHeaderCells,
  GridLoading,
  GridMessage,
  GridTable,
  gridRowClass,
  type GridColumn,
} from '@/components/page/grid-table'
import { Button } from '@/components/ui/button'
import { scopeSummary } from '@/lib/connections'
import { formatDay, formatMoment } from '@/lib/library'
import { cn } from '@/lib/utils'

/*
  The AI apps connected to Heed as the signed-in person (FR-403), in the app's bordered grid:
  which app, what it may do, when it connected and when it last asked for a token. Disconnect
  ends the connection at once: its refresh tokens end and the MCP server refuses its access
  tokens. Below the table's 4xl width the columns after the app leave, and the app's second line
  says what it can do and when it was last used: the fixed columns take 38 rem, so a narrower
  table would leave the app's name no room.
*/

const SLOT = 'connected-apps'
const optional = '@max-4xl:hidden'

const columns: GridColumn[] = [
  { icon: BotIcon, title: 'App', className: 'flex-1' },
  { icon: ListChecksIcon, title: 'Can', className: cn('w-column-about', optional) },
  { icon: CalendarIcon, title: 'Connected', className: cn('w-column-until', optional) },
  { icon: ClockIcon, title: 'Last used', className: cn('w-column-changed', optional) },
]

export function ConnectedApps() {
  const connections = useQuery(connectionsQuery())
  if (connections.isPending) return <GridLoading slot={SLOT} label="Loading connected apps" />
  if (connections.isError)
    return (
      <GridFailed slot={SLOT} what="your connected apps" retry={() => void connections.refetch()} />
    )
  if (connections.data.length === 0)
    return (
      <GridMessage slot={SLOT} icon={PlugIcon} title="No AI apps are connected">
        Paste the prompt above into your AI app. It asks you to sign in and allow it, and then it
        shows here. <HelpLink to="connect-your-ai-app">How connecting works</HelpLink>
      </GridMessage>
    )
  return (
    <GridTable
      slot={SLOT}
      label="Connected AI apps"
      header={
        <>
          <GridHeaderCells columns={columns} />
          <div role="columnheader" className={cn(gridCell, 'w-column-status')}>
            <span className="sr-only">Disconnect</span>
          </div>
        </>
      }
    >
      {connections.data.map((connection) => (
        <ConnectionRow key={connection.id} connection={connection} />
      ))}
    </GridTable>
  )
}

function ConnectionRow({ connection }: { connection: Connection }) {
  const disconnect = useApiWrite('disconnectApp')
  const [open, setOpen] = useState(false)
  return (
    <div role="row" data-row-id={connection.id} className={gridRowClass}>
      <div
        role="cell"
        className={cn(gridCell, 'flex-1 shrink flex-col items-start justify-center gap-1 py-2')}
      >
        <span className="max-w-full truncate text-body" title={connection.clientName}>
          {connection.clientName}
        </span>
        <span className="max-w-full truncate text-dense text-muted-foreground">
          {connection.clientHost}
          <span className="@4xl:hidden">
            {' '}
            · {scopeSummary(connection.scopes)} · Last used {formatMoment(connection.lastUsedAt)}
          </span>
        </span>
      </div>
      <div role="cell" className={cn(gridCell, 'w-column-about', optional)}>
        <span className="truncate">{scopeSummary(connection.scopes)}</span>
      </div>
      <div role="cell" className={cn(gridCell, 'w-column-until tabular-nums', optional)}>
        {formatDay(connection.connectedAt)}
      </div>
      <div role="cell" className={cn(gridCell, 'w-column-changed tabular-nums', optional)}>
        <span title={formatMoment(connection.lastUsedAt, 'long')}>
          {formatMoment(connection.lastUsedAt)}
        </span>
      </div>
      <div role="cell" className={cn(gridCell, 'w-column-status justify-end')}>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          trigger={
            <Button variant="ghost" size="sm">
              <UnlinkIcon />
              Disconnect
            </Button>
          }
          title={`Disconnect ${connection.clientName}?`}
          effect="It stops working at once. To use it again, connect it again from the AI app."
          action="Disconnect"
          actionIcon={UnlinkIcon}
          tone="destructive"
          onConfirm={async () => {
            await disconnect.mutateAsync({ id: connection.id })
            setOpen(false)
          }}
        />
      </div>
    </div>
  )
}
