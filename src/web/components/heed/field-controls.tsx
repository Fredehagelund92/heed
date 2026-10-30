import * as React from 'react'
import { CalendarIcon, XIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { missingDates, WHEN_PRESETS, whenSummary, type WhenMode, type WhenValue } from '@/lib/when'
import { TagChip } from '@/components/heed/tag-chip'
import { PersonAvatar } from '@/components/heed/bits'

// An edit page's properties as a calm list under the title, the way a document shows them, not a
// form: a muted icon and label on the left, the value on the right shown as the thing it is (a dot,
// avatars, a chip, a date phrase), no border at rest, a soft fill on hover and a soft ring on focus.
// A click opens one popover (a bottom sheet on a phone) or edits in place. Arrow keys move between
// properties; Enter opens; Esc closes.

/** A value at rest: no border; a soft fill says it can be clicked. */
const valueBox =
  '-mx-1.5 flex min-h-8 w-fit max-w-[calc(100%+0.75rem)] min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm transition-colors outline-none hover:bg-muted/70 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/40 data-popup-open:bg-muted disabled:cursor-not-allowed disabled:hover:bg-transparent'

/** An empty value: what to add, in a muted ghost, never an empty box. */
export function Ghost({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>
}

/** The properties, in groups split by space and one hairline. Up and Down move between values. */
export function PropertyList({ label, children }: { label: string; children: React.ReactNode }) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const t = e.target as HTMLElement
    if (!t.matches('[data-prop-value]')) return
    // In a text line the arrows move the caret until it reaches an end.
    if (t instanceof HTMLTextAreaElement) {
      const atEnd = t.selectionStart === t.value.length
      const atStart = t.selectionEnd === 0
      if ((e.key === 'ArrowDown' && !atEnd) || (e.key === 'ArrowUp' && !atStart)) return
    }
    const all = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-prop-value]')].filter(
      (el) => !el.closest('[hidden]'),
    )
    const i = all.indexOf(t)
    const next = all[i + (e.key === 'ArrowDown' ? 1 : -1)]
    if (!next) return
    e.preventDefault()
    next.focus()
  }
  return (
    <div
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="mb-6 flex flex-col border-b pb-5 sm:mb-8"
    >
      {children}
    </div>
  )
}

/** One group of properties; the next group starts after a hairline. */
export function PropertyGroup({ children }: { children: React.ReactNode }) {
  return (
    <dl className="flex flex-col gap-0.5 border-t border-border/60 py-2.5 first:border-t-0 first:pt-0 last:pb-0">
      {children}
    </dl>
  )
}

/** One property: the label in its column (above the value on a phone), the value beside it. */
export function PropertyRow({
  id,
  label,
  icon,
  required,
  children,
}: {
  id: string
  label: string
  icon?: React.ReactNode
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-1 items-start gap-x-3 sm:grid-cols-(--cols-lead-34)">
      <dt
        id={id}
        className="flex h-7 items-center gap-2 text-sm text-muted-foreground sm:h-8 [&>svg]:size-3.5 [&>svg]:shrink-0"
      >
        {icon}
        {label}
        {required && (
          <span className="size-1.5 shrink-0 rounded-full bg-primary/70" title="Needed to publish">
            <span className="sr-only">, needed to publish</span>
          </span>
        )}
      </dt>
      <dd className="min-w-0 pl-1.5 max-sm:pb-1.5">{children}</dd>
    </div>
  )
}

/**
 * A field that opens one popover, or a bottom sheet on a phone. The trigger reads as the label and
 * its value ("Kind: Rule"), so a screen reader hears both.
 */
export function PickerField({
  labelId,
  label,
  value,
  open,
  onOpenChange,
  disabled,
  lockedReason,
  initialFocus,
  className,
  children,
}: {
  labelId: string
  label: string
  value: React.ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  disabled?: boolean
  /** Why this person may not change it: the value stays readable, the reason shows on hover or focus. */
  lockedReason?: string
  /** What takes focus when it opens: an element, or a function that finds one. */
  initialFocus?: React.RefObject<HTMLElement | null> | (() => HTMLElement | null | undefined)
  className?: string
  children: React.ReactNode
}) {
  const mobile = useIsMobile()
  const valueId = React.useId()
  if (lockedReason)
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-prop-value
              aria-disabled
              aria-labelledby={`${labelId} ${valueId}`}
              className={cn(valueBox, 'cursor-default hover:bg-transparent')}
            />
          }
        >
          <span id={valueId} className="flex min-w-0 flex-wrap items-center gap-1.5">
            {value}
          </span>
        </TooltipTrigger>
        <TooltipContent>{lockedReason}</TooltipContent>
      </Tooltip>
    )
  const trigger = (
    <button
      type="button"
      data-prop-value
      disabled={disabled}
      aria-labelledby={`${labelId} ${valueId}`}
      className={valueBox}
    >
      <span id={valueId} className="flex min-w-0 flex-wrap items-center gap-1.5">
        {value}
      </span>
    </button>
  )
  if (mobile)
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger render={trigger} />
        <SheetContent
          side="bottom"
          initialFocus={initialFocus}
          className="max-h-bottom-sheet gap-0 pb-safe"
        >
          <SheetHeader className="pb-2">
            <SheetTitle>{label}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 overflow-y-auto px-4">{children}</div>
        </SheetContent>
      </Sheet>
    )
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        align="start"
        initialFocus={initialFocus}
        aria-label={label}
        className={cn('w-72 p-1', className)}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}

export type Option<T extends string> = {
  value: T
  label: string
  hint?: string
  icon?: React.ReactNode
}

/** One choice from a short list: arrow keys move, Enter picks, the field closes. */
export function SelectField<T extends string>({
  labelId,
  label,
  value,
  options,
  onChange,
  disabled,
  display,
}: {
  labelId: string
  label: string
  value: T
  options: Option<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  /** What the field shows, when it is more than the option's label. */
  display?: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const list = React.useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)
  return (
    <PickerField
      labelId={labelId}
      label={label}
      value={display ?? current?.label}
      open={open}
      onOpenChange={setOpen}
      disabled={disabled}
      initialFocus={list}
    >
      <Command
        ref={list}
        tabIndex={-1}
        defaultValue={current?.label}
        label={label}
        className="p-0 outline-none"
      >
        <CommandList label={label}>
          {options.map((o) => (
            <CommandItem
              key={o.value}
              value={o.label}
              data-checked={o.value === value}
              onSelect={() => {
                onChange(o.value)
                setOpen(false)
              }}
            >
              {o.icon && (
                <span className="flex size-4 shrink-0 items-center justify-center self-start pt-0.5">
                  {o.icon}
                </span>
              )}
              <span className="flex min-w-0 flex-col">
                <span>{o.label}</span>
                {o.hint && (
                  <span className="line-clamp-2 text-xs text-muted-foreground">{o.hint}</span>
                )}
              </span>
            </CommandItem>
          ))}
        </CommandList>
      </Command>
    </PickerField>
  )
}

export type OptionGroup = {
  heading: string
  options: { value: string; label: string; icon?: React.ReactNode }[]
}

/** One choice from a long list: type to narrow it, grouped, Enter picks. */
export function SearchSelectField({
  labelId,
  label,
  value,
  groups,
  onChange,
  display,
  placeholder,
  searchPlaceholder,
  onClear,
  clearLabel = 'Clear',
}: {
  labelId: string
  label: string
  value?: string
  groups: OptionGroup[]
  onChange: (value: string) => void
  display?: React.ReactNode
  placeholder: string
  searchPlaceholder: string
  /** An optional value can be taken away again: the last item in the list does it. */
  onClear?: () => void
  clearLabel?: string
}) {
  const [open, setOpen] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)
  return (
    <PickerField
      labelId={labelId}
      label={label}
      value={display ?? <Ghost>{placeholder}</Ghost>}
      open={open}
      onOpenChange={setOpen}
      initialFocus={input}
      className="min-w-72"
    >
      <Command label={label} className="p-0">
        <CommandInput ref={input} placeholder={searchPlaceholder} />
        <CommandList label={label} className="max-h-72 max-sm:max-h-menu">
          <CommandEmpty>Nothing by that name.</CommandEmpty>
          {groups.map((g) => (
            <CommandGroup key={g.heading} heading={g.heading}>
              {g.options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.label}
                  data-checked={o.value === value}
                  onSelect={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                >
                  {o.icon}
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          {onClear && value && (
            <CommandGroup>
              <CommandItem
                value={clearLabel}
                onSelect={() => {
                  onClear()
                  setOpen(false)
                }}
                className="text-muted-foreground"
              >
                <XIcon aria-hidden />
                {clearLabel}
              </CommandItem>
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </PickerField>
  )
}

/** A value that is set elsewhere, shown at the fields' height so the list stays aligned. */
export function StaticField({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-2 text-sm text-muted-foreground">{children}</div>
  )
}

/* ---------- When ---------- */

const toDate = (iso: string) => {
  if (!iso) return undefined
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const toIso = (d: Date | undefined) =>
  d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : ''

/**
 * When as one picker: the presets and the calendar in the same popover. A preset with dates shows
 * the calendar beside it (a range for Between dates); Always shows none.
 */
export function WhenField({
  labelId,
  value,
  onChange,
}: {
  labelId: string
  value: WhenValue
  onChange: (value: WhenValue) => void
}) {
  const [open, setOpen] = React.useState(false)
  const mobile = useIsMobile()
  const presets = React.useRef<HTMLDivElement>(null)
  const missing = missingDates(value)
  const month = toDate(value.mode === 'until' ? value.until : value.from) ?? new Date(2026, 9, 1)
  const single = value.mode === 'until' ? value.until : value.from
  const hint =
    value.mode === 'always'
      ? 'Agents get it whatever dates a question asks about.'
      : value.mode === 'ongoing'
        ? 'Pick when it started, if you know.'
        : value.mode === 'between'
          ? 'Pick the first day, then the last.'
          : value.mode === 'until'
            ? 'Pick the last day it applies.'
            : value.mode === 'day'
              ? 'Pick the day.'
              : 'Pick the first day it applies.'
  return (
    <PickerField
      labelId={labelId}
      label="When"
      value={
        missing ? (
          <Ghost>{whenSummary(value)}</Ghost>
        ) : (
          <TagChip icon={<CalendarIcon aria-hidden />} className="max-w-full">
            {whenSummary(value)}
          </TagChip>
        )
      }
      open={open}
      onOpenChange={setOpen}
      // Focus lands on the chosen preset; arrows move between presets, Tab goes on to the calendar.
      initialFocus={() =>
        presets.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
      }
      className="w-auto max-w-viewport-inset"
    >
      <div className="flex flex-col gap-1 sm:flex-row">
        <RadioGroup
          ref={presets}
          aria-label="When it applies"
          value={value.mode}
          onValueChange={(v) => onChange({ ...value, mode: v as WhenMode })}
          className="grid shrink-0 grid-cols-2 gap-0.5 p-1 sm:flex sm:w-40 sm:flex-col sm:border-r sm:pr-2"
        >
          {WHEN_PRESETS.map((p) => (
            <label
              key={p.value}
              className="flex h-9 cursor-default items-center gap-2.5 rounded-md px-2 text-sm hover:bg-muted has-data-checked:bg-muted has-data-checked:font-medium pointer-coarse:h-11"
            >
              <RadioGroupItem value={p.value} />
              {p.label}
            </label>
          ))}
        </RadioGroup>
        <div className="flex min-w-0 flex-col p-1 sm:w-68">
          <p className="px-2 pt-1.5 pb-1 text-xs text-muted-foreground" aria-live="polite">
            {hint}
          </p>
          {value.mode !== 'always' &&
            (value.mode === 'between' ? (
              <Calendar
                mode="range"
                defaultMonth={month}
                selected={{ from: toDate(value.from), to: toDate(value.until) }}
                onSelect={(r) => onChange({ ...value, from: toIso(r?.from), until: toIso(r?.to) })}
                className={cn(
                  'p-1',
                  mobile ? '[--cell-size:--spacing(11)]' : '[--cell-size:--spacing(8)]',
                )}
              />
            ) : (
              <Calendar
                mode="single"
                defaultMonth={month}
                selected={toDate(single)}
                onSelect={(d) =>
                  onChange(
                    value.mode === 'until'
                      ? { ...value, until: toIso(d) }
                      : { ...value, from: toIso(d) },
                  )
                }
                className={cn(
                  'p-1',
                  mobile ? '[--cell-size:--spacing(11)]' : '[--cell-size:--spacing(8)]',
                )}
              />
            ))}
          <div className="mt-auto flex items-center justify-between gap-2 border-t px-1 pt-2 pb-1">
            <span className="min-w-0 truncate px-1 text-xs font-medium">{whenSummary(value)}</span>
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      </div>
    </PickerField>
  )
}

/** A line of text edited in place: no border until focus, growing with what is typed. */
export function InlineText({
  labelId,
  value,
  onChange,
  placeholder,
}: {
  labelId: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <textarea
      data-prop-value
      aria-labelledby={labelId}
      rows={1}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="-mx-1.5 field-sizing-content w-overhang max-w-xl resize-none rounded-md bg-transparent px-1.5 py-1.5 text-sm leading-5 transition-colors outline-none placeholder:text-muted-foreground hover:bg-muted/50 focus-visible:bg-transparent focus-visible:ring-3 focus-visible:ring-ring/40"
    />
  )
}

/* ---------- people ---------- */

/** A person as a chip: their face and name, "(you)" for the reader. */
export function PersonChip({
  name,
  you,
  onRemove,
}: {
  name: string
  you?: boolean
  onRemove?: () => void
}) {
  return (
    <TagChip
      icon={<PersonAvatar name={name} size={16} className="-ml-0.5" />}
      onRemove={onRemove}
      removeLabel={onRemove ? `Remove ${name}` : undefined}
    >
      {name}
      {you && <span className="font-normal text-muted-foreground"> (you)</span>}
    </TagChip>
  )
}

/** Several people from one picker: avatar chips at rest, you first in the list, type to filter. */
export function PeopleField({
  labelId,
  label,
  values,
  people,
  me,
  onChange,
  disabled,
  lockedReason,
  note,
  footer,
}: {
  labelId: string
  label: string
  values: string[]
  people: { name: string; role: string }[]
  me: string
  onChange: (values: string[]) => void
  disabled?: boolean
  lockedReason?: string
  /** One line under the list: what being chosen here means. */
  note?: string
  /** An action under the list, such as inviting someone who isn't here yet. */
  footer?: (close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)
  const ordered = [...people].sort((a, b) => (a.name === me ? -1 : b.name === me ? 1 : 0))
  return (
    <PickerField
      labelId={labelId}
      label={label}
      open={open}
      onOpenChange={setOpen}
      disabled={disabled}
      lockedReason={lockedReason}
      initialFocus={input}
      value={
        values.length ? (
          values.map((n) => <PersonChip key={n} name={n} you={n === me} />)
        ) : (
          <Ghost>Add an owner</Ghost>
        )
      }
    >
      <Command label={label} className="p-0">
        <CommandInput ref={input} placeholder="Search people" />
        <CommandList label={label} className="max-h-72 max-sm:max-h-menu">
          <CommandEmpty>Nobody by that name.</CommandEmpty>
          {ordered.map((p) => (
            <CommandItem
              key={p.name}
              value={p.name}
              data-checked={values.includes(p.name)}
              onSelect={() =>
                onChange(
                  values.includes(p.name)
                    ? values.filter((x) => x !== p.name)
                    : [...values, p.name],
                )
              }
            >
              <PersonAvatar name={p.name} size={20} />
              <span className="flex min-w-0 flex-col">
                <span>
                  {p.name}
                  {p.name === me && <span className="text-muted-foreground"> (you)</span>}
                </span>
                <span className="truncate text-xs text-muted-foreground">{p.role}</span>
              </span>
            </CommandItem>
          ))}
        </CommandList>
        {note && <p className="border-t px-2 pt-2 pb-1 text-xs text-muted-foreground">{note}</p>}
        {footer && <div className="border-t pt-1">{footer(() => setOpen(false))}</div>}
      </Command>
    </PickerField>
  )
}
