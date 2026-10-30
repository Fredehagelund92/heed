import type { LogEntry } from '@/model/items'
// A context item's or a definition's versions as the app reads them (src/web/api): a number,
// who, when and what changed. Pure types and the words a version list says them with.

export type VersionKind =
  | 'wording'
  | 'link'
  | 'formatting'
  | 'dates'
  | 'published'
  | 'returned'
  | 'checked'
  | 'synced'
  | 'archived'
  | 'moved'
  | 'retyped'
  | 'owners'

export type Version = {
  v: number
  who: string
  /** ISO date. */
  on: string
  kind: VersionKind
  /** One sentence: what this version changed. */
  summary: string
  /** The field it changed, and its words before and after, for the read-only diff. */
  field: string
  before: string
  after: string
}

/** Whether a version changed the words, so it can be restored (a check or a return changed nothing). */
export const restorable = (v: Version) =>
  !['checked', 'returned', 'synced', 'archived', 'moved', 'retyped', 'owners'].includes(v.kind)

/** A short plain verb for each kind, as a row says it: "Jon Abara edited wording". */
export const VERB: Record<VersionKind, string> = {
  wording: 'edited wording',
  link: 'changed the link',
  formatting: 'changed formatting',
  dates: 'changed the dates',
  published: 'published a suggestion',
  returned: 'returned a suggestion',
  checked: 'checked it: still true',
  synced: 'synced a change',
  archived: 'archived it',
  moved: 'moved it',
  retyped: 'changed its kind',
  owners: 'changed its owners',
}

/**
 * The demo world's today, as the rest of the mock dates it, until the workspace's own today comes
 * from the service (the golden plan's P11).
 */
export const TODAY = '2026-10-23'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "today", "yesterday", "4 days ago", "12 Oct", "3 Oct 2025". */
export function relativeDate(iso: string) {
  const days = Math.round((Date.parse(TODAY) - Date.parse(iso)) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m! - 1]}${y === Number(TODAY.slice(0, 4)) ? '' : ` ${y}`}`
}

/** "October 2026": a version list's group header. */
export const monthOf = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

/** A change to many items, as the History log says it: "Archived “A”, “B” and 3 more". */
export function logLine(e: Pick<LogEntry, 'what' | 'summary' | 'items'>) {
  const names = e.items.map((i) => `“${i.title}”`)
  const titles =
    names.length > 2
      ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
      : names.join(' and ')
  const verb = {
    archived: 'Archived',
    deleted: 'Deleted',
    moved: 'Moved',
    kind: 'Changed the kind of',
    owners: 'Changed the owners of',
    checked: 'Checked',
  }[e.what]
  const detail =
    e.what === 'moved'
      ? e.summary.replace(/^Moved /, '').replace(/\.$/, '')
      : e.what === 'kind' || e.what === 'owners'
        ? e.summary.replace(/\.$/, '')
        : ''
  return `${verb} ${titles}${detail ? `: ${detail.charAt(0).toLowerCase()}${detail.slice(1)}` : ''}`
}
