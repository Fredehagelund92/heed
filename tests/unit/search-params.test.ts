import { describe, expect, it } from 'vitest'
import { listKey, listSearch } from '@/lib/list-memory'
import {
  validateAdminSearch,
  validateCatalogueSearch,
  validateDocsSearch,
  validateGapsSearch,
  validateMcpSearch,
  validateSettingsSearch,
  validateTryItSearch,
  validateLibrarySearch,
  validateProposalsSearch,
  validateQualitySearch,
  validateSignedOutSearch,
  validateWorkbenchSearch,
} from '@/lib/search-params'
import {
  workbenchFromGaps,
  workbenchFromQuality,
  workbenchRecord,
  workbenchTab,
} from '@/lib/workbench-address'
import { retiredSettingsSectionMoves, retiredSettingsSections } from '@/lib/settings-sections'

describe('typed search params', () => {
  it('accepts valid values', () => {
    expect(
      validateLibrarySearch({
        view: 'attention',
        q: 'orders',
        kind: 'event,note',
        status: 'stale',
        sort: 'title',
        dir: 'desc',
        group: 'kind',
      }),
    ).toEqual({
      view: 'attention',
      q: 'orders',
      kind: 'event,note',
      status: 'stale',
      sort: 'title',
      dir: 'desc',
      group: 'kind',
    })
  })

  it('keeps URLs clean: no defaults are written in', () => {
    expect(validateLibrarySearch({})).toEqual({})
  })

  it('drops an invalid value instead of failing the route', () => {
    expect(validateLibrarySearch({ kind: 'poem', q: 'orders' })).toEqual({
      kind: undefined,
      q: 'orders',
    })
    expect(validateLibrarySearch({ kind: 'event,poem' }).kind).toBeUndefined()
    expect(validateLibrarySearch({ view: 'cards' }).view).toBeUndefined()
    expect(validateGapsSearch({ status: 'maybe', area: 'area_commercial' })).toEqual({
      status: undefined,
      area: 'area_commercial',
    })
  })

  it('carries the item open in the library panel and its tab, and leaves them out of the list', () => {
    const search = validateLibrarySearch({ view: 'mine', panel: 'itm_zgk6ael1', tab: 'history' })
    expect(search).toEqual({ view: 'mine', panel: 'itm_zgk6ael1', tab: 'history' })
    expect(listSearch(search)).toEqual({ view: 'mine' })
    expect(listKey(search)).toBe(listKey({ view: 'mine' }))
    expect(validateLibrarySearch({ panel: '../x y', tab: 'read' })).toEqual({
      panel: undefined,
      tab: undefined,
    })
  })

  it('carries the proposal open in the Proposals panel and its tab', () => {
    const id = '00000000-0000-4000-8000-00000000005a'
    expect(validateProposalsSearch({ view: 'review', panel: id, tab: 'checks' })).toEqual({
      view: 'review',
      panel: id,
      tab: 'checks',
    })
    // Both modes' tabs are kept; the panel falls back to its first when it has not got one.
    expect(validateProposalsSearch({ panel: id, tab: 'preview' }).tab).toBe('preview')
    expect(validateProposalsSearch({ panel: 'itm_zgk6ael1', tab: 'read' })).toEqual({
      panel: undefined,
      tab: undefined,
    })
  })

  it('carries the term open in the catalogue panel by its key, and its tab', () => {
    expect(
      validateCatalogueSearch({ kind: 'metric', panel: 'metric:orders', tab: 'source' }),
    ).toEqual({ kind: 'metric', panel: 'metric:orders', tab: 'source' })
    expect(validateCatalogueSearch({ panel: 'dim:market' }).panel).toBe('dim:market')
    expect(validateCatalogueSearch({ panel: 'val:market/norway', tab: 'overview' })).toEqual({
      panel: undefined,
      tab: undefined,
    })
  })

  it('drops params the route does not know', () => {
    expect(validateLibrarySearch({ q: 'x', utm_source: 'mail' })).toEqual({
      q: 'x',
      utm_source: undefined,
    })
  })

  it('returns a dropped key as undefined, so the raw value cannot leak through the router merge', () => {
    const search = validateLibrarySearch({ kind: 'poem', utm_source: 'mail' })
    expect(Object.keys(search).sort()).toEqual(['kind', 'utm_source'])
    expect(search.kind).toBeUndefined()
  })

  it('keeps only a path on this site to go back to after signing in', () => {
    expect(validateSignedOutSearch({ from: '/library?kind=event' }).from).toBe(
      '/library?kind=event',
    )
    for (const from of ['https://evil.example/x', '//evil.example/x', 'library', 42])
      expect(validateSignedOutSearch({ from }).from).toBeUndefined()
  })
})

const GAP = '00000000-0000-4000-a000-000000000010'
const RUN = '00000000-0000-4000-b000-000000000090'
const EARLIER = '00000000-0000-4000-b000-000000000080'
const TRY = '00000000-0000-4000-b000-00000009002b'

describe('the Workbench address (Workbench plan, 3.3)', () => {
  it('carries the scope, the view, the open record, its tab, the runs and the compare focus', () => {
    const search = {
      area: 'area_commercial',
      view: 'worse',
      q: 'net revenue',
      open: 'question:net-revenue-month-to-date',
      tab: 'evidence',
      run: RUN,
      against: EARLIER,
      cell: TRY,
      mode: 'compare',
    }
    expect(validateWorkbenchSearch(search)).toEqual(search)
    expect(validateWorkbenchSearch({})).toEqual({})
  })

  it('opens each kind of record by its id, and drops anything else', () => {
    for (const open of [
      'domain:area_commercial',
      'question:net-revenue-month-to-date',
      `gap:${GAP}`,
      'item:itm_jyfuvl07',
      `run:${RUN}`,
    ])
      expect(validateWorkbenchSearch({ open }).open).toBe(open)
    for (const open of ['proposal:12', 'gap:not-a-uuid', 'item:12', 'domain:', 'question:'])
      expect(validateWorkbenchSearch({ open }).open).toBeUndefined()
  })

  it('names runs by id, not by edition, and keeps the gap filters', () => {
    expect(validateWorkbenchSearch({ against: '2026-10-07.2' }).against).toBeUndefined()
    expect(
      validateWorkbenchSearch({
        view: 'gaps',
        status: 'open',
        type: 'missing',
        origin: 'no_item_calls',
      }),
    ).toEqual({ view: 'gaps', status: 'open', type: 'missing', origin: 'no_item_calls' })
    expect(validateWorkbenchSearch({ view: 'all', mode: 'focus' })).toEqual({
      view: undefined,
      mode: undefined,
    })
  })

  it('reads the kind and id of the open record', () => {
    expect(workbenchRecord(undefined)).toBeNull()
    expect(workbenchRecord(`run:${RUN}`)).toEqual({ kind: 'run', id: RUN })
    expect(workbenchRecord('question:net-revenue-month-to-date')).toEqual({
      kind: 'question',
      id: 'net-revenue-month-to-date',
    })
  })

  it("falls back to the kind's first tab for a tab the kind does not have", () => {
    expect(workbenchTab('question', undefined)).toBe('evidence')
    expect(workbenchTab('question', 'history')).toBe('history')
    expect(workbenchTab('question', 'changes')).toBe('evidence')
    expect(workbenchTab('gap', 'result')).toBe('evidence')
    expect(workbenchTab('run', 'changes')).toBe('changes')
    expect(workbenchTab('run', 'evidence')).toBe('overview')
    expect(workbenchTab('domain', 'runs')).toBe('runs')
    expect(workbenchTab('domain', 'team')).toBe('team')
    expect(workbenchTab('question', 'team')).toBe('evidence')
    expect(workbenchTab('item', 'evidence')).toBeUndefined()
  })
})

describe('the Quality and Gaps addresses in the Workbench (Workbench plan, 3.3)', () => {
  const quality = (raw: Record<string, unknown>) => workbenchFromQuality(validateQualitySearch(raw))
  const gaps = (raw: Record<string, unknown>) => workbenchFromGaps(validateGapsSearch(raw))

  it('/quality keeps the domain', () => {
    expect(quality({})).toEqual({})
    expect(quality({ area: 'area_commercial' })).toEqual({ area: 'area_commercial' })
  })

  it('/quality?view=questions and runs keep the view, the search and the domain', () => {
    expect(quality({ view: 'questions', q: 'revenue', area: 'area_commercial' })).toEqual({
      view: 'questions',
      q: 'revenue',
      area: 'area_commercial',
    })
    expect(quality({ view: 'runs', area: 'area_commercial' })).toEqual({
      view: 'runs',
      area: 'area_commercial',
    })
  })

  it('a domain panel opens the domain record on the same tab', () => {
    expect(quality({ panel: 'domain:area_commercial', tab: 'runs' })).toEqual({
      open: 'domain:area_commercial',
      tab: 'runs',
    })
    expect(quality({ panel: 'domain:area_commercial' })).toEqual({
      open: 'domain:area_commercial',
    })
  })

  it("a question panel's Results become Test result and its Question becomes Evidence", () => {
    expect(quality({ panel: 'question:net-revenue-month-to-date', tab: 'results' })).toEqual({
      open: 'question:net-revenue-month-to-date',
      tab: 'result',
    })
    expect(quality({ panel: 'question:net-revenue-month-to-date', tab: 'overview' })).toEqual({
      open: 'question:net-revenue-month-to-date',
      tab: 'evidence',
    })
  })

  it('a run panel keeps its tab, the run it is compared with and the open try', () => {
    expect(
      quality({ view: 'runs', panel: `run:${RUN}`, tab: 'changes', against: EARLIER, cell: TRY }),
    ).toEqual({ view: 'runs', open: `run:${RUN}`, tab: 'changes', against: EARLIER, cell: TRY })
  })

  it('drops a comparison or a try that no run panel carries', () => {
    expect(quality({ panel: 'domain:area_commercial', against: EARLIER, cell: TRY })).toEqual({
      open: 'domain:area_commercial',
    })
  })

  it('/gaps lands on the Gaps view with its search, filters and open gap', () => {
    expect(gaps({})).toEqual({ view: 'gaps' })
    expect(
      gaps({
        view: 'gaps',
        q: 'orders',
        area: 'area_commercial',
        status: 'open',
        type: 'missing',
        origin: 'no_item_calls',
        gap: GAP,
      }),
    ).toEqual({
      view: 'gaps',
      q: 'orders',
      area: 'area_commercial',
      status: 'open',
      type: 'missing',
      origin: 'no_item_calls',
      open: `gap:${GAP}`,
    })
  })

  it('/gaps?view=topics stays on the Gaps page', () => {
    expect(gaps({ view: 'topics', area: 'area_commercial' })).toBeNull()
  })

  it('leaves out an area the Workbench cannot name', () => {
    expect(gaps({ area: 'Not An Area' })).toEqual({ view: 'gaps' })
  })
})

describe('Settings, Administration and their old addresses (navigation decision, 12 October 2026)', () => {
  it('keeps a section of Administration with its setting, filters, open entry and gateway tab', () => {
    const search = {
      section: 'audit',
      action: 'setting',
      actor: 'per_ravi',
      area: 'area_commercial',
      from: '2026-10-01',
      to: '2026-10-07',
      entry: 42,
    }
    expect(validateAdminSearch(search)).toEqual(search)
    expect(validateAdminSearch({ section: 'gateway', tab: 'activity', days: 30 })).toEqual({
      section: 'gateway',
      tab: 'activity',
      days: 30,
    })
    // Profile and Connect an AI app are the person's own, not Administration's.
    expect(validateAdminSearch({ section: 'profile' }).section).toBeUndefined()
    expect(validateAdminSearch({ section: 'areas', days: 3 })).toEqual({
      section: undefined,
      days: undefined,
    })
  })

  it("reads Settings' own sections, and the old ones with their params so a link can move on", () => {
    expect(validateSettingsSearch({ section: 'connect' })).toEqual({ section: 'connect' })
    for (const section of retiredSettingsSections)
      expect(validateSettingsSearch({ section, setting: 'evals.tries' })).toEqual({
        section,
        setting: 'evals.tries',
      })
    expect(validateSettingsSearch({ section: 'gateway' }).section).toBeUndefined()
  })

  it('sends each old Settings section to where it went: Administration, or Editions to export', () => {
    expect(retiredSettingsSectionMoves).toEqual({
      areas: { section: 'domains' },
      limits: { section: 'limits' },
      roles: { section: 'people' },
      audit: { section: 'audit' },
      operations: { section: 'operations' },
      import: { section: 'import' },
      export: 'editions',
    })
  })

  it("keeps the old MCP and gateway page's tab and days, and Try it's old Connect tab", () => {
    expect(validateMcpSearch({ tab: 'tools' })).toEqual({ tab: 'tools' })
    expect(validateMcpSearch({ tab: 'activity', days: 90 })).toEqual({ tab: 'activity', days: 90 })
    expect(validateMcpSearch({ days: 5 })).toEqual({ days: undefined })
    expect(validateTryItSearch({ tab: 'connect' })).toEqual({ tab: 'connect' })
  })
})

describe('the docs home', () => {
  it('opens on a section the sidebar lists, and on every section for anything else', () => {
    expect(validateDocsSearch({ section: 'questions' })).toEqual({ section: 'questions' })
    expect(validateDocsSearch({})).toEqual({})
    expect(validateDocsSearch({ section: 'faq' })).toEqual({ section: undefined })
  })
})
