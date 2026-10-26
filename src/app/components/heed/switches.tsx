import * as React from 'react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// The three ways the mockup lets someone pick between things, one component each, so a later
// change is one edit (segmented/segmented-controls.md has the inventory and the reason per place):
//   ViewToggle   another view of the same thing, usually an advanced one: one quiet icon button
//   TextSwitch   a filter or a two-way option: words (with counts), the chosen one underlined
//   ChoiceGroup  a decision with a few answers, all visible: outline buttons, one checked
// No pill tabs, no segmented tracks.

/** Another view of the same thing: one icon button, pressed while that view is on. */
export function ViewToggle({
  pressed,
  onPressedChange,
  icon,
  text,
  on,
  off,
}: {
  pressed: boolean
  onPressedChange: (p: boolean) => void
  icon: React.ReactNode
  /** A short visible word beside the icon ("Source"), for a toggle that isn't obvious from its icon. */
  text?: string
  on: string
  off: string
}) {
  const label = pressed ? off : on
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="outline"
            size={text ? 'sm' : 'icon-sm'}
            aria-label={on}
            aria-pressed={pressed}
            onClick={() => onPressedChange(!pressed)}
            className="aria-pressed:border-foreground/40 aria-pressed:bg-muted aria-pressed:text-foreground"
          />
        }
      >
        {icon}
        {text}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export type TextOption<T extends string> = {
  value: T
  label: React.ReactNode
  count?: number
  icon?: React.ReactNode
}

/** Move the choice with the arrow keys, as a radio group does. */
function useArrows<T extends string>(values: T[], value: T, onChange: (v: T) => void) {
  return (e: React.KeyboardEvent<HTMLElement>) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0
    if (!step) return
    e.preventDefault()
    const next = values[(values.indexOf(value) + step + values.length) % values.length]
    const group = e.currentTarget
    onChange(next)
    requestAnimationFrame(() => group.querySelector<HTMLElement>(`[data-value="${next}"]`)?.focus())
  }
}

/**
 * Words to choose from, Linear style: quiet text with an optional count, the chosen one in ink with
 * a 2px underline that slides to it. For a list filter ("Needs me 15  All 23") and for a two-way
 * option said as a sentence ("Answer as Draft - Published").
 */
export function TextSwitch<T extends string>({
  label,
  options,
  value,
  onChange,
  lead,
  separator,
  className,
}: {
  /** The group's name for screen readers. */
  label: string
  options: TextOption<T>[]
  value: T
  onChange: (v: T) => void
  /** Words before the choices, shown: "Answer as". */
  lead?: string
  /** A quiet mark between the words, for the sentence form. */
  separator?: string
  className?: string
}) {
  const wrap = React.useRef<HTMLDivElement>(null)
  // The underline slides only when the choice changes; a label growing (a count) just moves it.
  const [bar, setBar] = React.useState<{
    left: number
    width: number
    of: T
    slide: boolean
  } | null>(null)
  React.useLayoutEffect(() => {
    const el = wrap.current?.querySelector<HTMLElement>(`[data-value="${value}"]`)
    if (el)
      setBar((b) => ({
        left: el.offsetLeft,
        width: el.offsetWidth,
        of: value,
        slide: !!b && b.of !== value,
      }))
  }, [value, options])
  const onKeyDown = useArrows(
    options.map((o) => o.value),
    value,
    onChange,
  )
  return (
    <div className={cn('flex items-center gap-2 text-sm', className)}>
      {lead && <span className="text-muted-foreground">{lead}</span>}
      <div
        ref={wrap}
        role="radiogroup"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="relative flex items-center gap-3"
      >
        {options.map((o, i) => {
          const on = o.value === value
          return (
            <React.Fragment key={o.value}>
              {separator && i > 0 && (
                <span aria-hidden className="-mx-1.5 text-muted-foreground/70">
                  {separator}
                </span>
              )}
              <button
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                data-value={o.value}
                onClick={() => onChange(o.value)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-sm whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-3.5',
                  on
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {o.icon}
                {o.label}
                {o.count !== undefined && (
                  <span className="text-xs text-muted-foreground tabular-nums">{o.count}</span>
                )}
              </button>
            </React.Fragment>
          )
        })}
        {bar && (
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute -bottom-px h-0.5 rounded-full bg-foreground',
              bar.slide && 'transition-[left,width] duration-(--dur-3) ease-out',
            )}
            style={{ left: bar.left, width: bar.width }}
          />
        )}
      </div>
    </div>
  )
}

/** A decision with a few answers, all visible at once: outline buttons, one checked. */
export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T | undefined
  onChange: (v: T) => void
  className?: string
}) {
  const onKeyDown = useArrows(
    options.map((o) => o.value),
    value ?? options[0].value,
    onChange,
  )
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('flex flex-wrap gap-2', className)}
    >
      {options.map((o, i) => {
        const on = o.value === value
        return (
          <Button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (value === undefined && i === 0) ? 0 : -1}
            data-value={o.value}
            variant="outline"
            size="sm"
            onClick={() => onChange(o.value)}
            className={cn(
              'h-8 px-3',
              on && 'border-foreground/60 bg-muted text-foreground hover:bg-muted',
            )}
          >
            {o.label}
          </Button>
        )
      })}
    </div>
  )
}
