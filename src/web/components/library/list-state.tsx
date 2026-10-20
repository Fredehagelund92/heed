import { useEffect, useState, type ReactNode } from 'react'
import {
  InboxIcon,
  RefreshCwIcon,
  SearchXIcon,
  TriangleAlertIcon,
  type Icon,
} from '@/components/icons'
import { ApiError, failedOnServer } from '@/api'
import { updateAdvice } from '@/api/api-version'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { useOutdated } from '@/hooks/use-outdated'
import type { Density } from '@/lib/preferences'
import { cn } from '@/lib/utils'
import { columnSpecs, type ColumnId } from './columns'

/**
 * The states of a list (contract 9.5), one component per state, so every list renders them the
 * same way: loading, empty view, no results, error and stale. The library opens on its table even
 * when it holds few items; an empty one says so in one line and links to the help page.
 */

/** True after `delay` ms of `active`, then held at least `hold` ms (contract 10, rule 7). */
export function useDelayedFlag(active: boolean, delay = 150, hold = 300) {
  const [shown, setShown] = useState(false)
  const [since, setSince] = useState(0)
  useEffect(() => {
    if (active && !shown) {
      const timer = setTimeout(() => {
        setShown(true)
        setSince(Date.now())
      }, delay)
      return () => clearTimeout(timer)
    }
    if (!active && shown) {
      const timer = setTimeout(() => setShown(false), Math.max(0, hold - (Date.now() - since)))
      return () => clearTimeout(timer)
    }
    return undefined
  }, [active, shown, since, delay, hold])
  return shown
}

const skeletonRow: Record<Density, string> = {
  compact: 'h-row',
  comfortable: 'h-row-comfortable',
  scope: 'h-row-scope',
}

/**
 * Skeleton rows with the real row height, the real columns and the grid's hairlines (contract
 * 9.5, "Loading"). No spinner in a table.
 */
export function ListLoading({
  columns,
  narrow,
  // The rows' own height: compact (40) is the grid's default density.
  density = 'compact',
  selectable = true,
  rows = 14,
  label = 'Loading the library',
  rowButton = true,
  header,
}: {
  /** The library's column ids, or the width classes of another grid's columns. */
  columns: readonly (ColumnId | { id: string; widthClass: string })[]
  narrow: boolean
  density?: Density
  selectable?: boolean
  rows?: number
  label?: string
  /** The library grid ends each row with a menu button; a grid without one leaves it out. */
  rowButton?: boolean
  /**
   * The grid's own column header, kept over the skeleton rows so the columns do not move when
   * the rows arrive. A placeholder while loading: hidden from assistive technology and inert.
   */
  header?: ReactNode
}) {
  const cell = 'flex shrink-0 items-center self-stretch border-l border-border-subtle px-3'
  const specs = columns.map((column) =>
    typeof column === 'string'
      ? { id: column, widthClass: columnSpecs[column].widthClass }
      : column,
  )
  return (
    <div role="status" aria-label={label} className="flex flex-col">
      {header && !narrow ? (
        <div role="table" aria-hidden="true" inert data-slot="loading-header">
          {header}
        </div>
      ) : null}
      {Array.from({ length: rows }, (_, index) =>
        narrow ? (
          <div
            key={index}
            className="flex min-h-row-phone gap-3 border-b border-border-subtle px-gutter py-3"
            data-layout={index === 0 ? 'content' : undefined}
          >
            <Skeleton className="size-7 rounded-md" />
            <div className="flex flex-1 flex-col gap-2 pt-1">
              <Skeleton className={cn('h-4', index % 3 === 0 ? 'w-3/4' : 'w-full')} />
              <Skeleton className="h-5 w-1/2 rounded-badge" />
            </div>
          </div>
        ) : (
          <div
            key={index}
            className={cn(
              'flex items-stretch border-b border-border-subtle px-gutter',
              skeletonRow[density],
            )}
            data-layout={index === 0 ? 'content' : undefined}
          >
            {selectable ? (
              <div className="flex w-column-select shrink-0 items-center justify-center">
                <Skeleton className="size-4 rounded-sm" />
              </div>
            ) : null}
            {/* As in the grid: with a checkbox column the kind sits in it and the title follows
                without a line; without one the title starts with the row's icon. */}
            <div
              className={cn(
                'flex min-w-0 flex-1 items-center gap-3 self-stretch',
                selectable ? 'pl-1' : 'px-3',
              )}
            >
              {selectable ? null : <Skeleton className="size-4 shrink-0 rounded-sm" />}
              <Skeleton className={cn('h-3', index % 3 === 0 ? 'w-1/2' : 'w-2/3')} />
            </div>
            {specs.map((column) => (
              <div key={column.id} className={cn(cell, column.widthClass)}>
                <Skeleton
                  className={cn(
                    'w-2/3',
                    column.id === 'domain' || column.id === 'status' ? 'h-5 rounded-badge' : 'h-3',
                  )}
                />
              </div>
            ))}
            {rowButton ? <div className={cn(cell, 'w-row-button')} /> : null}
          </div>
        ),
      )}
      <span className="sr-only">Loading</span>
    </div>
  )
}

/** A centred message with one action (contract 7.1 `Empty`): empty view and no results. */
export function ListMessage({
  icon: Glyph,
  title,
  children,
  action,
}: {
  icon: Icon
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <Empty className="px-gutter py-16" data-layout="content">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Glyph />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  )
}

export function ListEmpty({
  title,
  children,
  action,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <ListMessage icon={InboxIcon} title={title} action={action}>
      {children}
    </ListMessage>
  )
}

export function ListNoResults({
  title = 'No facts match',
  description,
  onClear,
}: {
  title?: string
  description: ReactNode
  onClear: () => void
}) {
  return (
    <ListMessage
      icon={SearchXIcon}
      title={title}
      action={
        <Button variant="outline" onClick={onClear}>
          Clear search and filters
        </Button>
      }
    >
      {description}
    </ListMessage>
  )
}

/**
 * Why a read failed, in a sentence: the connection, a failure of the service itself, or an update
 * one side has not caught up with (api/api-version.ts), which says what to do instead.
 */
function FailureReason({ error }: { error: unknown }) {
  const side = useOutdated()
  if (side || (error instanceof ApiError && error.kind === 'outdated'))
    return updateAdvice(side ?? 'checking')
  return failedOnServer(error)
    ? 'Something went wrong on our side. Try again, and tell the data team if it keeps happening.'
    : 'Check your connection, then try again.'
}

/** The request failed and nothing is cached (contract 9.5, "Error"). */
export function ListError({
  title = "We couldn't load the library",
  safe = 'Your facts are safe.',
  error,
  onRetry,
  detail,
}: {
  title?: string
  /** What the failure did not touch: "Your facts are safe." */
  safe?: string
  /** The failure, which says why nothing is shown. */
  error?: unknown
  onRetry: () => void
  detail?: string
}) {
  return (
    <div className="px-gutter py-6" data-layout="content">
      <Alert variant="danger" role="alert" className="max-w-reading">
        <TriangleAlertIcon aria-hidden="true" />
        <AlertContent>
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>
            <p>
              {safe} <FailureReason error={error} />
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={onRetry}>
                <RefreshCwIcon />
                Try again
              </Button>
              {detail ? (
                <details className="text-caption">
                  <summary className="cursor-pointer">Details for support</summary>
                  {detail}
                </details>
              ) : null}
            </div>
          </AlertDescription>
        </AlertContent>
      </Alert>
    </div>
  )
}

/** Cached rows are shown but a refresh failed (contract 9.5, "Stale"): one line with Retry. */
export function ListStale({ loadedAt, onRetry }: { loadedAt: string; onRetry: () => void }) {
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(loadedAt),
  )
  return (
    <div
      role="status"
      className="flex min-h-control-lg items-center gap-3 border-b border-status-warning-border bg-status-warning-bg px-gutter py-1 text-dense text-status-warning-fg"
    >
      <TriangleAlertIcon aria-hidden="true" className="size-4 shrink-0 text-status-warning-icon" />
      <span className="min-w-0 flex-1">Showing the list from {time}. We couldn't refresh it.</span>
      <Button variant="ghost" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}
