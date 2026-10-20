import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ItemPanel } from '@/components/library/item-panel'
import { useDockList } from '@/components/page/use-dock-list'
import type { ItemTab, TryItSearch } from '@/lib/search-params'

/*
  A fact of the reply opened in the docked panel, as the library opens one from its rows (design
  round 3, direction A): the same `ItemPanel` and the same list keys (`useDockList`), so the
  reply, the scope in the bar and the scroll stay where they were beside it. The fact is in the
  address (`?panel=`, and `tab=` past Read), so a link shows it and Back closes it. The reply's
  facts are the list: previous and next step through them in their rank order.
*/

/** The fact open in the panel, and the addresses that open one, as the page holds them. */
export type FactPanelState = {
  openId: string | null
  tab: ItemTab
  /** The page's address with a fact open on a tab, or with none open. */
  to: (
    id: string | null,
    tab: ItemTab,
  ) => Pick<TryItSearch, 'about' | 'from' | 'to' | 'panel' | 'tab'>
}

export function FactPanel({
  state,
  ids,
  region,
}: {
  state: FactPanelState
  /** The reply's facts in their rank order. */
  ids: readonly string[]
  /** The element that holds the facts (`[data-row-id]` with a `[data-row-link]` in each). */
  region: HTMLElement | null
}) {
  const navigate = useNavigate()
  const { openId, tab, to } = state
  // The scope's field is the page's search: `/` goes to it.
  const searchRef = useMemo(
    () => ({
      get current() {
        return region?.querySelector<HTMLInputElement>('[role="combobox"]') ?? null
      },
    }),
    [region],
  )
  // Stepping and the tabs replace the entry, keeping what it says (the panel opened over it).
  const show = (id: string | null, next: ItemTab) =>
    void navigate({
      to: '/try-it',
      search: to(id, next),
      replace: true,
      state: true,
      resetScroll: false,
    })
  const dock = useDockList({
    region,
    ids,
    panelId: openId,
    open: (id) => show(id, tab),
    close: () =>
      void navigate({ to: '/try-it', search: to(null, 'read'), replace: true, resetScroll: false }),
    searchRef,
    enabled: openId !== null || ids.length > 0,
  })

  // A panel opened from the page takes the focus, so a keyboard reads it at once; the next fact
  // in the same panel (a click, j or k) leaves the focus where the person put it.
  const [shown, setShown] = useState(openId)
  const [fresh, setFresh] = useState(true)
  if (shown !== openId) {
    setShown(openId)
    setFresh(shown === null)
  }

  if (openId === null) return null
  return (
    <ItemPanel
      itemId={openId}
      tab={tab}
      onTabChange={(next) => show(openId, next)}
      position={dock.position}
      onPrevious={dock.previousId ? () => show(dock.previousId ?? null, tab) : undefined}
      onNext={dock.nextId ? () => show(dock.nextId ?? null, tab) : undefined}
      onClose={dock.closePanel}
      expand={(itemId, itemTab) => (
        <Link
          to="/library/$itemId"
          params={{ itemId }}
          search={{ tab: itemTab === 'read' ? undefined : itemTab }}
          // Its Escape comes back here, panel and all.
          state={{ fromParent: true }}
        />
      )}
      focusOnOpen={fresh}
    />
  )
}
