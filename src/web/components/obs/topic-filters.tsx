import * as React from 'react'
import { toast } from 'sonner'
import { useWrite } from '@/api/queries'
import { BookmarkIcon, ChevronDownIcon, ListTreeIcon, XIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { barButton, FilterValue } from '@/components/heed/list'
import { TextSwitch } from '@/components/heed/switches'
import { GROUPINGS, type Grouping, type Topic } from '@/model/observability'
import type { ObsView } from '@/lib/obs'
import { passes, readDomain, type Filters } from '@/lib/obs-views'
import { setQuery } from '@/lib/router'

// Overview's controls for its topics, on the list pattern Context and Definitions share: the views
// as words with counts, the grouping, and a view saved for the whole workspace. The filters are
// the filter bar's (filter-bar.tsx).

export type ViewOption = { id: string; name: string; count: number }

/**
 * The views, built in and saved: words with how many topics each holds, the chosen one underlined.
 * On a narrow page they fold into one menu. A saved view can be taken off by anyone, as it belongs
 * to the workspace.
 */
export function ViewSwitch({
  views,
  value,
  onChange,
  onRemove,
}: {
  views: ViewOption[]
  value: string
  onChange: (id: string) => void
  /** Taking the chosen view off, when it is a saved one. */
  onRemove?: () => void
}) {
  const on = views.find((v) => v.id === value) ?? views[0]!
  return (
    <div className="flex min-w-0 items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" className={cn(barButton, 'text-foreground @4xl/main:hidden')} />
          }
        >
          <span className="sr-only">View: </span>
          {on.name}
          <span className="text-xs text-muted-foreground tabular-nums">{on.count}</span>
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Views</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={on.id} onValueChange={(v) => onChange(v as string)}>
              {views.map((v) => (
                <DropdownMenuRadioItem key={v.id} value={v.id}>
                  <FilterValue count={v.count}>{v.name}</FilterValue>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <TextSwitch
        label="Views"
        className="min-w-0 pl-1 text-sm @max-4xl/main:hidden"
        value={on.id}
        onChange={onChange}
        options={views.map((v) => ({ value: v.id, label: v.name, count: v.count }))}
      />
      {onRemove && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove the view ${on.name}`}
          className="text-muted-foreground"
          onClick={onRemove}
        >
          <XIcon />
        </Button>
      )}
    </div>
  )
}

/** The filters with nothing on: an owner keeps their own domain. */
export const cleared = (view: Pick<ObsView, 'owned' | 'domain'>): Filters =>
  view.owned && view.domain ? [{ key: 'domain', values: [view.domain] }] : []

/** How the topics are grouped for reading; each stays one exact scope with its month. */
export function GroupMenu({ value }: { value: Grouping }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className={cn(barButton, value !== 'none' && 'bg-muted text-foreground')}
          />
        }
      >
        <ListTreeIcon />
        Group <span className="text-foreground">{GROUPINGS[value]}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Group topics by</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(v) => setQuery({ group: v === 'metric' ? undefined : (v as string) })}
          >
            {(Object.keys(GROUPINGS) as Grouping[]).map((g) => (
              <DropdownMenuRadioItem key={g} value={g}>
                {GROUPINGS[g]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
          Each topic stays one exact scope with its month; grouping joins them for reading.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Save this view: a name, and everyone in the workspace has it beside the others. */
export function SaveView({
  filters,
  said,
  disabled,
}: {
  filters: Filters
  /** The filters as sentences, for the name it suggests. */
  said: string[]
  disabled: boolean
}) {
  const write = useWrite()
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const suggested = said.join(', ')
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o && disabled) return
        setOpen(o)
        if (o) setName(suggested)
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            className={barButton}
            aria-disabled={disabled || undefined}
            aria-description={
              disabled ? 'Filter the topics first: a view keeps its filters.' : undefined
            }
          />
        }
      >
        <BookmarkIcon />
        Save this view
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            void write('saveView', { name: name.trim(), filters }).then(({ id }) => {
              setOpen(false)
              setQuery({ view: id })
              toast(`Saved the view ${name.trim()}`, {
                description: 'Everyone in the workspace has it beside the others.',
              })
            })
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="view-name">
            Name the view
            <Input id="view-name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <p className="text-xs text-muted-foreground">
            It keeps these filters: {suggested}. It belongs to the workspace, so everyone sees it.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Save for everyone</Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}

/** How many topics a view holds, with the domain the service reads. */
export const viewCount = (
  all: Topic[],
  has: (t: Topic) => boolean,
  filters: Filters,
  name: (t: Topic) => string,
) => {
  const domain = readDomain(filters)
  return all.filter(
    (t) => has(t) && passes(t, domain ? [{ key: 'domain', values: [domain] }] : [], name),
  ).length
}
