import { useQuery } from '@tanstack/react-query'
import { ChevronDownIcon, ChevronUpIcon } from '@/components/icons'
import { ConflictView } from '@/components/heed/conflict-view'
import { DockFrame, PeekBar } from '@/components/dock'
import { Page } from '@/components/site-header'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { conflictQuery, conflictsQuery } from '@/api/queries'
import { openDock } from '@/lib/dock'
import { href, navigate, useRoute } from '@/lib/router'
import { CONFLICTS_LIST, conflictPath, type ConflictRow } from '@/model/conflicts'

// Where a conflict is settled (FR-220): its own page under Context and the conflict dock (720,
// expandable to the page). Both draw the one ConflictView. The conflicts are found in the Context
// list, filtered to Conflicts, where each item in one carries the Conflict chip.

/** The page: the pair, Context filtered to Conflicts before it, and J and K through the conflicts. */
export function ConflictPage({ pairKey }: { pairKey: string }) {
  const { query } = useRoute()
  const pair = useQuery(conflictQuery(pairKey))
  const topic = pair.data?.topic
  return (
    <Page
      title={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href={href(CONFLICTS_LIST)}>Context</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage className="truncate">
                Conflict{topic ? `: ${topic}` : ''}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    >
      <div className="mx-auto flex min-h-full w-full max-w-wide flex-col px-4 py-6 md:px-8 md:py-8">
        <ConflictView
          key={pairKey}
          pairKey={pairKey}
          place="page"
          openAs={query.get('settle') === 'not_conflict' ? 'not_conflict' : undefined}
          onStep={(p) => navigate(conflictPath(p.key))}
        />
      </div>
    </Page>
  )
}

/** The dock: the same view at 720, up and down through the conflict list, the page behind it. */
export function ConflictDock({ pairKey }: { pairKey: string }) {
  const list = useQuery(conflictsQuery('all'))
  const rows = list.data ?? []
  const at = rows.findIndex((r) => r.key === pairKey)
  const go = (p: ConflictRow) => openDock('conflict', p.key)
  return (
    <DockFrame
      title="Conflict"
      quietTitle
      actions={
        <PeekBar onExpand={() => navigate(conflictPath(pairKey))}>
          {at >= 0 && (
            <span className="flex items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Previous conflict"
                      disabled={at === 0}
                      onClick={() => go(rows[at - 1]!)}
                    />
                  }
                >
                  <ChevronUpIcon />
                </TooltipTrigger>
                <TooltipContent>
                  Previous <Kbd>K</Kbd>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Next conflict"
                      disabled={at === rows.length - 1}
                      onClick={() => go(rows[at + 1]!)}
                    />
                  }
                >
                  <ChevronDownIcon />
                </TooltipTrigger>
                <TooltipContent>
                  Next <Kbd>J</Kbd>
                </TooltipContent>
              </Tooltip>
            </span>
          )}
        </PeekBar>
      }
    >
      <div key={pairKey} className="p-4 dock-swap">
        <ConflictView pairKey={pairKey} place="dock" onStep={go} />
      </div>
    </DockFrame>
  )
}
