import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDownIcon, ChevronUpIcon, NotebookTextIcon, PlusIcon } from '@/components/icons'
import { ConflictView } from '@/components/heed/conflict-view'
import { DockFrame, PeekBar } from '@/components/dock'
import { Loadable, TableSkeleton } from '@/components/heed/load-state'
import { TextSwitch } from '@/components/heed/switches'
import { ContextViews } from '@/components/heed/context-views'
import { Page, SiteHeader } from '@/components/site-header'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { conflictQuery, conflictsQuery } from '@/api/queries'
import { openDock } from '@/lib/dock'
import { href, navigate, setQuery, useRoute } from '@/lib/router'
import { useDomains } from '@/lib/workspace'
import { conflictPath, sideTitle, type ConflictRow } from '@/model/conflicts'

// Where a conflict is settled (FR-220): its own page under Context, the conflict dock (720,
// expandable to the page) and the Conflicts view of the Context list. All three draw the one
// ConflictView.

/** The page: the pair, Context before it, and J and K through the conflict list. */
export function ConflictPage({ pairKey }: { pairKey: string }) {
  const pair = useQuery(conflictQuery(pairKey))
  const topic = pair.data?.topic
  return (
    <Page
      title={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href={href('/context/conflicts')}>Context</BreadcrumbLink>
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

const SHOWN = 6

/** Context, Conflicts: one row per pair, most asked first, mine or all. No bulk action: each needs a reason. */
export function ConflictsPage() {
  const { query } = useRoute()
  const whose = query.get('whose') === 'all' ? 'all' : 'mine'
  const all = useQuery(conflictsQuery('all'))
  const domains = useDomains()
  const [more, setMore] = React.useState(false)
  const rows = all.data ?? []
  const mine = rows.filter((r) => r.mine)
  const listed = whose === 'mine' ? mine : rows
  const shown = more ? listed : listed.slice(0, SHOWN)
  const hidden = listed.length - shown.length
  const domainsOf = (r: ConflictRow) =>
    [...new Set([r.holder.domain, r.other.domain])].map((d) => domains[d]?.name ?? d).join(' and ')
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SiteHeader title="Context" icon={<NotebookTextIcon />}>
        <Button size="sm" onClick={() => navigate('/context/new')}>
          <PlusIcon data-icon="inline-start" />
          New context
        </Button>
      </SiteHeader>
      <div className="@container/main flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-wide flex-col gap-4 px-4 py-5 md:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ContextViews value="conflicts" />
            {rows.length > 0 && (
              <TextSwitch
                label="Whose"
                value={whose}
                onChange={(v) => setQuery({ whose: v === 'all' ? 'all' : undefined })}
                options={[
                  { value: 'mine', label: 'Mine', count: mine.length },
                  { value: 'all', label: 'All', count: rows.length },
                ]}
              />
            )}
          </div>
          <Loadable what="the conflicts" skeleton={<TableSkeleton rows={6} />} query={all}>
            {rows.length === 0 ? (
              <Empty className="border border-dashed">
                <EmptyHeader>
                  <EmptyTitle>Nothing disagrees</EmptyTitle>
                  <EmptyDescription>
                    Agents get one answer for every question that was asked. A conflict shows here
                    when an owner marks two items as disagreeing.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant="outline" onClick={() => navigate('/context')}>
                    Back to the items
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {rows.length} {rows.length === 1 ? 'conflict' : 'conflicts'}. Agents get both
                  items of each. Most asked first.
                </p>
                <div className="overflow-x-auto rounded-frame border">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Conflicts, most asked first</caption>
                    <thead>
                      <tr className="bg-muted/40 text-xs text-muted-foreground">
                        <th className="h-9 px-4 text-left font-medium">Topic</th>
                        <th className="h-9 px-4 text-left font-medium">The two items</th>
                        <th className="h-9 px-4 text-left font-medium max-md:hidden">Domains</th>
                        <th className="h-9 px-4 text-right font-medium">Asked</th>
                        <th className="h-9 px-4 text-left font-medium max-sm:hidden">Since</th>
                        <th className="h-9 px-4 text-left font-medium max-md:hidden">
                          <span className="sr-only">What you can do</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((r) => (
                        <tr
                          key={r.key}
                          className="cursor-pointer border-t align-top hover:bg-muted/50"
                          onClick={() => openDock('conflict', r.key)}
                        >
                          <td className="px-4 py-3 font-medium">
                            <a
                              href={href(conflictPath(r.key))}
                              className="underline-offset-4 hover:underline"
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                openDock('conflict', r.key)
                              }}
                            >
                              {r.topic}
                            </a>
                          </td>
                          <td className="px-4 py-3">
                            <span className="block">{sideTitle(r.holder)}</span>
                            <span className="block text-muted-foreground">
                              {sideTitle(r.other)}
                            </span>
                          </td>
                          <td className="px-4 py-3 max-md:hidden">{domainsOf(r)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{r.asked}</td>
                          <td className="px-4 py-3 whitespace-nowrap max-sm:hidden">{r.since}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground max-md:hidden">
                            {r.canSettle ? 'You can settle it' : 'Ask the owner'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  {hidden > 0 ? (
                    <Button variant="ghost" size="sm" onClick={() => setMore(true)}>
                      Show {hidden} more ({hidden} not shown)
                    </Button>
                  ) : (
                    <span />
                  )}
                  <span className="text-xs text-muted-foreground">
                    {rows.length} {rows.length === 1 ? 'conflict' : 'conflicts'}, {mine.length}{' '}
                    {mine.length === 1 ? 'is' : 'are'} yours
                  </span>
                </div>
              </>
            )}
          </Loadable>
        </div>
      </div>
    </div>
  )
}
