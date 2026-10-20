import { beforeAll, describe, expect, it } from 'vitest'
import { itemDisplayStatus, lastValidDay, needsALook } from '@domain/status'
import { api } from '@/api'
import {
  columnSpecs,
  defaultColumns,
  fitColumns,
  ROW_BUTTON_WIDTH,
  SELECT_WIDTH,
  TITLE_MIN_WIDTH,
} from '@/components/library/columns'
import {
  aboutSummary,
  activeFilterCount,
  aboutChoices,
  aboutKeys,
  buildRows,
  daysFrom,
  filtersOf,
  formatDay,
  groupRows,
  needsALookCount,
  sortRows,
  sortStateOf,
  viewTotal,
  type LibraryRow,
  type LibraryViewer,
} from '@/lib/library'
import {
  filterChoicePatch,
  filterCounter,
  hiddenEndedIssues,
  searchIds,
  visibleRows,
  type FilterChoice,
} from '@/lib/library-search'
import type { LibrarySearch } from '@/lib/search-params'
import { listKey, listSearch, rememberCursor, rememberedCursor } from '@/lib/list-memory'
import { cn } from '@/lib/utils'
import { areas, currentUserId, people, vocabulary } from '@/mocks/reference-data'

/** The signed-in contributor, who looks after no domain. */
const reader: LibraryViewer = { personId: currentUserId, areaIds: [], maintains: false }

async function rows(): Promise<LibraryRow[]> {
  return buildRows(await api.listLibrary(), { areas, people, vocabulary })
}

// The mock binding builds its 1,500 fixtures on its first call; do that once, outside the tests'
// time, so a busy machine does not run the first test's five seconds out on it.
beforeAll(async () => {
  await api.listLibrary()
}, 30_000)

const base = {
  kind: 'note' as const,
  status: 'accepted' as const,
  validity: { start: '2026-01-01', end: null },
  reviewDate: '2026-12-01',
  checkFlag: null,
}

describe('item status', () => {
  const today = '2026-10-07'

  it('derives the status from the item and the date, most important first', () => {
    expect(itemDisplayStatus(base, today)).toBe('accepted')
    expect(itemDisplayStatus({ ...base, reviewDate: '2026-10-06' }, today)).toBe('stale')
    expect(itemDisplayStatus({ ...base, checkFlag: 'needs_check' }, today)).toBe('needs_check')
    expect(
      itemDisplayStatus({ ...base, reviewDate: '2020-01-01', checkFlag: 'source_missing' }, today),
    ).toBe('source_missing')
    expect(
      itemDisplayStatus({ ...base, validity: { start: '2026-01-01', end: '2026-10-07' } }, today),
    ).toBe('expired')
    expect(itemDisplayStatus({ ...base, status: 'retired', checkFlag: 'needs_check' }, today)).toBe(
      'retired',
    )
  })

  it('treats the stored end date as exclusive', () => {
    expect(lastValidDay('2027-01-01')).toBe('2026-12-31')
    expect(
      itemDisplayStatus({ ...base, validity: { start: '2026-01-01', end: '2026-10-08' } }, today),
    ).toBe('accepted')
  })

  it('counts re-check due, source changed and source missing as needing a look', () => {
    expect(needsALook('stale')).toBe(true)
    expect(needsALook('needs_check')).toBe(true)
    expect(needsALook('source_missing')).toBe(true)
    expect(needsALook('accepted')).toBe(false)
    expect(needsALook('expired')).toBe(false)
  })
})

describe('library rows', () => {
  it('resolves names and the inclusive last day', async () => {
    const all = await rows()
    expect(all).toHaveLength(1500)
    const ended = all.find((row) => row.validity.end !== null)
    expect(ended?.until).toBe(lastValidDay(ended?.validity.end ?? ''))
    expect(all.every((row) => row.areaName !== 'Unknown domain')).toBe(true)
    expect(all.every((row) => row.about.length > 0)).toBe(true)
  })

  it('leaves retired items out of every view unless asked for', async () => {
    const all = await rows()
    const listed = visibleRows(all, {}, reader)
    expect(listed.some((row) => row.displayStatus === 'retired')).toBe(false)
    const retired = visibleRows(all, { status: 'retired' }, reader)
    expect(retired.length).toBeGreaterThan(0)
    expect(retired.every((row) => row.displayStatus === 'retired')).toBe(true)
  })

  it('tucks ended issues out of the default view and keeps ended events (requirements 4.4)', async () => {
    const all = await rows()
    const listed = visibleRows(all, {}, reader)
    expect(listed.some((row) => row.kind === 'issue' && row.displayStatus === 'expired')).toBe(
      false,
    )
    expect(listed.some((row) => row.kind !== 'issue' && row.displayStatus === 'expired')).toBe(true)
    expect(listed.some((row) => row.displayStatus === 'active_issue')).toBe(true)
    expect(hiddenEndedIssues(all, {}, reader)).toBe(3)
    expect(hiddenEndedIssues(all, { kind: 'issue', q: 'France' }, reader)).toBe(1)

    // One click shows them: the Ended issues filter, or asking for the Ended status.
    const shown = visibleRows(all, { kind: 'issue', ended: 'show' }, reader)
    expect(shown.filter((row) => row.displayStatus === 'expired')).toHaveLength(3)
    expect(hiddenEndedIssues(all, { ended: 'show' }, reader)).toBe(0)
    const endedStatus = visibleRows(all, { kind: 'issue', status: 'expired' }, reader)
    expect(endedStatus).toHaveLength(3)
    expect(activeFilterCount({ kind: 'issue', ended: 'show' })).toBe(2)
  })

  it('shows mine and needs a look as views', async () => {
    const all = await rows()
    const mine = visibleRows(all, { view: 'mine' }, reader)
    expect(mine.length).toBeGreaterThan(0)
    expect(
      mine.every((row) => row.proposerId === currentUserId || row.ownerId === currentUserId),
    ).toBe(true)
    const attention = visibleRows(all, { view: 'attention' }, reader)
    expect(attention.length).toBeGreaterThan(0)
    expect(attention.length).toBeLessThan(all.length / 4)
    expect(attention.every((row) => needsALook(row.displayStatus))).toBe(true)
  })

  it('starts Needs a look with the domains an owner looks after, and widens it on request (A8)', async () => {
    const all = await rows()
    const owner: LibraryViewer = {
      personId: 'per_jon',
      areaIds: ['area_sales'],
      maintains: true,
    }
    const everyone = visibleRows(all, { view: 'attention' }, reader)
    const mine = visibleRows(all, { view: 'attention' }, owner)
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.length).toBeLessThan(everyone.length)
    expect(mine.every((row) => row.areaId === 'area_sales')).toBe(true)
    expect(visibleRows(all, { view: 'attention', domains: 'all' }, owner)).toEqual(everyone)
    // The other views do not narrow by domain.
    expect(visibleRows(all, {}, owner)).toEqual(visibleRows(all, {}, reader))
    expect(viewTotal(all, 'attention', filtersOf({}), owner)).toBe(mine.length)

    // The sidebar counts what the view opens with, and only for people who can act on it.
    expect(needsALookCount(all, owner)).toBe(mine.length)
    expect(needsALookCount(all, { ...reader, maintains: true })).toBe(everyone.length)
    expect(needsALookCount(all, reader)).toBeNull()
  })

  it('filters by kind, status, domain and what it is about', async () => {
    const all = await rows()
    const events = visibleRows(all, { kind: 'event,note' }, reader)
    expect(events.every((row) => row.kind === 'event' || row.kind === 'note')).toBe(true)
    const commercial = visibleRows(all, { area: 'area_sales' }, reader)
    expect(commercial.every((row) => row.areaId === 'area_sales')).toBe(true)
    const norway = visibleRows(all, { about: 'market:norway' }, reader)
    expect(norway.length).toBeGreaterThan(0)
    expect(norway.every((row) => row.about.includes('Norway'))).toBe(true)
    expect(activeFilterCount({ kind: 'event,note', area: 'area_sales', q: 'x' })).toBe(3)
  })

  it('searches titles, where it applies and owners, with prefixes and small typos', async () => {
    const all = await rows()
    const byTitle = searchIds(all, 'norway')
    expect(byTitle.length).toBeGreaterThan(0)
    expect(searchIds(all, 'norwy').slice(0, 5)).toEqual(byTitle.slice(0, 5))
    expect(searchIds(all, 'nor').length).toBeGreaterThanOrEqual(byTitle.length)
    const names = new Map(all.map((row) => [row.id, `${row.title} ${row.about.join(' ')}`]))
    expect(byTitle.every((id) => names.get(id)?.includes('Norway'))).toBe(true)
    const owner = all.find((row) => row.ownerName === 'Jon Abara')
    expect(searchIds(all, 'abara')).toContain(owner?.id)
    expect(searchIds(all, 'zzzzqqq')).toEqual([])
  })

  it('puts the best match first while searching, unless a sort is chosen', async () => {
    const all = await rows()
    expect(sortStateOf({ q: 'orders' })).toEqual({ sort: 'relevance' })
    expect(sortStateOf({ q: 'orders', sort: 'title' })).toEqual({ sort: 'title', dir: 'asc' })
    expect(sortStateOf({})).toEqual({ sort: 'updated', dir: 'desc' })
    const sorted = visibleRows(all, { q: 'orders', sort: 'title' }, reader)
    const titles = sorted.map((row) => row.title)
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)))
  })

  it('sorts ongoing items after dated ones by Until, and is stable', async () => {
    const all = await rows()
    const sorted = sortRows(all, { sort: 'until', dir: 'asc' })
    const firstOngoing = sorted.findIndex((row) => row.until === null)
    expect(sorted.slice(firstOngoing).every((row) => row.until === null)).toBe(true)
    expect(sortRows(all, { sort: 'until', dir: 'asc' })).toEqual(sorted)
  })

  it('groups rows under counted headers, and hides the rows of a collapsed group', async () => {
    const all = (await rows()).slice(0, 200)
    const entries = groupRows(all, 'kind')
    const headers = entries.filter((entry) => entry.type === 'group')
    expect(headers.map((header) => header.key)).toEqual(['note', 'event', 'guide', 'example'])
    expect(
      headers.reduce((sum, header) => sum + (header.type === 'group' ? header.count : 0), 0),
    ).toBe(200)
    const collapsed = groupRows(all, 'kind', new Set(['note']))
    expect(collapsed.length).toBe(
      entries.length - (headers[0]?.type === 'group' ? headers[0].count : 0),
    )
  })

  it('formats dates and the about summary as the contract shows them', () => {
    expect(formatDay('2026-12-31')).toBe('31 Dec 2026')
    expect(formatDay('2026-08-04', 'long')).toBe('4 August 2026')
    expect(aboutSummary(['Orders'])).toBe('Orders')
    expect(aboutSummary(['Orders', 'Norway', 'Clothing'])).toBe('Orders · Norway +1')
  })
})

describe('the action bar counts', () => {
  it('counts each Filter menu option as the list will be after the click, other filters and the search kept', async () => {
    const all = await rows()
    const after = (search: LibrarySearch, choice: FilterChoice) =>
      visibleRows(all, { ...search, ...filterChoicePatch(search, choice) }, reader).length
    const searches: LibrarySearch[] = [
      { q: 'orders' },
      { kind: 'event', q: 'orders' },
      { kind: 'event', status: 'accepted' },
      { kind: 'event,note', status: 'accepted,source_missing', area: 'area_sales' },
      { area: 'area_sales', ended: 'show' },
    ]
    const choices: FilterChoice[] = [
      { facet: 'kind', value: 'note' },
      { facet: 'kind', value: 'event' },
      { facet: 'status', value: 'accepted' },
      { facet: 'status', value: 'source_missing' },
      { facet: 'area', value: 'area_sales' },
      { facet: 'area', value: 'area_marketing' },
      { facet: 'about', value: 'orders' },
      { facet: 'about', value: 'market:norway' },
      { facet: 'ended' },
    ]
    for (const search of searches) {
      const count = filterCounter(all, search, reader)
      for (const choice of choices) expect(count(choice)).toBe(after(search, choice))
    }
  })

  it('toggles the value on a multi-select field and replaces the domain', () => {
    expect(filterChoicePatch({ kind: 'event' }, { facet: 'kind', value: 'note' })).toEqual({
      kind: 'event,note',
    })
    expect(filterChoicePatch({ kind: 'event,note' }, { facet: 'kind', value: 'note' })).toEqual({
      kind: 'event',
    })
    expect(filterChoicePatch({ kind: 'event' }, { facet: 'kind', value: 'event' })).toEqual({
      kind: undefined,
    })
    expect(
      filterChoicePatch({ status: 'accepted' }, { facet: 'status', value: 'retired' }),
    ).toEqual({ status: 'accepted,retired' })
    expect(filterChoicePatch({ area: 'area_a' }, { facet: 'area', value: 'area_b' })).toEqual({
      area: 'area_b',
    })
    expect(filterChoicePatch({ area: 'area_a' }, { facet: 'area', value: 'area_a' })).toEqual({
      area: undefined,
    })
    expect(filterChoicePatch({ about: 'a' }, { facet: 'about', value: 'b' })).toEqual({
      about: 'b',
    })
    expect(filterChoicePatch({ about: 'a' }, { facet: 'about', value: 'a' })).toEqual({
      about: undefined,
    })
    expect(filterChoicePatch({}, { facet: 'ended' })).toEqual({ ended: 'show' })
    expect(filterChoicePatch({ ended: 'show' }, { facet: 'ended' })).toEqual({ ended: undefined })
  })

  it('offers every metric and value the rows are about once, metrics first, each by name', async () => {
    const all = await rows()
    const choices = aboutChoices(all)
    const keys = new Set(all.flatMap((row) => aboutKeys(row.scope)))
    expect(choices.map((choice) => choice.key).sort()).toEqual([...keys].sort())
    const order = { metric: 0, dimension_value: 1, dimension: 2 }
    for (let index = 1; index < choices.length; index++) {
      const [a, b] = [choices[index - 1]!, choices[index]!]
      expect(
        order[a.kind] < order[b.kind] ||
          (a.kind === b.kind && a.name.localeCompare(b.name, 'en') <= 0),
      ).toBe(true)
    }
    const orders = choices.find((choice) => choice.key === 'orders')
    expect(orders).toMatchObject({ name: 'Orders', kind: 'metric' })
  })

  it('reads "57 of 1,404": the view before filters, never fewer than the list shows', async () => {
    const all = await rows()
    const plain = viewTotal(all, 'all', filtersOf({}), reader)
    expect(plain).toBe(visibleRows(all, {}, reader).length)
    // Filters that bring back ended issues or retired items raise the total with them.
    const wide = { status: 'expired,retired,accepted' }
    expect(viewTotal(all, 'all', filtersOf(wide), reader)).toBeGreaterThanOrEqual(
      visibleRows(all, wide, reader).length,
    )
    expect(viewTotal(all, 'all', filtersOf(wide), reader)).toBeGreaterThan(plain)
  })
})

describe('column budget (contract 8.1, direction A)', () => {
  const at = (container: number, gutter = 24) => fitColumns(defaultColumns, container, gutter)

  it('shows every default column from 1,164, and Title never goes below 440', () => {
    expect(at(1164).columns).toEqual(['domain', 'status', 'until', 'owner'])
    for (const container of [1440, 1184, 1164, 1100, 1044, 976, 900, 888]) {
      const fit = at(container)
      if (fit.narrow) continue
      const used =
        24 * 2 +
        SELECT_WIDTH +
        ROW_BUTTON_WIDTH +
        fit.columns.reduce((sum, id) => sum + columnSpecs[id].width, 0)
      expect(container - used, `title at ${container}`).toBeGreaterThanOrEqual(TITLE_MIN_WIDTH)
    }
  })

  it('drops Ends below 1,164, then Owner below 1,044; Domain and Status stay', () => {
    expect(at(1163).columns).toEqual(['domain', 'status', 'owner'])
    expect(at(1044).columns).toEqual(['domain', 'status', 'owner'])
    expect(at(1043).columns).toEqual(['domain', 'status'])
    // 1024 wide with the rail: Title, Domain and Status, and a 528 pixel title.
    expect(at(976).columns).toEqual(['domain', 'status'])
  })

  it('becomes the narrow row below 888', () => {
    expect(at(888).narrow).toBe(false)
    expect(at(887).narrow).toBe(true)
    expect(at(390, 16).narrow).toBe(true)
  })

  it('leaves the checkbox column out of the budget on a touch screen', () => {
    expect(fitColumns(defaultColumns, 1124, 24, { selectable: false }).columns).toEqual([
      'domain',
      'status',
      'until',
      'owner',
    ])
  })

  it('leaves Domain out when the list shows one domain, and optional columns go first', () => {
    expect(fitColumns(defaultColumns, 1300, 24, { oneDomain: true }).columns).not.toContain(
      'domain',
    )
    const fit = fitColumns([...defaultColumns, 'about', 'checked'], 1300, 24)
    expect(fit.dropped.slice(0, 2)).toEqual(['checked', 'about'])
  })

  it('beside a docked panel Domain leaves last, so the table keeps its checkboxes to 696', () => {
    const docked = (container: number) =>
      fitColumns(defaultColumns, container, 24, { docked: true })
    // 1,440 wide with the rail and a 480 panel: Title, Domain and Status.
    expect(docked(912).columns).toEqual(['domain', 'status'])
    expect(docked(855)).toEqual({
      columns: ['status'],
      narrow: false,
      dropped: ['until', 'owner', 'domain'],
    })
    // 1,224 wide, where the panel starts to dock: a 440 title and the status.
    expect(docked(696).narrow).toBe(false)
    expect(docked(695).narrow).toBe(true)
    // Without a panel Domain stays.
    expect(at(855).narrow).toBe(true)
  })
})

describe('days from today', () => {
  it('counts whole UTC days, negative once a date has passed', () => {
    expect(daysFrom('2026-10-07', '2026-10-07')).toBe(0)
    expect(daysFrom('2026-10-07', '2026-11-06')).toBe(30)
    expect(daysFrom('2026-10-07', '2026-10-04')).toBe(-3)
    // Across the end of summer time the count stays whole.
    expect(daysFrom('2026-10-20', '2026-11-02')).toBe(13)
  })
})

describe('list memory', () => {
  it('keys a list by its params and remembers the cursor per list', () => {
    expect(listKey({ view: 'mine', q: ' orders ' })).toBe(listKey({ view: 'mine', q: 'orders' }))
    expect(listKey({ view: 'mine' })).not.toBe(listKey({}))
    rememberCursor({ view: 'attention' }, 'itm_a')
    expect(rememberedCursor({ view: 'attention' })).toBe('itm_a')
    expect(rememberedCursor({})).toBeUndefined()
    expect(listSearch({ view: 'mine', q: '', kind: undefined })).toEqual({ view: 'mine' })
  })
})

describe('cn', () => {
  it('keeps a type role next to a text colour, and merges two roles', () => {
    expect(cn('text-caption', 'text-muted-foreground')).toBe('text-caption text-muted-foreground')
    expect(cn('text-caption', 'text-body')).toBe('text-body')
    expect(cn('shadow-raised', 'shadow-overlay')).toBe('shadow-overlay')
    expect(cn('z-sticky', 'z-overlay')).toBe('z-overlay')
  })
})
