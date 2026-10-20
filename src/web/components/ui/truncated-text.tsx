import type { ReactElement, ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger, TOOLTIP_DELAY } from '@/components/ui/tooltip'
import { useTextCut } from '@/hooks/use-text-cut'
import { cn } from '@/lib/utils'

/*
  Truncated text (contract 7.1): text that ends in an ellipsis when its box is too narrow keeps
  the whole text one step away. While it is cut, the whole text is its tooltip, 350 ms after a
  pointer rests on it, and the text sits over its row's link (`z-raised`) so the pointer can reach
  it, as the status glyph does. While it fits it is the plain element: no tooltip to announce, to
  cost, or to take the row's click. A screen reader reads the whole text either way.
*/

/** Wraps `children`, the element that may be cut, in the tooltip while `cut`. */
export function CutTooltip({
  cut,
  text,
  children,
}: {
  cut: boolean
  text: ReactNode
  children: ReactElement
}) {
  if (!cut) return children
  return (
    <Tooltip>
      <TooltipTrigger delay={TOOLTIP_DELAY} render={children} />
      <TooltipContent side="top" align="start">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

/** One line of text that truncates, with the whole text as its tooltip while it is cut. */
export function TruncatedText({
  text,
  className,
  children,
}: {
  /** The whole text, as the tooltip says it. */
  text: string
  className?: string
  /** What the line shows, when it is more than the plain text. */
  children?: ReactNode
}) {
  const { ref, cut } = useTextCut<HTMLSpanElement>(text)
  return (
    <CutTooltip cut={cut} text={text}>
      <span
        ref={ref}
        data-slot="truncated-text"
        data-cut={cut || undefined}
        className={cn('min-w-0 truncate', cut && 'relative z-raised', className)}
      >
        {children ?? text}
      </span>
    </CutTooltip>
  )
}
