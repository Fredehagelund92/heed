import type { RefObject } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useDockMode } from '@/components/page/dock-panel'
import { useDockList } from '@/components/page/use-dock-list'
import type { ProposalsSearch } from '@/lib/search-params'
import { ProposalPanel } from './proposal-panel'
import type { RowPanel } from './row-panel'

/** The list's own params, without the panel and its tab: what makes it the same list. */
function listOf(search: ProposalsSearch): ProposalsSearch {
  return { ...search, panel: undefined, tab: undefined }
}

/**
 * The docked panel of the Proposals page's lists (To review and Mine): the proposal open in it
 * is in the address (`?panel=`, and `?tab=`), so a panel is linkable and Back closes it. j and k
 * step it through the rows, Escape closes it and focus returns to the row. In the queue, a
 * decision moves the panel on to the next proposal, so an owner triages without leaving it.
 */
export function useProposalPanel({
  search,
  region,
  ids,
  searchRef,
  enabled,
  selection,
  bulk,
  discard,
}: {
  search: ProposalsSearch
  region: HTMLElement | null
  /** The rows' ids in the order they show. */
  ids: readonly string[]
  searchRef: RefObject<HTMLInputElement | null>
  enabled: boolean
  /** The rows' selection and its bulk actions, in the review queue (FR-223). */
  selection?: Parameters<typeof useDockList>[0]['selection']
  bulk?: Parameters<typeof useDockList>[0]['bulk']
  /** Discarding the person's drafts, in Mine. */
  discard?: Parameters<typeof useDockList>[0]['discard']
}) {
  const navigate = useNavigate({ from: '/proposals/' })
  const panelId = search.panel ?? null
  const list = listOf(search)
  const open = (id: string) =>
    void navigate({
      to: '/proposals',
      search: { ...list, panel: id, tab: search.tab },
      replace: true,
      state: true,
      resetScroll: false,
    })
  const dock = useDockList({
    region,
    ids,
    panelId,
    open,
    close: () =>
      void navigate({ to: '/proposals', search: list, replace: true, resetScroll: false }),
    searchRef,
    enabled,
    selection,
    bulk,
    discard,
  })
  const mode = useDockMode()

  const panel: RowPanel = {
    search: { ...list, tab: search.tab },
    openId: panelId,
  }
  const element = panelId ? (
    <ProposalPanel
      id={panelId}
      tab={search.tab}
      onTabChange={(tab) =>
        void navigate({
          to: '/proposals',
          search: { ...list, panel: panelId, tab },
          replace: true,
          state: true,
          resetScroll: false,
        })
      }
      position={dock.position}
      onPrevious={dock.previousId ? () => open(dock.previousId!) : undefined}
      onNext={dock.nextId ? () => open(dock.nextId!) : undefined}
      onClose={dock.closePanel}
      onDecided={() => {
        // The decided proposal leaves the queue: read the next one, or stay on it at the end.
        if (dock.nextId) open(dock.nextId)
      }}
    />
  ) : null
  return {
    panel,
    element,
    closePanel: dock.closePanel,
    /** On a phone the panel fills the screen: the list under it is out of reach until it closes. */
    listHidden: panelId !== null && mode === 'full',
  }
}
