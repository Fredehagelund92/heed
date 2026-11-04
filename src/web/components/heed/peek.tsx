import * as React from 'react'
import type { LucideIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { FoldTrigger } from '@/components/heed/fold'

// The quick view (peek) of a context item or a definition, from the peek design's option 2: a note
// and one closed Details row. Every element passed one test: is it content a person wrote or reads,
// a decision they make here, or machinery the product does? Machinery is gone or behind Details.
// A peek is a few bands cut by full-width hairlines: the title, the meaning and (only when a
// decision is needed) one attention line; who owns it, whether it is still right and where it
// comes from; for a definition the other words; then Details, closed; for a context item the
// toolbar under it.

/** The bands, each cut from the next by a hairline that runs edge to edge. */
export function PeekBands({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col pt-6 [&>*+*]:border-t">{children}</div>
}

/** One band. The first (the title) has no space above, since the body's own top padding is there; a flush band brings its own. */
export function PeekBand({
  children,
  first,
  flush,
  label,
}: {
  children: React.ReactNode
  first?: boolean
  flush?: boolean
  label?: string
}) {
  return (
    <section
      aria-label={label}
      className={cn(flush ? 'p-0' : first ? 'px-4 pb-5 @md:px-5' : 'px-4 py-5 @md:px-5')}
    >
      {children}
    </section>
  )
}

/** The name, once: in the body, not repeated in the bar. */
export function PeekTitle({
  children,
  lead,
}: {
  children: React.ReactNode
  lead?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3">
      {lead}
      <h2 className="min-w-0 text-lg leading-6 font-bold tracking-tight text-pretty break-words">
        {children}
      </h2>
    </div>
  )
}

/** The words themselves, the largest text in the peek. */
export function PeekMeaning({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 text-reading leading-6">{children}</div>
}

/** The one thing that needs a decision, with one button. The choice itself is made on the page. */
export function PeekAttention({
  icon: Icon,
  children,
  action,
}: {
  icon: LucideIcon
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div
      role="note"
      className="mt-4 flex items-center gap-2.5 rounded-frame border border-caution/45 bg-caution/8 py-2 pr-2 pl-3 text-sm dark:border-warn/45 dark:bg-caution/12"
    >
      <Icon aria-hidden className="size-4 shrink-0 text-caution-text dark:text-warn" />
      <span className="min-w-0 flex-1 text-pretty break-words">{children}</span>
      {action && <span className="shrink-0">{action}</span>}
    </div>
  )
}

/** A quiet fact line: an icon and a sentence, names in the ink colour. */
export function PeekFact({
  icon: Icon,
  children,
}: {
  icon: LucideIcon
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2 text-dense leading-5 text-muted-foreground [&_b]:font-semibold [&_b]:text-foreground">
      <Icon aria-hidden className="mt-0.75 size-3.5 shrink-0" />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  )
}

export function PeekFacts({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-2">{children}</div>
}

/** A tiny label over a band's content, used only where a band would be ambiguous ("Also called"). */
export function PeekLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-xs font-semibold text-muted-foreground">{children}</p>
}

/**
 * One closed row with what experienced people need in place: content people wrote or read, never
 * machinery.
 */
export function PeekFold({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <Collapsible>
      <FoldTrigger label="Details" summary={summary} className="px-4 @md:px-5" />
      <CollapsibleContent keepMounted>
        <div className="px-4 pb-5 @md:px-5">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** A definition's Details: a short label-value list and a few quiet links. */
export function PeekDetails({
  rows,
  links,
}: {
  rows: [string, React.ReactNode][]
  links: React.ReactNode[]
}) {
  return (
    <PeekFold summary={rows.map(([k]) => k).join(', ')}>
      <dl className="grid grid-cols-(--cols-lead-23) gap-x-3 gap-y-2 text-sm @md:grid-cols-(--cols-lead-26)">
        {rows.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className="text-dense leading-5.5 font-medium text-muted-foreground">{k}</dt>
            <dd className="min-w-0 leading-5.5 break-words">{v}</dd>
          </React.Fragment>
        ))}
      </dl>
      {links.length > 0 && <div className="mt-4 flex flex-col items-start gap-1.5">{links}</div>}
    </PeekFold>
  )
}

/** The quiet actions on a context item, in their own band under Details, open or shut. */
export function PeekToolbar({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap items-center gap-x-2.5 px-4 py-1.5 @md:px-5"
    >
      {children}
    </div>
  )
}

/** A quiet link in Details or the toolbar: an icon and a few words, 44 px under a finger. */
export function PeekLink({
  icon: Icon,
  children,
  onClick,
  href,
  className,
}: {
  icon: LucideIcon
  children: React.ReactNode
  onClick?: () => void
  href?: string
  className?: string
}) {
  const cls = cn(
    "-ml-1.5 h-7 gap-1.5 px-1.5 text-dense font-medium text-muted-foreground hover:text-foreground pointer-coarse:h-11 [&_svg:not([class*='size-'])]:size-3.5",
    className,
  )
  if (href)
    return (
      <Button
        variant="ghost"
        size="sm"
        className={cls}
        nativeButton={false}
        render={<a href={href} />}
      >
        <Icon aria-hidden />
        {children}
      </Button>
    )
  return (
    <Button variant="ghost" size="sm" className={cls} onClick={onClick}>
      <Icon aria-hidden />
      {children}
    </Button>
  )
}
