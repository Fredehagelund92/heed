import { describe, expect, it } from 'vitest'
import type { IndexedItem, LibraryItem } from '../../src/contract/index.ts'
import { indexedItemSchema } from '../../src/contract/schemas.ts'
import { itemTrust } from '../../src/domain/status.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLibraryService } from '../../src/server/modules/library/index.ts'
import { generateItems, versionDays } from '../../db/seed/fixtures/items.ts'
import { vocabulary } from '../../db/seed/fixtures/reference-data.ts'
import { accept, foundation, openEdition, people, servingEdition, version } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  The library index (GET /library) reads v_item_index (0057), which builds the index's fields
  itself instead of picking them out of each item's whole document in v_item_api. The two must
  never drift apart: on the bulk seed, every entry's item fields are exactly the index's fields of
  the item's document, as the application role reads them. What the list's columns read from
  them (when it was last checked, its trust today, its scope by name) is computed beside them.
*/

const today = '2026-10-07'

describe('the library index on PostgreSQL', () => {
  const { client, url } = testDatabase({ seeded: true })

  it('is the index fields of every readable item document, ordered by id', async () => {
    const database = apiDatabase(url)
    try {
      const fields = Object.keys(indexedItemSchema.shape) as (keyof IndexedItem)[]
      const docs = await client.query<{ items: IndexedItem[] }>(
        `select coalesce(jsonb_agg(jsonb_build_object(${fields.map((field) => `'${field}', doc->'${field}'`).join(', ')})
           order by id collate "C"), '[]') as items from v_item_api where audience_groups is null`,
      )
      const index = await database.transaction(null, (tx) =>
        createLibraryService(tx, systemClock(today)).getIndex(),
      )
      expect(index.items).toHaveLength(1500)
      // The seed has each shape the index can take, so the comparison covers all of them.
      expect(index.items.some((item) => item.checkFlag !== null)).toBe(true)
      expect(index.items.some((item) => item.status === 'retired')).toBe(true)
      expect(index.items.some((item) => item.scope.dimensions.length > 0)).toBe(true)
      expect(index.items.some((item) => item.reviewQuestion === 'still_going_on')).toBe(true)
      expect(index.items.some((item) => item.validity.end !== null)).toBe(true)
      const itemFields = (item: LibraryItem) =>
        Object.fromEntries(fields.map((field) => [field, item[field]]))
      expect(index.items.map(itemFields)).toEqual(docs.rows[0]!.items)
    } finally {
      await database.close()
    }
  })

  it('says each item’s trust by the rule the freshness counts, and its scope by name', async () => {
    const database = apiDatabase(url)
    try {
      const index = await database.transaction(null, (tx) =>
        createLibraryService(tx, systemClock(today)).getIndex(),
      )
      const generated = new Map(generateItems().map((item) => [item.id, item]))
      const names = new Map<string, string>([
        ...vocabulary.metrics.map((m) => [`metric:${m.id}`, m.name] as const),
        ...vocabulary.dimensions.flatMap((d) => [
          [`dim:${d.id}`, d.name] as const,
          ...d.values.map((v) => [`val:${d.id}/${v.id}`, v.name] as const),
        ]),
      ])
      const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
      for (const item of index.items) {
        expect(item.trust, item.id).toBe(itemTrust(generated.get(item.id)!, today))
        const keys = [
          ...item.scope.metrics.map((id) => `metric:${id}`).sort(byKey),
          ...item.scope.dimensions.map((id) => `dim:${id}`).sort(byKey),
          ...item.scope.dimensionValues.map((v) => `val:${v.dimension}/${v.value}`).sort(byKey),
        ]
        expect(item.chips, item.id).toEqual(keys.map((key) => names.get(key)))
        // The seed's history accepts every version on its day (versionDays).
        const accepted = versionDays(generated.get(item.id)!).at(-1)!.accepted
        expect(item.lastChecked?.on, item.id).toBe(accepted)
      }
      expect(new Set(index.items.map((item) => item.trust))).toEqual(
        new Set(['current', 'needs_check', 'ended']),
      )
    } finally {
      await database.close()
    }
  })
})

describe('when an item was last checked', () => {
  const { client, url } = testDatabase()

  it('is its version’s acceptance, which a recheck renews', async () => {
    await client.query('reset role')
    await foundation(client)
    const { item } = await transaction(client, () => servingEdition(client))
    const read = async () => {
      const database = apiDatabase(url)
      try {
        const index = await database.transaction(null, (tx) =>
          createLibraryService(tx, systemClock(today)).getIndex(),
        )
        return index.items.find((row) => row.id === item)!
      } finally {
        await database.close()
      }
    }
    const day = new Date().toISOString().slice(0, 10)
    const first = await read()
    expect(first.lastChecked).toEqual({ on: day, personId: people.owner })
    expect(first.chips).toEqual(['Orders'])
    expect(first.trust).toBe('current')

    // An administrator rechecks it: "checked, still correct" is a new accepted version.
    const { rows } = await client.query<{ id: string }>(
      'select version_id as id from v_item_list where id = $1',
      [item],
    )
    await transaction(client, async () => {
      const recheck = await version(client, {
        item,
        previous: rows[0]!.id,
        recheck: true,
        summary: 'Orders',
        body: 'Norway closed on 4 August.',
        owner: people.owner,
      })
      await accept(client, recheck.id, { actor: people.admin, capacity: 'administrator' })
      const edition = await openEdition(client)
      await client.query('select edition_serve_item_version($1,$2)', [edition, recheck.id])
      await client.query('select edition_seal($1)', [edition])
      await client.query('select edition_publish($1)', [edition])
    })
    expect((await read()).lastChecked).toEqual({ on: day, personId: people.admin })
  })
})
