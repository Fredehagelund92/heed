import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { BinEntry } from '@/api'
import { areasQuery, binQuery, peopleQuery } from '@/api/queries'
import {
  FileTextIcon,
  GitPullRequestIcon,
  HeedDomainIcon,
  QuoteIcon,
  RotateCcwIcon,
  Trash2Icon,
  UserRoundIcon,
} from '@/components/icons'
import { DomainBadge, KindIcon } from '@/components/item/item-marks'
import { gridCell, gridRowControl } from '@/components/page/grid'
import {
  GridFailed,
  GridHeaderCells,
  GridLoading,
  GridMessage,
  GridTable,
  type GridColumn,
} from '@/components/page/grid-table'
import { Page, PageContent } from '@/components/page/page'
import { SelectionBar, SelectionBarButton } from '@/components/page/selection-bar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { formatDay } from '@/lib/library'
import { selectionRange } from '@/lib/list-selection'
import { cn } from '@/lib/utils'
import { RestoreFromBinDialog, type BinSubject } from './bin-dialogs'

const SLOT = 'bin'

/**
 * The title and the reason share the room the fixed columns leave, the title twice the reason's
 * share, and each takes up to two lines, so a narrow table still reads them; the row grows. On a
 * phone every cell wraps under the title.
 */
const titleCell = 'min-w-0 flex-2 shrink gap-2'
const reasonCell = 'min-w-0 flex-1 shrink'

const columns: readonly GridColumn[] = [
  { icon: HeedDomainIcon, title: 'Domain', className: 'w-column-domain' },
  { icon: UserRoundIcon, title: 'Moved', className: 'w-column-owner' },
  { icon: QuoteIcon, title: 'Why', className: reasonCell },
]

/**
 * The Bin (an administrator's): the items moved out of the library, newest first, with who moved
 * each, when and why. Agents do not get them and no list, search or count shows them. Restore
 * brings an item back as it was: served again if agents got it, otherwise retired. An item whose
 * domain was deleted goes to another domain the administrator chooses, retired, with a proposal
 * there (FR-814). Select rows to restore several at once; Shift and a click selects every row
 * between.
 */
export function BinPage() {
  const bin = useQuery(binQuery())
  const { data: areas = [] } = useQuery(areasQuery())
  const { data: people = [] } = useQuery(peopleQuery())
  const entries = useMemo(() => bin.data?.items ?? [], [bin.data])
  const ids = useMemo(() => entries.map((entry) => entry.itemId), [entries])
  // Rows restored since the list was read leave the selection.
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const selected = useMemo(
    () => new Set([...chosen].filter((id) => ids.includes(id))),
    [chosen, ids],
  )
  const [anchor, setAnchor] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<readonly BinSubject[]>([])
  const [restoreOpen, setRestoreOpen] = useState(false)
  const restore = (subjects: readonly BinSubject[]) => {
    setRestoring(subjects)
    setRestoreOpen(true)
  }
  const personName = (id: string) => people.find((person) => person.id === id)?.name ?? 'Someone'

  const toggle = (id: string, range: boolean) => {
    if (range && anchor) {
      const span = selectionRange(ids, anchor, id)
      setChosen((current) => new Set([...current, ...span]))
      return
    }
    setAnchor(id)
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const on = ids.filter((id) => selected.has(id)).length
  const all = on > 0 && on === ids.length

  let body
  if (bin.isPending) body = <GridLoading slot={SLOT} label="Loading the Bin" />
  else if (bin.isError)
    body = <GridFailed slot={SLOT} what="the Bin" retry={() => void bin.refetch()} />
  else if (entries.length === 0)
    body = (
      <GridMessage
        slot={SLOT}
        icon={Trash2Icon}
        title="The Bin is empty"
        action={
          <Button variant="outline" render={<Link to="/library" />}>
            Open the library
          </Button>
        }
      >
        Facts an admin moves out of the library wait here until someone restores them.
      </GridMessage>
    )
  else
    body = (
      <GridTable
        slot={SLOT}
        label="Bin"
        header={
          <>
            <div role="columnheader" className={cn(gridCell, titleCell)}>
              <Checkbox
                checked={all}
                indeterminate={on > 0 && !all}
                onCheckedChange={() => setChosen(on === 0 ? new Set(ids) : new Set())}
                aria-label={on ? 'Clear the selection' : 'Select every fact in the Bin'}
                className={cn(on === 0 && gridRowControl)}
              />
              <FileTextIcon aria-hidden="true" className="size-icon-sm shrink-0" />
              <span className="truncate">Fact</span>
            </div>
            <GridHeaderCells columns={columns} />
            <div role="columnheader" className={cn(gridCell, 'w-column-until')}>
              <span className="sr-only">Restore</span>
            </div>
          </>
        }
      >
        {entries.map((entry) => (
          <BinRow
            key={entry.itemId}
            entry={entry}
            selected={selected.has(entry.itemId)}
            selecting={selected.size > 0}
            onToggle={(range) => toggle(entry.itemId, range)}
            domain={areas.find((area) => area.id === entry.areaId)}
            movedBy={personName(entry.binnedBy)}
            onRestore={() => restore([toSubject(entry)])}
          />
        ))}
      </GridTable>
    )

  return (
    <Page title="Bin">
      <PageContent width="list" className={cn('gap-6', selected.size > 0 && 'pb-16')}>
        {entries.length ? (
          <p className="max-w-reading text-body text-muted-foreground">
            Facts moved out of the library. Agents don't get them, and no list, search or count
            shows them. Restore brings a fact back as it was. If its domain was deleted, it goes to
            another domain for review.
          </p>
        ) : null}
        <div className="flex flex-col gap-3">
          {body}
          {entries.length ? (
            <p className="text-dense text-muted-foreground" role="status" data-slot="bin-count">
              {entries.length === 1 ? '1 fact' : `${entries.length.toLocaleString('en')} facts`} in
              the Bin
            </p>
          ) : null}
        </div>
      </PageContent>
      {selected.size > 0 ? (
        <SelectionBar count={selected.size} onClear={() => setChosen(new Set())}>
          <SelectionBarButton
            onClick={() =>
              restore(entries.filter((entry) => selected.has(entry.itemId)).map(toSubject))
            }
          >
            <RotateCcwIcon />
            Restore
          </SelectionBarButton>
        </SelectionBar>
      ) : null}
      <RestoreFromBinDialog
        subjects={restoring}
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        onRestored={() => {
          const restored = new Set(restoring.map((subject) => subject.id))
          setChosen((current) => new Set([...current].filter((id) => !restored.has(id))))
        }}
      />
    </Page>
  )
}

const toSubject = (entry: BinEntry): BinSubject => ({
  id: entry.itemId,
  kind: entry.kind,
  title: entry.title,
  deletedDomain: entry.deletedDomain,
})

/**
 * One item in the Bin: its title, which opens it to read, its domain, who moved it, when and why,
 * and its Restore.
 */
function BinRow({
  entry,
  selected,
  selecting,
  onToggle,
  domain,
  movedBy,
  onRestore,
}: {
  entry: BinEntry
  selected: boolean
  /** Whether anything is selected: the boxes then show on every row. */
  selecting: boolean
  onToggle: (range: boolean) => void
  domain: { name: string; label: Parameters<typeof DomainBadge>[0]['label'] } | undefined
  movedBy: string
  onRestore: () => void
}) {
  return (
    <div
      role="row"
      data-row-id={entry.itemId}
      aria-selected={selected}
      className="group/row flex min-h-row items-stretch hover:bg-accent"
    >
      <div role="cell" className={cn(gridCell, titleCell, 'py-2')}>
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggle(false)}
          onMouseDown={(event) => {
            // Shift-click selects rows, not the text between their checkboxes.
            if (event.shiftKey) event.preventDefault()
          }}
          onClick={(event) => {
            if (event.shiftKey) {
              event.preventDefault()
              event.preventBaseUIHandler()
              onToggle(true)
            }
          }}
          aria-label={`Select ${entry.title}`}
          className={cn(!selected && !selecting && gridRowControl)}
        />
        <KindIcon kind={entry.kind} />
        {/* The title opens the item to read before restoring it. */}
        <Link
          to="/library/bin/$itemId"
          params={{ itemId: entry.itemId }}
          className="line-clamp-2 min-w-0 rounded-sm text-body underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ring @max-3xl:text-row-phone"
          title={entry.title}
        >
          {entry.title}
        </Link>
        {entry.openProposals > 0 ? (
          <span
            className="flex shrink-0 items-center gap-1 text-caption text-muted-foreground"
            title="Nobody can accept its open proposals while the fact is in the Bin"
          >
            <GitPullRequestIcon aria-hidden="true" className="size-icon-sm" />
            {entry.openProposals === 1
              ? '1 open proposal'
              : `${entry.openProposals.toLocaleString('en')} open proposals`}
          </span>
        ) : null}
      </div>
      <div role="cell" className={cn(gridCell, 'w-column-domain')}>
        {domain ? (
          <DomainBadge name={domain.name} label={domain.label} size="sm" />
        ) : (
          // Its domain was deleted (FR-814): Restore offers another domain.
          <span className="truncate text-dense text-muted-foreground">
            {entry.deletedDomain ? `${entry.deletedDomain}, deleted` : 'Domain deleted'}
          </span>
        )}
      </div>
      {/* Who moved it, over the day; on a phone, one line: "Moved by Ravi Kapoor 7 Oct 2026". */}
      <div
        role="cell"
        className={cn(
          gridCell,
          'w-column-owner flex-col items-start justify-center py-2 @max-3xl:flex-row @max-3xl:gap-3',
        )}
      >
        <span className="flex max-w-full gap-1">
          <span data-phone-label aria-hidden="true" className="text-muted-foreground">
            Moved by
          </span>
          <span className="truncate">{movedBy}</span>
        </span>
        <span className="text-caption text-muted-foreground tabular-nums @max-3xl:text-dense">
          {formatDay(entry.binnedAt)}
        </span>
      </div>
      <div role="cell" className={cn(gridCell, reasonCell, 'py-2')}>
        <span className="line-clamp-2" title={entry.reason}>
          {entry.reason}
        </span>
      </div>
      <div role="cell" className={cn(gridCell, 'w-column-until justify-end')}>
        <Button variant="ghost" size="sm" onClick={onRestore} aria-label={`Restore ${entry.title}`}>
          <RotateCcwIcon />
          Restore
        </Button>
      </div>
    </div>
  )
}
