import type { LinkTo } from '@/components/quality/panel-parts'
import type { WorkbenchSearch } from '@/lib/search-params'
import { openRecordSearch, workbenchRecord, workbenchTabFromQuality } from '@/lib/workbench-address'

/**
 * The Workbench's links for the record bodies it shows (Workbench plan, W6b): another record
 * opens in the record pane with the tab kept (`openRecordSearch`), and a tab, a try's transcript
 * or the run compared with changes the address in place. The run compared with is the scope
 * strip's too, so opening another record keeps it unless the link names one.
 */
export function workbenchLinks(search: WorkbenchSearch): LinkTo {
  return ({ record, tab, ...change }) => {
    let next: WorkbenchSearch = record ? openRecordSearch(search, record) : { ...search }
    if ('cell' in change) next = { ...next, cell: change.cell }
    if ('against' in change && (!record || change.against !== undefined))
      next = { ...next, against: change.against }
    if (tab !== undefined)
      next = { ...next, tab: workbenchTabFromQuality(workbenchRecord(next.open)?.kind, tab) }
    return {
      to: '/health',
      search: Object.fromEntries(
        Object.entries(next).filter(([, value]) => value !== undefined),
      ) as WorkbenchSearch,
    }
  }
}

/** Where an open record is in the work list, and previous and next in it (W5). */
export type ListPlace = {
  position: { index: number; total: number } | null
  onPrevious: (() => void) | undefined
  onNext: (() => void) | undefined
}

/** The record bar's part of a list place: "Test question · 2 of 9", and previous and next. */
export function placeInBar(kind: string, { position, onPrevious, onNext }: ListPlace) {
  return {
    meta: `${kind}${position ? ` · ${position.index + 1} of ${position.total}` : ''}`,
    browse: position !== null,
    onPrevious,
    onNext,
  }
}
