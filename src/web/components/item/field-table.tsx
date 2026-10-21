import type { ReactNode } from 'react'
import type { Icon } from '@/components/icons'
import { useInRail } from '@/components/page/page-rail'
import { cn } from '@/lib/utils'

/*
  The property table of a document page (contract 7.2, "FieldRow"): a bordered grid with a line
  between the rows and between the label and the value, rows at least 44 high, and one field
  icon per field, the same icon the field has everywhere else. In a page rail it is a flat list
  of the same rows, the label and its icon muted, then the value, with no lines; the label sits
  on the value's first line, whether that is text, a badge or text with a hint under it.
*/

export function FieldTable({
  label,
  children,
  wideLabels = false,
  className,
}: {
  label: string
  children: ReactNode
  /** A wider label column from a 448 pixel page, for names of two words ("Needs a look"). */
  wideLabels?: boolean
  className?: string
}) {
  const inRail = useInRail()
  return (
    <dl
      aria-label={label}
      data-slot="field-table"
      data-labels={wideLabels ? 'wide' : undefined}
      data-flat={inRail ? '' : undefined}
      className={cn(
        'flex flex-col text-dense',
        !inRail && 'overflow-hidden rounded-lg border bg-card [&>div+div]:border-t',
        className,
      )}
    >
      {children}
    </dl>
  )
}

export function FieldRow({
  icon: Glyph,
  label,
  children,
  hint,
}: {
  icon: Icon
  label: string
  children: ReactNode
  /** A plain sentence under the value: what it means. */
  hint?: ReactNode
}) {
  const inRail = useInRail()
  return (
    <div data-slot="field-row" className={cn('flex', !inRail && 'min-h-control-touch')}>
      <dt
        className={cn(
          'flex w-field-label shrink-0 items-center gap-2 text-muted-foreground heed-ink @md:in-data-[labels=wide]:w-field-label-wide',
          inRail ? 'h-control-md' : 'px-4 py-3',
        )}
      >
        <Glyph aria-hidden="true" className="size-icon-sm shrink-0" />
        <span className="min-w-0">{label}</span>
      </dt>
      <dd
        className={cn(
          'flex min-w-0 flex-1 flex-col items-start justify-center gap-1',
          inRail ? 'py-1' : 'border-l px-4 py-3',
        )}
      >
        {inRail ? (
          // The value's first line is a 24 band centred on the label, for text and badges alike.
          <span className="flex min-h-6 items-center">
            <span>{children}</span>
          </span>
        ) : (
          children
        )}
        {hint ? <span className="text-caption text-muted-foreground">{hint}</span> : null}
      </dd>
    </div>
  )
}

/** A section of a document page: an `h2` with its field icon, then the content (contract 5). */
export function Section({
  title,
  icon: Glyph,
  level = 2,
  children,
}: {
  title: string
  icon: Icon
  /** h2 on a page; h3 where the surface's own title is an h2 (a docked panel). */
  level?: 2 | 3
  children: ReactNode
}) {
  const Heading = level === 2 ? 'h2' : 'h3'
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <Heading className="flex items-center gap-2 text-large font-bold tracking-large">
        <Glyph aria-hidden="true" className="size-4 shrink-0 text-muted-foreground heed-ink" />
        {title}
      </Heading>
      {children}
    </section>
  )
}
