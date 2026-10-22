import { useId, type ComponentProps, type ReactNode } from 'react'
import type { ItemKind } from '@domain/item'
import { KindIcon } from '@/components/item/kind-icon'
import { cn } from '@/lib/utils'

/*
  One card about the object an agent or the assistant changes (contract 7.2, 9.8): the object's
  kind glyph and title, its state, what changes, what is left for the person, and one decision.
  The same card serves the assistant's draft before it is created and an agent's proposal on its
  review page, so a change an agent made reads the same wherever a person meets it.
*/

export function ChangeCard({
  label,
  kind,
  title,
  badges,
  meta,
  children,
  note,
  status,
  actions,
  className,
  ...rest
}: {
  /** What the object is, for a screen reader before its title: "New draft". */
  label: string
  kind: ItemKind | null
  title: ReactNode
  /** Its state, as badges: "Unreviewed draft". */
  badges?: ReactNode
  /** Words beside the badges: "New item", "Only you can see it". */
  meta?: ReactNode
  /** What changes: the fields, or the diff. */
  children: ReactNode
  /** What is left for the person. */
  note?: ReactNode
  /** Where the decision stands, in a status region: "Saving the draft". */
  status?: ReactNode
  /** The one decision: a primary, and at most one quiet way out. */
  actions?: ReactNode
  className?: string
} & Omit<ComponentProps<'section'>, 'title' | 'children'>) {
  const labelId = useId()
  const titleId = useId()
  const footer = status || actions
  return (
    <section
      data-slot="change-card"
      aria-labelledby={`${labelId} ${titleId}`}
      className={cn('flex min-w-0 flex-col rounded-lg border bg-card', className)}
      {...rest}
    >
      <header className="flex min-w-0 flex-col gap-2 px-4 pt-4 pb-3">
        <span id={labelId} className="sr-only">
          {label}:
        </span>
        <p className="flex min-w-0 items-start gap-2 text-body font-bold text-pretty break-words">
          {kind ? (
            <span className="flex h-5 shrink-0 items-center">
              <KindIcon kind={kind} size="md" />
            </span>
          ) : null}
          <span id={titleId} className="min-w-0">
            {title}
          </span>
        </p>
        {badges || meta ? (
          <div
            data-slot="change-card-meta"
            className={cn(
              'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground',
              kind && 'pl-6',
            )}
          >
            {badges}
            {meta}
          </div>
        ) : null}
      </header>
      <div
        data-slot="change-card-body"
        className="flex min-w-0 flex-col gap-3 border-t border-border-subtle px-4 py-3"
      >
        {children}
        {note ? (
          <div data-slot="change-card-note" className="text-caption text-muted-foreground">
            {note}
          </div>
        ) : null}
      </div>
      {footer ? (
        <footer
          data-slot="change-card-footer"
          className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-subtle px-4 py-3"
        >
          {status || actions ? (
            <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-2">
              {status ? (
                <p
                  role="status"
                  className="flex min-w-0 items-center gap-2 text-caption text-muted-foreground empty:sr-only"
                >
                  {status}
                </p>
              ) : null}
              {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
            </div>
          ) : null}
        </footer>
      ) : null}
    </section>
  )
}
