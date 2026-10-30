import * as React from 'react'
import { ChevronRightIcon, PanelRightOpenIcon, XIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// Every right-hand panel has one anatomy: a title bar (the bar's height, its title, its own actions
// and a way to close it), one scrolling body, and a footer for the actions that must stay in reach.
// The body is the panel's only scroller; the bar and the footer never scroll away.

export function Panel({
  title,
  quietTitle,
  leading,
  actions,
  onClose,
  closeLabel = 'Close the panel',
  footer,
  label,
  children,
  className,
}: {
  title: React.ReactNode
  /** A peek names what it is quietly in the bar; its own title is in the body, once. */
  quietTitle?: boolean
  /** Before the title: a phone's back arrow. */
  leading?: React.ReactNode
  actions?: React.ReactNode
  onClose?: () => void
  closeLabel?: string
  /** Stays under the body: the decision, the primary actions. */
  footer?: React.ReactNode
  /** The region's name, when the title isn't plain text. */
  label?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      aria-label={label ?? (typeof title === 'string' ? title : 'Side panel')}
      className={cn('@container flex h-full min-h-0 flex-col bg-background', className)}
    >
      <div className="flex h-bar shrink-0 items-center gap-1 border-b px-2 md:px-4">
        {leading}
        <h2
          className={cn(
            'min-w-0 flex-1 truncate px-1 text-sm font-medium',
            quietTitle && 'text-dense font-normal text-muted-foreground',
          )}
        >
          {title}
        </h2>
        {actions}
        {onClose && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon" aria-label={closeLabel} onClick={onClose} />
              }
            >
              <XIcon />
            </TooltipTrigger>
            <TooltipContent>{closeLabel}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      {footer && <div className="shrink-0 border-t bg-background">{footer}</div>}
    </section>
  )
}

/**
 * A group inside a panel body that folds to its heading, so a long block (a preview) can step
 * aside and the next one (the decisions) comes into view. One row: chevron, title, a muted count.
 */
export function PanelGroup({
  title,
  count,
  description,
  defaultOpen = true,
  children,
  className,
}: {
  title: string
  count?: number
  description?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
  className?: string
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  const id = React.useId()
  return (
    <section className={cn('border-b last:border-b-0', className)}>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="group/pg flex min-h-11 w-full items-center gap-1.5 px-4 text-left text-sm font-medium outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <ChevronRightIcon
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground transition-transform group-aria-expanded/pg:rotate-90"
          />
          {title}
          {count !== undefined && (
            <span className="font-normal text-muted-foreground tabular-nums">{count}</span>
          )}
        </button>
      </h3>
      <div id={id} hidden={!open} className="px-4 pb-4">
        {description && <p className="mb-3 text-sm text-muted-foreground">{description}</p>}
        {children}
      </div>
    </section>
  )
}

/** A folded panel's rail: one button that opens it again, where the panel's close was. */
export function PanelRail({ label, onShow }: { label: string; onShow: () => void }) {
  return (
    <div className="flex h-full flex-col items-center pt-1.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={label}
              className="size-9"
              onClick={onShow}
            />
          }
        >
          <PanelRightOpenIcon />
        </TooltipTrigger>
        <TooltipContent side="left">{label}</TooltipContent>
      </Tooltip>
    </div>
  )
}
