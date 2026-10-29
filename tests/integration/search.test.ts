import { describe, expect, it } from 'vitest'
import { SEARCH_GROUP_MAX } from '../../src/contract/index.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLibraryService } from '../../src/server/modules/library/index.ts'
import { generateItems } from '../../db/seed/fixtures/items.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  Search everywhere (GET /search, the command palette) on the 1,500 seeded items, as the
  application role reads them: a few of each group, a name that starts with the words first, and
  nothing a person may not read.
*/

const { client, url } = testDatabase({ seeded: true })

const search = async (q: string) => {
  const database = apiDatabase(url)
  try {
    return await database.transaction(null, (tx) =>
      createLibraryService(tx, systemClock('2026-10-07')).search(q),
    )
  } finally {
    await database.close()
  }
}

/** Runs `change` with the triggers that keep versions unchanged off, then puts it back. */
async function patched(change: string, undo: string, values: unknown[], run: () => Promise<void>) {
  await client.query('reset role')
  await client.query('alter table item_versions disable trigger user')
  await client.query(change, values)
  await client.query('alter table item_versions enable trigger user')
  try {
    await run()
  } finally {
    await client.query('alter table item_versions disable trigger user')
    await client.query(undo, values)
    await client.query('alter table item_versions enable trigger user')
  }
}

describe('search everywhere on PostgreSQL', () => {
  it('finds an item by a word of its title, or by part of one as people type', async () => {
    const item = generateItems().find((i) => i.title.split(' ').some((w) => w.length > 7))!
    const word = item.title
      .split(' ')
      .find((w) => w.length > 7)!
      .replace(/[^\p{L}\p{N}]/gu, '')
    const found = await search(word)
    expect(found.items.length).toBeGreaterThan(0)
    expect(found.items.length).toBeLessThanOrEqual(SEARCH_GROUP_MAX)
    const byTitle = await search(item.title)
    expect(byTitle.items[0]).toMatchObject({ id: item.id, title: item.title, kind: item.kind })
    const typed = await search(item.title.slice(0, -2))
    expect(typed.items.map((row) => row.id)).toContain(item.id)
  })

  it('keeps each group to a few, a name that starts with the words first', async () => {
    const found = await search('or')
    for (const group of [found.items, found.definitions, found.domains, found.people])
      expect(group.length).toBeLessThanOrEqual(SEARCH_GROUP_MAX)
    expect(found.definitions[0]).toMatchObject({
      key: 'metric:orders',
      kind: 'metric',
      name: 'Orders',
    })
    const markets = await search('Market')
    expect(markets.definitions[0]).toMatchObject({ key: 'dim:market', kind: 'dimension' })
  })

  it('finds a definition by another name, a domain and a person by part of the name', async () => {
    await client.query('reset role')
    const { rows } = await client.query<{ name: string }>(
      'select name from areas where archived_at is null order by name limit 1',
    )
    const domain = rows[0]!.name
    expect((await search(domain.slice(1, 4))).domains.map((d) => d.name)).toContain(domain)
    const people = (await search('Lindq')).people
    expect(people.map((p) => p.name)).toEqual(['Maria Lindqvist'])
    expect(people[0]!.id).not.toBe('')
    await client.query('alter table vocab_term_versions disable trigger user')
    await client.query(
      `update vocab_term_versions set aliases = '{Turnover}' where term_key = 'metric:net_revenue'`,
    )
    try {
      expect((await search('turnover')).definitions).toEqual([
        { key: 'metric:net_revenue', kind: 'metric', name: 'Net revenue', aliases: ['Turnover'] },
      ])
    } finally {
      await client.query(
        `update vocab_term_versions set aliases = '{}' where term_key = 'metric:net_revenue'`,
      )
      await client.query('alter table vocab_term_versions enable trigger user')
    }
  })

  it('leaves out an item a person may not read', async () => {
    const [item] = generateItems(1)
    await patched(
      "update item_versions set audience_groups = '{finance}' where item_id = $1",
      'update item_versions set audience_groups = null where item_id = $1',
      [item!.id],
      async () => {
        expect((await search(item!.title)).items.map((row) => row.id)).not.toContain(item!.id)
      },
    )
  })

  it('finds nothing for words that are only spaces', async () => {
    expect(await search('   ')).toEqual({ items: [], definitions: [], domains: [], people: [] })
  })
})
