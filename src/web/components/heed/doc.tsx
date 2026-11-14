import type { ReactNode } from 'react'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { FoldTrigger } from '@/components/heed/fold'
import { cn } from '@/lib/utils'

// The context item as a document, laid out the way editorcn's Simple Document Editor template lays out its
// page: a muted canvas, a paper sheet with the title as a large heading and the text as the
// document, and a slim footer. The item's fields sit in a property strip under the title instead of
// a form. Used by the editor and, read-only, by the item's page.

/** editorcn's canvas: the muted surface the paper sits on. */
export function Canvas({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('bg-band', className)}>{children}</div>
}

/**
 * editorcn's article: full bleed on a phone, a bordered sheet from sm up. The sheet is a fixed 56rem
 * (896px) at most, centred in its pane with a 24px gutter, so the properties grid never moves when
 * the window, the sidebar or a panel changes. Prose inside keeps a reading measure (`prose`).
 */
export function Paper({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <article
      className={cn(
        'bg-background px-4 py-5 transition-[border-color,box-shadow] sm:mx-auto sm:mt-4 sm:mb-6 sm:w-sheet-inset sm:max-w-sheet sm:rounded-frame sm:border sm:px-10 sm:py-12 sm:shadow-xs xl:px-14',
        // Writing in it, the sheet says so: a soft ring while the text has focus.
        'sm:has-[.ProseMirror:focus]:border-ring/60 sm:has-[.ProseMirror:focus]:ring-3 sm:has-[.ProseMirror:focus]:ring-ring/15',
        className,
      )}
    >
      {children}
    </article>
  )
}

/**
 * The reading measure for a document's prose: 60ch, about 79 characters of the body face, left
 * aligned in the sheet. Properties, chips and tables don't take it, so they use the sheet's width.
 */
export const prose = 'max-w-reading'

/** The item's fields, one quiet row each: a label and its value or its control. */
export function Properties({ children }: { children: ReactNode }) {
  return <dl className="mb-6 flex flex-col gap-0.5 border-b pb-5 text-sm sm:mb-8">{children}</dl>
}

export function Property({
  label,
  icon,
  children,
}: {
  label: string
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="grid min-h-8 grid-cols-(--cols-lead-30) items-center gap-2 sm:grid-cols-(--cols-lead-36)">
      <dt className="flex items-center gap-2 text-muted-foreground [&>svg]:size-3.5 [&>svg]:shrink-0">
        {icon}
        {label}
      </dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-1.5">{children}</dd>
    </div>
  )
}

/** One closed row in a document, like the quick view's Details: a label and what is set. */
export function DocFold({
  label,
  summary,
  children,
}: {
  label: string
  summary: ReactNode
  children: ReactNode
}) {
  return (
    <Collapsible>
      {/* One line, one target: the label, then what is set, muted, then the chevron. Its band
          reaches a little past the words, which stay in line with the rows above. */}
      <div className="-mx-2">
        <FoldTrigger label={label} summary={summary} className="rounded-md px-2" />
      </div>
      <CollapsibleContent keepMounted>{children}</CollapsibleContent>
    </Collapsible>
  )
}

/**
 * The properties a new person doesn't need up front, folded into one row: "More" and a quiet
 * one-line summary of what is set; opened, the rows themselves.
 */
export function MoreProperties({
  summary,
  children,
  label = 'More',
}: {
  summary: ReactNode
  children: ReactNode
  label?: string
}) {
  return (
    <DocFold label={label} summary={summary}>
      <dl className="flex flex-col gap-0.5">{children}</dl>
    </DocFold>
  )
}

/** editorcn's footer, at the header's height, hairline and text size: counts on the left, a status on the right. */
export function DocFooter({ children, status }: { children: ReactNode; status?: ReactNode }) {
  return (
    <footer className="flex h-bar shrink-0 items-center gap-4 border-t bg-background px-4 text-sm text-muted-foreground tabular-nums md:px-6">
      {children}
      {status && <div className="ml-auto flex items-center gap-1.5">{status}</div>}
    </footer>
  )
}

/** A section of the side panel, Efferd style: a 16px title over a hairline. */
export function SideSection({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children?: ReactNode
  className?: string
}) {
  return (
    <section className={cn('border-b px-4 py-4', className)}>
      <h2 className="text-base leading-snug font-medium">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      {children && <div className="mt-3">{children}</div>}
    </section>
  )
}
