import type { ComponentProps, ReactNode } from 'react'
import { XIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'

/**
 * The selection bar (contract 8.7): it floats at the bottom of the main column, 24 above the
 * bottom, on the ink surface, and never covers a row: a clearance as tall as the bar and its 24
 * follows the list, so a short list ends above it and a long one scrolls its last rows clear. It holds what can be done with the
 * selection (Copy links in the library, Give a role and Remove in People and roles) and Clear.
 * It is a labelled region and announces the count politely. Buttons on the ink surface use the
 * label colour for their focus ring, because the regular ring is 2.3:1 on the dark theme's light
 * ink (contract preview, finding 3).
 */
export function SelectionBar({
  count,
  label = 'Selected rows',
  onClear,
  children,
}: {
  count: number
  /** The region's name: what is selected. */
  label?: string
  onClear: () => void
  /** The actions on the selection, as `SelectionBarButton`s. */
  children: ReactNode
}) {
  return (
    <>
      {/*
        The bar's clearance (contract 8.7): below a short list the bar would otherwise rise over
        its last row, and below a long one the last rows scroll clear of it.
      */}
      <div
        aria-hidden="true"
        data-slot="selection-clearance"
        className="h-selection-clearance shrink-0"
      />
      <div className="pointer-events-none sticky bottom-6 z-selection flex h-0 justify-center">
        <div
          role="region"
          aria-label={label}
          data-launcher-clear
          className="pointer-events-auto flex h-selection-bar -translate-y-full animate-in items-center gap-2 rounded-lg bg-ink pr-2 pl-4 text-dense text-ink-foreground shadow-raised duration-base fade-in-0 slide-in-from-bottom-2"
        >
          <span aria-live="polite" className="font-bold whitespace-nowrap tabular-nums">
            {count.toLocaleString('en')} selected
          </span>
          <span aria-hidden="true" className="h-4 w-px bg-ink-foreground/30" />
          {children}
          <SelectionBarButton onClick={onClear}>
            <XIcon />
            Clear
            <Kbd className="bg-ink-hover text-ink-foreground">Esc</Kbd>
          </SelectionBarButton>
        </div>
      </div>
    </>
  )
}

/** A button on the selection bar's ink surface. */
export function SelectionBarButton({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        'text-ink-foreground hover:bg-ink-hover hover:text-ink-foreground focus-visible:outline-ink-foreground',
        className,
      )}
      {...props}
    />
  )
}
