import { describe, expect, it } from 'vitest'
import type { ItemChange, ItemPage, ItemVersionEntry } from '@contract/context'
import type { TermVersion } from '@contract/terms'
import type { Vocabulary } from '@domain/item'
import {
  dayShiftOf,
  draftOf,
  factOfDraft,
  factOfPage,
  historyOf,
  itemPageOf,
  logOf,
  serviceDay,
  termHistoryOf,
  textFromService,
  textToService,
  versionAt,
  wordsOf,
} from '@/api/http-context'
import type { Names } from '@/api/http-map'
import type { Fact } from '@/model/items'

const vocabulary: Vocabulary = {
  metrics: [
    { id: 'orders', name: 'Orders', group: 'Sales' },
    { id: 'gross_sales', name: 'Gross sales', group: 'Sales' },
  ],
  dimensions: [
    {
      id: 'market',
      name: 'Market',
      values: [
        { id: 'norway', name: 'Norway', aliases: [] },
        { id: 'spain', name: 'Spain', aliases: [] },
      ],
    },
  ],
}
const words = wordsOf(vocabulary)

const names: Names = {
  person: (id) =>
    ({ per_jon: 'Jon Abara', per_sofia: 'Sofia Brandt', per_ines: 'Ines Duarte' })[id] ?? 'Someone',
  domainOwners: (areaId) => (areaId === 'area_sales' ? ['Jon Abara', 'Sofia Brandt'] : []),
}

describe('the words a scope and a mention name', () => {
  it('names a metric, a dimension and a value by key, and finds each key by its name', () => {
    expect(words.keyOf('Orders')).toEqual({ kind: 'metric', key: 'metric:orders' })
    expect(words.keyOf('market')).toEqual({ kind: 'dim', key: 'dim:market' })
    expect(words.keyOf('Norway')).toEqual({ kind: 'val', key: 'val:market/norway' })
    expect(words.keyOf('Sales')).toBeUndefined()
    expect(words.nameOf('metric:gross_sales')).toBe('Gross sales')
    expect(words.nameOf('val:market/spain')).toBe('Spain')
    // A key the vocabulary no longer has reads as its id.
    expect(words.nameOf('metric:returns')).toBe('returns')
  })
})

describe('mentions, both ways', () => {
  const app =
    'Compare [@ id="metric:Orders" label="Orders"] in [@ id="market:Norway" label="Norway"] with ' +
    '[@ id="context:itm_za26xpzv" label="the regulator pause"] for [@ id="domain:area_sales" label="Sales"].'
  const service =
    'Compare @[Orders](metric:orders) in @[Norway](val:market/norway) with ' +
    '@[the regulator pause](item:itm_za26xpzv) for @[Sales](area:area_sales).'

  it("writes the app's tokens as the service's markup, with the words agents read", () => {
    expect(textToService(app, words)).toEqual({
      plain: 'Compare Orders in Norway with the regulator pause for Sales.',
      markup: service,
    })
  })

  it("reads the service's markup as the app's tokens", () => {
    expect(textFromService(service, words)).toBe(app)
  })

  it('keeps a mention the service cannot follow as its words, and leaves plain text as it is', () => {
    expect(
      textToService(
        'A [@ id="term:Webshop" label="Webshop"] order by [@ id="person:Jon Abara" label="Jon"].',
        words,
      ),
    ).toEqual({ plain: 'A Webshop order by Jon.' })
    expect(textToService('Orders fell 4% @ the till.', words)).toEqual({
      plain: 'Orders fell 4% @ the till.',
    })
  })

  it("escapes an @ in the words beside a mention, so the service's markup reads them back", () => {
    const written = textToService('Mail @ the desk: [@ id="metric:Orders" label="Orders"]', words)
    expect(written.markup).toBe('Mail \\@ the desk: @[Orders](metric:orders)')
    expect(textFromService(written.markup!, words)).toBe(
      'Mail @ the desk: [@ id="metric:Orders" label="Orders"]',
    )
  })
})

describe("the service's day", () => {
  it("counts the days from the clock's day to the service's today, and dates a time by them", () => {
    const shift = dayShiftOf({ today: '2026-10-23', loadedAt: '2026-10-27T10:00:00.000Z' })
    expect(shift).toBe(-4)
    expect(serviceDay('2026-10-27T15:30:00Z', shift)).toBe('2026-10-23')
    expect(dayShiftOf({ today: '2026-10-27', loadedAt: '2026-10-27T23:59:00.000Z' })).toBe(0)
  })
})

const entry = (e: Partial<ItemVersionEntry>): ItemVersionEntry => ({
  version: 1,
  kind: 'published',
  personId: 'per_jon',
  on: '2026-09-01',
  field: '',
  before: '',
  after: '',
  restorable: true,
  ...e,
})

const page = (patch: Partial<ItemPage['item']> = {}, extra: Partial<ItemPage> = {}): ItemPage => ({
  item: {
    id: 'itm_norway_stop',
    kind: 'event',
    areaId: 'area_sales',
    status: 'accepted',
    version: 2,
    title: 'Online sales to Norway stopped',
    summary: 'Orders in Norway fell to nothing.',
    summaryMarkup: '@[Orders](metric:orders) in Norway fell to nothing.',
    body: 'Parcels on their way arrived.',
    references: [],
    scope: { metrics: ['orders'], dimensions: [], dimensionValues: [] },
    validity: { start: '2026-08-04', end: '2026-08-11' },
    reviewDate: null,
    reviewQuestion: 'still_correct',
    evidence: [
      { url: 'https://customs.example/norway', quote: 'Online sales stop.', date: '2026-08-04' },
    ],
    checkFlag: null,
    claimLevel: 'fact_only',
    riskLevel: 'normal',
    notToConclude: "Don't read the drop as demand.",
    audience: { kind: 'everyone' },
    ownerId: 'per_jon',
    changeMarks: {},
    createdVia: 'form',
    proposerId: 'per_ines',
    createdAt: '2026-08-04T08:00:00Z',
    updatedAt: '2026-08-05T08:00:00Z',
    ...patch,
  },
  lastChecked: { on: '2026-10-02', personId: 'per_sofia' },
  trust: 'current',
  chips: ['Orders', 'Norway'],
  owners: [],
  history: [
    entry({ version: 2, kind: 'wording', field: 'Text', before: 'Old.', after: 'New.' }),
    entry({ version: 1 }),
  ],
  canChange: true,
  ...extra,
})

describe("a context item's page", () => {
  it('reads the item with its text, its mentions, where it comes from and its dates', () => {
    expect(factOfPage(page(), names, words)).toEqual({
      id: 'itm_norway_stop',
      title: 'Online sales to Norway stopped',
      summary: '[@ id="metric:Orders" label="Orders"] in Norway fell to nothing.',
      body: 'Parcels on their way arrived.',
      domain: 'area_sales',
      kind: 'event',
      where: ['Orders', 'Norway'],
      // The service's end is the first day it no longer applies.
      valid: { from: '2026-08-04', until: '2026-08-10' },
      when: '4 to 10 Aug 2026',
      status: 'Live',
      checkedBy: 'Sofia Brandt',
      checkedOn: '2 Oct 2026',
      source: 'https://customs.example/norway',
      quote: 'Online sales stop.',
      dontConclude: "Don't read the drop as demand.",
    })
  })

  it('names its own owners only when they are not its domain’s, and its trust as its status', () => {
    const own = factOfPage(page({}, { owners: ['per_ines'], trust: 'needs_check' }), names, words)
    expect(own).toMatchObject({ owners: ['Ines Duarte'], status: 'Needs checking' })
    const domain = factOfPage(page({}, { owners: ['per_jon', 'per_sofia'] }), names, words)
    expect(domain?.owners).toBeUndefined()
    expect(factOfPage(page({ status: 'retired' }), names, words)?.status).toBe('Archived')
  })

  it('leaves out an item of the kind the app does not offer', () => {
    expect(factOfPage(page({ kind: 'example' }), names, words)).toBeNull()
    expect(itemPageOf(page({ kind: 'example' }), names, words, 0)).toBeNull()
  })
})

describe("an item's history", () => {
  const entries = [
    entry({
      version: null,
      kind: 'owners',
      after: 'Ines Duarte added as an owner.',
      restorable: false,
    }),
    entry({
      version: 3,
      kind: 'checked',
      personId: 'per_sofia',
      on: '2026-10-27',
      restorable: false,
    }),
    entry({
      version: 2,
      kind: 'moved',
      field: 'Domain',
      before: 'Marketing',
      after: 'Sales',
      restorable: false,
    }),
    entry({ version: 1, personId: null }),
  ]

  it('numbers every row newest first, in the words the list reads, on the service’s day', () => {
    const history = historyOf(entries, names, -4)
    expect(history.map((v) => v.v)).toEqual([4, 3, 2, 1])
    expect(history[0]).toMatchObject({ kind: 'owners', summary: 'Ines Duarte added as an owner.' })
    expect(history[1]).toMatchObject({
      who: 'Sofia Brandt',
      on: '2026-10-23',
      summary: 'Checked against the source: still true.',
    })
    expect(history[2]).toMatchObject({ summary: 'Moved from Marketing to Sales.', field: 'Domain' })
    expect(history[3]).toMatchObject({ who: 'Someone', summary: 'Published.' })
  })

  it('names the text as people do, and finds the version a row restores', () => {
    const [wording] = historyOf(
      [entry({ version: 2, kind: 'wording', field: 'Text', before: 'a', after: 'b' })],
      names,
      0,
    )
    expect(wording).toMatchObject({
      field: 'What agents should know',
      summary: 'Reworded what agents should know.',
    })
    expect(versionAt(entries, 2)).toBe(2)
    expect(versionAt(entries, 1)).toBe(1)
    // An owners change made no version of its own.
    expect(versionAt(entries, 4)).toBeNull()
    expect(versionAt(entries, 9)).toBeNull()
  })
})

describe("a term's history", () => {
  const version = (v: Partial<TermVersion>): TermVersion => ({
    revision: 1,
    change: 'created',
    name: 'Webshop',
    meaning: 'Orders placed online.',
    sameAs: null,
    areaId: 'area_sales',
    personId: 'per_ines',
    at: '2026-07-02T09:00:00Z',
    ...v,
  })

  it('lists each write newest first, with what the meaning was before it', () => {
    const history = termHistoryOf(
      [
        version({}),
        version({ revision: 2, change: 'edited', meaning: 'Orders placed on the webshop.' }),
        version({ revision: 3, change: 'edited', name: 'Web shop', personId: 'per_jon' }),
      ],
      names.person,
      0,
    )
    expect(history.map((v) => [v.v, v.kind, v.who, v.summary])).toEqual([
      [3, 'wording', 'Jon Abara', 'Renamed from Webshop.'],
      [2, 'wording', 'Ines Duarte', 'Reworded.'],
      [1, 'published', 'Ines Duarte', 'Written.'],
    ])
    expect(history[1]).toMatchObject({
      before: 'Orders placed online.',
      after: 'Orders placed on the webshop.',
      on: '2026-07-02',
    })
  })

  it('says what a synonym meant', () => {
    const [synonym] = termHistoryOf(
      [version({ name: 'GMV', meaning: null, sameAs: 'Gross sales' })],
      names.person,
      0,
    )
    expect(synonym?.after).toBe('Another name for Gross sales')
  })
})

describe('the History log of changes to many items', () => {
  const change = (c: Partial<ItemChange>): ItemChange => ({
    id: 'chg_1',
    action: 'archived',
    personId: 'per_jon',
    at: '2026-10-27T09:00:00Z',
    summary: 'Archived “Orders lag” and 1 more.',
    items: [{ id: 'itm_lag_one_day', title: 'Orders lag', areaId: 'area_sales' }],
    withheld: 0,
    undone: false,
    ...c,
  })

  it('lists what is still in force, by who made it, on the service’s day', () => {
    expect(logOf([change({}), change({ id: 'chg_2', undone: true })], names, -4)).toEqual([
      {
        id: 'chg_1',
        on: '2026-10-23',
        who: 'Jon Abara',
        what: 'archived',
        summary: 'Archived “Orders lag” and 1 more.',
        items: [{ id: 'itm_lag_one_day', title: 'Orders lag', domain: 'area_sales' }],
      },
    ])
  })
})

describe('a draft, as the Context list and its page read it', () => {
  it('reads what the draft has so far, by who started it', () => {
    const fact = factOfDraft(
      {
        id: '01a17d1c-0000-7000-8000-000000000001',
        title: 'Black Friday',
        areaId: 'area_sales',
        proposerId: 'per_jon',
        draft: {
          kind: 'event',
          title: 'Black Friday 2026 orders land in two weeks',
          summary: 'Its weekend orders land in week 48.',
          scope: {
            metrics: ['metric:orders'],
            dimensions: [],
            dimensionValues: [{ dimension: 'dim:market', value: 'val:market/spain' }],
          },
          validity: { start: '2026-11-27', end: '2026-12-01' },
        },
      },
      names,
      words,
    )
    expect(fact).toMatchObject({
      title: 'Black Friday 2026 orders land in two weeks',
      domain: 'area_sales',
      kind: 'event',
      status: 'Draft',
      by: 'Jon Abara',
      where: ['Orders', 'Spain'],
      valid: { from: '2026-11-27', until: '2026-11-30' },
      source: '',
      dontConclude: '',
    })
  })

  it('names an untitled draft so, and starts it as a Rule', () => {
    const fact = factOfDraft(
      { id: 'x', title: '', areaId: null, proposerId: 'per_ines', draft: {} },
      names,
      words,
    )
    expect(fact).toMatchObject({ title: 'Untitled draft', kind: 'note', where: [], domain: '' })
  })
})

describe("the editor's item, as the draft the service publishes", () => {
  const before: Fact = factOfPage(page(), names, words)!

  it('names only what an edit changes', () => {
    expect(
      draftOf(
        { ...before, title: 'Online sales to Norway stopped in August' },
        words,
        '2026-10-23',
        before,
      ),
    ).toEqual({
      title: 'Online sales to Norway stopped in August',
    })
    expect(
      draftOf(
        { ...before, valid: { from: '2026-08-04', until: '2026-08-12' } },
        words,
        '2026-10-23',
        before,
      ),
    ).toEqual({ validity: { start: '2026-08-04', end: '2026-08-13' } })
    expect(draftOf({ ...before, quote: 'A new sentence.' }, words, '2026-10-23', before)).toEqual({
      evidence: [
        { url: 'https://customs.example/norway', quote: 'A new sentence.', date: '2026-10-23' },
      ],
    })
  })

  it('sends the default line when the what-not-to-conclude line is cleared', () => {
    const cautious = { ...before, dontConclude: 'Do not read this as a trend.' }
    expect(draftOf({ ...cautious, dontConclude: '' }, words, '2026-10-23', cautious)).toEqual({
      notToConclude: 'cause not proven',
    })
  })

  it('writes the whole of a new item: its scope by key and its text with its mentions', () => {
    const draft = draftOf(
      {
        ...before,
        id: 'draft',
        summary: '[@ id="metric:Orders" label="Orders"] fell.',
        body: undefined,
        where: ['Orders', 'Market', 'Spain', 'Sales'],
        valid: { from: '2026-10-14' },
      },
      words,
      '2026-10-23',
    )
    expect(draft).toMatchObject({
      areaId: 'area_sales',
      kind: 'event',
      summary: 'Orders fell.',
      summaryMarkup: '@[Orders](metric:orders) fell.',
      body: '',
      scope: {
        metrics: ['metric:orders'],
        dimensions: ['dim:market'],
        dimensionValues: [{ dimension: 'dim:market', value: 'val:market/spain' }],
      },
      validity: { start: '2026-10-14', end: null },
      notToConclude: "Don't read the drop as demand.",
    })
  })
})
