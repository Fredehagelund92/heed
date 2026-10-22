import { useId, useState } from 'react'
import { shiftDate } from '@domain/validity'
import { CalendarIcon, XIcon } from '@/components/icons'
import { DateField } from '@/components/form/date-field'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Popover, PopoverContent, PopoverDescription, PopoverTitle } from '@/components/ui/popover'
import { rangeWords } from '@/lib/assistant'
import { formatDay } from '@/lib/library'
import { DEFAULT_DAYS } from '@/lib/try-it'

/*
  The dates of a question (Heed composer, stage 2): what a dates chip in the question opens, and
  what the Dates button and the @ list's "Pick dates" open to put one in. Quick periods counted
  from today as get_facts counts them (a "this" period runs to today, a "last" one is the last
  complete one), each used at once, or the first and last day, and the days they read,
  with today said. A new one starts at today, as a question without dates is read, and opens on
  Today, so Enter at once puts today in. It opens above the composer, on a
  phone too, so the question stays in view.
*/

export type Days = { from: string; to: string }

const pad = (n: number) => String(n).padStart(2, '0')
/** The first day of the month `months` away from a day's month. */
function monthFrom(day: string, months: number): string {
  const index = Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1 + months
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}-01`
}

/**
 * The quick periods, with the words a chip for each says in the question. They are counted as
 * get_facts counts the periods people name (`periods` in src/domain/dates.ts, which a unit test
 * holds these to): a "this" period runs to today and a "last" one is the last complete one. They
 * are worked out here so the date reader stays out of this chunk and of the first load.
 */
export function quickPeriods(today: string): { label: string; words: string; days: Days }[] {
  const month = monthFrom(today, 0)
  const quarter = monthFrom(today, -((Number(today.slice(5, 7)) - 1) % 3))
  const year = today.slice(0, 4)
  const before = (start: string) => shiftDate(start, -1)
  return [
    { label: 'Today', words: 'today', days: { from: today, to: today } },
    { label: 'This month so far', words: 'this month so far', days: { from: month, to: today } },
    {
      label: 'Last month',
      words: 'last month',
      days: { from: monthFrom(today, -1), to: before(month) },
    },
    {
      label: 'This quarter so far',
      words: 'this quarter so far',
      days: { from: quarter, to: today },
    },
    {
      label: 'Last quarter',
      words: 'last quarter',
      days: { from: monthFrom(quarter, -3), to: before(quarter) },
    },
    {
      label: `${year} so far`,
      words: `${year} so far`,
      days: { from: `${year}-01-01`, to: today },
    },
    { label: `Whole ${year}`, words: year, days: { from: `${year}-01-01`, to: `${year}-12-31` } },
    {
      label: 'Last year',
      words: 'last year',
      days: { from: `${Number(year) - 1}-01-01`, to: `${Number(year) - 1}-12-31` },
    },
    {
      label: `Last ${DEFAULT_DAYS} days`,
      words: `the last ${DEFAULT_DAYS} days`,
      days: { from: shiftDate(today, 1 - DEFAULT_DAYS), to: today },
    },
  ]
}

/** The days in words, as the "Heed reads" line says them: "1 Jan to 31 Dec 2026". */
export const daysWords = (days: Days) => rangeWords(days.from, days.to, formatDay) ?? ''

/** The words a dates chip says for days: a quick period's own, else the days themselves. */
export function wordsFor(days: Days, today: string | null): string {
  const quick = today
    ? quickPeriods(today).find(
        (period) => period.days.from === days.from && period.days.to === days.to,
      )
    : undefined
  return quick?.words ?? daysWords(days)
}

const TITLE = 'Dates of the question'

/**
 * The dates panel. `days` is the dates chip's, or null for a new one, which starts at today. A
 * quick period is used at once; Use these dates sets the days typed; Remove
 * dates, for a chip, takes it out of the question.
 */
export function AskDatesPopover({
  open,
  onOpenChange,
  anchor,
  today,
  days,
  onUse,
  onRemove,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What it opens beside: the dates chip, or the question. */
  anchor: Element | null
  /** The service's day; null until the library has loaded. */
  today: string | null
  days: Days | null
  onUse: (days: Days, words: string) => void
  /** Takes the dates chip out; none for a new one. */
  onRemove?: () => void
}) {
  const id = useId()
  const fresh = (): { from: string | null; to: string | null } => days ?? { from: today, to: today }
  const [draft, setDraft] = useState(fresh)
  const [shown, setShown] = useState(open)
  // Each time it opens it starts from the chip's days, or today.
  if (open !== shown) {
    setShown(open)
    if (open) setDraft(fresh())
  }
  const quick = today ? quickPeriods(today) : []
  const from = draft.from
  const to = draft.from && draft.to && draft.to >= draft.from ? draft.to : draft.from
  const picked = from && to ? { from, to } : null
  return (
    <Popover open={open} onOpenChange={onOpenChange} phoneSheet={false}>
      <PopoverContent
        side="top"
        align="start"
        anchor={anchor}
        data-slot="ask-dates"
        aria-labelledby={`${id}-title`}
        // The quick period in use, else the first.
        initialFocus={() => {
          const quick = document.getElementById(`${id}-quick`)
          return (
            quick?.querySelector<HTMLElement>('[aria-pressed="true"]') ??
            quick?.querySelector<HTMLElement>('button') ??
            true
          )
        }}
        className="w-dock max-w-(--available-width) gap-4 p-4"
      >
        <div className="flex items-center justify-between gap-2">
          <PopoverTitle id={`${id}-title`} className="text-body font-bold">
            {TITLE}
          </PopoverTitle>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
          >
            <XIcon />
          </Button>
        </div>
        <form
          noValidate
          className="@container flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            // The popup is portalled out of the composer's form, but React still bubbles the
            // submit to it, which would send the question.
            event.stopPropagation()
            if (picked) onUse(picked, wordsFor(picked, today))
            onOpenChange(false)
          }}
        >
          {quick.length ? (
            <div
              id={`${id}-quick`}
              role="group"
              aria-label="Quick dates"
              className="flex flex-wrap gap-2"
            >
              {quick.map((period) => {
                const pressed = from === period.days.from && to === period.days.to
                return (
                  <Button
                    key={period.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-pressed={pressed}
                    // A quick period is a choice: it is used at once.
                    onClick={() => {
                      onUse(period.days, period.words)
                      onOpenChange(false)
                    }}
                    className="aria-pressed:border-status-info-border aria-pressed:bg-status-info-bg"
                  >
                    {period.label}
                  </Button>
                )
              })}
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${id}-from`}>From</FieldLabel>
              <DateField
                id={`${id}-from`}
                value={draft.from}
                onValueChange={(next) => setDraft((now) => ({ ...now, from: next }))}
                calendarLabel="Choose the first day"
                placeholder="First day"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-to`}>To</FieldLabel>
              <DateField
                id={`${id}-to`}
                value={draft.to}
                min={draft.from ?? undefined}
                onValueChange={(next) => setDraft((now) => ({ ...now, to: next }))}
                calendarLabel="Choose the last day"
                placeholder="Last day"
              />
            </Field>
          </div>
          <PopoverDescription
            data-slot="ask-dates-reads"
            className="flex items-start gap-2 text-caption text-muted-foreground"
          >
            <CalendarIcon aria-hidden="true" className="size-icon-sm shrink-0" />
            <span>
              {picked ? (
                <>
                  Asks about <b className="font-bold text-foreground">{daysWords(picked)}</b>, both
                  days included
                  {today && picked.to > today ? ', with the days after today' : ''}.{' '}
                </>
              ) : (
                'Choose the first day. '
              )}
              {today ? `Today is ${formatDay(today, 'long')} (UTC).` : null}
            </span>
          </PopoverDescription>
          <div className="flex justify-end gap-2">
            {onRemove ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  onRemove()
                  onOpenChange(false)
                }}
              >
                Remove dates
              </Button>
            ) : null}
            <Button type="submit" disabled={!picked}>
              Use these dates
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
