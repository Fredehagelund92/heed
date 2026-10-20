import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { useDockedPanel, usePanelCovered, usePanelOpened } from '@/components/app-shell/dock-hooks'
import { ArrowLeftIcon } from '@/components/icons'
import { Button, QuietButtons } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent } from '@/components/ui/sheet'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import {
  RecordBar,
  RecordBody,
  RecordHeading,
  recordKeyDown,
  RecordTabs,
  type RecordTab,
} from './record-parts'
import './dock-panel.css'

/*
  The docked panel (design round 3, direction A): one record opened from a grid, beside the grid
  so the list stays in view. It is a region, not a dialog: the page around it keeps working, and
  the list's keys (j and k, Escape) keep acting on the list. From 1,224 wide it docks on the
  right and the shell keeps its width free (the sidebar folds to its rail); below that it lies
  over the grid's right side; on a phone it fills the screen, with a back arrow for close.

  The surface that opens it owns what is in it and where it is in the address (`?panel=`), so a
  panel is linkable and Back closes it. The panel gives the frame: a bar with what the record is
  and where it is in the list (never a raw id), previous and next, expand to its page and close;
  the record's title first, then its badges and note line (the professional pass); its tabs,
  whose contents the surface passes as `TabsContent`; and a footer for actions, quiet: ghost
  buttons beside the one primary.
*/

/** Where the panel sits: docked beside the grid, over the grid, or the whole screen. */
export type DockMode = 'docked' | 'overlay' | 'full'

/**
 * The panel docks from 1,224 wide: beside the rail (48) a 480 panel leaves the library 696, the
 * smallest table that still has its checkboxes (a 440 title and the status). Below that it lies
 * over the grid, which keeps its full width.
 */
const DOCK_QUERY = '(min-width: 76.5rem)'

export function useDockMode(): DockMode {
  const wide = useMediaQuery(DOCK_QUERY)
  const phone = useIsMobile()
  return phone ? 'full' : wide ? 'docked' : 'overlay'
}

/** The row open in the panel, on a grid: the cursor's tint and an ink line on its left edge. */
export const openRowClass =
  'data-open:bg-accent data-open:before:absolute data-open:before:inset-y-0 data-open:before:left-0 data-open:before:border-l-2 data-open:before:border-foreground'

export type DockTab<T extends string> = RecordTab<T>

export function DockPanel<T extends string>({
  title,
  meta,
  badges,
  note,
  tabs,
  tab,
  onTabChange,
  tabsLabel,
  onPrevious,
  onNext,
  browse = true,
  expand,
  controls,
  onClose,
  footer,
  contentKey,
  focusOnOpen = false,
  leaving = false,
  children,
}: {
  /** The record's title, the panel's heading and name. Null while the record loads. */
  title: string | null
  /** What the record is and where: its kind or a human key and its place ("Guide · 2 of 1,404"). */
  meta?: ReactNode
  /** The record's badges, under the title. */
  badges?: ReactNode
  /** The one line that asks for a look, under the title. */
  note?: ReactNode
  /** The record's tabs; without them the children are the panel's body (a load error). */
  tabs?: readonly DockTab<T>[]
  tab?: T
  onTabChange?: (tab: T) => void
  tabsLabel?: string
  /** Previous and next in the list; absent at its ends. */
  onPrevious?: () => void
  onNext?: () => void
  /** Whether the bar has previous and next. A panel that is not opened from a list has neither. */
  browse?: boolean
  /** A link to the record's own page, rendered as the expand button. */
  expand?: ReactElement
  /** The surface's own controls in the bar, before expand (the assistant's New chat). */
  controls?: ReactNode
  onClose: () => void
  /** The actions on the record. */
  footer?: ReactNode
  /** Changes with the record, so the panel scrolls back to its top for the next one. */
  contentKey?: string
  /** Takes focus when it opens, as a panel opened from a button far from it does (the assistant). */
  focusOnOpen?: boolean
  /**
   * Closed, and on screen only for its 100 ms exit (useExit): inert, so the keys and the focus
   * already belong to the page, and no longer keeping its width free.
   */
  leaving?: boolean
  /** The tabs' contents, as `TabsContent` panels. */
  children?: ReactNode
}) {
  const mode = useDockMode()
  useDockedPanel(mode === 'docked' && !leaving)
  usePanelOpened(contentKey)
  const covered = usePanelCovered()
  // A record the assistant covered is revealed as the assistant leaves over it: it is already
  // there, so it does not open again.
  const [revealed, setRevealed] = useState(false)
  if (covered && !revealed) setRevealed(true)
  const titleId = useId()
  const touch = mode === 'full'
  const region = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)

  // Shown again after the assistant covered it, the panel takes focus back where it was, unless
  // the person has already put it somewhere else.
  const lastFocus = useRef<HTMLElement | null>(null)
  const wasCovered = useRef(false)
  useEffect(() => {
    if (covered) {
      wasCovered.current = true
      return
    }
    if (!wasCovered.current) return
    wasCovered.current = false
    const active = document.activeElement
    if (active && active !== document.body) return
    const target = lastFocus.current?.isConnected ? lastFocus.current : region.current
    target?.focus({ preventScroll: true })
  }, [covered])

  // The next record starts at its top.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0
  }, [contentKey])

  // Full screen hides the list, so focus moves into the panel (and back to the row on close).
  useEffect(() => {
    if (mode === 'full') region.current?.focus({ preventScroll: true })
  }, [mode])
  useEffect(() => {
    if (focusOnOpen && !leaving) region.current?.focus({ preventScroll: true })
    // Only when it opens, or opens again while it leaves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving])

  // Leaving, it gives up the focus before anything else runs, so what takes the focus back (the
  // record it covered, or what opened it) finds it free, as it would if the panel were gone.
  useLayoutEffect(() => {
    const active = document.activeElement
    if (leaving && active instanceof HTMLElement && region.current?.contains(active)) active.blur()
  }, [leaving])

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => recordKeyDown(event, onClose)

  const Frame = touch ? SheetContent : 'section'
  const panel = (
    <Frame
      {...(touch
        ? { showCloseButton: false, side: 'full' as const, finalFocus: false as const }
        : {})}
      ref={region}
      tabIndex={-1}
      aria-labelledby={title === null ? undefined : titleId}
      aria-modal={touch || undefined}
      aria-label={title === null ? 'Loading details' : undefined}
      data-slot="dock-panel"
      data-mode={mode}
      data-revealed={revealed || undefined}
      data-leaving={leaving || undefined}
      inert={leaving}
      hidden={covered}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        if (event.target instanceof HTMLElement) lastFocus.current = event.target
      }}
      className={cn(
        '@container fixed flex flex-col bg-background outline-none',
        touch ? 'z-overlay' : 'z-sidebar',
        // The panel's own motion, in and out; on a phone it replaces the sheet's.
        'dock-motion',
        mode === 'full'
          ? 'inset-0 h-dvh w-full max-w-none gap-0 rounded-none border-0 shadow-none transition-none'
          : 'right-0 bottom-0 w-dock max-w-full border-l',
        // Docked, the shell header ends at the panel; over the grid, the panel starts under the
        // header, so Search, the bell and Add context stay in reach.
        mode === 'docked' && 'top-0',
        mode === 'overlay' && 'top-header shadow-overlay',
      )}
    >
      <RecordBar
        meta={meta}
        back={
          mode === 'full' ? (
            <SheetClose
              render={
                <Button
                  variant="ghost"
                  size="icon-touch"
                  aria-label="Close"
                  className="text-muted-foreground"
                />
              }
            >
              <ArrowLeftIcon />
            </SheetClose>
          ) : null
        }
        controls={controls}
        browse={browse}
        onPrevious={onPrevious}
        onNext={onNext}
        expand={expand}
        onClose={mode === 'full' ? undefined : onClose}
        touch={touch}
      />

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <RecordHeading title={title} titleId={titleId} badges={badges} note={note} />
        {tabs && tab !== undefined ? (
          <RecordTabs tabs={tabs} tab={tab} onTabChange={onTabChange} tabsLabel={tabsLabel}>
            {children}
          </RecordTabs>
        ) : (
          <RecordBody>{children}</RecordBody>
        )}
      </div>

      {footer ? (
        <div
          data-slot="dock-footer"
          className="flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-3 max-md:pb-safe-bottom @md:px-6"
        >
          <QuietButtons value>{footer}</QuietButtons>
        </div>
      ) : null}
    </Frame>
  )
  return touch ? (
    <Sheet
      open={!covered && !leaving}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {panel}
    </Sheet>
  ) : (
    panel
  )
}
