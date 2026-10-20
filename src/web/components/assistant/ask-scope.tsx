import { useId, useState, type ReactElement } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { shiftDate } from '@domain/validity'
import { scopeTermsQuery } from '@/api/queries'
import { CalendarIcon, GitCommitHorizontalIcon, XIcon } from '@/components/icons'
import { DateField } from '@/components/form/date-field'
import { ScopeInput } from '@/components/mentions/scope-input'
import {
  ScopeTermLabel,
  scopeTermKind,
  scopeTermWords,
  type ScopeTermView,
} from '@/components/mentions/scope-term'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Kbd } from '@/components/ui/kbd'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { rangeWords } from '@/lib/assistant'
import { formatDay } from '@/lib/library'
import { removeFromScope, scopeKeys } from '@/lib/mention-targets'
import { defaultWindow, emptyScope, hasTerms, type TryItScope } from '@/lib/try-it'
import { cn } from '@/lib/utils'

/*
  The scope of a question (Assistant board, A.scope, with C's shared bar): the metrics, markets
  and products a question is about and its first and last day, as chips. The composer shows them
  above the words, each with a remove button; the question shows the ones it was asked with. One
  scope is shared by Ask and What an agent would get, so the facts an agent gets are the facts
  the answer reads.
*/

/** The words a term key reads as before its name arrives: `val:market/north_land` is "North land". */
const humanize = (key: string) => {
  const id =
    key
      .slice(key.indexOf(':') + 1)
      .split('/')
      .pop() ?? key
  const words = id.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The names of a scope's keys, from the vocabulary, as the scope input shows them. */
export function useScopeTerms(keys: readonly string[]): Map<string, ScopeTermView> {
  const sorted = [...keys].sort()
  const names = useQuery({
    ...scopeTermsQuery(sorted),
    enabled: sorted.length > 0,
    placeholderData: keepPreviousData,
  })
  const terms = new Map<string, ScopeTermView>()
  for (const key of keys) terms.set(key, { kind: scopeTermKind(key), name: humanize(key) })
  for (const hit of names.data ?? [])
    terms.set(hit.key, {
      kind: hit.kind,
      name: hit.name,
      dimensionName: hit.dimension?.name ?? null,
    })
  return terms
}

/** A scope in words: "Average order value, Market United Kingdom, 1 to 30 Jun 2026". */
export function scopeWords(scope: TryItScope, terms: Map<string, ScopeTermView>): string {
  const named = scopeKeys(scope.scope).map((key) => {
    const term = terms.get(key)
    return term ? scopeTermWords(term) : humanize(key)
  })
  const days = rangeWords(scope.from, scope.to, formatDay)
  return [...named, days].filter(Boolean).join(', ')
}

const chipClass =
  'inline-flex badge-md max-w-full min-w-0 items-center gap-1 rounded-badge border border-border bg-background text-foreground'

/**
 * The scope's chips: each term, then the days. With `onChange` each has a remove button; the
 * dates' chip removes both days.
 */
export function ScopeChips({
  scope,
  onChange,
  className,
  label = 'Scope',
}: {
  scope: TryItScope
  onChange?: (scope: TryItScope) => void
  className?: string
  label?: string
}) {
  const keys = scopeKeys(scope.scope)
  const terms = useScopeTerms(keys)
  const days = rangeWords(scope.from, scope.to, formatDay)
  if (!keys.length && !days) return null
  const remove = (button: string, action: () => void) =>
    onChange ? (
      <button
        type="button"
        aria-label={`Remove ${button}`}
        onClick={action}
        className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <XIcon aria-hidden="true" className="size-icon-sm" />
      </button>
    ) : null
  return (
    <ul
      aria-label={label}
      data-slot="ask-scope-chips"
      className={cn('flex min-w-0 flex-wrap gap-2', className)}
    >
      {keys.map((key) => {
        const term = terms.get(key)!
        return (
          <li key={key} className="flex max-w-full min-w-0">
            <span data-slot="scope-chip" data-kind={term.kind} className={chipClass}>
              <ScopeTermLabel term={term} />
              {remove(scopeTermWords(term), () =>
                onChange?.({ ...scope, scope: removeFromScope(scope.scope, key) }),
              )}
            </span>
          </li>
        )
      })}
      {days ? (
        <li className="flex max-w-full min-w-0">
          <span data-slot="scope-chip" data-kind="dates" className={chipClass}>
            <CalendarIcon
              aria-hidden="true"
              className="size-icon-sm shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 truncate">{days}</span>
            {remove(`the dates ${days}`, () => onChange?.({ ...scope, from: null, to: null }))}
          </span>
        </li>
      ) : null}
    </ul>
  )
}

/** The first day of a day's month, and of the month before. */
const monthStart = (day: string) => `${day.slice(0, 8)}01`
const lastMonth = (today: string) => {
  const end = shiftDate(monthStart(today), -1)
  return { from: monthStart(end), to: end }
}

const TITLE = 'Scope for the next question'

/**
 * "Scope for the next question" (A.scope): what it is about, from the vocabulary, and the first
 * and last day, with three quick ranges. Use this scope sets it for Ask and What an agent would
 * get; Clear empties both. Enter picks the highlighted term and, once the list has closed, uses
 * the scope, which the button's key says. Opened with @ it is a mention: the first term picked
 * from the list is used at once and it closes, back to the question.
 */
export function ScopePopover({
  scope,
  onChange,
  today,
  edition,
  trigger,
  open,
  mention = false,
  onOpenChange,
}: {
  scope: TryItScope | null
  onChange: (scope: TryItScope | null) => void
  /** The service's day, for the quick ranges; null until the library has loaded. */
  today: string | null
  /** The live edition's label, which answers use. */
  edition: string | null
  /** The button that opens it. */
  trigger: ReactElement
  open: boolean
  /** Opened with @: a term picked from the list is used at once and closes it. */
  mention?: boolean
  onOpenChange: (open: boolean) => void
}) {
  const id = useId()
  const phone = useIsMobile()
  const [draft, setDraft] = useState<TryItScope>(
    scope ?? { scope: emptyScope, from: null, to: null },
  )
  const [shown, setShown] = useState(open)
  // Each time it opens it starts from the scope in use.
  if (open !== shown) {
    setShown(open)
    if (open) setDraft(scope ?? { scope: emptyScope, from: null, to: null })
  }
  const ranges = today
    ? [
        { label: 'This month', ...{ from: monthStart(today), to: today } },
        { label: 'Last month', ...lastMonth(today) },
        { label: 'Last 30 days', ...defaultWindow(today) },
      ]
    : []
  const empty = !hasTerms(draft.scope) && !draft.from
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        side="top"
        align="start"
        data-slot="ask-scope-popover"
        // What it is about is the first thing to fill in.
        initialFocus={() => document.getElementById(`${id}-scope`) ?? true}
        // On a phone the sheet's own bar carries the title and the close button.
        sheetTitle={TITLE}
        className="w-dock max-w-(--available-width) gap-4 p-4"
      >
        {phone ? null : (
          <div className="flex items-center justify-between gap-2">
            <PopoverTitle className="text-body font-bold">{TITLE}</PopoverTitle>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              onClick={() => onOpenChange(false)}
            >
              <XIcon />
            </Button>
          </div>
        )}
        <form
          noValidate
          className="@container flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            // The popup is portalled out of the composer's form, but React still bubbles the
            // submit to it, which would send the half-written question with the old scope.
            event.stopPropagation()
            onChange(empty ? null : draft)
            onOpenChange(false)
          }}
        >
          <Field>
            <FieldLabel htmlFor={`${id}-scope`}>What it is about</FieldLabel>
            <ScopeInput
              id={`${id}-scope`}
              value={draft.scope}
              onChange={(next) => setDraft((now) => ({ ...now, scope: next }))}
              onPick={
                mention
                  ? (next) => {
                      onChange({ ...draft, scope: next })
                      onOpenChange(false)
                    }
                  : undefined
              }
              placeholder="A metric, a market or a product"
            />
          </Field>
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${id}-from`}>From</FieldLabel>
                <DateField
                  id={`${id}-from`}
                  value={draft.from}
                  onValueChange={(from) => setDraft((now) => ({ ...now, from }))}
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
                  onValueChange={(to) => setDraft((now) => ({ ...now, to }))}
                  calendarLabel="Choose the last day"
                  placeholder="Last day"
                />
              </Field>
            </div>
            {ranges.length ? (
              <div role="group" aria-label="Quick dates" className="flex flex-wrap gap-2">
                {ranges.map((range) => {
                  const picked = draft.from === range.from && draft.to === range.to
                  return (
                    <Button
                      key={range.label}
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-pressed={picked}
                      onClick={() =>
                        setDraft((now) => ({ ...now, from: range.from, to: range.to }))
                      }
                      className="aria-pressed:border-status-info-border aria-pressed:bg-status-info-bg"
                    >
                      {range.label}
                    </Button>
                  )
                })}
              </div>
            ) : null}
          </div>
          {edition ? (
            <PopoverDescription className="flex items-center gap-2 text-caption text-muted-foreground">
              <GitCommitHorizontalIcon aria-hidden="true" className="size-icon-sm shrink-0" />
              <span>
                Answers use the live edition{' '}
                <span className="font-mono tabular-nums" translate="no">
                  {edition}
                </span>
                .
              </span>
            </PopoverDescription>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDraft({ scope: emptyScope, from: null, to: null })}
            >
              Clear
            </Button>
            <Button type="submit" aria-keyshortcuts="Enter">
              Use this scope
              <Kbd aria-hidden="true" className="pointer-coarse:hidden">
                ↵
              </Kbd>
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
