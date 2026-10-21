import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Area, ContextItem } from '@domain/item'
import { editionItemComparisonQuery } from '@/api/edition-queries'
import { fixNextQuery, itemQuery } from '@/api/queries'
import { EditionChangeBadge, EditionChangeCard } from '@/components/editions/change-card'
import { GitCompareArrowsIcon, InfoIcon, ListChecksIcon, UsersIcon } from '@/components/icons'
import { itemDetailRows, itemPeopleRows } from '@/components/item/item-details'
import { ItemBadges, StateNote } from '@/components/item/item-header'
import { KindIcon } from '@/components/item/item-marks'
import { useItemFacts } from '@/components/item/item-parts'
import { DetailsList } from '@/components/page/details-list'
import { RecordPane } from '@/components/page/record-pane'
import { RecordSection } from '@/components/page/record-parts'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { versionWords } from '@/lib/editions'
import { formatDay } from '@/lib/library'
import { checkName, fixKindWords, type FixEntry } from '@/lib/quality'
import { ItemRecordActions } from './action-panel'
import { placeInBar, type ListPlace } from './links'
import { useDiffLookups } from './question-evidence'

/*
  An item's record in the Workbench (Workbench plan, slice W6c): why the work list names it (past
  its review date, or no test question covers it, in Fix next's words), the item page's Details
  facts with its validity in the badges, and what changed in it between the two editions the
  Workbench compares, as the diff kit's card. The item is read and changed on its own page; the
  action panel opens it there, or writes a test question for it.
*/

/** The record bar's parts: the kind and place in the list, previous, next and close. */
type Bar = {
  meta: ReactNode
  browse: boolean
  onPrevious: (() => void) | undefined
  onNext: (() => void) | undefined
  onClose: () => void
  contentKey: string
}

/** Fix next's longest list, read with the work list's own params so the two share one cache. */
const FIX_LIMIT = 200

export function ItemRecord({
  id,
  scope,
  editions,
  areaOf,
  maintains,
  place,
  onClose,
  onWrite,
}: {
  id: string
  /** The domain in the scope strip: the work list read Fix next for it. */
  scope: string | undefined
  /**
   * The editions the scope strip compares for the item's domain; undefined for the live edition
   * and the one before it.
   */
  editions: ((areaId: string) => { from: string; to: string } | undefined) | undefined
  areaOf: (id: string | null) => Area | undefined
  maintains: (area: string) => boolean
  /** Where the record is in the work list. */
  place: ListPlace
  onClose: () => void
  onWrite: (item: ContextItem) => void
}) {
  const detail = useQuery(itemQuery(id))
  const bar = placeInBar('Fact', place)
  const shared: Bar = {
    ...bar,
    meta: <span className="truncate">{bar.meta}</span>,
    onClose,
    contentKey: `item:${id}`,
  }
  if (detail.isPending) return <RecordPane title={null} label="Loading the fact" {...shared} />
  if (!detail.data)
    return (
      <RecordPane
        title={detail.isError ? "We couldn't load this fact" : "This fact isn't available"}
        {...shared}
      >
        <p className="text-body text-muted-foreground">
          {detail.isError
            ? 'Check your connection, then try again.'
            : 'It may have been removed, or only some groups can see it.'}
        </p>
      </RecordPane>
    )
  return (
    <ItemRecordContent
      item={detail.data}
      scope={scope}
      editions={editions?.(detail.data.areaId)}
      area={areaOf(detail.data.areaId)}
      maintains={maintains(detail.data.areaId)}
      shared={shared}
      onWrite={() => onWrite(detail.data!)}
    />
  )
}

function ItemRecordContent({
  item,
  scope,
  editions,
  area,
  maintains,
  shared,
  onWrite,
}: {
  item: ContextItem
  scope: string | undefined
  editions: { from: string; to: string } | undefined
  area: Area | undefined
  maintains: boolean
  shared: Bar
  onWrite: () => void
}) {
  const facts = useItemFacts(item)
  const fix = useQuery(fixNextQuery({ ...(scope ? { area: scope } : {}), limit: FIX_LIMIT }))
  const entries = (fix.data?.entries ?? []).filter(
    (entry) => entry.subject.type === 'item' && entry.subject.id === item.id,
  )
  return (
    <RecordPane
      title={item.title}
      {...shared}
      meta={
        <>
          <KindIcon
            kind={item.kind}
            active={facts.state.conditions.lifecycle === 'active_issue'}
            decorative
          />
          {shared.meta}
        </>
      }
      // The bar names the kind; the badges start at the domain and end at the validity.
      badges={<ItemBadges item={item} area={facts.area} state={facts.state} kind={false} />}
      note={facts.state.note ? <StateNote>{facts.state.note}</StateNote> : null}
      actions={
        <ItemRecordActions item={item} area={area} maintains={maintains} onWrite={onWrite} />
      }
    >
      <div className="flex flex-col gap-8">
        <WhyListed entries={entries} pending={fix.isPending} />
        <ItemChange item={item} editions={editions} />
        <RecordSection title="Details" icon={InfoIcon}>
          <DetailsList
            label="Details"
            rows={[...itemDetailRows(item, facts), { label: 'Version', value: item.version }]}
          />
        </RecordSection>
        <RecordSection title="People" icon={UsersIcon}>
          <DetailsList label="People" rows={itemPeopleRows(item, facts)} />
        </RecordSection>
      </div>
    </RecordPane>
  )
}

/** Why the work list names the item: each of Fix next's reasons for it, with its badge. */
function WhyListed({ entries, pending }: { entries: readonly FixEntry[]; pending: boolean }) {
  return (
    <RecordSection title="Why it's listed" icon={ListChecksIcon}>
      {pending ? (
        <Skeleton role="status" aria-label="Loading why it's listed" className="h-5 w-2/3" />
      ) : entries.length ? (
        <ul className="flex flex-col gap-3" aria-label="Why it's listed" data-slot="why-listed">
          {entries.map((entry) => {
            const badge = fixKindWords[entry.kind]
            const checks = entry.checks.length
              ? `Failed: ${entry.checks.map(checkName).join(', ')}.`
              : null
            return (
              <li key={entry.kind} className="flex min-w-0 flex-col items-start gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                  {entry.since ? (
                    <span className="text-caption text-muted-foreground">
                      Since {formatDay(entry.since)}
                    </span>
                  ) : null}
                </span>
                <p className="text-body">
                  {[...entry.reasons.map((reason) => `${reason}.`), ...(checks ? [checks] : [])]
                    .join(' ')
                    .trim()}
                </p>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-body text-muted-foreground">
          The work list doesn&apos;t name it now. Nothing about it needs checking.
        </p>
      )}
    </RecordSection>
  )
}

/** What changed in the item between the two editions, as the diff kit's card. */
function ItemChange({
  item,
  editions,
}: {
  item: ContextItem
  editions: { from: string; to: string } | undefined
}) {
  const lookups = useDiffLookups()
  const comparison = useQuery(editionItemComparisonQuery({ id: item.id, ...editions }))
  const data = comparison.data
  return (
    <RecordSection title="What changed" icon={GitCompareArrowsIcon}>
      {comparison.isPending ? (
        <Skeleton
          role="status"
          aria-label="Loading what changed in the fact"
          className="h-row-scope w-full"
        />
      ) : !data ? (
        <p className="text-body text-muted-foreground">
          We couldn&apos;t load what changed in the fact.{' '}
          <button type="button" className="underline" onClick={() => void comparison.refetch()}>
            Try again
          </button>
        </p>
      ) : (
        <>
          <p className="flex flex-wrap items-center gap-2 text-dense text-muted-foreground">
            {data.change ? (
              <>
                <EditionChangeBadge change={data.change.change} />
                <span>
                  {versionWords({
                    from: data.change.from?.version ?? null,
                    to: data.change.to?.version ?? null,
                  })}
                  .
                </span>
              </>
            ) : null}
            <span>
              {data.from
                ? editions
                  ? 'Between the two runs the strip above compares.'
                  : 'Between what agents got before and what they get today.'
                : 'New: the first time agents got it.'}
            </span>
          </p>
          <EditionChangeCard comparison={data} lookups={lookups} header={false} />
        </>
      )}
    </RecordSection>
  )
}
