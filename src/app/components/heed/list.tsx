import * as React from 'react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  EllipsisIcon,
  LinkIcon,
  PlusIcon,
  SearchIcon,
  SquareArrowOutUpRightIcon,
  XIcon,
} from '@/components/icons'
import { toast } from 'sonner'
import { useListOrder, words } from '@/lib/list'
import { navigate } from '@/lib/router'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Status } from '@/model/items'

// The parts the Context and Definitions lists share, drawn the way the Heed app draws its list and
// Efferd its tables: a quiet filter bar, a thin header row, rows of one line at one density, plain
// text and glyphs instead of pills, and a cursor the keyboard moves.

/** The filter bar: 40 high, 28px controls in muted text, wrapping on a phone. */
export function ListBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-1 border-b px-4 py-1.5 md:px-6">
      {children}
    </div>
  )
}

/** A control in the bar. */
export const barButton =
  "h-7 gap-1.5 px-2 text-dense font-normal text-muted-foreground hover:text-foreground aria-expanded:text-foreground [&_svg:not([class*='size-'])]:size-3.5"

export function BarSpacer({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-end gap-2 @max-2xl/main:order-last @max-2xl/main:basis-full">
      {children}
    </div>
  )
}

export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  const ref = React.useRef<HTMLInputElement>(null)
  // "/" jumps to the search field, as in the Heed app.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === '/' && !t.closest('input, textarea, [contenteditable=true]')) {
        e.preventDefault()
        ref.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="relative w-full max-w-80 min-w-0 @max-2xl/main:max-w-none">
      <SearchIcon
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Escape clears the field, then leaves it; Down goes to the first row.
          if (e.key === 'Escape') {
            e.stopPropagation()
            if (value) onChange('')
            else e.currentTarget.blur()
          }
          if (e.key === 'ArrowDown') {
            const first = document.querySelector<HTMLElement>('[data-row-open]')
            if (first) {
              e.preventDefault()
              first.focus()
            }
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-7 pr-8 pl-8 text-dense md:text-dense @max-2xl/main:h-11 @max-2xl/main:text-base pointer-coarse:h-11"
      />
      <Kbd className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 max-md:hidden">
        /
      </Kbd>
    </div>
  )
}

export function Count({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-live="polite"
      className="w-30 shrink-0 text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums @max-5xl/main:sr-only"
    >
      {children}
    </span>
  )
}

/** A filter that is on, read as a sentence: "Domain is Sales", "Status is any of Live, Archived +1". */
export function FilterChip({
  field,
  values,
  onRemove,
}: {
  field: string
  values: string[]
  onRemove: () => void
}) {
  const shown = values.slice(0, 2).join(', ')
  const rest = values.length - 2
  const label = `${field} ${values.length > 1 ? 'is any of' : 'is'} ${values.join(', ')}`
  return (
    <span className="inline-flex h-6 max-w-full items-center gap-1 rounded-md border bg-background pr-0.5 pl-2 text-xs">
      <span className="truncate">
        <span className="text-muted-foreground">
          {field} {values.length > 1 ? 'is any of' : 'is'}
        </span>{' '}
        {shown}
        {rest > 0 && <span className="text-muted-foreground"> +{rest}</span>}
      </span>
      <button
        type="button"
        aria-label={`Remove the filter: ${label}`}
        className="relative grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground outline-none after:absolute after:-inset-3 hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={onRemove}
      >
        <XIcon className="size-3" />
      </button>
    </span>
  )
}

/** A value in the filter menu: its label as the list draws it, and how many rows it would show. */
export function FilterValue({ children, count }: { children: React.ReactNode; count: number }) {
  return (
    <span className="flex w-full items-center gap-2">
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
    </span>
  )
}

/** The row of filters that are on, under the bar, with Clear all from two. */
export function FilterRow({
  children,
  count,
  onClear,
}: {
  children: React.ReactNode
  count: number
  onClear: () => void
}) {
  if (!count) return null
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-4 py-1.5 md:px-6">
      {children}
      {count > 1 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs font-normal text-muted-foreground"
          onClick={onClear}
        >
          Clear all
        </Button>
      )}
    </div>
  )
}

/** The words a search matched, in bold, as the Heed app marks them. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const ws = words(query)
  if (!ws.length) return <>{text}</>
  const re = new RegExp(
    `(^|[^\\p{L}\\p{N}])(${ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'giu',
  )
  const parts: React.ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    const [, before = '', word = ''] = m
    const start = m.index + before.length
    parts.push(
      text.slice(last, start),
      <mark key={start} className="bg-transparent font-bold text-inherit">
        {word}
      </mark>,
    )
    last = start + word.length
  }
  parts.push(text.slice(last))
  return <>{parts}</>
}

/** A group's header row: collapsible, with its count. */
export function GroupRow({
  label,
  detail,
  open,
  onToggle,
  colSpan,
}: {
  label: string
  detail: string
  open: boolean
  onToggle: () => void
  colSpan: number
}) {
  return (
    <tr className="border-b bg-muted/40">
      <td colSpan={colSpan} className="h-8 p-0">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex h-8 w-full items-center gap-1.5 px-4 text-left text-xs font-medium outline-none hover:bg-muted focus-visible:bg-muted md:px-6"
        >
          {open ? (
            <ChevronDownIcon className="size-3.5 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronRightIcon className="size-3.5 text-muted-foreground" aria-hidden />
          )}
          {label}
          <span className="font-normal text-muted-foreground tabular-nums">{detail}</span>
        </button>
      </td>
    </tr>
  )
}

/** The row's own menu, shown on hover or focus: open the page, copy its link. */
export function RowMenu({
  title,
  page,
  link,
  extra,
}: {
  title: string
  page: string
  link: string
  extra?: { label: string; icon: React.ReactNode; onSelect: () => void }[]
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`More for ${title}`}
            className="text-muted-foreground opacity-0 group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 [@media(hover:none)]:opacity-100"
            onClick={(e) => e.stopPropagation()}
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => navigate(page)}>
          <SquareArrowOutUpRightIcon />
          Open the page
        </DropdownMenuItem>
        {extra?.map((x) => (
          <DropdownMenuItem key={x.label} onClick={x.onSelect}>
            {x.icon}
            {x.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem
          onClick={() => {
            navigator.clipboard?.writeText(link).catch(() => undefined)
            toast('Link copied')
          }}
        >
          <LinkIcon />
          Copy link
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The quiet last row that adds one more. */
export function AddRow({
  label,
  onClick,
  colSpan,
}: {
  label: string
  onClick: () => void
  colSpan: number
}) {
  return (
    <tr className="border-b">
      <td colSpan={colSpan} className="p-0">
        <button
          type="button"
          onClick={onClick}
          className="flex h-9 w-full items-center gap-2 px-4 text-left text-sm text-muted-foreground outline-none hover:bg-muted/50 hover:text-foreground focus-visible:bg-muted md:px-6"
        >
          <PlusIcon className="size-4" aria-hidden />
          {label}
        </button>
      </td>
    </tr>
  )
}

/** "3 of 17" with Previous and Next, in the peek's header, while its list is on screen. */
export function DockStepper({
  list,
  id,
  onGo,
}: {
  list: string
  id: string
  onGo: (id: string) => void
}) {
  const order = useListOrder(list)
  const at = order?.indexOf(id) ?? -1
  const ref = React.useRef<HTMLSpanElement>(null)
  // J and K step through the list while focus is in the peek, as they do in the list itself.
  React.useEffect(() => {
    if (!order || at < 0) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (
        t.closest('input, textarea, [contenteditable=true]') ||
        !ref.current?.closest('section')?.contains(t)
      )
        return
      const next = e.key === 'j' ? order[at + 1] : e.key === 'k' ? order[at - 1] : undefined
      if (next) {
        e.preventDefault()
        onGo(next)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [order, at, onGo])
  if (!order || at < 0) return null
  return (
    <span ref={ref} className="flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous"
              disabled={at === 0}
              onClick={() => onGo(order[at - 1]!)}
            />
          }
        >
          <ChevronUpIcon />
        </TooltipTrigger>
        <TooltipContent>
          Previous <Kbd>K</Kbd>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next"
              disabled={at === order.length - 1}
              onClick={() => onGo(order[at + 1]!)}
            />
          }
        >
          <ChevronDownIcon />
        </TooltipTrigger>
        <TooltipContent>
          Next <Kbd>J</Kbd>
        </TooltipContent>
      </Tooltip>
    </span>
  )
}

/**
 * The header row's cell look: 36 high like the Heed app's, 12px medium muted labels on a faint
 * muted band, and a hairline a touch stronger than the rows' drawn as an inset shadow, so it stays
 * when the header sticks while scrolling (a collapsed border would not).
 */
export const thClass =
  'h-9 bg-band px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground shadow-[inset_0_-1px_0_color-mix(in_oklab,var(--border),var(--foreground)_14%)]'

/** A header cell. */
export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn(thClass, className)}>{children}</th>
}

const dot: Record<Status, string> = {
  Draft: 'bg-transparent ring-1 ring-inset ring-off',
  Live: 'bg-good',
  'Needs checking': 'bg-caution',
  Archived: 'bg-off',
}

const statusHint: Record<Status, string> = {
  Draft: 'Draft: written, not shared with agents yet',
  Live: 'Live: agents get it',
  'Needs checking': 'Needs checking: its check date passed or a definition changed',
  Archived: 'Archived: agents no longer get it',
}

/**
 * A status as a small dot. As in the Heed app, a calm status is the dot alone with its name in a
 * tooltip; one that asks for a look says it in words too.
 */
export function StatusDot({
  status,
  label,
  className,
}: {
  status: Status
  label?: boolean
  className?: string
}) {
  const calm = status === 'Live' && !label
  return (
    <span
      title={statusHint[status]}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap',
        status === 'Needs checking' ? 'text-foreground' : 'text-muted-foreground',
        className,
      )}
    >
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', dot[status])} />
      <span className={cn(calm && 'sr-only')}>{status}</span>
    </span>
  )
}

/** The note dot for a definition Cube changed. */
export function ChangedDot() {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full align-middle',
        dot['Needs checking'],
      )}
    />
  )
}
