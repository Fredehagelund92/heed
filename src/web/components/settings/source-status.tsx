import type { OperationsOverviewView } from '@/api'
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  TriangleAlertIcon,
} from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { connectorStatusWords } from '@/lib/settings'

type Status = OperationsOverviewView['connectors'][number]['status']

/** A definition source's status: out of date is the one that asks for a look. */
export function SourceStatus({ status }: { status: Status }) {
  const words = connectorStatusWords[status]
  if (status === 'stale')
    return (
      <Badge form="soft" tone="warning" icon={TriangleAlertIcon} size="sm">
        {words}
      </Badge>
    )
  const icon =
    status === 'ok' ? CircleCheckIcon : status === 'disabled' ? CircleSlashIcon : CircleDashedIcon
  return (
    <Badge form="bare" icon={icon} size="sm" quiet={status === 'disabled'}>
      {words}
    </Badge>
  )
}
