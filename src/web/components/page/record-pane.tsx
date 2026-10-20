import { useEffect, useId, useRef, type ReactNode } from 'react'
import { useFoldedSidebar } from '@/components/app-shell/dock-hooks'
import { ArrowLeftIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/use-mobile'
import { workbenchBarClass } from './workbench'
import {
  RecordBar,
  RecordBody,
  RecordHeading,
  recordKeyDown,
  RecordTabs,
  type RecordTab,
} from './record-parts'

/*
  The record pane (Workbench plan, 3.1 and slice W4): one record shown in the page's own flow,
  beside the list it was opened from, with its actions beside it. It draws the docked panel's
  bar, heading and tabs (record-parts.tsx), so the two frames read the same; unlike the docked
  panel it is part of the page, not laid over it, and the shell keeps no room free for it.

  While it is open the shell folds the sidebar to its rail. The record and the action panel each
  scroll on their own; on a page under 1,100 wide the actions fold under the record, behind a
  hairline, and the two scroll together. On a phone the page shows the record instead of the
  list, with a back arrow in place of close, and the actions follow it.

  It must sit in a container (the page template is one) and not in another container between
  it and the page, because the fold follows the page's width.
*/

export function RecordPane<T extends string>({
  title,
  label,
  meta,
  badges,
  note,
  tabs,
  tab,
  onTabChange,
  tabsLabel,
  controls,
  onPrevious,
  onNext,
  browse = true,
  onClose,
  actions,
  contentKey,
  children,
}: {
  /** The record's title, the pane's heading and name. Null while the record loads. */
  title: string | null
  /** The pane's name while the title loads. */
  label?: string
  /** What the record is and where it is in the list ("Test question · 1 of 9"). */
  meta?: ReactNode
  badges?: ReactNode
  note?: ReactNode
  /** The record's tabs; without them the children are its body. */
  tabs?: readonly RecordTab<T>[]
  tab?: T
  onTabChange?: (tab: T) => void
  tabsLabel?: string
  /** The record's own controls in the bar, before previous and next. */
  controls?: ReactNode
  onPrevious?: () => void
  onNext?: () => void
  /** Whether the bar has previous and next. */
  browse?: boolean
  onClose: () => void
  /** The action panel's sections; without them the record takes the width. */
  actions?: ReactNode
  /** Changes with the record, so the next one starts at its top. */
  contentKey?: string
  /** The tabs' contents, as `TabsContent` panels. */
  children?: ReactNode
}) {
  const phone = useIsMobile()
  useFoldedSidebar(!phone)
  const titleId = useId()
  const region = useRef<HTMLElement>(null)
  const workspace = useRef<HTMLDivElement>(null)

  // The next record starts at its top, in whichever part scrolls at this width.
  useEffect(() => {
    if (workspace.current) workspace.current.scrollTop = 0
    if (region.current) region.current.scrollTop = 0
    if (phone) window.scrollTo({ top: 0 })
  }, [contentKey, phone])

  // On a phone the record takes the list's place, so focus moves into it.
  useEffect(() => {
    if (phone) region.current?.focus({ preventScroll: true })
  }, [phone, contentKey])

  return (
    <div
      ref={workspace}
      data-slot="record-workspace"
      className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-y-auto md:overscroll-contain @workbench-fold:flex-row @workbench-fold:overflow-hidden"
    >
      <section
        ref={region}
        tabIndex={-1}
        aria-labelledby={title === null ? undefined : titleId}
        aria-label={title === null ? (label ?? 'Loading the record') : undefined}
        data-slot="record-pane"
        onKeyDown={(event) => recordKeyDown(event, onClose)}
        className="@container flex min-w-0 shrink-0 flex-col bg-background outline-none @workbench-fold:min-h-0 @workbench-fold:flex-1 @workbench-fold:overflow-y-auto @workbench-fold:overscroll-contain"
      >
        <RecordBar
          meta={meta}
          back={
            phone ? (
              <Button
                variant="ghost"
                size="icon-touch"
                aria-label="Close"
                onClick={onClose}
                className="text-muted-foreground"
              >
                <ArrowLeftIcon />
              </Button>
            ) : null
          }
          controls={controls}
          browse={browse}
          onPrevious={onPrevious}
          onNext={onNext}
          onClose={phone ? undefined : onClose}
          touch={phone}
          className={workbenchBarClass}
        />
        <RecordHeading title={title} titleId={titleId} badges={badges} note={note} />
        {tabs && tab !== undefined ? (
          <RecordTabs
            tabs={tabs}
            tab={tab}
            onTabChange={onTabChange}
            tabsLabel={tabsLabel}
            stickyClassName="top-header"
          >
            {children}
          </RecordTabs>
        ) : (
          <RecordBody>{children}</RecordBody>
        )}
      </section>
      {actions ? (
        <aside
          aria-label="Actions"
          data-slot="record-actions"
          className="flex shrink-0 flex-col gap-6 border-t px-4 pt-6 pb-8 @md:px-6 @workbench-fold:w-workbench-actions @workbench-fold:overflow-y-auto @workbench-fold:overscroll-contain @workbench-fold:border-t-0 @workbench-fold:border-l @workbench-fold:px-4"
        >
          {actions}
        </aside>
      ) : null}
    </div>
  )
}
