import { describe, expect, it } from 'vitest'
import type { LibraryItem } from '../../src/contract/index.ts'
import { libraryItemSchema } from '../../src/contract/schemas.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLibraryService } from '../../src/server/modules/library/index.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  The library index (GET /library) reads v_item_index (0057), which builds the index's fields
  itself instead of picking them out of each item's whole document in v_item_api. The two must
  never drift apart: on the bulk seed, every entry is exactly the index's fields of the item's
  document, as the application role reads them. tests/integration/api.test.ts shows that an item
  for a group stays out of both.
*/

const { client, url } = testDatabase({ seeded: true })

describe('the library index on PostgreSQL', () => {
  it('is the index fields of every readable item document, ordered by id', async () => {
    const database = apiDatabase(url)
    try {
      const fields = Object.keys(libraryItemSchema.shape) as (keyof LibraryItem)[]
      const docs = await client.query<{ items: LibraryItem[] }>(
        `select coalesce(jsonb_agg(jsonb_build_object(${fields.map((field) => `'${field}', doc->'${field}'`).join(', ')})
           order by id collate "C"), '[]') as items from v_item_api where audience_groups is null`,
      )
      const index = await database.transaction(null, (tx) =>
        createLibraryService(tx, systemClock('2026-10-07')).getIndex(),
      )
      expect(index.items).toHaveLength(1500)
      // The seed has each shape the index can take, so the comparison covers all of them.
      expect(index.items.some((item) => item.checkFlag !== null)).toBe(true)
      expect(index.items.some((item) => item.status === 'retired')).toBe(true)
      expect(index.items.some((item) => item.scope.dimensions.length > 0)).toBe(true)
      expect(index.items.some((item) => item.reviewQuestion === 'still_going_on')).toBe(true)
      expect(index.items.some((item) => item.validity.end !== null)).toBe(true)
      expect(JSON.stringify(index.items)).toBe(JSON.stringify(docs.rows[0]!.items))
    } finally {
      await database.close()
    }
  })
})
