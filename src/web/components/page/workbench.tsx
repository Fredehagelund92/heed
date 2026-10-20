import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { openRowClass } from './dock-panel'
import { Page } from './page'

/*
  The Workbench page template (contract 5, "Workbench page"; Workbench plan, 3.1). Under the
  header, a toolbar row (the scope strip, a `PageToolbar`), then three panes: the list on the
  left (316), the record in the flexible middle and its actions on the right (280). From 768 wide
  the page is the window's height under the header and does not scroll: each pane scrolls on its
  own. Under a 1,100 pixel page the actions fold under the record (`RecordPane` does that); on a
  phone the panes stack and the page scrolls, and an open record takes the list's place.
*/

/** The page: the window's height under the header from 768 wide, so its panes scroll alone. */
export function WorkbenchTemplate({
  className,
  ...props
}: Omit<ComponentProps<typeof Page>, 'heading'>) {
  return (
    <Page
      data-template="workbench"
      launcherRoom="phone"
      className={cn('md:h-workbench md:flex-none md:overflow-hidden', className)}
      {...props}
    />
  )
}

/** The row of panes under the toolbar: side by side from 768 wide, stacked on a phone. */
export function WorkbenchPanes({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="workbench-panes"
      className={cn('relative flex min-h-0 flex-1 flex-col md:flex-row', className)}
      {...props}
    />
  )
}

/**
 * The list pane on the left, 316 wide; full width on a phone. From 768 wide its bar and totals
 * stay put while its body (`WorkbenchListBody`) scrolls on its own; on a phone the page scrolls.
 */
export function WorkbenchListPane({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      data-slot="workbench-list"
      className={cn(
        'flex shrink-0 flex-col max-md:border-b md:min-h-0 md:w-workbench-list md:overflow-hidden md:border-r',
        className,
      )}
      {...props}
    />
  )
}

/**
 * The list's bar: its views over its search, under a hairline. The list's content starts at the
 * page gutter, on the header's and the scope strip's edge (contract 5, one left edge).
 */
export function WorkbenchListBar({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-layout="content"
      className={cn('flex shrink-0 flex-col gap-2 border-b px-gutter py-3', className)}
      {...props}
    />
  )
}

/** A view of the list in its bar: 28 high, 44 on a phone. */
export const workbenchViewClass = 'max-md:h-control-touch'

/** The list's search field: 28 high like the views, 44 on a phone or a touch screen. */
export const workbenchSearchClass =
  'h-control-sm min-w-0 flex-1 bg-background max-md:h-control-touch pointer-coarse:h-control-touch'

/** The list's rows, scrolling on their own from 768 wide. */
export function WorkbenchListBody({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="workbench-list-body"
      className={cn(
        'flex flex-1 flex-col md:min-h-0 md:overflow-y-auto md:overscroll-contain',
        className,
      )}
      {...props}
    />
  )
}

/**
 * A group's header in the list: a quiet band with its name and count, stuck to the top of the
 * rows while they scroll, and under the shell's header on a phone, where the page scrolls.
 */
export function WorkbenchListGroupHeading({ className, ...props }: ComponentProps<'h3'>) {
  return (
    <h3
      className={cn(
        'sticky top-0 z-sticky flex h-8 items-center gap-2 border-b border-border-subtle bg-sidebar px-gutter text-caption text-muted-foreground max-md:top-header',
        className,
      )}
      {...props}
    />
  )
}

/**
 * A row of the list: at least 40 high (56 on a phone), a hairline under it, the accent on hover,
 * the open row as every list beside a record has it (`openRowClass`: the tint and a 2 pixel ink
 * edge, contract 8.12 rule 7), a ring for the keyboard.
 */
export const workbenchRowClass = cn(
  'relative flex min-h-row items-start gap-2 border-b border-border-subtle px-gutter py-2 -outline-offset-2 hover:bg-accent has-[[data-row-link]:focus-visible]:outline-2 has-[[data-row-link]:focus-visible]:outline-ring max-md:min-h-row-phone max-md:py-3',
  openRowClass,
)

/** A row's title: one line in 14/20; on a phone 15/20, up to two lines. */
export const workbenchRowTitleClass =
  'block min-w-0 truncate text-body max-md:line-clamp-2 max-md:text-row-phone max-md:whitespace-normal'

/** A note under the list's rows: how they are ranked, and the privacy rule. */
export function WorkbenchListNote({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p className={cn('px-gutter py-3 text-caption text-muted-foreground', className)} {...props} />
  )
}

/** The totals at the list's foot, 36 high. */
export function WorkbenchListFoot({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      className={cn(
        'flex h-footer shrink-0 items-center gap-3 overflow-hidden border-t px-gutter text-caption whitespace-nowrap text-muted-foreground tabular-nums',
        className,
      )}
      {...props}
    />
  )
}

/**
 * The record's place when no record is open (the overview): the middle and the actions' width
 * together, scrolling on its own. An open record is a `RecordPane` in the same place.
 */
export function WorkbenchPane({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      data-slot="workbench-pane"
      className={cn(
        '@container flex min-w-0 flex-1 flex-col md:min-h-0 md:overflow-y-auto md:overscroll-contain',
        className,
      )}
      {...props}
    />
  )
}

/**
 * What a focus mode covers (the list and the record, Workbench plan W7): laid out as if it were
 * not there, and while covered out of reach (inert) and, on a phone, out of the page, so each
 * pane keeps its scroll position for when the focus closes.
 */
export function WorkbenchUnderFocus({
  covered,
  className,
  ...props
}: ComponentProps<'div'> & { covered: boolean }) {
  return (
    <div
      data-slot="workbench-under-focus"
      inert={covered}
      className={cn('contents', covered && 'max-md:hidden', className)}
      {...props}
    />
  )
}

/**
 * A focus mode's frame (the compare focus, W7): from 768 wide laid over the panes, the list and
 * the actions included, scrolling on its own; on a phone in the page's flow in their place. The
 * panes' row (`WorkbenchPanes`) must be its positioned parent.
 */
export function WorkbenchFocus({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      data-slot="workbench-focus"
      className={cn(
        '@container z-sticky flex min-w-0 flex-col bg-background outline-none md:absolute md:inset-0 md:overflow-y-auto md:overscroll-contain',
        className,
      )}
      {...props}
    />
  )
}

/** A record's bar, stuck to the top of its pane from 768 wide; on a phone the page scrolls it. */
export const workbenchBarClass = 'z-sticky bg-background md:sticky md:top-0'
