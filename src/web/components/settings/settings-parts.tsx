import { useId, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Person } from '@domain/item'
import { peopleQuery } from '@/api/queries'
import { productName } from '@/lib/brand'

/**
 * A section of a settings page: its heading in the large type, a muted line under it and an
 * action at the end of the heading row, then its content. Sections of a page are 32 apart.
 */
export function SettingsBlock({
  title,
  description,
  action,
  slot,
  children,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  /** Names the block for tests and screenshots (`data-slot`). */
  slot?: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <section
      aria-labelledby={id}
      data-slot={slot}
      // Its own container: a grid inside drops its optional columns by the block's width.
      className="@container flex min-w-0 flex-col gap-3"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={id} className="text-large font-bold">
            {title}
          </h2>
          {description ? (
            <p className="max-w-reading text-dense text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/** People by id, for the names beside roles, changes and log entries. */
export function usePeople() {
  const { data: people = [] } = useQuery(peopleQuery())
  const byId = new Map(people.map((person) => [person.id, person]))
  return {
    people,
    person: (id: string | null): Person | undefined => (id ? byId.get(id) : undefined),
    /** A person's name; "Someone no longer here" for an id the list does not hold. */
    nameOf: (id: string | null, fallback = 'Someone no longer here') =>
      id ? (byId.get(id)?.name ?? fallback) : productName,
  }
}
