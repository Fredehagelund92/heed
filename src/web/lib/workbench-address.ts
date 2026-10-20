import {
  validateWorkbenchSearch,
  type GapsSearch,
  type QualityPanelTab,
  type QualitySearch,
  type WorkbenchSearch,
  type WorkbenchTab,
} from './search-params'

/*
  The Workbench's address beyond its schema (Workbench plan, 3.3): the kinds of record it opens
  and their tabs, and where the retired Quality and the owners' Gaps addresses land in it. Apart
  from search-params.ts, whose schemas the shell loads before any page, so this stays in lazy
  chunks: the /quality redirect imports it only when an old link is followed.
*/

/** The kinds of record the Workbench opens, and the tabs of each, the first being the default. */
export const workbenchRecordTabs = {
  question: ['evidence', 'result', 'history'],
  gap: ['evidence', 'history'],
  item: [],
  run: ['overview', 'changes', 'results'],
  domain: ['overview', 'questions', 'runs', 'team'],
} as const
export type WorkbenchRecordKind = keyof typeof workbenchRecordTabs
/** The record an `open` param names: its kind and its id. */
export function workbenchRecord(open: string | undefined) {
  if (!open) return null
  const at = open.indexOf(':')
  return { kind: open.slice(0, at) as WorkbenchRecordKind, id: open.slice(at + 1) }
}

/** The tab a record of this kind shows: the one asked for when the kind has it, else its first. */
export function workbenchTab(
  kind: WorkbenchRecordKind,
  tab: WorkbenchTab | undefined,
): WorkbenchTab | undefined {
  const tabs: readonly WorkbenchTab[] = workbenchRecordTabs[kind]
  return tab !== undefined && tabs.includes(tab) ? tab : tabs[0]
}

/**
 * The address with another record open (Workbench plan, W6b): the tab stays, so moving from one
 * question to the next keeps its Test result open, and a record without it shows its first tab
 * (`workbenchTab`); the try whose transcript showed and the compare focus belong to the record
 * left, so they go. The scope, the list and the run compared with stay.
 */
export function openRecordSearch(search: WorkbenchSearch, open: string): WorkbenchSearch {
  return { ...search, open, cell: undefined, mode: undefined }
}

/** Quality's question tabs, by the Workbench tab they became. */
const questionTabFromQuality: Partial<Record<QualityPanelTab, WorkbenchTab>> = {
  overview: 'evidence',
  results: 'result',
}

/**
 * A tab a record body names in Quality's words, in the Workbench's: a question's Question and
 * Results tabs are its Evidence and Test result; the other kinds kept their names.
 */
export function workbenchTabFromQuality(
  kind: WorkbenchRecordKind | undefined,
  tab: QualityPanelTab,
): WorkbenchTab | undefined {
  if (kind === 'question') return questionTabFromQuality[tab]
  return tab
}

/**
 * Where an address of the retired Quality page lands in the Workbench (Workbench plan, 3.3): the
 * domain, the view and its search, and the open panel as the open record with the matching tab;
 * a run keeps the run it is compared with and the try whose transcript shows. A pure function,
 * so the redirect is too.
 */
export function workbenchFromQuality(search: QualitySearch): WorkbenchSearch {
  const record = workbenchRecord(search.panel)
  let tab: WorkbenchTab | undefined
  if (record?.kind === 'question')
    tab = search.tab === undefined ? undefined : questionTabFromQuality[search.tab]
  else if (record && search.tab !== undefined)
    tab = (workbenchRecordTabs[record.kind] as readonly WorkbenchTab[]).includes(search.tab)
      ? search.tab
      : undefined
  const run = record?.kind === 'run'
  return clean<WorkbenchSearch>({
    area: search.area,
    view: search.view,
    q: search.view ? search.q : undefined,
    open: search.panel,
    tab,
    against: run ? search.against : undefined,
    cell: run ? search.cell : undefined,
  })
}

/**
 * Where an owner's, deputy's or administrator's address of the Gaps page lands in the Workbench
 * (Workbench plan, 3.3): the Gaps view with the same search and filters, and the open gap as the
 * open record. The topic counts stay on the Gaps page, so they have no Workbench address (null).
 */
export function workbenchFromGaps(search: GapsSearch): WorkbenchSearch | null {
  if (search.view === 'topics') return null
  return clean<WorkbenchSearch>({
    view: 'gaps',
    q: search.q,
    // The Gaps page takes any text; an area the Workbench cannot name is left out.
    area: validateWorkbenchSearch({ area: search.area }).area,
    status: search.status,
    type: search.type,
    origin: search.origin,
    open: search.gap ? `gap:${search.gap}` : undefined,
  })
}

/** Leaves out the keys with no value, so the address stays clean. */
function clean<T extends Record<string, unknown>>(search: T): T {
  return Object.fromEntries(Object.entries(search).filter(([, value]) => value !== undefined)) as T
}
