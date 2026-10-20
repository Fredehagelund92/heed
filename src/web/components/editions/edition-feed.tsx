import { useId } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueries } from '@tanstack/react-query'
import type { Area } from '@domain/item'
import type { Edition } from '@/api'
import { editionBeforeDayQuery } from '@/api/edition-queries'
import {
  CircleCheckIcon,
  GitCommitHorizontalIcon,
  GitCompareArrowsIcon,
  HistoryIcon,
} from '@/components/icons'
import { DomainBadge, KindIcon } from '@/components/item/item-marks'
import { HelpLink } from '@/components/help/help-link'
import { ListError, ListMessage } from '@/components/library/list-state'
import { openRowClass } from '@/components/page/dock-panel'
import { gridRowTitle, phoneRowTitle } from '@/components/page/grid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { panelRowHistory } from '@/lib/history'
import { comparePresets, presetFirstDay } from '@/lib/edition-compare'
import type { EditionSummary, ItemChange } from '@/lib/edition-diff'
import {
  changesSince,
  dayChanges,
  editionChanges,
  feedDays,
  type FeedDay,
} from '@/lib/edition-feed'
import { editionReason } from '@/lib/editions'
import { formatDay } from '@/lib/library'
import type { EditionCompareSearch, EditionsSearch } from '@/lib/search-params'
import { cn } from '@/lib/utils'
import { EditionChangeBadge } from './change-card'

/** Items a feed entry lists before "more"; the docked panel and What changed show them all. */
const ENTRY_ITEMS = 3

export function LiveMark() {
  return (
    <Badge form="bare" tone="success" icon={CircleCheckIcon} size="sm">
      Live
    </Badge>
  )
}

/** The ranges the live card offers, each ending at the live edition (What changed's presets). */
const ranges = comparePresets.filter((preset) => preset.days !== null && preset.days <= 90)

/**
 * What changed over the last days, as links: the edition live when the first day began against
 * the live edition, worked out as the page opens so each is a plain link (null until then).
 */
export function useRangeLinks(live: Edition | undefined) {
  const today = new Date().toISOString().slice(0, 10)
  const starts = useQueries({
    queries: ranges.map((preset) => ({
      ...editionBeforeDayQuery(presetFirstDay(today, preset.days ?? 1)),
      enabled: live !== undefined,
    })),
  })
  return ranges.map((preset, index) => {
    const start = starts[index]?.data
    return {
      id: preset.id,
      title: preset.title,
      search: live && start ? ({ since: start.label, until: live.label } as const) : null,
    }
  })
}

/** One changed item of an entry: what kind it is, its title (into What changed), its change. */
function EntryItem({
  label,
  item,
  areas,
  narrow,
}: {
  label: string
  item: ItemChange
  areas: readonly Area[]
  narrow: boolean
}) {
  const area = areas.find((candidate) => candidate.id === item.areaId)
  return (
    <li
      className={cn(
        'relative flex min-h-row items-center gap-3 border-t border-border-subtle px-4 -outline-offset-2 hover:bg-accent has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-ring',
        narrow && 'min-h-row-phone py-2',
      )}
    >
      <KindIcon kind={item.kind} className="relative" />
      {/* On a phone the change sits under the title, so a long one never runs off the card. */}
      <div className={cn('flex min-w-0 flex-1 gap-3', narrow ? 'flex-col gap-1' : 'items-center')}>
        <Link
          to="/editions/compare"
          search={{ ...editionChanges(label), item: item.itemId }}
          aria-label={`${item.title}: what changed`}
          className={cn(narrow ? phoneRowTitle : gridRowTitle, 'flex-1')}
        >
          {item.title}
        </Link>
        {area && !narrow ? (
          <DomainBadge
            name={area.name}
            label={area.label}
            size="sm"
            className="max-w-column-domain"
          />
        ) : null}
        <span className="flex">
          <EditionChangeBadge change={item.change} />
        </span>
      </div>
    </li>
  )
}

/**
 * One edition as a release note: its number, which opens it in the docked panel; the sentence
 * that says what changed, who did it and why; its first changed items, each straight into What
 * changed; and the two ways into What changed for it: this edition's change, and since it.
 */
function FeedEntry({
  entry,
  areas,
  list,
  openLabel,
  narrow,
}: {
  entry: EditionSummary
  areas: readonly Area[]
  /** The page's address without an open edition, which the number's link adds to. */
  list: EditionsSearch
  openLabel: string | null
  narrow: boolean
}) {
  const { edition } = entry
  const headingId = useId()
  const shown = entry.items.slice(0, ENTRY_ITEMS)
  const more = entry.items.length - shown.length + entry.more
  const open = openLabel === edition.label
  return (
    <li data-row-id={edition.label}>
      <article
        aria-labelledby={headingId}
        data-slot="edition-entry"
        data-live={edition.live || undefined}
        className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card"
      >
        <div
          data-open={open || undefined}
          className={cn(
            'relative flex min-w-0 flex-col gap-2 px-4 py-3 -outline-offset-2 hover:bg-accent has-[[data-row-link]:focus-visible]:outline-2 has-[[data-row-link]:focus-visible]:outline-ring',
            openRowClass,
          )}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h4 id={headingId} className="text-body">
              <Link
                to="/editions"
                search={{ ...list, edition: edition.label }}
                {...panelRowHistory(openLabel !== null)}
                resetScroll={false}
                data-row-link
                aria-label={`Edition ${edition.label}`}
                className="font-mono tabular-nums outline-none after:absolute after:inset-0"
                translate="no"
              >
                {edition.label}
              </Link>
            </h4>
            {edition.live ? <LiveMark /> : null}
            <span className="text-caption text-muted-foreground">{editionReason(edition)}</span>
          </div>
          <p className="text-body break-words">{entry.sentence}</p>
        </div>
        {shown.length ? (
          <ul aria-label={`Facts changed in ${edition.label}`} className="flex flex-col">
            {shown.map((item) => (
              <EntryItem
                key={item.itemId}
                label={edition.label}
                item={item}
                areas={areas}
                narrow={narrow}
              />
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-4 py-2">
          <Button
            variant="outline"
            size="sm"
            render={<Link to="/editions/compare" search={editionChanges(edition.label)} />}
            aria-label={`What changed in edition ${edition.label}`}
          >
            <GitCompareArrowsIcon aria-hidden />
            What changed
          </Button>
          {edition.live ? null : (
            <Button
              variant="ghost"
              size="sm"
              render={<Link to="/editions/compare" search={changesSince(edition.label)} />}
              aria-label={`What changed since edition ${edition.label}`}
            >
              Since this edition
            </Button>
          )}
          {more > 0 ? (
            <span className="ml-auto text-caption text-muted-foreground">
              {more.toLocaleString('en')} more {more === 1 ? 'item' : 'items'}
            </span>
          ) : null}
        </div>
      </article>
    </li>
  )
}

/** A day of the feed: when, how many editions, and what changed that day as one range. */
function FeedDayHeading({
  day,
  range,
  id,
}: {
  day: FeedDay<EditionSummary>
  range: EditionCompareSearch | null
  id: string
}) {
  const count = day.entries.length
  return (
    <div className="flex min-h-control-md flex-wrap items-center gap-x-3 gap-y-1">
      <h3 id={id} className="text-dense font-bold">
        {day.day ? formatDay(day.day, 'long') : 'Unknown day'}
      </h3>
      <span className="text-caption text-muted-foreground">
        {count.toLocaleString('en')} {count === 1 ? 'edition' : 'editions'}
      </span>
      {range && count > 1 ? (
        <Link
          to="/editions/compare"
          search={range}
          className="text-caption font-bold underline-offset-4 hover:underline"
        >
          What changed that day
        </Link>
      ) : null}
    </div>
  )
}

/**
 * The editions as release notes (Editions design, direction B, slice S3): newest first, by day,
 * one card per edition. An edition opens in the docked panel; What changed is one click from
 * every card, and since an edition and a whole day are ranges beside it.
 */
export function EditionFeed({
  entries,
  pending,
  error,
  onRetry,
  hasMore,
  loadingMore,
  onMore,
  areas,
  list,
  openLabel,
  narrow,
}: {
  entries: readonly EditionSummary[]
  pending: boolean
  error: Error | null
  onRetry: () => void
  hasMore: boolean
  loadingMore: boolean
  onMore: () => void
  areas: readonly Area[]
  list: EditionsSearch
  openLabel: string | null
  /** The phone's rows: titles on up to two lines, 56 high. */
  narrow: boolean
}) {
  const baseId = useId()
  if (pending)
    return (
      <div role="status" aria-label="Loading the editions" className="flex flex-col gap-4">
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
      <ListMessage icon={GitCommitHorizontalIcon} title="No editions yet">
        We save an edition each time AI apps get a change. The first one shows here.{' '}
        <HelpLink to="editions">What is an edition?</HelpLink>
      </ListMessage>
    )
  const days = feedDays(entries)
  return (
    <div className="flex flex-col gap-6">
      {days.map((day, index) => {
        const id = `${baseId}-${index}`
        return (
          <section key={day.day} aria-labelledby={id} className="flex flex-col gap-3">
            <FeedDayHeading day={day} range={dayChanges(day)} id={id} />
            <ol aria-labelledby={id} className="flex flex-col gap-3">
              {day.entries.map((entry) => (
                <FeedEntry
                  key={entry.edition.seq}
                  entry={entry}
                  areas={areas}
                  list={list}
                  openLabel={openLabel}
                  narrow={narrow}
                />
              ))}
            </ol>
          </section>
        )
      })}
      {hasMore ? (
        <Button variant="outline" className="w-fit" disabled={loadingMore} onClick={onMore}>
          <HistoryIcon aria-hidden />
          {loadingMore ? 'Loading older editions…' : 'Show older editions'}
        </Button>
      ) : null}
    </div>
  )
}
