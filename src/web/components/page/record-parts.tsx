import { useCallback, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { ChevronDownIcon, ChevronUpIcon, Maximize2Icon, XIcon, type Icon } from '@/components/icons'
import { Button, QuietButtons } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatHotkey } from '@/lib/commands'
import { cn } from '@/lib/utils'

/*
  The parts of a record's frame, shared by the two frames that show one record: the docked panel
  (`DockPanel`, fixed beside a grid) and the record pane (`RecordPane`, in the Workbench's page
  flow). Both draw the same bar (what the record is and where it is in the list, previous and
  next, expand and close, or a back arrow on a phone), the same heading (the title first, then
  the badges and the note line) and the same line tabs, from these parts, so the two cannot
  drift apart (Workbench plan, risk R1). The bodies both frames show are built from sections.
*/

/** Menus, dialogs and listboxes opened from the record own their keys. */
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

/** Keys that scroll the record while focus is in it, instead of moving the list's cursor. */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '])

/**
 * A record's keys: Escape closes it, and is kept from the page so the list does not act twice;
 * inside it the arrows scroll it, so the page's list keys stop there. A menu or dialog opened
 * from it keeps its own keys.
 */
export function recordKeyDown(event: KeyboardEvent<HTMLElement>, onClose: () => void) {
  if (event.target instanceof Element && event.target.closest(OVERLAY)) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    onClose()
  } else if (SCROLL_KEYS.has(event.key) && !event.metaKey && !event.ctrlKey) {
    event.stopPropagation()
  }
}

export type RecordTab<T extends string> = { value: T; label: string; count?: ReactNode }

export function BarButton({
  label,
  hint,
  touch,
  onClick,
  disabled,
  render,
  children,
}: {
  label: string
  hint?: string
  touch: boolean
  onClick?: () => void
  disabled?: boolean
  /** A link to render the button as (expand). */
  render?: ReactElement
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size={touch ? 'icon-touch' : 'icon'}
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            render={render}
            className="text-muted-foreground"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{hint ? `${label} (${hint})` : label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The record's bar: a back arrow on a phone, what the record is and where it is in the list,
 * the record's own controls, previous and next, expand and close.
 */
export function RecordBar({
  meta,
  back,
  controls,
  browse,
  onPrevious,
  onNext,
  expand,
  onClose,
  touch,
  className,
}: {
  meta?: ReactNode
  /** The phone's back arrow, in place of close. */
  back?: ReactNode
  /** The record's own controls before previous and next (the Workbench's Compare). */
  controls?: ReactNode
  browse: boolean
  onPrevious?: () => void
  onNext?: () => void
  expand?: ReactElement
  /** Close, at the bar's end; left out where the back arrow closes. */
  onClose?: () => void
  touch: boolean
  className?: string
}) {
  return (
    <div
      className={cn('flex h-header shrink-0 items-center gap-2 border-b px-2 @md:px-4', className)}
    >
      {back}
      <div
        data-slot="dock-meta"
        className="flex min-w-0 flex-1 items-center gap-2 px-2 text-caption text-muted-foreground tabular-nums"
      >
        {meta}
      </div>
      {controls}
      {browse ? (
        <>
          <BarButton
            label="Previous"
            hint={formatHotkey('k').join('')}
            touch={touch}
            onClick={onPrevious}
            disabled={!onPrevious}
          >
            <ChevronUpIcon />
          </BarButton>
          <BarButton
            label="Next"
            hint={formatHotkey('j').join('')}
            touch={touch}
            onClick={onNext}
            disabled={!onNext}
          >
            <ChevronDownIcon />
          </BarButton>
        </>
      ) : null}
      {expand ? (
        <BarButton label="Open page" touch={touch} render={expand}>
          <Maximize2Icon />
        </BarButton>
      ) : null}
      {onClose ? (
        <BarButton
          label="Close"
          hint={formatHotkey('escape').join('')}
          touch={false}
          onClick={onClose}
        >
          <XIcon />
        </BarButton>
      ) : null}
    </div>
  )
}

/** The record's heading: the title (a placeholder while it loads), then its badges and note line. */
export function RecordHeading({
  title,
  titleId,
  badges,
  note,
}: {
  title: string | null
  titleId: string
  badges?: ReactNode
  note?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 px-4 pt-6 @md:px-6">
      {title === null ? (
        <Skeleton role="status" aria-label="Loading" className="h-7 w-3/4" />
      ) : (
        <h2 id={titleId} className="text-title font-bold tracking-title text-balance">
          {title}
        </h2>
      )}
      <QuietButtons value>
        {badges}
        {note}
      </QuietButtons>
    </div>
  )
}

/**
 * The record's body, under its heading or its tabs. `clearLauncher`: the body reaches the page's
 * bottom-right corner, so its end scrolls clear of the assistant launcher there.
 */
export function RecordBody({
  children,
  clearLauncher = false,
}: {
  children?: ReactNode
  clearLauncher?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col px-4 pt-6 pb-8 @md:px-6',
        clearLauncher && '[body:has([data-slot=assistant-launcher])_&]:pb-launcher-clear',
      )}
    >
      {children}
    </div>
  )
}

/** A section of a record's body: its heading with an icon, an optional action, and its content. */
export function RecordSection({
  title,
  icon: Glyph,
  action,
  children,
}: {
  title: string
  icon: Icon
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <div className="flex min-h-control-md items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-large font-bold">
          <Glyph aria-hidden="true" className="size-4 shrink-0 text-muted-foreground heed-ink" />
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/**
 * The record's line tabs, stuck to the top of what scrolls, and the body under them. On a phone
 * a record's tabs may not all fit: the row scrolls sideways and keeps the tab that is shown in
 * view, also when the tabs' counts arrive later and widen the row.
 */
export function RecordTabs<T extends string>({
  tabs,
  tab,
  onTabChange,
  tabsLabel,
  stickyClassName = 'top-0',
  children,
}: {
  tabs: readonly RecordTab<T>[]
  tab: T
  onTabChange?: (tab: T) => void
  tabsLabel?: string
  /** Where the row sticks in what scrolls: under a bar that sticks too, it starts below it. */
  stickyClassName?: string
  /** The tabs' contents, as `TabsContent` panels. */
  children?: ReactNode
}) {
  const tabRow = useCallback(
    (row: HTMLDivElement | null) => {
      const active = row?.querySelector<HTMLElement>('[aria-selected="true"]')
      if (!row || !active) return
      const keepInView = () => {
        const edge = row.getBoundingClientRect()
        const box = active.getBoundingClientRect()
        if (box.left < edge.left) row.scrollLeft -= Math.ceil(edge.left - box.left)
        else if (box.right > edge.right) row.scrollLeft += Math.ceil(box.right - edge.right)
      }
      keepInView()
      if (typeof ResizeObserver === 'undefined') return
      const observer = new ResizeObserver(keepInView)
      // The row keeps its width while a tab before the shown one widens, so each tab is watched.
      observer.observe(row)
      for (const trigger of row.querySelectorAll('[role="tab"]')) observer.observe(trigger)
      return () => observer.disconnect()
    },
    // Again for each tab shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab],
  )
  return (
    <Tabs value={tab} onValueChange={(value: T) => onTabChange?.(value)} className="gap-0 pt-4">
      <TabsList
        ref={tabRow}
        variant="line"
        aria-label={tabsLabel}
        className={cn(
          'sticky z-sticky no-scrollbar w-full justify-start overflow-x-auto overscroll-x-contain bg-background px-2 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:border-b @md:px-4',
          stickyClassName,
        )}
      >
        {tabs.map((entry) => (
          <TabsTrigger key={entry.value} value={entry.value}>
            {entry.label}
            {entry.count}
          </TabsTrigger>
        ))}
      </TabsList>
      <RecordBody>{children}</RecordBody>
    </Tabs>
  )
}
