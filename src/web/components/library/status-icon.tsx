import type { ReactNode } from 'react'
import { asksForALook, type ItemDisplayStatus } from '@domain/status'
import { StatusBadge, statusGlyphs, statusTone } from '@/components/item/item-marks'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { statusHints, statusNames, statusShortNames } from '@/lib/library'
import { cn } from '@/lib/utils'

/**
 * A status as one 18 pixel glyph and nothing else: a calm status in the library table's Status
 * column (contract 8.1, round 2.1 of the design). Seven statuses, seven shapes, so the column
 * reads without words; the name is the accessible name and, with what it means, the tooltip. The
 * glyph sits above the row's link so a pointer can rest on it. A row keeps words only for
 * statuses that ask for a look (RowStatus).
 */
export function StatusIcon({
  status,
  className,
}: {
  status: ItemDisplayStatus
  className?: string
}) {
  const Glyph = statusGlyphs[status]
  return (
    <StatusTooltip status={status} className={className}>
      <Glyph aria-hidden="true" className={cn('size-icon-status', statusTone[status])} />
    </StatusTooltip>
  )
}

/** A status mark named by its status, with the name and what it means as its tooltip. */
function StatusTooltip({
  status,
  className,
  children,
}: {
  status: ItemDisplayStatus
  className?: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={statusNames[status]}
            data-slot="status-icon"
            data-status={status}
            className={cn('relative z-raised inline-flex shrink-0', className)}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="flex-col items-start gap-1">
        <span className="font-bold">{statusNames[status]}</span>
        <span>{statusHints[status]}</span>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * A row's status, in the table and on a phone: warnings are named with the status badge, so
 * colour and shape are never the only sign (A8); calm statuses keep their named glyph without
 * repeating words. `short` is the table's 128 pixel column: the badge says a short word
 * ("Changed"), and its accessible name and tooltip say the status in full.
 */
export function RowStatus({
  status,
  short = false,
}: {
  status: ItemDisplayStatus
  short?: boolean
}) {
  if (!asksForALook(status)) return <StatusIcon status={status} />
  if (!short) return <StatusBadge status={status} size="sm" />
  return (
    <StatusTooltip status={status} className="min-w-0">
      <StatusBadge status={status} size="sm" label={statusShortNames[status]} />
    </StatusTooltip>
  )
}
