import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/*
  One action bar on every list page (the Library, the Catalogue, Proposals, the review queue,
  Gaps): the views on the left, a divider, Filter and the display controls, then the search field
  on the right, with any note just before it. Every control is 28 high, on the same line and the
  same gutter as the table under it; on a phone the search takes a row of its own.
*/

/** A view in a toolbar (All, Mine, To review): ghost, the current one filled and bold, 44 on a phone. */
export const toolbarViewClass = cn(
  buttonVariants({ variant: 'ghost', size: 'toolbar' }),
  'font-normal text-muted-foreground aria-[current=page]:bg-muted aria-[current=page]:font-bold aria-[current=page]:text-foreground @max-2xl:h-control-touch',
)

/** The line between a toolbar's views and its filters. */
export function PageToolbarDivider() {
  return <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border @max-2xl:hidden" />
}

/** The right side of a toolbar, which holds the search field and a note before it. */
export const toolbarSearchSlot =
  'flex min-w-0 flex-1 items-center justify-end gap-2 @max-2xl:order-last @max-2xl:basis-full'

/** A toolbar's search field: 28 like the controls beside it, up to 320 wide, 44 on touch. */
export const toolbarSearchField =
  'h-control-sm w-full max-w-popover min-w-0 bg-background @max-2xl:h-control-touch @max-2xl:max-w-none pointer-coarse:h-control-touch'

/**
 * The count at the end of a toolbar ("1,404 items", "57 of 1,404 items"): one 120 pixel slot,
 * right-aligned, so the search fields before it end at the same place on every list page. A
 * narrower bar keeps it for screen readers only.
 */
export const toolbarCount =
  'w-column-until shrink-0 text-right text-caption whitespace-nowrap text-muted-foreground tabular-nums @max-4xl:sr-only'
