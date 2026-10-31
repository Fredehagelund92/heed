import * as React from 'react'
import { useObservability } from '@/lib/obs'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BotIcon,
  ChevronDownIcon,
  InfoIcon,
  LayersIcon,
} from '@/components/icons'
import { cn } from '@/lib/utils'
import { Changed } from '@/components/heed/changed'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Change } from '@domain/observability'
import { RANGES, type Range } from '@/model/observability'
import { useDomainList, useDomains } from '@/lib/workspace'
import type { ObsView } from '@/lib/obs'
import { setQuery } from '@/lib/router'

// The controls every Observability page shares, kept in the address so a link (or Back) lands the
// same way: 7, 30 or 90 days, a domain and a kind of agent. An owner who isn't an admin sees only
// the domains they own, and no agent filter (the agents list is for admins).

/** 7, 30 or 90 days: one row of three, a radio group to a screen reader. */
export function RangeSwitch({ value }: { value: Range }) {
  return (
    <div
      role="radiogroup"
      aria-label="Time"
      className="flex h-8 shrink-0 items-stretch rounded-md border bg-background p-0.5 max-sm:h-10"
    >
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          role="radio"
          aria-checked={value === r}
          onClick={() => setQuery({ range: r === 7 ? undefined : String(r) })}
          className={cn(
            'rounded-tile px-2.5 text-dense whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
            value === r && 'bg-muted font-medium text-foreground',
          )}
        >
          {r} days
        </button>
      ))}
    </div>
  )
}

function Filter({
  icon,
  label,
  value,
  options,
  onChange,
  heading,
}: {
  icon: React.ReactNode
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  heading: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="h-8 gap-1.5 font-normal max-sm:h-10" />
        }
      >
        {icon}
        <span className="sr-only">{heading}: </span>
        {label}
        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{heading}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as string)}>
            {options.map((o) => (
              <DropdownMenuRadioItem key={o.value} value={o.value}>
                {o.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The domain filter alone: every domain or one for admins, an owner's own domains. */
export function DomainFilter({ view }: { view: Pick<ObsView, 'domain' | 'owned'> }) {
  const domains = useDomains()
  const domainIds = useDomainList().map((d) => d.id)
  const doms = view.owned ?? domainIds.filter((d) => !domains[d]?.sandbox)
  if (view.owned?.length === 1) return null
  return (
    <Filter
      heading="Domain"
      icon={<LayersIcon className="size-3.5" />}
      label={view.domain ? (domains[view.domain]?.name ?? 'All domains') : 'All domains'}
      value={view.domain ?? 'all'}
      options={[
        ...(view.owned ? [] : [{ value: 'all', label: 'All domains' }]),
        ...doms.map((d) => ({ value: d, label: domains[d]?.name ?? d })),
      ]}
      onChange={(v) => setQuery({ domain: v === 'all' ? undefined : v })}
    />
  )
}

/** The page's filters: a domain, a kind of agent (admins), and the range. */
export function ObsControls({ view, compact }: { view: ObsView; compact?: boolean }) {
  const obs = useObservability()
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!compact && <DomainFilter view={view} />}
      {!compact && !view.owned && (
        <Filter
          heading="Agent"
          icon={<BotIcon className="size-3.5" />}
          label={view.agent ?? 'All agents'}
          value={view.agent ?? 'all'}
          options={[
            { value: 'all', label: 'All agents' },
            ...obs.data.agents.map((a) => ({ value: a.name, label: a.name })),
          ]}
          onChange={(v) => setQuery({ agent: v === 'all' ? undefined : v })}
        />
      )}
      <RangeSwitch value={view.range} />
    </div>
  )
}

/**
 * How a number moved from the period before, as a cell says it: the words ("+4 pts", "About the
 * same"), an arrow when it went up or down by more than chance would, and whether that is good or
 * bad. Colour comes only with an arrow, and only when the move means something: green ink for
 * better, amber for "look here" (never red, which says something failed). The arrow and the words
 * give the direction, so amber never has to mean "down".
 */
export type KpiChange = { words: string; direction?: 'up' | 'down'; tone?: 'good' | 'bad' }

/**
 * A move as a cell says it: "About the same" with no arrow and no colour within the margin; else
 * the words, the arrow, and good or bad when `better` says which way is better.
 */
export function kpiChange(
  change: Change | null,
  words: (change: Change) => string,
  better?: 'up' | 'down',
): KpiChange | undefined {
  if (!change) return undefined
  if (change.direction === 'same') return { words: 'About the same' }
  return {
    words: words(change),
    direction: change.direction,
    ...(better ? { tone: change.direction === better ? 'good' : 'bad' } : {}),
  }
}

/** "3 more", "3 fewer": a move in calls. */
export const moreOrFewer = (c: Change) =>
  `${Math.abs(c.by).toLocaleString('en-GB')} ${c.by > 0 ? 'more' : 'fewer'}`

/** What a number counts, exactly, a click away: an info button beside its label. */
export function Definition({ label, definition }: { label: string; definition: string }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="-my-1 text-muted-foreground max-sm:size-9 print:hidden"
            aria-label={`What ${label} counts`}
          />
        }
      >
        <InfoIcon />
      </PopoverTrigger>
      <PopoverContent align="start" className="text-pretty">
        <p className="font-medium">{label}</p>
        <p className="text-muted-foreground">{definition}</p>
      </PopoverContent>
    </Popover>
  )
}

/**
 * One number in a row of cells: a label with its icon, the number, and a line on what it compares
 * with. A link goes to its rows; a cell with no link may say exactly what it counts, a click away.
 */
export function Kpi({
  icon,
  label,
  value,
  unit,
  change,
  sub,
  href,
  definition,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  unit?: string
  change?: KpiChange
  sub?: string
  href?: string
  definition?: string
}) {
  const Arrow = change?.direction === 'up' ? ArrowUpIcon : ArrowDownIcon
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5">
        {icon}
        {label}
        {definition && !href && <Definition label={label} definition={definition} />}
      </span>
      <span className="mt-1 flex items-baseline gap-1.5">
        <Changed
          value={typeof value === 'string' || typeof value === 'number' ? value : undefined}
          className="text-2xl font-semibold tracking-tight tabular-nums"
        >
          {value}
        </Changed>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </span>
      {/* The change on a line of its own, so it never runs into what the number counts. */}
      {change && (
        <span
          data-slot="kpi-change"
          className={cn(
            'mt-0.5 flex items-center gap-0.5 text-xs font-semibold text-muted-foreground',
            !change.direction && 'font-medium',
            change.direction && change.tone === 'good' && 'text-good-ink',
            change.direction && change.tone === 'bad' && 'text-caution-text',
            change.direction && !change.tone && 'text-foreground',
          )}
        >
          {change.direction && <Arrow className="size-3" aria-hidden />}
          {change.words}
        </span>
      )}
      {sub && <span className="mt-0.5 text-xs text-muted-foreground">{sub}</span>}
    </>
  )
  const cls = 'flex min-w-0 flex-col bg-background px-4 py-3 md:px-5 md:py-4'
  return href ? (
    <a
      href={href}
      className={cn(
        cls,
        'outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset',
      )}
    >
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  )
}
