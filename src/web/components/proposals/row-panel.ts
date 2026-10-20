import { panelRowHistory } from '@/lib/history'
import type { ProposalsSearch } from '@/lib/search-params'

/**
 * How a row of the Proposals page opens its proposal in the docked panel (design round 3,
 * direction A): the list's own params with the row as `panel`. While a panel is open the next
 * row replaces the address, so Back closes the panel instead of stepping through every proposal
 * read (lib/history.ts).
 */
export type RowPanel = {
  /** The list's params and the panel's tab, which the next row opens on. */
  search: ProposalsSearch
  /** The proposal open in the panel. */
  openId: string | null
}

export function panelLink(panel: RowPanel, id: string) {
  return {
    to: '/proposals',
    search: { ...panel.search, panel: id },
    ...panelRowHistory(panel.openId !== null),
    resetScroll: false,
  } as const
}
