import { useId, type ReactNode } from 'react'
import { gridRowControl } from '@/components/page/grid'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * A proposal row's select cell, as the library's (contract 8.1; the professional pass, rule 8):
 * the row's icon, which gives way to its checkbox while the row is hovered, focused from the
 * keyboard or selected. A row the person may not decide (`blocked`, from `canDecideInList`) keeps
 * the checkbox, disabled, with the reason and who can decide as its tooltip and description.
 */
export function RowSelectCell({
  title,
  icon,
  selected,
  blocked,
  onToggle,
}: {
  title: string
  icon: ReactNode
  selected: boolean
  /** Why the person cannot select this row, and who can decide it; null when they can. */
  blocked: string | null
  /** Selects or unselects the row; `range` selects from the anchor to it (Shift). */
  onToggle: (range: boolean) => void
}) {
  const reasonId = useId()
  const box = (
    <Checkbox
      checked={blocked ? false : selected}
      disabled={blocked !== null}
      onCheckedChange={() => onToggle(false)}
      onMouseDown={(event) => {
        // Shift-click selects rows, not the text between their checkboxes.
        if (event.shiftKey) event.preventDefault()
      }}
      onClick={(event) => {
        if (event.shiftKey) {
          event.preventDefault()
          // The range owns this click; do not also toggle its endpoint.
          event.preventBaseUIHandler()
          onToggle(true)
        }
      }}
      tabIndex={-1}
      aria-label={`Select ${title}`}
      aria-describedby={blocked ? reasonId : undefined}
      className={cn('relative z-raised', !blocked && gridRowControl)}
    />
  )
  return (
    <div
      role="cell"
      data-edge="start"
      data-blocked={blocked ? true : undefined}
      className="relative flex w-column-select shrink-0 items-center justify-center"
    >
      <span className="absolute flex row-rest">{icon}</span>
      {blocked ? (
        <>
          {/* The tip closes as the pointer leaves, so it never holds the row's title under it. */}
          <Tooltip disableHoverablePopup>
            <TooltipTrigger
              render={
                <span
                  data-slot="select-blocked"
                  className={cn('relative z-raised inline-flex', gridRowControl)}
                />
              }
            >
              {box}
            </TooltipTrigger>
            <TooltipContent side="right">{blocked}</TooltipContent>
          </Tooltip>
          <span id={reasonId} className="sr-only">
            {blocked}
          </span>
        </>
      ) : (
        box
      )}
    </div>
  )
}
