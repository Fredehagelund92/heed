import type { ReactNode } from 'react'
import type { Area } from '@domain/item'

/**
 * What an option for a domain carries: the domain's name as its accessible name, and its summary
 * line as its description, so a screen reader says "Commercial" and then what it holds.
 */
export function domainOptionProps(area: Pick<Area, 'id' | 'name' | 'summary'>, list: string) {
  return {
    'aria-label': area.name,
    ...(area.summary ? { 'aria-describedby': `${list}-${area.id}-summary` } : {}),
  }
}

/**
 * A domain in a picker: its name, and its summary line under it when it has one (FR-813), so a
 * person picks the domain by what it holds, not only by its name. `list` names the picker, so
 * the summary's id is unique on the page (`domainOptionProps`).
 */
export function DomainOptionText({
  area,
  list,
  children,
}: {
  area: Pick<Area, 'id' | 'summary'>
  list: string
  /** The name, as the picker draws it (a badge or plain text). */
  children: ReactNode
}) {
  return (
    <span className="flex min-w-0 flex-col">
      {children}
      {area.summary ? (
        <span
          id={`${list}-${area.id}-summary`}
          className="truncate text-caption text-muted-foreground"
        >
          {area.summary}
        </span>
      ) : null}
    </span>
  )
}
