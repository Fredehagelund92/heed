import { useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { ContextItem } from '@domain/item'
import { itemQuery, useRecordVisit } from '@/api/queries'
import { ItemBadges, StateNote } from '@/components/item/item-header'
import { KindIcon } from '@/components/item/item-marks'
import { ReviewStamp, useItemReviewStamp } from '@/components/item/review-stamp'
import {
  ItemActionGroup,
  ItemTabPanels,
  itemTabItems,
  useItemFacts,
} from '@/components/item/item-parts'
import { DockPanel } from '@/components/page/dock-panel'
import { PageRail } from '@/components/page/page-rail'
import { Button } from '@/components/ui/button'
import { kindNames } from '@/lib/library'
import { rememberCursor } from '@/lib/list-memory'
import type { ItemTab, LibrarySearch } from '@/lib/search-params'
import { ListEmpty } from './list-state'

type ItemPanelProps = {
  itemId: string
  tab: ItemTab
  onTabChange: (tab: ItemTab) => void
  /** Where the item is in the list, when it is in it. */
  position: { index: number; total: number } | null
  onPrevious?: () => void
  onNext?: () => void
  onClose: () => void
  /** The list's own params, carried to the item page by expand. */
  listSearch: LibrarySearch
}

/**
 * The library's item panel (design round 3, direction A): the item opened from a row, docked
 * beside the list. The same parts as the item page (its title, badges and note line, the Read,
 * Source, History and Links tabs, and its action group, here in the footer); the bar names the
 * kind and the place in the list instead of the id, so reading an item
 * in the panel and on its page is the same. Expand opens the item page, which keeps the list.
 */
export function ItemPanel(props: ItemPanelProps) {
  const { data: item, isPending } = useQuery(itemQuery(props.itemId))
  if (item) return <ItemPanelContent item={item} {...props} />
  return (
    <DockPanel
      title={isPending ? null : 'Fact not found'}
      meta={<span className="truncate">Fact</span>}
      onClose={props.onClose}
      onPrevious={props.onPrevious}
      onNext={props.onNext}
    >
      {isPending ? null : (
        <ListEmpty
          title="This fact isn't in the library"
          action={
            <Button variant="outline" onClick={props.onClose}>
              Close
            </Button>
          }
        >
          It may have been removed, or the link is mistyped. The list is still where it was.
        </ListEmpty>
      )}
    </DockPanel>
  )
}

function ItemPanelContent({
  item,
  tab,
  onTabChange,
  position,
  onPrevious,
  onNext,
  onClose,
  listSearch,
}: ItemPanelProps & { item: ContextItem }) {
  const facts = useItemFacts(item)
  const stamp = useItemReviewStamp(item)
  const recordVisit = useRecordVisit().mutate
  useEffect(() => {
    recordVisit(item.id)
  }, [item.id, recordVisit])

  return (
    <DockPanel
      title={item.title}
      contentKey={item.id}
      meta={
        <>
          <KindIcon
            kind={item.kind}
            active={facts.state.conditions.lifecycle === 'active_issue'}
            decorative
          />
          <span className="truncate">{kindNames[item.kind]}</span>
          {position ? (
            <span className="shrink-0">
              · {(position.index + 1).toLocaleString('en')} of {position.total.toLocaleString('en')}
            </span>
          ) : null}
        </>
      }
      // The bar names the kind, so the badges start at the domain.
      badges={<ItemBadges item={item} area={facts.area} state={facts.state} kind={false} />}
      note={
        stamp || facts.state.note ? (
          <>
            {stamp ? <ReviewStamp view={stamp} /> : null}
            {facts.state.note ? <StateNote>{facts.state.note}</StateNote> : null}
          </>
        ) : null
      }
      tabs={itemTabItems(facts)}
      tab={tab}
      onTabChange={onTabChange}
      tabsLabel="Fact sections"
      onPrevious={onPrevious}
      onNext={onNext}
      onClose={onClose}
      expand={
        <Link
          to="/library/$itemId"
          params={{ itemId: item.id }}
          search={{ ...listSearch, tab: tab === 'read' ? undefined : tab }}
          // The item page carries this list, and its Escape comes back to it, panel and all.
          state={{ fromList: true, fromParent: true }}
          onClick={() => rememberCursor(listSearch, item.id)}
        />
      }
      // A check moves on to the next item, so a run through Needs a look is one key per item.
      footer={<ItemActionGroup item={item} facts={facts} onChecked={onNext} />}
    >
      <PageRail placement="panel">
        <ItemTabPanels
          item={item}
          facts={facts}
          headingLevel={3}
          className="flex flex-col gap-8 text-body"
        />
      </PageRail>
    </DockPanel>
  )
}
