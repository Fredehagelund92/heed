import * as React from 'react'
import {
  type CustomComponents,
  type DayButton,
  DayPicker,
  getDefaultClassNames,
} from 'react-day-picker'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from '@/components/icons'

/**
 * Calendar on react-day-picker (contract 7.1), used only inside `DateField` and
 * `ValidityRange`. Dates are UTC days (NFR-048): pass `timeZone="UTC"` (the default here) and
 * dates made with `isoToDate`. A day is 32 pixels (44 on a coarse pointer). The arrow keys move
 * by day and week, Page Up and Page Down by month, Home and End to the week's ends.
 */
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  timeZone = 'UTC',
  components,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  const defaults = getDefaultClassNames()
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      timeZone={timeZone}
      weekStartsOn={1}
      className={cn('group/calendar w-fit text-dense', className)}
      classNames={{
        root: cn('w-fit', defaults.root),
        months: cn('relative flex flex-col gap-4', defaults.months),
        month: cn('flex w-full flex-col gap-2', defaults.month),
        nav: cn('absolute inset-x-0 top-0 flex w-full items-center justify-between', defaults.nav),
        button_previous: cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          'select-none aria-disabled:opacity-50',
          defaults.button_previous,
        ),
        button_next: cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          'select-none aria-disabled:opacity-50',
          defaults.button_next,
        ),
        month_caption: cn(
          'flex h-control-md w-full items-center justify-center px-8 max-md:h-control-touch pointer-coarse:h-control-touch',
          defaults.month_caption,
        ),
        caption_label: cn('font-bold select-none', defaults.caption_label),
        month_grid: cn('w-full border-collapse', defaults.month_grid),
        weekdays: cn('flex', defaults.weekdays),
        weekday: cn(
          'flex-1 py-1 text-caption font-normal text-muted-foreground select-none',
          defaults.weekday,
        ),
        week: cn('flex w-full', defaults.week),
        day: cn(
          'group/day relative size-control-md p-0 text-center select-none max-md:size-control-touch pointer-coarse:size-control-touch',
          defaults.day,
        ),
        range_start: cn('rounded-l-md bg-muted', defaults.range_start),
        range_middle: cn('rounded-none bg-muted', defaults.range_middle),
        range_end: cn('rounded-r-md bg-muted', defaults.range_end),
        today: cn('font-bold', defaults.today),
        outside: cn('text-muted-foreground', defaults.outside),
        disabled: cn('text-muted-foreground opacity-50', defaults.disabled),
        hidden: cn('invisible', defaults.hidden),
        ...classNames,
      }}
      components={{
        Root: CalendarRoot,
        Chevron: CalendarChevron,
        DayButton: CalendarDayButton,
        ...components,
      }}
      {...props}
    />
  )
}

// Module-level, not inline: a component made during render is a new type each time, so React
// would remount the whole calendar on every render and lose a click that is under way.
function CalendarRoot({
  className,
  rootRef,
  ...props
}: React.ComponentProps<NonNullable<CustomComponents['Root']>>) {
  return <div data-slot="calendar" ref={rootRef} className={className} {...props} />
}

function CalendarChevron({
  className,
  orientation,
  ...props
}: React.ComponentProps<NonNullable<CustomComponents['Chevron']>>) {
  const Glyph =
    orientation === 'left'
      ? ChevronLeftIcon
      : orientation === 'right'
        ? ChevronRightIcon
        : ChevronDownIcon
  return <Glyph className={cn('size-4', className)} {...props} />
}

function CalendarDayButton({
  className,
  day: _day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])
  const single =
    modifiers.selected && !modifiers.range_start && !modifiers.range_end && !modifiers.range_middle
  return (
    <button
      ref={ref}
      type="button"
      data-slot="calendar-day"
      data-single={single || undefined}
      data-range-start={modifiers.range_start || undefined}
      data-range-end={modifiers.range_end || undefined}
      data-range-middle={modifiers.range_middle || undefined}
      className={cn(
        'inline-flex size-full items-center justify-center rounded-md text-dense tabular-nums -outline-offset-2 transition-colors duration-instant hover:bg-muted disabled:pointer-events-none data-range-end:bg-primary data-range-end:text-primary-foreground data-range-middle:rounded-none data-range-middle:hover:bg-accent data-range-start:bg-primary data-range-start:text-primary-foreground data-single:bg-primary data-single:text-primary-foreground',
        className,
      )}
      {...props}
    />
  )
}

export { Calendar, CalendarDayButton }
