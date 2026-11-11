import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ObsDimension, ObsFilterView } from '@/api/client'
import { dimensionValuesQuery } from '@/api/queries'
import { PinIcon, PinOffIcon, SearchIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ShowMoreButton } from '@/components/heed/show-more'
import { CountUp } from '@/components/heed/count-up'
import { Swatch } from '@/components/obs/charts'
import type { Field } from '@/components/obs/filter-bar'
import { countOf } from '@/components/obs/filter-picker'
import { useDelayedBusy } from '@/lib/loading'
import { useDebounced } from '@/lib/mentions'
import { nameOf, rememberNames } from '@/lib/obs-names'
import {
  ANY,
  chipOf,
  facetSaid,
  facetSize,
  facetWords,
  FILTER_WORDS,
  opWords,
  toggled,
  withValues,
  type DimKey,
  type FacetValue,
  type FieldKey,
  type Filters,
} from '@/lib/obs-views'
import type { Shown } from '@/model/observability'

// The facets: the fixed fields, the dimensions an admin pinned for the workspace, and one By facet
// that switches between the other dimensions, each value with what it counts, counted without its
// own chip so the other values stay in sight. A tick adds the value to its chip; a count looks at
// only that value. Beside the topics on a wide page, in a sheet on a narrow one. The fields' counts
// are the disclosed counts added up (lib/obs-views.ts), a dimension's the service's
// (/observability/values, the most asked 50): "13+" when a part is hidden, "Fewer than 5", and
// "Not shown" where the service keeps no count for the topics in view.

/** How many values a field shows before Show more. */
const FIRST = 6

export type FacetsProps = {
  chips: Filters
  onChange: (chips: Filters, said: string) => void
  fields: Field[]
  facet: (key: FieldKey) => FacetValue[]
  words: (key: FieldKey, v: string) => string
  /** The dimensions' facets: pinned ones, and one By facet. */
  dims?: DimensionFacetsProps
}

export type DimensionFacetsProps = {
  /** The view the counts follow, and its range in days. */
  view: ObsFilterView
  days: number
  /** Every dimension, the most asked first, as the filter's first step lists them. */
  dimensions: ObsDimension[]
  pinned: DimKey[]
  /** An admin pins a dimension for everyone, or unpins it. */
  onPin?: (key: DimKey, on: boolean) => void
}

/** The facets beside the topics; folded away, they keep their place shut and out of reach. */
export function FacetRail({ folded, ...props }: FacetsProps & { folded: boolean }) {
  return (
    <aside
      aria-label="Facets"
      inert={folded}
      className={cn(
        'min-w-0 overflow-hidden border-r py-3 transition-[opacity,border-color] duration-(--dur-3) ease-panel',
        folded && 'border-transparent opacity-0',
      )}
    >
      <div className="w-60">
        <Facets {...props} />
      </div>
    </aside>
  )
}

export function FacetSheet({
  open,
  onOpenChange,
  ...props
}: FacetsProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="gap-0 overflow-y-auto pb-safe-area">
        <SheetHeader className="border-b">
          <SheetTitle>Facets</SheetTitle>
          <SheetDescription>Every value with what it counts. Counts only.</SheetDescription>
        </SheetHeader>
        <div className="py-3">
          <Facets {...props} />
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Facets({ chips, onChange, fields, facet, words, dims }: FacetsProps) {
  const [q, setQ] = React.useState('')
  const [more, setMore] = React.useState<FieldKey[]>([])
  const find = q.trim().toLowerCase()
  return (
    <div className="flex flex-col">
      <div className="px-3 pb-2">
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a value"
            aria-label="Find a value"
            className="h-7 pl-8 text-dense md:text-dense pointer-coarse:h-11"
          />
        </div>
      </div>
      {fields.map((f) => {
        const counts = facet(f.key)
        const chip = chipOf(chips, f.key)
        const values = counts.filter(
          (v) =>
            (!find || words(f.key, v.value).toLowerCase().includes(find)) &&
            // A value with no topic in view is left out, unless it is chosen; an answer state
            // and a kind of agent always show.
            (f.key === 'answer' ||
              f.key === 'agent' ||
              chip?.values.includes(v.value) ||
              v.topics > 0),
        )
        if (!values.length) return null
        const all = more.includes(f.key) || !!find
        const list = all ? values : values.slice(0, FIRST)
        const max = Math.max(1, ...values.map((v) => facetSize(v.count)))
        const state = f.key === 'answer'
        return (
          <section
            key={f.key}
            aria-label={FILTER_WORDS[f.key]}
            className="border-t border-border/60 px-3 py-2 first-of-type:border-t-0"
          >
            <h3 className="flex h-6 items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <span>
                {FILTER_WORDS[f.key]}
                {chip?.not && <span className="font-normal"> {opWords(chip)}</span>}
              </span>
              {chip && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-6 px-1.5 text-xs font-normal"
                  onClick={() =>
                    onChange(
                      chips.filter((c) => c.key !== f.key),
                      `Removed the filter ${FILTER_WORDS[f.key]}`,
                    )
                  }
                >
                  Clear
                  <span className="sr-only"> {FILTER_WORDS[f.key]}</span>
                </Button>
              )}
            </h3>
            <ul className="flex flex-col">
              {list.map((v) => {
                const on = !!chip?.values.includes(v.value)
                const label = words(f.key, v.value)
                const id = `facet-${f.key}-${v.value}`
                return (
                  <li key={v.value} className="flex h-7 items-center gap-2 pointer-coarse:h-11">
                    <Checkbox
                      id={id}
                      aria-label={label}
                      checked={on}
                      onCheckedChange={() => {
                        const next = f.one
                          ? withValues(chips, f.key, on ? [] : [v.value])
                          : toggled(chips, f.key, v.value)
                        onChange(next, `${on ? 'Removed' : 'Added'} ${label}`)
                      }}
                    />
                    <label
                      htmlFor={id}
                      className={cn(
                        'flex min-w-0 flex-1 items-center gap-1.5 truncate text-dense',
                        !v.topics && !on && f.key !== 'agent' && 'text-muted-foreground',
                      )}
                    >
                      {state && <Swatch state={v.value as Shown} />}
                      <span className="truncate">{label}</span>
                    </label>
                    <FacetCount
                      f={v}
                      max={max}
                      state={state}
                      label={label}
                      onDrill={() =>
                        onChange(
                          withValues(chips, f.key, [v.value], false),
                          `Looking at only ${label}`,
                        )
                      }
                    />
                  </li>
                )
              })}
            </ul>
            {!all && (
              <ShowMoreButton
                more={values.length - list.length}
                next={values.length - list.length}
                onClick={() => setMore((m) => [...m, f.key])}
                className="-ml-2 h-7 w-fit text-xs"
              />
            )}
          </section>
        )
      })}
      {dims && <DimensionFacets {...dims} chips={chips} onChange={onChange} find={q.trim()} />}
    </div>
  )
}

/**
 * The dimensions' facets: one for each dimension an admin pinned, in their order, then one By
 * facet that shows another dimension, the most asked first, switched in its menu. Each lists the
 * values agents asked about most in the range (one page from the service, never every value).
 */
function DimensionFacets({
  view,
  days,
  dimensions,
  pinned,
  onPin,
  chips,
  onChange,
  find,
}: DimensionFacetsProps & {
  chips: Filters
  onChange: (chips: Filters, said: string) => void
  find: string
}) {
  const asked = dimensions.filter((d) => (d.asked?.topics ?? 0) > 0)
  const shown = pinned.flatMap((k) => dimensions.find((d) => d.key === k) ?? [])
  const others = asked.filter((d) => !pinned.includes(d.key as DimKey))
  // By starts on a dimension a chip is on, else the most asked; the person's choice after that.
  const [by, setBy] = React.useState<DimKey | null>(null)
  const start = others.find((d) => chipOf(chips, d.key as DimKey)) ?? others[0]
  const chosen = others.find((d) => d.key === by) ?? start
  const pin = (d: ObsDimension, on: boolean) =>
    onPin && (
      <Button
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground pointer-coarse:size-11"
        aria-label={`${on ? 'Pin' : 'Unpin'} ${d.name} for everyone`}
        title={on ? 'Pin for everyone: a facet of its own' : 'Unpin for everyone'}
        onClick={() => onPin(d.key as DimKey, on)}
      >
        {on ? <PinIcon /> : <PinOffIcon />}
      </Button>
    )
  return (
    <>
      {shown.map((d) => (
        <DimensionFacet
          key={d.key}
          d={d}
          view={view}
          chips={chips}
          onChange={onChange}
          find={find}
          head={
            <>
              <PinIcon aria-hidden className="size-3 shrink-0" />
              <span className="truncate">{d.name}</span>
            </>
          }
          tools={pin(d, false)}
        />
      ))}
      {chosen && (
        <DimensionFacet
          key={`by:${chosen.key}`}
          d={chosen}
          view={view}
          chips={chips}
          onChange={onChange}
          find={find}
          label={`By ${chosen.name}`}
          head={
            <>
              <span className="shrink-0">By</span>
              <Select
                items={others.map((d) => ({ label: d.name, value: d.key }))}
                value={chosen.key}
                onValueChange={(v) => v && setBy(v as DimKey)}
              >
                <SelectTrigger
                  size="sm"
                  aria-label="Break the facets down by a dimension"
                  className="h-6 min-w-0 gap-1 border-transparent px-1.5 text-xs font-medium text-foreground hover:bg-muted pointer-coarse:h-11"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {others.map((d) => (
                      <SelectItem key={d.key} value={d.key}>
                        <span className="flex w-full items-center gap-3">
                          <span className="truncate">{d.name}</span>
                          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                            {facetWords(countOf(d.asked))}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </>
          }
          tools={pin(chosen, true)}
        />
      )}
      <p className="border-t border-border/60 px-3 pt-2 text-xs text-muted-foreground">
        {asked.length
          ? `${asked.length} ${asked.length === 1 ? 'dimension was' : 'dimensions were'} asked about in ${days} days. ${
              onPin
                ? 'Pin one to keep it here for everyone, or pick it in By.'
                : 'Pick one in By. An admin can pin one here for everyone.'
            }`
          : `Agents named no dimension in ${days} days.`}
      </p>
    </>
  )
}

/** One dimension's facet: its most asked values in the range, each to tick, with its count. */
function DimensionFacet({
  d,
  view,
  chips,
  onChange,
  find,
  head,
  label,
  tools,
}: {
  d: ObsDimension
  view: ObsFilterView
  chips: Filters
  onChange: (chips: Filters, said: string) => void
  find: string
  head: React.ReactNode
  /** Its name for a screen reader, when the head says it another way. */
  label?: string
  tools?: React.ReactNode
}) {
  const key = d.key as DimKey
  const q = useDebounced(find)
  const read = useQuery({
    ...dimensionValuesQuery(view, key, q),
    placeholderData: (last, was) =>
      (was?.queryKey[1] as { dimension?: string } | undefined)?.dimension === key
        ? last
        : undefined,
  })
  const [all, setAll] = React.useState(false)
  const group = read.data?.groups[0]
  rememberNames([d, ...(group?.values ?? [])])
  const chip = chipOf(chips, key)
  // Read for the first time, its rows keep their places from the first frame (skeletons once the
  // read has taken 150 ms), and the facet keeps that height when fewer values come: nothing under
  // it moves.
  const [places] = React.useState(() => {
    if (!read.isPending) return 0
    const n = d.valuesAsked
    return Math.max(1, chip?.values.length ?? 0, Math.min(FIRST, n)) + (n > FIRST ? 1 : 0)
  })
  const busy = useDelayedBusy(read.isPending)
  const read50 = group?.values ?? []
  // The values chosen come first, those the page lists and those it does not (from a link, or
  // fewer asks than its 50), then the most asked.
  const chosen = (chip?.values ?? []).filter(
    (v) => v !== ANY && (!find || nameOf(v).toLowerCase().includes(find.toLowerCase())),
  )
  const values = [
    ...chosen.map(
      (v) =>
        read50.find((x) => x.key === v) ?? {
          key: v,
          name: nameOf(v),
          asked: { total: 0, atLeast: 0, topics: 0 },
        },
    ),
    ...read50.filter((v) => !chosen.includes(v.key)),
  ]
  const list = all || find ? values : values.slice(0, Math.max(FIRST, chosen.length))
  const max = Math.max(1, ...values.map((v) => facetSize(countOf(v.asked))))
  const more = !all && !find && values.length > list.length
  const room =
    find || read.isPending ? 0 : places - (values.length ? list.length : 1) - (more ? 1 : 0)
  if (find && read.data && !values.length) return null
  return (
    <section aria-label={label ?? d.name} className="border-t border-border/60 px-3 py-2">
      <h3 className="flex h-6 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {head}
        <span className="ml-auto flex shrink-0 items-center">
          {chip && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs font-normal"
              onClick={() =>
                onChange(
                  chips.filter((c) => c.key !== key),
                  `Removed the filter ${d.name}`,
                )
              }
            >
              Clear
              <span className="sr-only"> {d.name}</span>
            </Button>
          )}
          {tools}
        </span>
      </h3>
      {read.isPending ? (
        <FacetPlaces rows={places || 3} shown={busy} />
      ) : read.isError ? (
        <p className="py-1 text-xs text-muted-foreground">
          Couldn’t load the values of {d.name}.{' '}
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => void read.refetch()}
          >
            Try again
          </Button>
        </p>
      ) : !values.length ? (
        <p className="flex min-h-7 items-center text-xs text-muted-foreground pointer-coarse:min-h-11">
          {d.values ? 'No value asked about in this range.' : 'No values from the definitions.'}
        </p>
      ) : (
        <ul className="flex flex-col">
          {list.map((v) => {
            const on = !!chip?.values.includes(v.key)
            const id = `facet-${v.key}`
            const f = { value: v.key, topics: v.asked.topics, count: countOf(v.asked) }
            return (
              <li key={v.key} className="flex h-7 items-center gap-2 pointer-coarse:h-11">
                <Checkbox
                  id={id}
                  aria-label={v.name}
                  checked={on}
                  onCheckedChange={() =>
                    onChange(toggled(chips, key, v.key), `${on ? 'Removed' : 'Added'} ${v.name}`)
                  }
                />
                <label htmlFor={id} className="flex min-w-0 flex-1 truncate text-dense">
                  <span className="truncate">{v.name}</span>
                </label>
                {read50.some((x) => x.key === v.key) ? (
                  <FacetCount
                    f={f}
                    max={max}
                    state={false}
                    label={v.name}
                    onDrill={() =>
                      onChange(withValues(chips, key, [v.key], false), `Looking at only ${v.name}`)
                    }
                  />
                ) : (
                  <span
                    className="ml-auto shrink-0 px-1 text-xs text-muted-foreground"
                    title="Not among the values asked about most in this range"
                  >
                    -<span className="sr-only">, not among the values asked about most</span>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {more && (
        <ShowMoreButton
          more={values.length - list.length}
          next={values.length - list.length}
          onClick={() => setAll(true)}
          className="-ml-2 h-7 w-fit text-xs"
        />
      )}
      {room > 0 && <FacetPlaces rows={room} shown={false} />}
      {(all || find) && group?.nextCursor && (
        <p className="pt-1 text-xs text-muted-foreground">
          {(group.matched - values.length).toLocaleString('en-GB')} more, fewer asks each: find one
          above.
        </p>
      )}
    </section>
  )
}

/** A facet's rows while its values load, at their own height; not shown, they only keep the room. */
function FacetPlaces({ rows, shown }: { rows: number; shown: boolean }) {
  return (
    <div aria-hidden className={cn('flex flex-col', !shown && 'invisible')}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-7 items-center gap-2 pointer-coarse:h-11">
          <Skeleton className="size-4 rounded-sm" />
          <Skeleton className="h-3" style={{ width: `${[70, 55, 62, 48, 66, 58][i % 6]}%` }} />
        </div>
      ))}
    </div>
  )
}

/**
 * A value's count, which looks at only that value: counting to a new number as the filters change,
 * with a quiet bar of its share of the field's largest. "Not shown" is greyed and does nothing.
 */
function FacetCount({
  f,
  max,
  state,
  label,
  onDrill,
}: {
  f: FacetValue
  max: number
  state: boolean
  label: string
  onDrill: () => void
}) {
  const words = facetWords(f.count, state)
  const exact = f.count?.visible ?? (f.count && f.count.shown > 0 ? f.count.shown : null)
  const bar = (
    <span aria-hidden className="h-1 w-6 shrink-0 overflow-hidden rounded-full bg-muted">
      <span
        className="block h-full rounded-full bg-muted-foreground/40 transition-[width] duration-(--dur-3) ease-move"
        style={{ width: `${Math.round((facetSize(f.count) / max) * 100)}%` }}
      />
    </span>
  )
  if (!f.count)
    return (
      <span
        className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground"
        title="The service counts kinds of agent for every topic only, not for the topics in view."
      >
        Not shown
      </span>
    )
  return (
    <button
      type="button"
      onClick={onDrill}
      aria-label={`${label}: ${facetSaid(f, state)}. Look at only these`}
      title="Look at only these"
      className="relative ml-auto flex h-6 shrink-0 items-center gap-2 rounded-sm px-1 text-xs text-muted-foreground tabular-nums outline-none after:absolute after:-inset-y-0.5 hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {exact !== null ? (
        <CountUp value={exact} suffix={f.count.visible === null ? '+' : undefined} />
      ) : (
        words
      )}
      {bar}
    </button>
  )
}
