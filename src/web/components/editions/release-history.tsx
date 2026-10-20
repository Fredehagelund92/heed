import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { AuditEntry, AuditSearchParams } from '@/api'
import { areasQuery, editionQuery, latestAuditQuery, libraryQuery } from '@/api/queries'
import { HistoryIcon } from '@/components/icons'
import { releaseHistoryLine } from '@/lib/editions'
import { usePermissions } from '@/lib/use-session'
import { cn } from '@/lib/utils'

/** Going back to an edition, as the history log records it. */
export const goBackHistory = (label: string): AuditSearchParams => ({
  action: 'edition.rollback',
  subjectId: label,
})

/** A stop switch for one target, on or off, as the history log records it. */
export const stopHistory = (
  scope: 'all' | 'area' | 'item',
  id: string | null | undefined,
  on: boolean,
): AuditSearchParams => ({
  action: on ? 'stop.on' : 'stop.off',
  subjectType: scope,
  subjectId: id ?? 'all',
})

/**
 * Whether the person reads the history log (administrators and auditors, FR-808). An owner reads
 * Editions too, but not the log, so the lines it would give are left out for them.
 */
function useReadsHistory() {
  const { ready, isFor } = usePermissions()
  return ready && isFor('administration')
}

/**
 * The newest entry of the history log for some filters, as one line: who did it, what and when,
 * and why, with the way to the entry in the history log (Administration). Nothing while it loads or
 * when there is none: the line reports what is recorded, so it never guesses.
 */
export function ReleaseHistoryLine({
  filters,
  className,
}: {
  filters: AuditSearchParams
  className?: string
}) {
  const enabled = useReadsHistory()
  const { data: entry } = useQuery({ ...latestAuditQuery(filters), enabled })
  return entry ? <HistoryLine entry={entry} className={className} /> : null
}

/**
 * The last time someone went back to an edition or used the stop switch, from the history log:
 * the live card's record of the guarded actions.
 */
export function LastReleaseAction({ className }: { className?: string }) {
  const enabled = useReadsHistory()
  const { data: back } = useQuery({ ...latestAuditQuery({ action: 'edition.rollback' }), enabled })
  const { data: stop } = useQuery({ ...latestAuditQuery({ action: 'stop' }), enabled })
  const newest = [back, stop]
    .filter((entry): entry is AuditEntry => Boolean(entry))
    .sort((a, b) => b.seq - a.seq)[0]
  return newest ? <HistoryLine entry={newest} className={className} /> : null
}

function HistoryLine({ entry, className }: { entry: AuditEntry; className?: string | undefined }) {
  const { data: areas } = useQuery(areasQuery())
  const isItem = entry.subjectType === 'item'
  const { data: library } = useQuery({ ...libraryQuery(), enabled: isItem })
  const goneBack = entry.action === 'edition.rollback' && entry.subjectId !== null
  const { data: edition } = useQuery({
    ...editionQuery(entry.subjectId ?? ''),
    enabled: goneBack,
  })
  const target =
    entry.subjectType === 'all'
      ? 'everything'
      : entry.subjectType === 'area'
        ? areas?.find((area) => area.id === entry.subjectId)?.name
        : library?.items.find((item) => item.id === entry.subjectId)?.title
  const sentence = releaseHistoryLine(entry, {
    ...(target ? { target: isItem ? `the item "${target}"` : target } : {}),
    restores: edition?.restores ?? null,
  })
  return (
    <p
      data-slot="release-history"
      className={cn('flex items-start gap-2 text-dense text-muted-foreground', className)}
    >
      <HistoryIcon aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 break-words">
        {sentence}{' '}
        <Link
          to="/admin"
          search={{ section: 'audit', entry: entry.seq }}
          className="font-bold text-foreground underline-offset-4 hover:underline"
        >
          Open in the history log
        </Link>
      </span>
    </p>
  )
}
