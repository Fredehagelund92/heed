import * as React from 'react'
import { BotIcon, ChevronDownIcon, LayersIcon } from 'lucide-react'
import { cn } from 'cn'
import { Changed } from '@/components/heed/changed'
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
import { AGENTS, RANGES, type Range } from '@/data/observability'
import { domainIds, domains, type DomainId } from '@/data/world'
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
      className="flex h-8 shrink-0 items-stretch rounded-md border bg-background p-0.5"
    >
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          role="radio"
          aria-checked={value === r}
          onClick={() => setQuery({ range: r === 7 ? undefined : String(r) })}
          className={cn(
            'rounded-[5px] px-2.5 text-[13px] whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 max-sm:min-h-10',
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

/** The page's filters: a domain, a kind of agent (admins), and the range. */
export function ObsControls({ view, compact }: { view: ObsView; compact?: boolean }) {
  const doms = (view.owned ?? domainIds.filter((d) => d !== 'sandbox')) as DomainId[]
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!compact && (view.owned?.length !== 1 || !view.owned) && (
        <Filter
          heading="Domain"
          icon={<LayersIcon className="size-3.5" />}
          label={view.domain ? domains[view.domain].name : 'All domains'}
          value={view.domain ?? 'all'}
          options={[
            ...(view.owned ? [] : [{ value: 'all', label: 'All domains' }]),
            ...doms.map((d) => ({ value: d, label: domains[d].name })),
          ]}
          onChange={(v) => setQuery({ domain: v === 'all' ? undefined : v })}
        />
      )}
      {!compact && !view.owned && (
        <Filter
          heading="Agent"
          icon={<BotIcon className="size-3.5" />}
          label={view.agent ?? 'All agents'}
          value={view.agent ?? 'all'}
          options={[
            { value: 'all', label: 'All agents' },
            ...AGENTS.map((a) => ({ value: a.name, label: a.name })),
          ]}
          onChange={(v) => setQuery({ agent: v === 'all' ? undefined : v })}
        />
      )}
      <RangeSwitch value={view.range} />
    </div>
  )
}

/** One number in a row of cells: a label with its icon, the number, and a line on what it compares with. A link goes to its rows. */
export function Kpi({
  icon,
  label,
  value,
  unit,
  change,
  tone,
  sub,
  href,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  unit?: string
  change?: string
  tone?: 'up' | 'down' | 'warn'
  sub?: string
  href?: string
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5">
        {icon}
        {label}
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
      <span className="mt-0.5 text-xs text-muted-foreground">
        {change && (
          <span
            className={cn(
              'mr-1 font-semibold',
              tone === 'up' && 'text-[var(--ok)]',
              tone === 'warn' && 'text-[var(--warn)]',
            )}
          >
            {change}
          </span>
        )}
        {sub}
      </span>
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
