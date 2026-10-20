import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { toApiError, type Edition } from '@/api'
import { editionFeedQuery, editionItemComparisonQuery } from '@/api/edition-queries'
import { areasQuery, peopleQuery } from '@/api/queries'
import {
  CircleCheckIcon,
  GitCommitHorizontalIcon,
  GitCompareArrowsIcon,
  HistoryIcon,
} from '@/components/icons'
import { CountBadge, Owner } from '@/components/item/item-marks'
import { ListError, ListMessage } from '@/components/library/list-state'
import { DetailsList } from '@/components/page/details-list'
import { DockPanel } from '@/components/page/dock-panel'
import type { DiffLookups } from '@/components/review/field-diff'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TabsContent } from '@/components/ui/tabs'
import type { EditionSummary, ItemChange } from '@/lib/edition-diff'
import { changesSince, editionChanges } from '@/lib/edition-feed'
import { editionReason, shortDigest } from '@/lib/editions'
import { formatMoment } from '@/lib/library'
import { targetsByKey } from '@/lib/mention-targets'
import { useMentionTargets } from '@/lib/use-mention-targets'
import { EditionChangeCard, EditionChangeCounts } from './change-card'
import { EditionRowMenu } from './edition-actions'

/** The panel's tabs; the tab is in the address (`tab=details`), so it is linkable and stays. */
export type EditionPanelTab = 'changes' | 'details'

/** How many items an edition changed, whatever the kind of change. */
export const changedItems = (entry: EditionSummary) =>
  Object.values(entry.counts).reduce((sum, count) => sum + count, 0)

/**
 * One edition in the docked panel beside the feed or the table (Editions design, slice S3: "the
 * docked panel shows the diff of whatever is selected"): the sentence that says what changed, who
 * did it and why, then each changed item field by field (the diff kit's card), and the edition's
 * facts. The way into what changed in full is the footer's one primary; since this edition is
 * beside it. j and k step through the editions, Escape closes it; expand opens the edition's page.
 */
export function EditionPanel({
  label,
  placeholder,
  position,
  onPrevious,
  onNext,
  onClose,
  tab,
  onTabChange,
}: {
  label: string
  /** The edition as the feed has it, shown at once; left out, the panel reads it. */
  placeholder: EditionSummary | undefined
  /** Where the edition is in the list, when it is in it. */
  position: { index: number; total: number } | null
  onPrevious?: (() => void) | undefined
  onNext?: (() => void) | undefined
  onClose: () => void
  tab: EditionPanelTab
  onTabChange: (tab: EditionPanelTab) => void
}) {
  const read = useQuery({
    ...editionFeedQuery({ through: label, limit: 1 }),
    enabled: placeholder === undefined,
  })
  const found = read.data?.entries[0]
  const entry = placeholder ?? (found?.edition.label === label ? found : undefined)

  const shared = {
    meta: (
      <>
        <span className="truncate">Edition</span>
        {position ? (
          <span className="shrink-0">
            · {(position.index + 1).toLocaleString('en')} of {position.total.toLocaleString('en')}
          </span>
        ) : null}
      </>
    ),
    onPrevious,
    onNext,
    onClose,
  }

  // The service refuses a number that is not an edition: that is not a failed connection.
  const failed = read.isError && toApiError(read.error).kind !== 'not-found'
  if (!entry && (read.isError || read.isSuccess)) {
    return (
      <DockPanel
        title={failed ? "This edition couldn't load" : 'There is no such edition'}
        {...shared}
      >
        {failed ? (
          <ListError
            title="We couldn't load this edition"
            safe="Nothing is lost."
            error={read.error}
            onRetry={() => void read.refetch()}
          />
        ) : (
          <p className="text-body text-muted-foreground">
            There is no edition {label}. The number may be mistyped, or the edition was never saved.
          </p>
        )}
      </DockPanel>
    )
  }
  if (!entry) return <DockPanel title={null} {...shared} />

  const { edition } = entry
  const total = changedItems(entry)
  return (
    <DockPanel
      title={`Edition ${edition.label}`}
      contentKey={edition.label}
      badges={
        <div className="flex flex-wrap items-center gap-2">
          {edition.live ? (
            <Badge form="bare" tone="success" icon={CircleCheckIcon}>
              Live
            </Badge>
          ) : null}
          <Badge form="outline" icon={edition.restores ? HistoryIcon : GitCommitHorizontalIcon}>
            {editionReason(edition)}
          </Badge>
        </div>
      }
      note={<p className="text-body break-words">{entry.sentence}</p>}
      tabs={[
        {
          value: 'changes',
          label: 'What changed',
          count: <CountBadge count={total} tone="quiet" />,
        },
        { value: 'details', label: 'Details' },
      ]}
      tab={tab}
      onTabChange={onTabChange}
      tabsLabel="Edition"
      expand={
        <Link
          to="/editions/$label"
          params={{ label: edition.label }}
          // The page goes up to this list, the entry behind it, so its Escape comes back here.
          state={{ fromParent: true }}
          aria-label={`Open the page of edition ${edition.label}`}
        />
      }
      footer={<EditionPanelActions edition={edition} />}
      {...shared}
    >
      <TabsContent value="changes" className="flex flex-col gap-4">
        <EditionItemDiffs entry={entry} total={total} />
      </TabsContent>
      <TabsContent value="details">
        <EditionFacts edition={edition} entry={entry} />
      </TabsContent>
    </DockPanel>
  )
}

/**
 * The footer: what changed in full (the one primary), since this edition beside it, and the
 * rest in the edition's menu (open its page, export, and going back or stopping delivery).
 */
function EditionPanelActions({ edition }: { edition: Edition }) {
  return (
    <>
      <Button render={<Link to="/editions/compare" search={editionChanges(edition.label)} />}>
        <GitCompareArrowsIcon aria-hidden />
        What changed
      </Button>
      {edition.live ? null : (
        <Button
          variant="outline"
          render={<Link to="/editions/compare" search={changesSince(edition.label)} />}
        >
          Since this edition
        </Button>
      )}
      <EditionRowMenu edition={edition} className="ml-auto" />
    </>
  )
}

/** Each item the edition changed, field by field, and a way to the rest when there are more. */
export function EditionItemDiffs({ entry, total }: { entry: EditionSummary; total: number }) {
  const { data: areas = [] } = useQuery(areasQuery())
  const { data: people = [] } = useQuery(peopleQuery())
  const { targets } = useMentionTargets()
  const lookups = useMemo<DiffLookups>(
    () => ({
      areas,
      targets: targetsByKey(targets),
      nameOf: (id) => people.find((person) => person.id === id)?.name ?? null,
    }),
    [areas, people, targets],
  )
  const label = entry.edition.label
  if (entry.items.length === 0)
    return (
      <ListMessage icon={GitCommitHorizontalIcon} title="No fact changed in this edition">
        {total > 0
          ? "Only some groups can see the facts it changed, so they're counted here but not shown."
          : 'The sentence above says what it changed instead.'}
      </ListMessage>
    )
  return (
    <>
      <EditionChangeCounts counts={entry.counts} />
      <ul aria-label={`Facts changed in ${label}`} className="flex flex-col gap-4">
        {entry.items.map((item) => (
          <li key={item.itemId}>
            <EditionItemDiff label={label} item={item} lookups={lookups} />
          </li>
        ))}
      </ul>
      {entry.more > 0 ? (
        <Link
          to="/editions/compare"
          search={editionChanges(label)}
          className="w-fit text-dense font-bold underline-offset-4 hover:underline"
        >
          {entry.more.toLocaleString('en')} more {entry.more === 1 ? 'item' : 'items'} in What
          changed
        </Link>
      ) : null}
    </>
  )
}

/** One item's change in this edition, read when the panel shows it. */
function EditionItemDiff({
  label,
  item,
  lookups,
}: {
  label: string
  item: ItemChange
  lookups: DiffLookups
}) {
  const comparison = useQuery(editionItemComparisonQuery({ id: item.itemId, to: label }))
  if (comparison.isPending)
    return (
      <div
        role="status"
        aria-label={`Loading what changed in ${item.title}`}
        className="flex flex-col gap-2"
      >
        <Skeleton className="h-row w-full" />
        <Skeleton className="h-row-scope w-full" />
      </div>
    )
  if (comparison.isError)
    return (
      <div className="flex flex-col gap-2 rounded-sm border px-4 py-3">
        <p className="text-body font-bold">{item.title}</p>
        <p className="text-dense text-muted-foreground">
          We couldn&apos;t load what changed in this fact.{' '}
          <Link
            to="/editions/compare"
            search={{ ...editionChanges(label), item: item.itemId }}
            className="font-bold text-foreground underline-offset-4 hover:underline"
          >
            Open it in What changed
          </Link>
        </p>
      </div>
    )
  return <EditionChangeCard comparison={comparison.data} lookups={lookups} />
}

/** The edition's facts: when it was sealed, what made it, who and why, what it serves, its digest. */
function EditionFacts({ edition, entry }: { edition: Edition; entry: EditionSummary }) {
  const { data: people } = useQuery(peopleQuery())
  const person = entry.actorId ? people?.find((candidate) => candidate.id === entry.actorId) : null
  const rows = [
    { label: 'Saved', value: formatMoment(edition.sealedAt ?? edition.createdAt, 'long') },
    { label: 'Reason', value: editionReason(edition) },
    {
      label: 'By',
      value: person ? (
        <Owner name={person.name} initials={person.initials} size="sm" />
      ) : (
        <span className="text-muted-foreground">Automatic</span>
      ),
    },
    ...(entry.why ? [{ label: 'Why', value: entry.why }] : []),
    ...(edition.restores
      ? [
          {
            label: 'Has the facts of',
            value: (
              <Link
                to="/editions"
                search={{ edition: edition.restores }}
                className="font-mono underline-offset-4 hover:underline"
                translate="no"
              >
                {edition.restores}
              </Link>
            ),
          },
        ]
      : []),
    ...(edition.digest
      ? [
          {
            label: 'Content digest',
            value: (
              <span className="font-mono" title={edition.digest} translate="no">
                {shortDigest(edition.digest)}
              </span>
            ),
          },
        ]
      : []),
  ]
  return <DetailsList label={`Edition ${edition.label}`} rows={rows} />
}
