import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ToolSwitch } from '@/api'
import { clientsQuery, toolsQuery, useApiWrite } from '@/api/queries'
import { LoadError } from '@/components/editions/load-error'
import { ConfirmDialog } from '@/components/form/confirm-dialog'
import {
  CircleSlashIcon,
  EyeIcon,
  FilePenIcon,
  MessageSquareIcon,
  PlayIcon,
} from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  accessWords,
  orderTools,
  toolInfo,
  toolName,
  toolsOnWords,
  toolSwitchEffect,
} from '@/lib/gateway'
import { formatMoment } from '@/lib/library'
import { showToast } from '@/lib/toast'

const accessIcons = { read: EyeIcon, feedback: MessageSquareIcon, propose: FilePenIcon } as const

/** One tool: what it does, since when it is on or off, and its switch. */
function ToolRow({ tool, onSwitch }: { tool: ToolSwitch; onSwitch: (enabled: boolean) => void }) {
  const info = toolInfo[tool.tool]
  const titleId = `tool-${tool.tool}`
  return (
    <li data-tool={tool.tool} className="flex items-start gap-4 p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 id={titleId} className="text-body font-bold">
            {toolName(tool.tool)}
          </h3>
          <span className="font-mono text-dense text-muted-foreground" translate="no">
            {tool.tool}
          </span>
        </div>
        <p className="text-dense text-muted-foreground">
          {info?.about ?? "A new tool. This page doesn't describe it yet."}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-dense text-muted-foreground">
          {info ? (
            <Badge form="bare" icon={accessIcons[info.access]} quiet>
              {accessWords[info.access]}
            </Badge>
          ) : null}
          <span>
            {tool.enabled ? 'On' : 'Off'} since {formatMoment(tool.updatedAt)}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center self-center">
        <Switch
          checked={tool.enabled}
          aria-labelledby={titleId}
          onCheckedChange={(enabled) => onSwitch(enabled)}
        />
      </div>
    </li>
  )
}

function ToolsSkeleton() {
  return (
    <div role="status" aria-label="Loading the tools" className="flex flex-col gap-2">
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full" />
      ))}
    </div>
  )
}

/**
 * The tool switch (FR-407): one list decides which tools are on, for every client. Switching
 * one asks for a reason, which the history log keeps, and says which clients it reaches. The
 * gateway reads the list on every request, so the next request sees the change.
 */
export function ToolsTab() {
  const tools = useQuery(toolsQuery())
  const { data: clients } = useQuery(clientsQuery())
  const setTool = useApiWrite('setTool')
  const [switching, setSwitching] = useState<{ tool: string; enabled: boolean } | null>(null)
  const name = switching ? toolName(switching.tool) : ''

  return (
    <section aria-labelledby="tools-title" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="tools-title" className="text-large font-bold">
          Tools agents can use
        </h2>
        <p className="max-w-reading text-dense text-muted-foreground">
          {tools.data ? <span aria-live="polite">{toolsOnWords(tools.data)} </span> : null}A tool
          you switch off is gone for every agent from its next call. You can narrow the list for one
          agent on the agents tab.
        </p>
      </div>
      {tools.isPending ? (
        <ToolsSkeleton />
      ) : tools.isError ? (
        <LoadError
          what="the tools"
          onRetry={() => void tools.refetch()}
          detail={tools.error.message}
        />
      ) : (
        <ul
          aria-label="Tools"
          data-slot="tools-list"
          className="flex flex-col divide-y rounded-lg border bg-card"
        >
          {orderTools(tools.data).map((tool) => (
            <ToolRow
              key={tool.tool}
              tool={tool}
              onSwitch={(enabled) => setSwitching({ tool: tool.tool, enabled })}
            />
          ))}
        </ul>
      )}
      {switching ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setSwitching(null)
          }}
          title={`Switch ${switching.enabled ? 'on' : 'off'} ${name}?`}
          effect={toolSwitchEffect(switching.tool, switching.enabled, clients)}
          action={switching.enabled ? 'Switch on' : 'Switch off'}
          actionIcon={switching.enabled ? PlayIcon : CircleSlashIcon}
          tone={switching.enabled ? 'default' : 'destructive'}
          reason={{ required: true, hint: 'Kept in the history log with the change.' }}
          onConfirm={async ({ reason }) => {
            await setTool.mutateAsync({ ...switching, reason })
            showToast(
              `${name} switched ${switching.enabled ? 'on' : 'off'}`,
              switching.enabled
                ? 'Agents can use it from their next call.'
                : 'Agents stop using it from their next call.',
            )
          }}
        />
      ) : null}
    </section>
  )
}
