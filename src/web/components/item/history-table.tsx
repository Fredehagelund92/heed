import type { HistoryEntry } from '@/api'
import { VersionBadge } from '@/components/item/fact-badges'
import { GitCommitHorizontalIcon, PencilLineIcon, BadgeCheckIcon } from '@/components/icons'
import { gridCell } from '@/components/page/grid'
import { GridHeaderCells } from '@/components/page/grid-table'
import { formatDay } from '@/lib/library'
import { cn } from '@/lib/utils'

/**
 * One version: who wrote it, and who accepted or retired it, with the dates. `binned` and
 * `restored` are its latest stay in the Bin: who moved it there and who brought it back, and the
 * domain it came back into when its own was deleted (FR-814).
 */
export type VersionRow = {
  version: number
  proposed: { by: string; date: string } | null
  accepted: { by: string; date: string } | null
  retired: { by: string; date: string } | null
  binned: { by: string; date: string } | null
  restored: { by: string; date: string; domain?: string } | null
}

/** Folds the history's events into one row per version, newest first (S4 of the item page design). */
export function versionRows(
  history: HistoryEntry[],
  name: (personId: string) => string,
): VersionRow[] {
  const rows = new Map<number, VersionRow>()
  for (const entry of history) {
    const row = rows.get(entry.version) ?? {
      version: entry.version,
      proposed: null,
      accepted: null,
      retired: null,
      binned: null,
      restored: null,
    }
    // Newest first: a version's latest stay in the Bin is the one it shows.
    row[entry.event] ??= {
      by: name(entry.personId),
      date: entry.date,
      ...(entry.domain ? { domain: entry.domain } : {}),
    }
    rows.set(entry.version, row)
  }
  return [...rows.values()].sort((a, b) => b.version - a.version)
}

function Who({ who, empty }: { who: { by: string; date: string } | null; empty: string }) {
  if (!who) return <span className="text-muted-foreground">{empty}</span>
  return (
    <>
      <span className="truncate">{who.by}</span>
      <span className="text-caption text-muted-foreground tabular-nums">{formatDay(who.date)}</span>
    </>
  )
}

/**
 * The item's history as a bordered table (S4 of the item page design): one row per version, 56
 * high, with who wrote it and who accepted it. On a narrow page each cell names its column.
 */
export function HistoryTable({ rows, quiet = false }: { rows: VersionRow[]; quiet?: boolean }) {
  const cell = quiet
    ? cn(gridCell, 'flex-1 flex-col items-start justify-center gap-1 py-2')
    : 'flex min-w-0 flex-1 flex-col justify-center gap-1 border-l px-4 py-3'
  const key = 'text-caption text-muted-foreground @md:sr-only'
  return (
    <div
      role="table"
      aria-label="Versions"
      data-slot="history-table"
      className={cn(
        'flex flex-col overflow-hidden border bg-card text-dense',
        quiet ? 'rounded-sm' : 'rounded-lg',
      )}
    >
      <div role="rowgroup" className="hidden @md:flex">
        <div
          role="row"
          className={cn(
            'flex h-table-header w-full items-center text-caption text-muted-foreground',
            quiet ? 'border-b border-border-subtle font-normal' : 'bg-muted font-bold',
          )}
        >
          {quiet ? (
            <GridHeaderCells
              columns={[
                { icon: GitCommitHorizontalIcon, title: 'Version', className: 'w-column-version' },
                { icon: PencilLineIcon, title: 'Written by', className: 'flex-1' },
                { icon: BadgeCheckIcon, title: 'Accepted by', className: 'flex-1' },
              ]}
            />
          ) : (
            <>
              <span role="columnheader" className="w-column-version shrink-0 px-4">
                Version
              </span>
              <span role="columnheader" className="flex-1 border-l px-4">
                Written by
              </span>
              <span role="columnheader" className="flex-1 border-l px-4">
                Accepted by
              </span>
            </>
          )}
        </div>
      </div>
      <div
        role="rowgroup"
        className="flex flex-col [&>div]:border-t @md:[&>div:first-child]:border-t-0"
      >
        {rows.map((row) => (
          <div
            key={row.version}
            role="row"
            className={cn(
              'flex min-h-14 flex-wrap @md:flex-nowrap',
              quiet && 'border-border-subtle',
            )}
          >
            <div
              role="cell"
              className="flex w-full items-center px-4 pt-3 @md:w-column-version @md:shrink-0 @md:py-3"
            >
              <VersionBadge version={row.version} />
            </div>
            <div role="cell" className={cn(cell, 'border-l-0 @md:border-l')}>
              <span className={key}>Written by</span>
              <Who who={row.proposed} empty="Not recorded" />
            </div>
            <div role="cell" className={cell}>
              <span className={key}>Accepted by</span>
              <Who who={row.accepted} empty="Waiting for review" />
              {row.retired ? (
                <span className="text-caption text-muted-foreground">
                  Archived by {row.retired.by} on {formatDay(row.retired.date)}
                </span>
              ) : null}
              {row.binned ? (
                <span className="text-caption text-muted-foreground">
                  Moved to the Bin by {row.binned.by} on {formatDay(row.binned.date)}
                </span>
              ) : null}
              {row.restored ? (
                <span className="text-caption text-muted-foreground">
                  {row.restored.domain
                    ? `Restored into ${row.restored.domain} for review by ${row.restored.by} on ${formatDay(row.restored.date)}`
                    : `Restored by ${row.restored.by} on ${formatDay(row.restored.date)}`}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
