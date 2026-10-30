import * as React from 'react'
import { ChevronDownIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

// Efferd's square hairline frames, as dashboard 2 draws them: a frame is a rectangle with a
// hairline border and no radius; its sections share hairlines; tables, key-value bands and cells
// run edge to edge. Settings, Integrations and the connect flow are built from these, so the
// rhythm (16px cells, 20px from md, a header row per section) is the same everywhere.

/** The page body: the same gutter as the Inbox, full width, with a ceiling for very wide screens. */
export function FramePage({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('mx-auto flex w-full max-w-wide flex-col gap-6 p-4 md:p-6', className)}>
      {children}
    </div>
  )
}

/** A square frame with a hairline border. Its sections draw the lines between them. */
export function Frame({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('overflow-hidden rounded-frame border bg-background', className)} {...props}>
      {children}
    </div>
  )
}

function SectionHeader({
  title,
  description,
  action,
  level = 2,
  trail,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  level?: 2 | 3
  trail?: React.ReactNode
}) {
  const H = level === 2 ? 'h2' : 'h3'
  return (
    <>
      <div className="min-w-0">
        <H className="text-base leading-snug font-medium">{title}</H>
        {description && (
          <p className="mt-0.5 max-w-3xl text-sm text-pretty text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {(action || trail) && (
        <div className="flex max-w-full shrink-0 items-center gap-2">
          {/* On a narrow page the buttons wrap rather than run off the edge. */}
          {action && (
            <div className="relative z-raised flex max-w-full flex-wrap items-center gap-2">
              {action}
            </div>
          )}
          {trail}
        </div>
      )}
    </>
  )
}

const headerRow = 'flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-4 md:px-5'

/**
 * One section of a frame: a header row (title, a line on what it is for, an action on the right)
 * and its content, which starts with its own hairline when it runs edge to edge. With
 * `collapsible` the whole header row folds the content, its chevron at the right end.
 */
export function FrameSection({
  title,
  description,
  action,
  level,
  collapsible,
  defaultOpen = true,
  open,
  onOpenChange,
  inline,
  className,
  children,
}: {
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  level?: 2 | 3
  collapsible?: boolean
  defaultOpen?: boolean
  /** A fold someone else opens too (a link that leads into it). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Keep a small action (a status, one icon) on the title's row at every width instead of wrapping under it. */
  inline?: boolean
  className?: string
  children?: React.ReactNode
}) {
  if (collapsible && title)
    return (
      <Collapsible
        defaultOpen={defaultOpen}
        open={open}
        onOpenChange={onOpenChange}
        render={<section className={cn('border-t first:border-t-0', className)} />}
      >
        <div
          data-slot="frame-section-header"
          className={cn(headerRow, 'relative flex-nowrap transition-colors hover:bg-band-soft')}
        >
          <SectionHeader
            title={title}
            description={description}
            level={level}
            action={action}
            trail={
              <CollapsibleTrigger className="group/fold flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none after:absolute after:inset-0 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                <ChevronDownIcon
                  className="size-4 transition-transform group-aria-expanded/fold:rotate-180"
                  aria-hidden
                />
                <span className="sr-only">
                  Show or hide {typeof title === 'string' ? title : 'this section'}
                </span>
              </CollapsibleTrigger>
            }
          />
        </div>
        <CollapsibleContent>{children}</CollapsibleContent>
      </Collapsible>
    )
  return (
    <section className={cn('border-t first:border-t-0', className)}>
      {title && (
        <div data-slot="frame-section-header" className={cn(headerRow, inline && 'flex-nowrap')}>
          <SectionHeader title={title} description={description} action={action} level={level} />
        </div>
      )}
      {children}
    </section>
  )
}

/** Padded content inside a section, under its header row. */
export function FrameBody({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return <div className={cn('px-4 pb-4 md:px-5 md:pb-5', className)}>{children}</div>
}

/** Numbers edge to edge, as Efferd's KPI cells. */
export function FrameNumbers({
  items,
}: {
  items: { label: string; value: string; sub: string; tone?: 'warn' | 'bad' }[]
}) {
  return (
    <dl className="grid grid-cols-2 gap-px border-y bg-border @3xl/main:grid-cols-4">
      {items.map((n) => (
        <div key={n.label} className="bg-background px-4 py-3 md:px-5">
          <dt className="text-xs text-muted-foreground">{n.label}</dt>
          <dd
            className={cn(
              'mt-1 text-2xl font-semibold tracking-tight tabular-nums',
              n.tone === 'bad' && 'text-destructive',
            )}
          >
            {n.value}
          </dd>
          <dd className="text-xs text-muted-foreground">{n.sub}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A column: `className` goes on the header and the cells (widths, hiding), `cell` on the cells only. */
export type FrameColumn = {
  label: React.ReactNode
  className?: string
  cell?: string
  align?: 'left' | 'right'
  srOnly?: boolean
}

/**
 * A table's scroller under a section's header row. While the table is wider than the page it scrolls
 * sideways, and takes a tab stop so the keys can scroll it too (WCAG 2.1.1).
 */
export function FrameScroll({ children }: { children: React.ReactNode }) {
  const [el, setEl] = React.useState<HTMLDivElement | null>(null)
  const [scrolls, setScrolls] = React.useState(false)
  React.useLayoutEffect(() => {
    if (!el) return
    const measure = () => setScrolls(el.scrollWidth > el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    for (const child of el.children) ro.observe(child)
    return () => ro.disconnect()
  }, [el])
  return (
    <div
      ref={setEl}
      tabIndex={scrolls ? 0 : undefined}
      className="overflow-x-auto border-t outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      {children}
    </div>
  )
}

/** A table that runs edge to edge under a section's header row, with the lists' thin header band. */
export function FrameTable({
  columns,
  rows,
  label,
}: {
  columns: FrameColumn[]
  rows: React.ReactNode[][]
  label?: string
}) {
  return (
    <FrameScroll>
      <table className="w-full text-sm" aria-label={label}>
        <thead>
          <tr className="bg-band text-xs text-muted-foreground">
            {columns.map((c, i) => (
              <th
                key={i}
                className={cn(
                  'h-9 px-4 font-medium whitespace-nowrap first:md:pl-5 last:md:pr-5',
                  c.align === 'right' ? 'text-right' : 'text-left',
                  c.className,
                )}
              >
                {c.srOnly ? <span className="sr-only">{c.label}</span> : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              {r.map((cell, j) => (
                <td
                  key={j}
                  className={cn(
                    'h-11 px-4 py-2 align-middle first:md:pl-5 last:md:pr-5',
                    columns[j]?.align === 'right' && 'text-right tabular-nums',
                    columns[j]?.className,
                    columns[j]?.cell,
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </FrameScroll>
  )
}

/**
 * Key-value rows as table-like bands: the name (and a line on what it does) on the left, the value
 * or its control on the right, a hairline between rows. On a phone a `wide` control goes under its name.
 */
export function FrameRows({
  rows,
}: {
  rows: {
    label: React.ReactNode
    hint?: React.ReactNode
    value: React.ReactNode
    id?: string
    wide?: boolean
  }[]
}) {
  return (
    <dl className="border-t">
      {rows.map((r, i) => (
        <div
          key={r.id ?? i}
          className={cn(
            'grid items-center gap-x-6 gap-y-2 border-t px-4 py-3 text-sm first:border-t-0 md:px-5',
            // A small control (a switch, a button) stays on the right at every width; a wide one goes under its name on a phone.
            r.wide ? 'sm:grid-cols-(--cols-trail-auto)' : 'grid-cols-(--cols-trail-auto)',
          )}
        >
          <dt className="min-w-0">
            <div className="font-medium">{r.label}</div>
            {r.hint && <div className="mt-0.5 text-pretty text-muted-foreground">{r.hint}</div>}
          </dt>
          <dd className="min-w-0">{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The band at the bottom of a frame, for actions. */
export function FrameFooter({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 border-t bg-band-soft px-4 py-3 md:px-5',
        className,
      )}
    >
      {children}
    </div>
  )
}

const calloutTone = {
  warn: 'border-caution/45 bg-caution/8',
  info: 'bg-band',
}

/** A square tinted band for something to act on: a callout, never a floating card. */
export function FrameCallout({
  tone = 'info',
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & { tone?: keyof typeof calloutTone }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start gap-3 rounded-frame border p-4 text-sm',
        calloutTone[tone],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
