import { useEffect, useId, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useInfiniteQuery, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Edition } from '@/api'
import { editionBeforeDayQuery, editionPagesQuery } from '@/api/edition-queries'
import { editionListQuery } from '@/api/queries'
import {
  ArrowRightLeftIcon,
  ArrowUpDownIcon,
  ChevronDownIcon,
  CircleCheckIcon,
} from '@/components/icons'
import { PageToolbar } from '@/components/page/page'
import { toolbarViewClass } from '@/components/page/toolbar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemMeta,
  ComboboxList,
  ComboboxStatus,
} from '@/components/ui/combobox'
import { comparePresets, presetFirstDay, type ComparePreset } from '@/lib/edition-compare'
import { editionReason } from '@/lib/editions'
import { formatDay } from '@/lib/library'
import { showToast } from '@/lib/toast'
import type { EditionCompareSearch } from '@/lib/search-params'
import { cn } from '@/lib/utils'

/** A day typed into a picker: a year, a month or a whole day ("2025", "2025-06", "2025-06-14"). */
const typedDay = (text: string) => /^\d{4}(-\d{2}(-\d{2})?)?/.exec(text.trim())?.[0] ?? null

/** Today as a UTC calendar day, the day the editions' numbers start with. */
const today = () => new Date().toISOString().slice(0, 10)

/**
 * One of the two editions, picked by its number. The list holds every edition, newest first,
 * a page at a time; typing a day ("2025-06") reads further back until it reaches that day.
 */
function EditionPicker({
  label,
  value,
  asked,
  onPick,
}: {
  label: 'Since' | 'Until'
  value: Edition | null
  /** The number in the address, shown while the comparison that names the edition loads. */
  asked: string | undefined
  onPick: (edition: Edition) => void
}) {
  const inputId = useId()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const pages = useInfiniteQuery({ ...editionPagesQuery(), enabled: open })
  const loaded = pages.data?.pages.flat() ?? []
  const editions =
    value && !loaded.some((edition) => edition.label === value.label) ? [value, ...loaded] : loaded
  const day = open ? typedDay(text) : null
  const oldest = loaded.at(-1)

  // A typed day older than the oldest edition read so far reads the next page, until it is there.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = pages
  useEffect(() => {
    if (!day || !oldest || !hasNextPage || isFetchingNextPage) return
    if (oldest.label.slice(0, day.length) >= day) void fetchNextPage()
  }, [day, oldest, hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <div className="flex min-w-0 items-center gap-2">
      <label
        htmlFor={inputId}
        className="w-column-select shrink-0 text-caption text-muted-foreground @2xl:w-auto"
      >
        {label}
      </label>
      <Combobox
        items={editions}
        // Only the number is read from the value (its label and its equality), so while the
        // edition loads the number in the address stands in for it.
        value={value ?? (asked ? ({ label: asked } as Edition) : null)}
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setText('')
        }}
        onInputValueChange={(next) => setText(next)}
        onValueChange={(next: Edition | null) => {
          if (next) onPick(next)
        }}
        itemToStringLabel={(edition: Edition) => edition.label}
        isItemEqualToValue={(a: Edition, b: Edition) => a.label === b.label}
        limit={60}
      >
        <ComboboxInput
          id={inputId}
          size="toolbar"
          aria-label={`${label} edition`}
          placeholder="Edition number"
          // Typing replaces the number: a day reads the editions back to it.
          onFocus={(event) => event.currentTarget.select()}
          className="w-column-about font-mono tabular-nums @max-2xl:basis-full"
          translate="no"
        />
        <ComboboxContent className="w-popover">
          <ComboboxEmpty>
            {pages.isPending
              ? 'Loading the editions…'
              : 'No edition has that number. Type a day, such as 2025-06-14.'}
          </ComboboxEmpty>
          <ComboboxList>
            {(edition: Edition) => (
              <ComboboxItem key={edition.label} value={edition}>
                <span className="font-mono tabular-nums" translate="no">
                  {edition.label}
                </span>
                {edition.live ? (
                  <Badge form="bare" tone="success" icon={CircleCheckIcon} size="sm">
                    Live
                  </Badge>
                ) : null}
                <ComboboxItemMeta className="truncate">{editionReason(edition)}</ComboboxItemMeta>
              </ComboboxItem>
            )}
          </ComboboxList>
          <ComboboxStatus loading={pages.isPending || isFetchingNextPage}>
            {pages.isPending || isFetchingNextPage
              ? 'Loading older editions'
              : hasNextPage
                ? `Showing editions back to ${oldest ? formatDay(oldest.label, 'long') : 'the oldest read'}. Type a day, such as 2025-06, to go further.`
                : ''}
          </ComboboxStatus>
        </ComboboxContent>
      </Combobox>
    </div>
  )
}

/**
 * The range bar: Since and Until with a swap between them, the ranges a person picks without
 * knowing edition numbers, and the two views (the overall result, or edition by edition). Every
 * choice is in the address, so a comparison is a link.
 */
export function CompareRangeBar({
  search,
  since,
  until,
}: {
  search: EditionCompareSearch
  /** The two editions compared, once the comparison names them. */
  since: Edition | null
  until: Edition | null
}) {
  const navigate = useNavigate({ from: '/editions/compare' })
  const queryClient = useQueryClient()
  const newest = useQuery(editionListQuery({ limit: 2 }))
  const [live, previous] = newest.data ?? []

  // A new range keeps the view and the filters, and closes the panel: its item may not be in it.
  const go = (range: { since?: string | undefined; until?: string | undefined }) =>
    void navigate({
      to: '/editions/compare',
      search: (current) => ({
        ...current,
        ...range,
        item: undefined,
        step: undefined,
        tab: undefined,
      }),
    })

  // The range shown, when it is one of the presets: the latest edition is known at once, a
  // range of days once it has been worked out (the reads are not started here).
  const [busy, setBusy] = useState(false)
  const starts = useQueries({
    queries: comparePresets.map((preset) => ({
      ...editionBeforeDayQuery(presetFirstDay(today(), preset.days ?? 1)),
      enabled: false,
    })),
  })
  const current = comparePresets.find((preset, index) => {
    const start = preset.days === null ? previous?.label : starts[index]?.data?.label
    return (
      live !== undefined &&
      search.until === live.label &&
      start !== undefined &&
      search.since === start
    )
  })

  const presetRange = async (preset: ComparePreset) => {
    const [top, before] = await queryClient.fetchQuery(editionListQuery({ limit: 2 }))
    if (!top) return null
    if (preset.days === null) return { since: before?.label, until: top.label }
    const start = await queryClient.fetchQuery(
      editionBeforeDayQuery(presetFirstDay(today(), preset.days)),
    )
    return { since: start?.label, until: top.label }
  }

  return (
    <PageToolbar aria-label="Editions compared" className="gap-x-6 gap-y-2">
      {/* Side by side with the swap between them; on a narrow bar, one above the other with
          the swap beside both. */}
      <div className="flex min-w-0 items-center gap-2 @max-2xl:basis-full">
        <div className="flex min-w-0 flex-1 flex-col gap-2 @2xl:flex-row @2xl:items-center">
          <EditionPicker
            label="Since"
            value={since}
            asked={search.since}
            onPick={(edition) => go({ since: edition.label })}
          />
          <SwapButton since={since} until={until} onSwap={go} className="@max-2xl:hidden" />
          <EditionPicker
            label="Until"
            value={until}
            asked={search.until}
            onPick={(edition) => go({ until: edition.label })}
          />
        </div>
        <SwapButton since={since} until={until} onSwap={go} className="@2xl:hidden" upright />
      </div>
      <ComparePresets
        current={current}
        busy={busy}
        onPick={(preset) => {
          setBusy(true)
          void presetRange(preset)
            .then(
              (range) => {
                if (range) go(range)
              },
              () =>
                showToast(
                  `We couldn't work out ${preset.title.toLowerCase()}`,
                  'Nothing changed. Check your connection, then try again.',
                ),
            )
            .finally(() => setBusy(false))
        }}
      />
    </PageToolbar>
  )
}

/**
 * The ranges as ghost buttons, the current one filled; below a 672 pixel bar, one menu button
 * that names the current range (contract 8.4).
 */
function ComparePresets({
  current,
  busy,
  onPick,
}: {
  current: ComparePreset | undefined
  busy: boolean
  onPick: (preset: ComparePreset) => void
}) {
  return (
    <>
      <div role="group" aria-label="Ranges" className="flex items-center gap-1 @max-2xl:hidden">
        {comparePresets.map((preset) => (
          <Button
            key={preset.id}
            variant="ghost"
            size="toolbar"
            aria-pressed={preset.id === current?.id}
            disabled={busy}
            onClick={() => onPick(preset)}
            className={cn(
              toolbarViewClass,
              preset.id === current?.id && 'bg-muted font-bold text-foreground',
            )}
          >
            {preset.title}
          </Button>
        ))}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="touch"
              disabled={busy}
              aria-label={`Range: ${current?.title ?? 'your own'}`}
              className="@2xl:hidden"
            />
          }
        >
          {current?.title ?? 'Pick a range'}
          <ChevronDownIcon className="text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={current?.id ?? ''}
            onValueChange={(id: string) => {
              const preset = comparePresets.find((candidate) => candidate.id === id)
              if (preset) onPick(preset)
            }}
          >
            {comparePresets.map((preset) => (
              <DropdownMenuRadioItem key={preset.id} value={preset.id} closeOnClick>
                {preset.title}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

const views = [
  { id: 'net', title: 'Overall result' },
  { id: 'steps', title: 'Edition by edition' },
] as const

/**
 * The two ways to read a comparison, first on the list's bar: the overall result (each item
 * once, as it was against how it is) or edition by edition, as each one was made. Below a 672
 * pixel bar they are one menu button (contract 8.4).
 */
export function CompareViews({ view }: { view: 'net' | 'steps' }) {
  const navigate = useNavigate({ from: '/editions/compare' })
  const searchFor = (id: 'net' | 'steps') => (current: EditionCompareSearch) => ({
    ...current,
    view: id === 'steps' ? ('steps' as const) : undefined,
    item: undefined,
    step: undefined,
    tab: undefined,
  })
  const shown = views.find((candidate) => candidate.id === view) ?? views[0]
  return (
    <>
      <nav aria-label="How to read the changes" className="flex items-center gap-1 @max-2xl:hidden">
        {views.map((candidate) => (
          <Link
            key={candidate.id}
            from="/editions/compare"
            to="/editions/compare"
            search={searchFor(candidate.id)}
            // The overall result has no `view`: without this, TanStack would also call it
            // current while the steps show, whose address holds everything its link holds.
            activeOptions={{ explicitUndefined: true }}
            aria-current={candidate.id === view ? 'page' : undefined}
            className={toolbarViewClass}
          >
            {candidate.title}
          </Link>
        ))}
      </nav>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="touch"
              aria-label={`View: ${shown.title}`}
              className="@2xl:hidden"
            />
          }
        >
          {shown.title}
          <ChevronDownIcon className="text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={view}
            onValueChange={(id: 'net' | 'steps') =>
              void navigate({ to: '/editions/compare', search: searchFor(id) })
            }
          >
            {views.map((candidate) => (
              <DropdownMenuRadioItem key={candidate.id} value={candidate.id} closeOnClick>
                {candidate.title}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

function SwapButton({
  since,
  until,
  onSwap,
  upright = false,
  className,
}: {
  since: Edition | null
  until: Edition | null
  onSwap: (range: { since: string | undefined; until: string | undefined }) => void
  /** Between two pickers above one another, the arrows point up and down. */
  upright?: boolean
  className?: string
}) {
  const Glyph = upright ? ArrowUpDownIcon : ArrowRightLeftIcon
  return (
    <Button
      variant="ghost"
      size="icon-toolbar"
      aria-label="Swap Since and Until"
      title="Swap Since and Until"
      disabled={!since || !until}
      onClick={() => onSwap({ since: until?.label, until: since?.label })}
      className={className}
    >
      <Glyph />
    </Button>
  )
}
