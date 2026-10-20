import { lazy, Suspense, type ReactNode } from 'react'
import { CircleHelpIcon } from '@/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import type { HelpTarget } from '@/lib/help'
import { cn } from '@/lib/utils'

/*
  Help in context (docs/help/README.md, "Help in context"): a quiet link where a person stalls,
  in the words of the question they have ("What is an MCP?"). It opens a card beside it (a
  sheet on a phone) with the few lines of the help page that answer it and a way to the whole
  page, so the person stays on the screen they were using. The card and the pages are chunks of
  their own, fetched when the link is pointed at or focused: a screen only carries the link.
*/

/** The quiet link of the help on a form and a screen ("Why we ask", "What is an MCP?"). */
export const helpTriggerClass =
  'inline-flex cursor-pointer items-center gap-1 rounded-sm text-foreground underline underline-offset-2 hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

const loadCard = () => import('./help-card')
const HelpCard = lazy(() => loadCard().then((module) => ({ default: module.HelpCard })))

const preload = () => void loadCard()

function HelpLoading() {
  return (
    <div role="status" aria-label="Loading the help" className="flex flex-col gap-2">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  )
}

export function HelpLink({
  to,
  children,
  className,
}: {
  /** The page, or the heading on it, that answers the question (`lib/help.ts`). */
  to: HelpTarget
  /** The question, in the person's words. */
  children: ReactNode
  className?: string
}) {
  return (
    <Popover>
      <PopoverTrigger
        data-slot="help-link"
        data-help={to}
        className={cn(helpTriggerClass, className)}
        onPointerEnter={preload}
        onFocus={preload}
      >
        <CircleHelpIcon aria-hidden="true" className="size-3 shrink-0" />
        {children}
      </PopoverTrigger>
      <PopoverContent align="start" sheetTitle="Help" data-slot="help-card">
        <Suspense fallback={<HelpLoading />}>
          <HelpCard target={to} />
        </Suspense>
      </PopoverContent>
    </Popover>
  )
}
