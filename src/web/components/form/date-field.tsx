import { useId, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CalendarIcon, XIcon } from '@/components/icons'
import { formatDay } from '@/lib/library'
import { dateToIso, isoToDate, parseDay } from '@/lib/validity-range'
import { cn } from '@/lib/utils'

/** The message for text that is not a day. */
export const DAY_FORMAT_MESSAGE = 'Enter a day like 4 Aug 2026.'

/**
 * One UTC day (NFR-048): a text field that reads what is typed ("4 Aug 2026", "2026-08-04",
 * "4/8/2026") and a calendar button beside it. Typing is the fast path and works without a
 * pointer; the calendar is there to look a day up. A click in the text opens the calendar too,
 * and leaves the focus in the text so typing still works. Put it in a `Field`: the input
 * registers with it, so the field's label names it and its error describes it.
 */
export function DateField({
  value,
  onValueChange,
  onTextError,
  min,
  max,
  placeholder = 'For example 4 Aug 2026',
  calendarLabel = 'Choose a day',
  clearLabel,
  disabled = false,
  name,
  id,
  className,
}: {
  /** The UTC day, or null when empty. */
  value: string | null
  onValueChange: (value: string | null) => void
  /** Called with a message when the typed text is not a day, and with null once it is. */
  onTextError?: (message: string | null) => void
  /** The first and last days the calendar offers. */
  min?: string
  max?: string
  placeholder?: string
  /** The calendar button's name, such as "Choose the first day". */
  calendarLabel?: string
  /** Shows a button that empties the field, named with this text ("Remove the end date"). */
  clearLabel?: string
  disabled?: boolean
  name?: string
  id?: string
  className?: string
}) {
  const [text, setText] = useState(value ? formatDay(value) : '')
  const [shown, setShown] = useState(value)
  const [open, setOpen] = useState(false)
  // Opened from the text, the calendar leaves the focus there; from its button, it takes it.
  const [fromText, setFromText] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const calendarId = useId()

  // A new value from outside (the calendar, a reset, a server reply) replaces the text.
  if (value !== shown) {
    setShown(value)
    setText(value ? formatDay(value) : '')
  }

  const commit = (raw: string) => {
    if (raw.trim() === '') {
      onTextError?.(null)
      if (value !== null) onValueChange(null)
      return
    }
    const day = parseDay(raw)
    if (day === null) {
      onTextError?.(DAY_FORMAT_MESSAGE)
      if (value !== null) onValueChange(null)
      setShown(null)
      return
    }
    onTextError?.(null)
    setText(formatDay(day))
    if (day !== value) onValueChange(day)
  }

  const openFromText = () => {
    if (disabled || open) return
    setFromText(true)
    setOpen(true)
  }

  const pick = (date: Date | undefined) => {
    setOpen(false)
    onTextError?.(null)
    onValueChange(date ? dateToIso(date) : null)
  }

  const disabledDays = [
    ...(min ? [{ before: isoToDate(min) }] : []),
    ...(max ? [{ after: isoToDate(max) }] : []),
  ]

  return (
    <div
      ref={box}
      data-slot="date-field"
      className={cn(
        'relative flex h-control-lg w-full min-w-0 items-center gap-1 rounded-md border border-input bg-background px-1 transition-colors has-disabled:opacity-50 has-aria-invalid:border-destructive has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring max-md:h-control-touch dark:bg-input/30 pointer-coarse:h-control-touch',
        className,
      )}
    >
      <Popover
        phoneSheet={false}
        open={open}
        onOpenChange={(next, details) => {
          // A press in the text is not "outside": the text opens the calendar and keeps it open.
          const target = details.event?.target
          if (
            !next &&
            details.reason === 'outside-press' &&
            target instanceof Node &&
            box.current?.contains(target)
          )
            return
          if (next) setFromText(false)
          setOpen(next)
        }}
      >
        <PopoverTrigger
          aria-label={calendarLabel}
          aria-controls={open ? calendarId : undefined}
          disabled={disabled}
          className="inline-flex size-control-sm shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed max-md:size-control-touch pointer-coarse:size-control-touch [&_svg]:size-4"
        >
          <CalendarIcon />
        </PopoverTrigger>
        <PopoverContent
          ref={popup}
          id={calendarId}
          anchor={box}
          align="start"
          initialFocus={!fromText}
          className="w-auto p-2"
        >
          <Calendar
            mode="single"
            selected={value ? isoToDate(value) : undefined}
            defaultMonth={value ? isoToDate(value) : min ? isoToDate(min) : undefined}
            onSelect={pick}
            disabled={disabledDays}
            autoFocus={!fromText}
          />
        </PopoverContent>
      </Popover>
      <Input
        id={id}
        size="lg"
        name={name}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        onClick={openFromText}
        onChange={(event) => setText(event.target.value)}
        onBlur={(event) => {
          // Leaving the text for the calendar keeps it open; leaving the field closes it.
          if (!(
            event.relatedTarget instanceof Node && popup.current?.contains(event.relatedTarget)
          ))
            setOpen(false)
          commit(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            setOpen(false)
            commit(event.currentTarget.value)
          }
          // Escape closes only the calendar, not a dialog the field is in.
          if (event.key === 'Escape' && open) {
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
          }
          if (event.key === 'ArrowDown' && !open && !disabled) {
            event.preventDefault()
            setFromText(false)
            setOpen(true)
          }
        }}
        className="h-full min-w-0 flex-1 border-0 bg-transparent pl-1 tabular-nums outline-none aria-invalid:ring-0 dark:bg-transparent"
      />
      {clearLabel && value !== null && !disabled && (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={() => {
            onTextError?.(null)
            onValueChange(null)
          }}
          className="inline-flex size-control-sm shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground max-md:size-control-touch pointer-coarse:size-control-touch [&_svg]:size-4"
        >
          <XIcon />
        </button>
      )}
    </div>
  )
}
