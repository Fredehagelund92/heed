import { type ReactNode, useId, useState } from 'react'
import { Radio as RadioPrimitive } from '@base-ui/react/radio'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'
import { DateField } from '@/components/form/date-field'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { InfoIcon } from '@/components/icons'
import { formatDay } from '@/lib/library'
import {
  endFromLastDay,
  lastDayFromEnd,
  type StoredValidity,
  validityProblems,
} from '@/lib/validity-range'
import { cn } from '@/lib/utils'

/**
 * When an item applies (contract 7.2, NFR-048): the first day, and the last day or none. The
 * screen always shows the last day it applies; the value it reports keeps the stored, exclusive
 * end (`lib/validity-range.ts`), so a feature never converts by hand.
 *
 * - `standing` (an event, note, guide or example): From and Until. An empty Until means no end
 *   date, which is allowed; the review date is set by an owner, not asked here.
 * - `issue`: Started, then a choice between "Still going on" and "It ended". It ended asks for
 *   the last day; the issue then stays as history.
 *
 * Put it under a `FieldSet` and `FieldLegend` ("When it applies"). Errors from the form (a
 * missing day, a finding from the service) come in through `errors`; a day that cannot be read
 * and a last day before the first are caught here as the person types.
 */
export function ValidityRange({
  value,
  onValueChange,
  kind = 'standing',
  ended: endedProp,
  onEndedChange,
  errors,
  reviewAfterDays = 14,
  disabled = false,
  className,
  idPrefix,
}: {
  value: StoredValidity
  onValueChange: (value: StoredValidity) => void
  kind?: 'standing' | 'issue'
  /** For an issue: whether the person said it ended. Uncontrolled when left out. */
  ended?: boolean
  onEndedChange?: (ended: boolean) => void
  errors?: { start?: string; end?: string }
  /** For an open issue: how soon it is asked about again (the service's setting). */
  reviewAfterDays?: number
  disabled?: boolean
  className?: string
  idPrefix?: string
}) {
  const [endedState, setEndedState] = useState(value.end !== null)
  const ended = endedProp ?? endedState
  const [textErrors, setTextErrors] = useState<{ start?: string; end?: string }>({})
  const setEnded = (next: boolean) => {
    setEndedState(next)
    onEndedChange?.(next)
    if (!next) setTextErrors((now) => ({ ...now, end: undefined }))
    if (!next && value.end !== null) onValueChange({ ...value, end: null })
  }
  const untilId = useId()

  const lastDay = lastDayFromEnd(value.end)
  const order = validityProblems({ start: value.start, lastDay }).find(
    (problem) => problem.field === 'end' && lastDay !== null,
  )
  const startError = textErrors.start ?? errors?.start
  const endError = textErrors.end ?? order?.message ?? errors?.end

  const setStart = (start: string | null) => onValueChange({ ...value, start })
  const setLastDay = (day: string | null) => onValueChange({ ...value, end: endFromLastDay(day) })

  const startField = (
    <Field invalid={Boolean(startError)} disabled={disabled}>
      <FieldLabel>{kind === 'issue' ? 'Started' : 'From'}</FieldLabel>
      <DateField
        id={idPrefix ? `${idPrefix}.start` : undefined}
        value={value.start}
        onValueChange={setStart}
        onTextError={(message) => setTextErrors((now) => ({ ...now, start: message ?? undefined }))}
        calendarLabel={kind === 'issue' ? 'Choose the day it started' : 'Choose the first day'}
        disabled={disabled}
      />
      <FieldError>{startError}</FieldError>
    </Field>
  )

  const lastDayField = (label: string, options: { clear?: boolean } = {}) => (
    <Field invalid={Boolean(endError)} disabled={disabled}>
      <FieldLabel>{label}</FieldLabel>
      <DateField
        id={idPrefix ? `${idPrefix}.end` : undefined}
        value={lastDay}
        onValueChange={setLastDay}
        onTextError={(message) => setTextErrors((now) => ({ ...now, end: message ?? undefined }))}
        min={value.start ?? undefined}
        placeholder={options.clear ? 'No end date' : 'For example 6 Oct 2026'}
        calendarLabel="Choose the last day"
        clearLabel={options.clear ? 'Remove the end date' : undefined}
        disabled={disabled}
      />
      <FieldError>{endError}</FieldError>
    </Field>
  )

  if (kind === 'standing') {
    return (
      <div
        data-slot="validity-range"
        className={cn('@container/validity grid w-full gap-4', className)}
      >
        <div className="grid gap-4 @lg/validity:grid-cols-2">
          {startField}
          {lastDayField('Until', { clear: true })}
        </div>
      </div>
    )
  }

  return (
    <div
      data-slot="validity-range"
      className={cn('@container/validity flex w-full flex-col gap-4', className)}
    >
      <div className="grid items-start gap-4 @lg/validity:grid-cols-2">
        {startField}
        <div className="flex min-w-0 flex-col gap-2">
          <span id={untilId} className="text-body font-bold text-foreground">
            Until
          </span>
          <RadioGroupPrimitive
            aria-labelledby={untilId}
            value={ended ? 'ended' : 'ongoing'}
            onValueChange={(next) => setEnded(next === 'ended')}
            disabled={disabled}
            className="grid h-control-lg grid-cols-2 gap-1 rounded-md bg-muted p-1 pointer-coarse:h-control-touch"
          >
            <Segment value="ongoing">Still going on</Segment>
            <Segment value="ended">It ended</Segment>
          </RadioGroupPrimitive>
        </div>
      </div>
      {ended && (
        <div className="grid gap-4 @lg/validity:grid-cols-2">{lastDayField('Last day')}</div>
      )}
      <Note>
        {ended
          ? lastDay && value.start
            ? `An ended issue leaves the library's main list. AI apps still get it for questions about ${formatDay(value.start, 'long')} to ${formatDay(lastDay, 'long')}.`
            : "An ended issue leaves the library's main list. AI apps still get it for questions about its own period."
          : `Without an end date we ask again in ${reviewAfterDays} days: "Is this still going on?" You can set the end date at any time.`}
      </Note>
    </div>
  )
}

function Segment({ value, children }: { value: string; children: ReactNode }) {
  return (
    <RadioPrimitive.Root
      value={value}
      nativeButton
      render={<button type="button" />}
      className="inline-flex min-w-0 items-center justify-center rounded-sm px-3 text-body text-muted-foreground transition-colors duration-instant hover:text-foreground data-checked:bg-background data-checked:font-bold data-checked:text-foreground data-checked:shadow-raised data-disabled:cursor-not-allowed data-disabled:opacity-50"
    >
      {children}
    </RadioPrimitive.Root>
  )
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex max-w-prose items-start gap-2 text-caption text-muted-foreground [&>svg]:size-icon-sm [&>svg]:shrink-0 [&>svg]:translate-y-px">
      <InfoIcon aria-hidden />
      <span>{children}</span>
    </p>
  )
}
