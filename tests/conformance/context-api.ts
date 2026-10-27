/**
 * The `ContextApi` conformance suite. The same tests run against the mock binding (tests/unit) and
 * against the http binding talking to the real service and PostgreSQL (tests/integration). Both
 * hold the same 1,500 generated items, so every expectation is worked out from the generator and
 * the two bindings must answer the same, apart from person ids (`per_maria` in the mock, a UUID
 * in the database).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { ContextItem } from '../../src/domain/item.ts'
import { mentionsInFields } from '../../src/domain/mentions.ts'
import { addDays, itemDisplayStatus, itemTrust, needsALook } from '../../src/domain/status.ts'
import { ITEMS_PAGE_MAX } from '../../src/contract/limits.ts'
import type { ContextApi, LibraryItem } from '../../src/web/api/client.ts'
import { generateItems, versionDays } from '../../src/web/mocks/items.ts'
import {
  DEMO_MODEL_URL,
  DEMO_READ_AT,
  DEMO_SOURCE_VERSION,
  demoDefinitions,
} from '../../src/web/mocks/cube-model.ts'
import {
  FIXTURE_TODAY,
  areas,
  currentUserId,
  people,
  vocabulary,
} from '../../src/web/mocks/reference-data.ts'

export type ConformanceOptions = {
  /** The binding's id for a fixture person, for example `per_maria`. */
  personId: (fixtureId: string) => string
}

const items = generateItems()
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en')
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** Sets are compared as sets: the database returns scope and references in key order. */
function normalized<T extends Partial<ContextItem>>(item: T): T {
  return {
    ...item,
    ...(item.references ? { references: [...item.references].sort() } : {}),
    ...(item.scope
      ? {
          scope: {
            metrics: [...item.scope.metrics].sort(),
            dimensions: [...item.scope.dimensions].sort(),
            dimensionValues: [...item.scope.dimensionValues].sort((a, b) =>
              `${a.dimension}/${a.value}`.localeCompare(`${b.dimension}/${b.value}`),
            ),
          },
        }
      : {}),
  }
}

const vocabularyNames = new Map<string, string>([
  ...vocabulary.metrics.map((m) => [`metric:${m.id}`, m.name] as const),
  ...vocabulary.dimensions.flatMap((d) => [
    [`dim:${d.id}`, d.name] as const,
    ...d.values.map((v) => [`val:${d.id}/${v.id}`, v.name] as const),
  ]),
])
const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
/** The index's chips: metrics, dimensions, then values, each by key, by their vocabulary names. */
const scopeChips = (scope: ContextItem['scope']) =>
  [
    ...scope.metrics.map((id) => `metric:${id}`).sort(byKey),
    ...scope.dimensions.map((id) => `dim:${id}`).sort(byKey),
    ...scope.dimensionValues.map((v) => `val:${v.dimension}/${v.value}`).sort(byKey),
  ].map((key) => vocabularyNames.get(key) ?? key)

const matches = (needle: string) => (item: ContextItem) =>
  item.title.toLowerCase().includes(needle) || item.summary.toLowerCase().includes(needle)

export function describeContextApi(
  name: string,
  getApi: () => ContextApi,
  { personId }: ConformanceOptions,
) {
  const api = () => getApi()
  const withPeople = <T extends { ownerId: string; proposerId: string }>(item: T): T => ({
    ...item,
    ownerId: personId(item.ownerId),
    proposerId: personId(item.proposerId),
  })
  // Groups are parked: the service serves every item to everyone. The mock keeps the fixture's
  // audience, so it is left out of the comparison.
  const comparable = (item: ContextItem) => {
    const { audience: _audience, ...rest } = normalized(item)
    return rest
  }

  describe(`ContextApi conformance: ${name}`, () => {
    // The first call builds the binding's world (the mock's 1,500 items); on a busy machine that
    // alone can pass a test's time limit, so it happens before the tests, with room of its own.
    beforeAll(() => api().listItems({ limit: 1 }), 60_000)

    it('pages the item list and reports the total', async () => {
      const page = await api().listItems({ limit: 10, offset: 10 })
      expect(page).toMatchObject({ total: items.length, limit: 10, offset: 10 })
      expect(page.rows).toHaveLength(10)
      const first = await api().listItems()
      expect(first).toMatchObject({ limit: 50, offset: 0 })
      expect(first.rows).toHaveLength(50)
      expect((await api().listItems({ offset: 5000 })).rows).toEqual([])
      await expect(api().listItems({ limit: ITEMS_PAGE_MAX + 1 })).rejects.toThrow()
      await expect(api().listItems({ limit: 0 })).rejects.toThrow()
      await expect(api().listItems({ offset: -1 })).rejects.toThrow()
    })

    it('filters by kind, area and what the text mentions', async () => {
      const page = await api().listItems({ kind: 'guide', areaId: 'area_sales', limit: 1000 })
      const expected = items.filter((i) => i.kind === 'guide' && i.areaId === 'area_sales')
      expect(page.total).toBe(expected.length)
      expect(page.rows.map((row) => row.id).sort()).toEqual(expected.map((i) => i.id).sort())

      const target = 'val:market/norway'
      const mentioning = items.filter((item) =>
        mentionsInFields(item).some((mention) => mention.target === target),
      )
      expect(mentioning.length).toBeGreaterThan(0)
      const mentions = await api().listItems({ mentions: target, limit: 1000 })
      expect(mentions.rows.map((row) => row.id).sort()).toEqual(mentioning.map((i) => i.id).sort())
      // Mentions are not scope: an item scoped to Norway that does not mention it is left out.
      expect(mentions.total).toBeLessThan(
        items.filter((i) => i.scope.dimensionValues.some((v) => v.value === 'norway')).length,
      )
    })

    it('lists issues, and asks an open issue whether it is still going on (FR-135)', async () => {
      const issues = items.filter((i) => i.kind === 'issue')
      expect(issues.length).toBeGreaterThan(0)
      const page = await api().listItems({ kind: 'issue', limit: 1000 })
      expect(page.rows.map((row) => row.id).sort()).toEqual(issues.map((i) => i.id).sort())
      expect(page.rows.map((row) => [row.validity.end === null, row.reviewQuestion])).toEqual(
        page.rows.map((row) => [
          row.validity.end === null,
          row.validity.end === null ? 'still_going_on' : 'still_correct',
        ]),
      )
      expect(page.rows.some((row) => row.reviewQuestion === 'still_going_on')).toBe(true)
      // Every other kind keeps the question it had, even without an end date.
      const others = await api().listItems({ kind: 'event', limit: 1000 })
      expect(others.rows.some((row) => row.validity.end === null)).toBe(true)
      expect(new Set(others.rows.map((row) => row.reviewQuestion))).toEqual(
        new Set(['still_correct']),
      )
    })

    it('searches title and summary without regard to case, and takes the words literally', async () => {
      const expected = items.filter(matches('norway')).length
      expect(expected).toBeGreaterThan(0)
      expect((await api().listItems({ q: 'norway' })).total).toBe(expected)
      expect((await api().listItems({ q: '  NORWAY ' })).total).toBe(expected)
      expect((await api().listItems({ q: 'tax rate' })).total).toBe(
        items.filter(matches('tax rate')).length,
      )
      // A wildcard character is a character, not a pattern.
      expect((await api().listItems({ q: '_' })).total).toBe(0)
      expect((await api().listItems({ q: '%' })).total).toBe(0)
    })

    it('sorts by update, title or start, breaking ties by id', async () => {
      const sorted = {
        updated: [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || byId(a, b)),
        title: [...items].sort((a, b) => a.title.localeCompare(b.title, 'en') || byId(a, b)),
        start: [...items].sort(
          (a, b) => b.validity.start.localeCompare(a.validity.start) || byId(a, b),
        ),
      }
      for (const sort of ['updated', 'title', 'start'] as const) {
        const page = await api().listItems({ sort, limit: 1000 })
        expect(
          page.rows.map((row) => row.id),
          sort,
        ).toEqual(sorted[sort].slice(0, 1000).map((item) => item.id))
      }
    })

    it('returns one item by id, and null for an unknown id', async () => {
      for (const item of [
        items[0]!,
        items.find((i) => i.bodyMarkup !== undefined)!,
        items.find((i) => i.status === 'retired')!,
      ]) {
        const read = await api().getItem(item.id)
        expect(read && comparable(read)).toEqual(comparable(withPeople(item)))
      }
      expect(await api().getItem('itm_missing0')).toBeNull()
    })

    it('serves the whole library as one light index with the server day', async () => {
      const index = await api().listLibrary()
      expect(index.today).toBe(FIXTURE_TODAY)
      expect(Number.isNaN(Date.parse(index.loadedAt))).toBe(false)
      expect(index.items).toHaveLength(items.length)
      const projection = (item: ContextItem): LibraryItem =>
        normalized({
          id: item.id,
          kind: item.kind,
          areaId: item.areaId,
          status: item.status,
          version: item.version,
          title: item.title,
          summary: item.summary,
          scope: item.scope,
          validity: item.validity,
          reviewDate: item.reviewDate,
          reviewQuestion: item.reviewQuestion,
          checkFlag: item.checkFlag,
          ownerId: personId(item.ownerId),
          proposerId: personId(item.proposerId),
          updatedAt: item.updatedAt,
          // The day of the current version's acceptance. The two demo histories name different
          // owners as the one who accepted it, so only that someone did is compared.
          lastChecked: { on: versionDays(item).at(-1)!.accepted, personId: 'someone' },
          trust: itemTrust(item, FIXTURE_TODAY),
          chips: scopeChips(item.scope),
          owners: [],
          opened: false,
        })
      for (const row of index.items) expect(row.lastChecked?.personId, row.id).toBeTruthy()
      const someone = (row: LibraryItem): LibraryItem => ({
        ...row,
        lastChecked: row.lastChecked && { ...row.lastChecked, personId: 'someone' },
      })
      expect(index.items.map((row) => normalized(someone(row)))).toEqual(
        [...items].sort(byId).map(projection),
      )
    })

    it('counts how much of the library is current, today as the index shows it', async () => {
      const freshness = await api().getLibraryFreshness({ weeks: 3 })
      expect(freshness.today).toBe(FIXTURE_TODAY)
      expect(freshness.days.map((entry) => entry.day)).toEqual([
        addDays(FIXTURE_TODAY, -14),
        addDays(FIXTURE_TODAY, -7),
        FIXTURE_TODAY,
      ])
      // Today's count is the index's: what applies (not retired, not ended) and has no look due.
      const applying = items
        .map((item) => itemDisplayStatus(item, FIXTURE_TODAY))
        .filter((status) => status !== 'retired' && status !== 'expired')
      expect(freshness.days.at(-1)).toEqual({
        day: FIXTURE_TODAY,
        applying: applying.length,
        current: applying.filter((status) => !needsALook(status)).length,
      })
      // Earlier days depend on when each binding's editions were sealed (the service's seed seals
      // them now; tests/integration/library-freshness.test.ts counts them back).
      for (const entry of freshness.days) expect(entry.current).toBeLessThanOrEqual(entry.applying)
      expect((await api().getLibraryFreshness()).days).toHaveLength(8)
      await expect(api().getLibraryFreshness({ weeks: 53 })).rejects.toThrow()
      await expect(api().getLibraryFreshness({ weeks: 0 })).rejects.toThrow()
    })

    it('tells the history of an item, newest first', async () => {
      for (const item of [
        items.find((i) => i.version === 1)!,
        items.find((i) => i.version > 2)!,
        items.find((i) => i.status === 'retired' && i.version > 1)!,
      ]) {
        const owner = personId(item.ownerId)
        const expected = versionDays(item).flatMap(({ version, proposed, accepted }) => [
          { version, event: 'proposed', date: proposed, personId: personId(item.proposerId) },
          { version, event: 'accepted', date: accepted, personId: owner },
        ])
        if (item.status === 'retired')
          expected.push({
            version: item.version,
            event: 'retired',
            date: item.updatedAt.slice(0, 10),
            personId: owner,
          })
        expect(await api().getItemHistory(item.id), item.id).toEqual(expected.reverse())
      }
      expect(await api().getItemHistory('itm_missing0')).toEqual([])
    })

    it('serves areas, people and vocabulary by name, and the signed-in person', async () => {
      // Owners given at the same moment may come in either order.
      expect(
        (await api().listAreas()).map((area) => ({
          ...area,
          ownerIds: area.ownerIds.toSorted(),
        })),
      ).toEqual(
        [...areas].sort(byName).map((area) => ({
          ...area,
          ownerIds: area.ownerIds.map(personId).sort(),
        })),
      )
      expect(await api().listPeople()).toEqual(
        [...people].sort(byName).map((person) => ({ ...person, id: personId(person.id) })),
      )
      expect(await api().getVocabulary()).toEqual({
        metrics: [...vocabulary.metrics].sort(byName),
        dimensions: [...vocabulary.dimensions].sort(byName).map((dimension) => ({
          ...dimension,
          values: [...dimension.values].sort(byName),
        })),
      })
      const session = await api().getSession()
      expect(session.person).toEqual({
        id: personId(currentUserId),
        name: 'Maria Lindqvist',
        initials: 'ML',
        permissions: { roles: [], assignments: [] },
      })
      expect(session.csrfToken).toEqual(expect.any(String))
    })

    it('lists what an item mentions and which items mention it', async () => {
      const source = items.find((item) => item.bodyMarkup?.includes('](item:'))!
      const links = await api().getItemLinks(source.id)
      const names = new Map<string, string>([
        ...vocabulary.metrics.map((m) => [`metric:${m.id}`, m.name] as const),
        ...vocabulary.dimensions.map((d) => [`dim:${d.id}`, d.name] as const),
        ...vocabulary.dimensions.flatMap((d) =>
          d.values.map((v) => [`val:${d.id}/${v.id}`, v.name] as const),
        ),
        ...items.map((i) => [`item:${i.id}`, i.title] as const),
        ...areas.map((a) => [`area:${a.id}`, a.name] as const),
      ])
      const types = {
        metric: 'metric',
        dim: 'dimension',
        val: 'dimension_value',
        item: 'item',
        area: 'area',
      } as const
      expect(links?.mentions).toEqual(
        mentionsInFields(source).map((mention) => {
          const prefix = mention.target.split(':')[0] as keyof typeof types
          const target = items.find((i) => `item:${i.id}` === mention.target)
          return {
            field: mention.field,
            position: mention.position,
            words: mention.label,
            target: {
              type: types[prefix],
              key: mention.target,
              name: names.get(mention.target),
              status: target?.status === 'retired' ? 'retired' : 'current',
            },
          }
        }),
      )

      const mentioned = mentionsInFields(source).find((m) => m.target.startsWith('item:'))!
      const targetId = mentioned.target.slice('item:'.length)
      const backlinks = await api().getItemLinks(targetId)
      const mentioning = items.filter((item) =>
        mentionsInFields(item).some((m) => m.target === mentioned.target),
      )
      expect(backlinks?.mentionedBy.total).toBe(mentioning.length)
      expect(backlinks?.mentionedBy.rows.map((row) => row.source.id).sort()).toEqual(
        mentioning
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || byId(a, b))
          .slice(0, 20)
          .map((item) => item.id)
          .sort(),
      )
      expect(backlinks?.mentionedBy.rows).toContainEqual({
        field: mentioned.field,
        position: mentioned.position,
        words: mentioned.label,
        source: { id: source.id, kind: source.kind, title: source.title, status: source.status },
      })
      expect((await api().listItems({ mentions: mentioned.target })).total).toBe(mentioning.length)
      expect(await api().getItemLinks('itm_missing0')).toBeNull()
    })

    describe('the scope picker (FR-107)', () => {
      const accepted = items.filter((item) => item.status === 'accepted')
      const usesOf = (dimension: string) =>
        accepted.filter(
          (item) =>
            item.scope.dimensions.includes(dimension) ||
            item.scope.dimensionValues.some((value) => value.dimension === dimension),
        ).length

      it('finds nothing for no words, and groups thousands of values with a count', async () => {
        expect(await api().searchScope({ q: '' })).toEqual({
          metrics: [],
          groups: [],
          nextCursor: null,
        })
        const spring = await api().searchScope({ q: 'spring', limit: 12 })
        expect(spring.metrics).toEqual([])
        expect(
          spring.groups.map((group) => [group.dimension.key, group.named, group.count]),
        ).toEqual([['dim:campaign', false, 240]])
        expect(spring.groups[0]!.values.length).toBeLessThanOrEqual(5)
        expect(spring.groups[0]!.dimension).toMatchObject({ kind: 'dimension', name: 'Campaign' })
      })

      it('offers a dimension by its name, counts how often it is used, and finds other names', async () => {
        const market = await api().searchScope({ q: 'market' })
        expect(market.groups[0]).toMatchObject({
          dimension: { key: 'dim:market', name: 'Market', uses: usesOf('market') },
          named: true,
          count: 12,
        })
        expect(market.metrics.map((hit) => hit.key)).toEqual(['metric:marketing_spend'])
        const other = await api().searchScope({ q: 'Norge' })
        expect(other.groups[0]!.values[0]).toMatchObject({
          key: 'val:market/norway',
          alias: 'Norge',
          dimension: { key: 'dim:market', name: 'Market' },
        })
      })

      it('pages through the values of one dimension', async () => {
        const first = await api().searchScope({ q: '', dimension: 'dim:campaign' })
        expect(first.groups[0]).toMatchObject({ count: 2400, named: true })
        expect(first.groups[0]!.values).toHaveLength(20)
        expect(first.nextCursor).toBe('20')
        const second = await api().searchScope({
          q: '',
          dimension: 'dim:campaign',
          cursor: first.nextCursor!,
        })
        expect(second.groups[0]!.values.map((hit) => hit.key)).not.toContain(
          first.groups[0]!.values[0]!.key,
        )
        const narrow = await api().searchScope({
          q: 'canada clearance 2025',
          dimension: 'dim:campaign',
        })
        expect(narrow.groups[0]!.values.map((hit) => hit.name).sort()).toEqual([
          'Canada Clearance 2025 Display',
          'Canada Clearance 2025 Email',
          'Canada Clearance 2025 Search',
          'Canada Clearance 2025 Social',
          'Canada Clearance 2025 Video',
        ])
        expect(narrow.nextCursor).toBeNull()
      })

      it('names the chips of a scope and leaves out a key no longer in use', async () => {
        const hits = await api().describeScope([
          'dim:market',
          'metric:gone_metric',
          'val:campaign/sweden_black_friday_2023_email',
        ])
        expect(hits.map((hit) => [hit.key, hit.name, hit.dimension?.name ?? null])).toEqual([
          ['dim:market', 'Market', null],
          [
            'val:campaign/sweden_black_friday_2023_email',
            'Sweden Black Friday 2023 Email',
            'Campaign',
          ],
        ])
      })
    })

    describe('the catalogue (FR-136)', () => {
      const accepted = items.filter((item) => item.status === 'accepted')
      const definition = (ref: string) => demoDefinitions.find((d) => d.ref === ref)!
      const mentioning = (key: string) =>
        items.filter((item) => mentionsInFields(item).some((m) => m.target === key)).length
      const source = {
        id: 'cube',
        name: 'Cube local model',
        tool: 'Cube',
        readAt: DEMO_READ_AT,
        sourceVersion: DEMO_SOURCE_VERSION,
        failing: false,
      }

      it('lists every metric and then every dimension by name, with the newest read', async () => {
        const catalogue = await api().listCatalogue()
        expect(catalogue.terms.map((term) => term.key)).toEqual([
          ...[...vocabulary.metrics].sort(byName).map((metric) => `metric:${metric.id}`),
          ...[...vocabulary.dimensions].sort(byName).map((dimension) => `dim:${dimension.id}`),
        ])
        expect(catalogue.sources).toEqual([source])
        expect(catalogue.today).toBe(FIXTURE_TODAY)
        // Only On-time shipping rate has no domain: its view has none, and the vocabulary none.
        expect(catalogue.coverage).toEqual({ metrics: vocabulary.metrics.length, withoutDomain: 1 })
      })

      it('joins the definition copy, the domain and the shelf of a metric', async () => {
        const terms = new Map((await api().listCatalogue()).terms.map((t) => [t.key, t]))
        const orders = terms.get('metric:orders')!
        const scoped = accepted.filter((item) => item.scope.metrics.includes('orders'))
        const statuses = scoped.map((item) => itemDisplayStatus(item, FIXTURE_TODAY))
        const stored = definition('cube:orders.orders')
        const depositsDefinition = {
          ref: stored.ref,
          name: 'orders.orders',
          title: stored.title,
          descriptionCopy: stored.descriptionCopy,
          valueType: 'number',
          state: 'current',
          renamedTo: null,
          changedAt: null,
          readAt: DEMO_READ_AT,
          sourceId: 'cube',
          tool: 'Cube',
        }
        expect(orders).toEqual({
          key: 'metric:orders',
          kind: 'metric',
          id: 'orders',
          name: 'Orders',
          aliases: [],
          group: { key: 'group:payments', name: 'Payments' },
          domain: { areaId: 'area_sales', source: 'source' },
          definition: depositsDefinition,
          definitions: [depositsDefinition],
          // The payment provider delay in Poland still applies on the fixture day.
          status: 'active_issues',
          shelf: {
            items: scoped.length,
            byKind: Object.fromEntries(
              (['note', 'event', 'guide', 'example', 'issue'] as const).map((kind) => [
                kind,
                scoped.filter((item) => item.kind === kind).length,
              ]),
            ),
            needsALook: statuses.filter((s) =>
              ['stale', 'needs_check', 'source_missing'].includes(s),
            ).length,
            activeIssues: 1,
            ended: statuses.filter((s) => s === 'expired').length,
            gaps: 0,
            mentionedBy: mentioning('metric:orders'),
            lastUpdated: scoped
              .map((item) => item.updatedAt)
              .sort()
              .at(-1),
          },
        })
        expect(orders.shelf.items).toBeGreaterThan(0)
        expect(orders.shelf.mentionedBy).toBe(
          (await api().listItems({ mentions: 'metric:orders' })).total,
        )
        // The vocabulary's area wins over the source; with neither there is no domain.
        expect(terms.get('metric:support_contacts')?.domain).toEqual({
          areaId: 'area_sales',
          source: 'vocabulary',
        })
        expect(terms.get('metric:on_time_shipping_rate')?.domain).toEqual({
          areaId: null,
          source: 'none',
        })
        expect(terms.get('metric:on_time_shipping_rate')?.definition?.descriptionCopy).toBeNull()
        expect(terms.get('metric:return_on_ad_spend')?.domain.areaId).toBe('area_paid_media')
        // Cube changed Repeat purchase rate after the first read, and items still carry the old mark.
        expect(terms.get('metric:repeat_purchase_rate')).toMatchObject({
          status: 'changed',
          definition: { state: 'changed', changedAt: DEMO_READ_AT },
        })
        expect(terms.get('metric:average_order_value')?.status).toBe('in_sync')
        // Nothing on the shelf names Channel yet.
        expect(terms.get('dim:channel')).toMatchObject({
          status: 'no_context',
          domain: { areaId: null, source: 'none' },
          shelf: { items: 0, mentionedBy: 0 },
        })
      })

      it('reads one term, a dimension with its values, and null for an unknown one', async () => {
        const list = (await api().listCatalogue()).terms
        const market = await api().getCatalogueTerm('dimension', 'market')
        const values = vocabulary.dimensions.find((d) => d.id === 'market')!.values
        expect(market).toEqual({
          ...list.find((term) => term.key === 'dim:market'),
          values: [...values].sort(byName).map((value) => ({
            key: `val:market/${value.id}`,
            id: value.id,
            name: value.name,
            aliases: value.aliases,
            items: accepted.filter((item) =>
              item.scope.dimensionValues.some(
                (v) => v.dimension === 'market' && v.value === value.id,
              ),
            ).length,
            mentionedBy: mentioning(`val:market/${value.id}`),
          })),
          source,
          // Market is in two views: the file of the first, which speaks for it.
          modelFile: {
            path: 'orders.yml',
            url: `${DEMO_MODEL_URL}/orders.yml`,
          },
          today: FIXTURE_TODAY,
        })
        // One dimension, many Cube names (CON-208): every view's member of its name, of no domain
        // because its views lie in different domains (CON-206).
        expect(market?.definitions.map((definition) => definition.name)).toEqual([
          'orders.market',
          'segments.market',
        ])
        expect(market?.domain).toEqual({ areaId: null, source: 'none' })
        expect(market?.values.find((value) => value.id === 'norway')?.aliases).toEqual(['Norge'])
        // A dimension's shelf holds the items about one of its values or about any value.
        expect(market?.shelf.items).toBe(
          accepted.filter(
            (item) =>
              item.scope.dimensions.includes('market') ||
              item.scope.dimensionValues.some((v) => v.dimension === 'market'),
          ).length,
        )
        // The model file's address is built from the `sources.cube_model_url` setting; nothing
        // is fetched from the Git host.
        expect(await api().getCatalogueTerm('metric', 'orders')).toEqual({
          ...list.find((term) => term.key === 'metric:orders'),
          values: [],
          source,
          modelFile: { path: 'orders.yml', url: `${DEMO_MODEL_URL}/orders.yml` },
          today: FIXTURE_TODAY,
        })
        expect(await api().getCatalogueTerm('metric', 'market')).toBeNull()
        expect(await api().getCatalogueTerm('dimension', 'orders')).toBeNull()
        expect(await api().getCatalogueTerm('metric', 'missing_metric')).toBeNull()
        await expect(api().getCatalogueTerm('metric', 'Orders!')).rejects.toThrow()
      })
    })
  })
}
