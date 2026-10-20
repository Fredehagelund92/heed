import { Link } from '@tanstack/react-router'
import type { Area } from '@domain/item'
import { CircleCheckIcon, HistoryIcon } from '@/components/icons'
import { DomainBadge, KindIcon } from '@/components/item/item-marks'
import { ListError, ListMessage } from '@/components/library/list-state'
import { openRowClass } from '@/components/page/dock-panel'
import { gridRowTitle, phoneRowTitle } from '@/components/page/grid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { panelRowHistory } from '@/lib/history'
import { viewedKey } from '@/lib/edition-compare'
import type { EditionSummary, ItemChange } from '@/lib/edition-diff'
import { editionReason } from '@/lib/editions'
import { formatMoment } from '@/lib/library'
import { cn } from '@/lib/utils'
import { EditionChangeBadge, EditionChangeCounts } from './change-card'

/** A row of the steps: one edition's change of one item. */
export const stepRowId = (edition: string, itemId: string) => `${edition}|${itemId}`

export type StepRowActions = {
  /** The row open in the panel (`stepRowId`). */
  openId: string | null
  viewed: ReadonlySet<string>
  onToggleViewed: (item: ItemChange) => void
  /** The phone's rows: the title on up to two lines, 56 high. */
  narrow: boolean
}

function StepItemRow({
  edition,
  item,
  areas,
  actions,
}: {
  edition: string
  item: ItemChange
  areas: readonly Area[]
  actions: StepRowActions
}) {
  const id = stepRowId(edition, item.itemId)
  const viewed = actions.viewed.has(viewedKey(item))
  const area = areas.find((candidate) => candidate.id === item.areaId)
  return (
    <li
      data-row-id={id}
      data-open={id === actions.openId || undefined}
      data-viewed={viewed || undefined}
      className={cn(
        'relative flex min-h-row items-center gap-3 border-t border-border-subtle px-4 -outline-offset-2 hover:bg-accent has-[[data-row-link]:focus-visible]:outline-2 has-[[data-row-link]:focus-visible]:outline-ring',
        actions.narrow && 'min-h-row-phone py-2',
        openRowClass,
      )}
    >
      <KindIcon kind={item.kind} className="relative" />
      <Link
        from="/editions/compare"
        to="/editions/compare"
        search={(previous) => ({ ...previous, item: item.itemId, step: edition })}
        {...panelRowHistory(actions.openId !== null)}
        resetScroll={false}
        data-row-link
        className={cn(
          actions.narrow ? phoneRowTitle : gridRowTitle,
          'flex-1',
          viewed && 'text-muted-foreground',
        )}
      >
        {item.title}
      </Link>
      {area ? (
        <DomainBadge
          name={area.name}
          label={area.label}
          size="sm"
          className="max-w-column-domain @max-5xl:hidden"
        />
      ) : null}
      <span className="@max-3xl:hidden">
        <EditionChangeBadge change={item.change} />
      </span>
      <label className="relative z-raised flex shrink-0 items-center gap-2 text-caption text-muted-foreground">
        <Checkbox
          checked={viewed}
          onCheckedChange={() => actions.onToggleViewed(item)}
          aria-label={`Viewed: ${item.title}`}
        />
        <span aria-hidden="true" className="@max-3xl:hidden">
          Viewed
        </span>
      </label>
    </li>
  )
}

function StepEntry({
  entry,
  areas,
  actions,
}: {
  entry: EditionSummary
  areas: readonly Area[]
  actions: StepRowActions
}) {
  const { edition } = entry
  const headingId = `step-${edition.seq}`
  return (
    <li>
      <article
        aria-labelledby={headingId}
        className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card"
      >
        <header className="flex min-w-0 flex-col gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 id={headingId} className="text-body">
              <Link
                to="/editions/$label"
                params={{ label: edition.label }}
                className="font-mono tabular-nums underline-offset-4 hover:underline"
                translate="no"
              >
                {edition.label}
              </Link>
            </h3>
            {edition.live ? (
              <Badge form="bare" tone="success" icon={CircleCheckIcon} size="sm">
                Live
              </Badge>
            ) : null}
            <span className="text-caption text-muted-foreground">
              {formatMoment(edition.sealedAt ?? edition.createdAt)} · {editionReason(edition)}
            </span>
          </div>
          <p className="text-body break-words">{entry.sentence}</p>
          <EditionChangeCounts counts={entry.counts} />
        </header>
        {entry.items.length ? (
          <ul aria-label={`Facts changed in ${edition.label}`} className="flex flex-col">
            {entry.items.map((item) => (
              <StepItemRow
                key={item.itemId}
                edition={edition.label}
                item={item}
                areas={areas}
                actions={actions}
              />
            ))}
          </ul>
        ) : null}
        {entry.more > 0 ? (
          <div className="border-t border-border-subtle px-4 py-3">
            <Link
              to="/editions/$label"
              params={{ label: edition.label }}
              className="text-dense font-bold underline-offset-4 hover:underline"
            >
              {entry.more.toLocaleString('en')} more in this edition
            </Link>
          </div>
        ) : null}
      </article>
    </li>
  )
}

/**
 * Edition by edition (Editions design: "step by step on demand"): each edition between the two,
 * newest first, as the feed writes it, a sentence that says what changed, who did it and why,
 * with its items. A row opens that edition's change of the item in the docked panel.
 */
export function CompareSteps({
  entries,
  pending,
  error,
  onRetry,
  hasMore,
  loadingMore,
  onMore,
  backwards,
  areas,
  actions,
}: {
  entries: readonly EditionSummary[]
  pending: boolean
  error: Error | null
  onRetry: () => void
  hasMore: boolean
  loadingMore: boolean
  onMore: () => void
  /** Until is older than Since: these are the editions going back would undo. */
  backwards: boolean
  areas: readonly Area[]
  actions: StepRowActions
}) {
  if (pending)
    return (
      <div role="status" aria-label="Loading the editions" className="flex flex-col gap-3">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-row-scope w-full rounded-lg" />
        ))}
      </div>
    )
  if (error && !entries.length)
    return (
      <ListError
        title="We couldn't load the editions"
        safe="Nothing is lost."
        error={error}
        onRetry={onRetry}
        detail={error.message}
      />
    )
  if (!entries.length)
    return (
      <ListMessage icon={HistoryIcon} title="No edition in between">
        Since and Until are the same edition, so no edition comes between them.
      </ListMessage>
    )
  return (
    <div className="flex flex-col gap-4">
      {backwards ? (
        <p className="text-dense text-muted-foreground">
          Until is older than Since, so these are the editions that going back would undo, newest
          first.
        </p>
      ) : null}
      <ol aria-label="Editions in this range, newest first" className="flex flex-col gap-4">
        {entries.map((entry) => (
          <StepEntry key={entry.edition.seq} entry={entry} areas={areas} actions={actions} />
        ))}
      </ol>
      {hasMore ? (
        <Button variant="outline" className="w-fit" disabled={loadingMore} onClick={onMore}>
          {loadingMore ? 'Loading older editions…' : 'Show older editions'}
        </Button>
      ) : null}
    </div>
  )
}
