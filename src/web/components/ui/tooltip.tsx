import { lazy, Suspense } from 'react'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import type { TooltipPopupProps } from './tooltip-popup'

// The popup is a chunk of its own, fetched when the first tooltip renders, which is right after
// the first load: the shell's buttons carry tooltips. A tooltip is closed until a pointer rests
// on its trigger, so the popup has arrived by the time one opens; one that opens sooner shows as
// soon as it arrives.
const TooltipPopup = lazy(() =>
  import('./tooltip-popup').then((module) => ({ default: module.TooltipPopup })),
)

/** How long a pointer rests on a trigger before its tooltip opens (contract 7.1 and the delays rule). */
const TOOLTIP_DELAY = 350

function TooltipProvider({ delay = 0, ...props }: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} {...props} />
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent(props: TooltipPopupProps) {
  return (
    <Suspense fallback={null}>
      <TooltipPopup {...props} />
    </Suspense>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, TOOLTIP_DELAY }
