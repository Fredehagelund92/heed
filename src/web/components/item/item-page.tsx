import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import type { ContextItem } from '@domain/item'
import { useRecordVisit } from '@/api/queries'
import { useDocumentScope } from '@/components/app-shell/command-scope'
import { HeaderActions } from '@/components/app-shell/header-actions'
import { useShellActions } from '@/components/app-shell/shell-actions'
import { ChevronDownIcon, ChevronUpIcon, StarIcon } from '@/components/icons'
import { ItemHeader } from '@/components/item/item-header'
import {
  ItemActionGroup,
  ItemTabPanels,
  itemTabItems,
  useItemFacts,
} from '@/components/item/item-parts'
import { Page, PageContent } from '@/components/page/page'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { DocumentScope } from '@/lib/commands'
import { formatHotkey } from '@/lib/commands'
import type { LibraryRow } from '@/lib/library'
import { listSearch, rememberCursor } from '@/lib/list-memory'
import type { ItemSearch, ItemTab } from '@/lib/search-params'
import { useItemListOrder, useListContext } from '@/lib/use-item-list-order'
import { ItemDetails } from '@/components/item/item-details'
import { ReviewStamp, useItemReviewStamp } from '@/components/item/review-stamp'
import { cn } from '@/lib/utils'

function NavButtons({
  position,
  total,
  previous,
  next,
  onPrevious,
  onNext,
  touch,
}: {
  position: number
  total: number
  previous: LibraryRow | undefined
  next: LibraryRow | undefined
  onPrevious: () => void
  onNext: () => void
  touch?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      {touch ? (
        <span className="text-caption text-muted-foreground tabular-nums" aria-live="polite">
          {position.toLocaleString('en')} of {total.toLocaleString('en')}
        </span>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size={touch ? 'icon-touch' : 'icon-toolbar'}
              onClick={onPrevious}
              disabled={!previous}
              aria-label="Previous fact"
            />
          }
        >
          <ChevronUpIcon />
        </TooltipTrigger>
        <TooltipContent>Previous fact ({formatHotkey('k').join('')})</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size={touch ? 'icon-touch' : 'icon-toolbar'}
              onClick={onNext}
              disabled={!next}
              aria-label="Next fact"
            />
          }
        >
          <ChevronDownIcon />
        </TooltipTrigger>
        <TooltipContent>Next fact ({formatHotkey('j').join('')})</TooltipContent>
      </Tooltip>
    </div>
  )
}

/** The reading column and persistent Details; navigation keeps the originating list and tab. */
export function ItemPage({ item, search }: { item: ContextItem; search: ItemSearch }) {
  const navigate = useNavigate()
  const router = useRouter()
  const facts = useItemFacts(item)
  const stamp = useItemReviewStamp(item)
  const { isFavorite, toggleFavorite } = useShellActions()
  const recordVisit = useRecordVisit()

  const tab: ItemTab = search.tab ?? 'read'
  const order = useItemListOrder(search, item.id)
  // Position, previous and next only when the page carries the list it was opened from.
  const listContext = useListContext(search)
  const index = listContext ? order.rows.findIndex((row) => row.id === item.id) : -1
  const previous = index > 0 ? order.rows[index - 1] : undefined
  const next = index >= 0 ? order.rows[index + 1] : undefined
  const carried = listSearch(order.search)

  const recordMutate = recordVisit.mutate
  useEffect(() => {
    recordMutate(item.id)
    rememberCursor(order.search, item.id)
  }, [item.id, recordMutate, order.search])

  // Steps from the item being opened: while it loads this page still shows the one before, so
  // stepping from that would go nowhere (Next) or lose a step (j j).
  const step = (offset: 1 | -1) => {
    const [, params, route] = router.getMatchedRoutes(router.latestLocation.pathname)
    const fromId = route?.id === '/library/$itemId' ? params.itemId : item.id
    const from = order.rows.findIndex((row) => row.id === fromId)
    if (from >= 0) goTo(order.rows[from + offset])
  }
  const goTo = (row: LibraryRow | undefined) => {
    if (!row) return
    // Replace, so the browser's Back returns to the list, not through every item; the entry
    // still came from the list. The tab stays, so a person reading sources can step through them.
    void navigate({
      to: '/library/$itemId',
      params: { itemId: row.id },
      search: { ...carried, tab: search.tab },
      replace: true,
      state: true,
    })
  }
  const showTab = (value: ItemTab) => {
    void navigate({
      to: '/library/$itemId',
      params: { itemId: item.id },
      search: { ...search, tab: value === 'read' ? undefined : value },
      replace: true,
      state: true,
    })
  }

  // The command registry gets one stable scope per item; it reads the latest actions via a ref.
  const actions = useRef({ next: () => step(1), previous: () => step(-1) })
  useLayoutEffect(() => {
    actions.current = { next: () => step(1), previous: () => step(-1) }
  })
  const scope = useMemo<DocumentScope>(
    () => ({
      itemId: item.id,
      next: () => actions.current.next(),
      previous: () => actions.current.previous(),
    }),
    [item.id],
  )
  useDocumentScope(scope)

  const favorite = isFavorite(item.id)

  const navigation =
    index >= 0 && order.rows.length > 1 ? (
      <NavButtons
        position={index + 1}
        total={order.rows.length}
        previous={previous}
        next={next}
        onPrevious={() => step(-1)}
        onNext={() => step(1)}
      />
    ) : null
  const star = (touch?: boolean) => (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size={touch ? 'icon-touch' : 'icon-toolbar'}
            onClick={() => toggleFavorite(item.id)}
            aria-pressed={favorite}
            aria-label={favorite ? 'Remove from favourites' : 'Add to favourites'}
          />
        }
      >
        <StarIcon className={cn(favorite && 'fill-current')} />
      </TooltipTrigger>
      <TooltipContent>
        {favorite ? 'Remove from favourites' : 'Add to favourites'} ({formatHotkey('f').join('')})
      </TooltipContent>
    </Tooltip>
  )
  return (
    <Page title={item.title} heading="paper" data-template="document">
      <HeaderActions>
        {navigation}
        {star()}
      </HeaderActions>

      <PageContent className="grow gap-8 item-wide:flex-row item-wide:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <ItemHeader
            item={item}
            area={facts.area}
            state={facts.state}
            stamp={stamp ? <ReviewStamp view={stamp} /> : null}
          />
          <article data-slot="paper" className="w-full min-w-0">
            <Tabs value={tab} onValueChange={(value: ItemTab) => showTab(value)}>
              <TabsList
                variant="line"
                aria-label="Fact sections"
                className="w-full justify-start border-b"
              >
                {itemTabItems(facts).map((entry) => (
                  <TabsTrigger key={entry.value} value={entry.value} className="font-normal">
                    {entry.label}
                    {entry.count}
                  </TabsTrigger>
                ))}
              </TabsList>
              <ItemTabPanels
                item={item}
                facts={facts}
                detailsInRail
                className="flex flex-col gap-8 pt-6 text-body"
              />
            </Tabs>
          </article>
        </div>
        <aside
          aria-label="Fact details"
          data-slot="item-details"
          className="@container relative flex w-full flex-col gap-6 border-t border-border-subtle pt-6 item-wide:w-item-details item-wide:shrink-0 item-wide:self-stretch item-wide:border-t-0 item-wide:pt-0 item-wide:before:absolute item-wide:before:-inset-y-6 item-wide:before:-left-4 item-wide:before:border-l item-wide:before:border-border-subtle"
        >
          <ItemActionGroup
            item={item}
            facts={facts}
            page
            onChecked={next ? () => goTo(next) : undefined}
          />
          <ItemDetails item={item} facts={facts} />
        </aside>
      </PageContent>

      <div
        data-launcher-clear
        className="sticky bottom-0 z-sticky flex items-center justify-between gap-2 border-t bg-background p-2 @2xl:hidden"
      >
        {star(true)}
        {index >= 0 && order.rows.length > 1 ? (
          <NavButtons
            position={index + 1}
            total={order.rows.length}
            previous={previous}
            next={next}
            onPrevious={() => step(-1)}
            onNext={() => step(1)}
            touch
          />
        ) : null}
      </div>
    </Page>
  )
}
