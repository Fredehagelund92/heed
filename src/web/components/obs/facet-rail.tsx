import * as React from 'react'
import { SearchIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
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
import {
  chipOf,
  facetSaid,
  facetSize,
  facetWords,
  FILTER_WORDS,
  opWords,
  toggled,
  withValues,
  type FacetValue,
  type FieldKey,
  type Filters,
} from '@/lib/obs-views'
import type { Shown } from '@/model/observability'

// The facets: every field's values with what each counts, counted without the field's own chip so
// the other values stay in sight. A tick adds the value to the field's chip; a count looks at only
// that value. Beside the topics on a wide page, in a sheet on a narrow one. The counts are the
// disclosed counts added up (lib/obs-views.ts): "13+" when a part is hidden, "Fewer than 5", and
// "Not shown" where the service keeps no count for the topics in view.

/** How many values a field shows before Show more. */
const FIRST = 6

export type FacetsProps = {
  chips: Filters
  onChange: (chips: Filters, said: string) => void
  fields: Field[]
  facet: (key: FieldKey) => FacetValue[]
  words: (key: FieldKey, v: string) => string
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

function Facets({ chips, onChange, fields, facet, words }: FacetsProps) {
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
