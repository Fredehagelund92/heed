import type { ReactNode } from 'react'
import { ArrowLeftIcon, Maximize2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import { closeDock } from '@/lib/dock'
import { Panel } from '@/components/heed/panel'

// The dock: Heed's right panel. A region beside the page, not a dialog. 480 wide for Ask, a context
// peek, Try it and an agent's view; 720 for a review. On a phone it fills the screen.

export function DockFrame({
  title,
  quietTitle,
  actions,
  footer,
  children,
}: {
  title: ReactNode
  /** A peek names what it is ("Context") quietly in the bar; its own title is in the body, once. */
  quietTitle?: boolean
  actions?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  const isMobile = useIsMobile()
  // The shared panel anatomy; on a phone the dock is a screen of its own, so it goes back instead of closing.
  return (
    <Panel
      title={title}
      quietTitle={quietTitle}
      leading={
        isMobile && (
          <Button variant="ghost" size="icon" aria-label="Back" onClick={closeDock}>
            <ArrowLeftIcon />
          </Button>
        )
      }
      actions={actions}
      onClose={isMobile ? undefined : closeDock}
      footer={
        // One footer language for every dock: the bar's height, actions on the right at the header's
        // button size, full width on a phone.
        footer && (
          <div className="flex h-bar items-center justify-end gap-2 px-4 md:px-5 max-sm:[&>*]:flex-1">
            {footer}
          </div>
        )
      }
    >
      {children}
    </Panel>
  )
}

/** A peek's bar: previous and next, then the expand icon that opens the page. */
export function PeekBar({ children, onExpand }: { children?: ReactNode; onExpand: () => void }) {
  return (
    <>
      {children}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon" aria-label="Open the page" onClick={onExpand} />
          }
        >
          <Maximize2Icon />
        </TooltipTrigger>
        <TooltipContent>Open the page</TooltipContent>
      </Tooltip>
    </>
  )
}

/** What the dock shows when its link points at something that isn't there. */
export function DockMissing({ children }: { children: ReactNode }) {
  return <p className="p-4 text-sm text-muted-foreground md:p-5">{children}</p>
}
