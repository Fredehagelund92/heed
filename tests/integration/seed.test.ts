import { expect, it } from 'vitest'
import { generateItems } from '../../src/web/mocks/items.ts'
import { bulkSeed, seedPersonId } from '../../db/seed/bulk.ts'
import type { ContextItem } from '../../src/domain/item.ts'
import { editionExportSchema } from '../../src/contract/admin.ts'
import { verifyEditionExport } from '../../src/domain/edition-export.ts'
import { exportEdition } from '../../src/server/modules/admin/index.ts'
import { rollbackTo } from '../../src/server/modules/editions/release.ts'
import { areas } from '../../src/web/mocks/reference-data.ts'
import { apiDatabase, testDatabase } from './support.ts'
const { client, url } = testDatabase()
// A 1,500-item load and roundtrip: generous, because a busy machine can take a few minutes.
it('roundtrips 1500 fixture items through the API read model', { timeout: 300_000 }, async () => {
  const items = generateItems(1500)
  await client.query('reset role')
  await expect(bulkSeed(client, [{ ...items[0]!, areaId: 'missing_area' }])).rejects.toMatchObject({
    code: '23503',
  })
  expect((await client.query('select id from items')).rows).toEqual([])
  expect(await bulkSeed(client, items)).toBe(1500)
  const result = await client.query<{ doc: ContextItem }>('select doc from v_item_api order by id')
  const normalize = (item: ContextItem) => ({
    ...item,
    scope: {
      ...item.scope,
      metrics: [...new Set(item.scope.metrics)].sort(),
      dimensions: [...item.scope.dimensions].sort(),
      dimensionValues: [...item.scope.dimensionValues].sort((a, b) =>
        `${a.dimension}/${a.value}`.localeCompare(`${b.dimension}/${b.value}`),
      ),
    },
    references: [...new Set(item.references)].sort(),
    audience: { kind: 'everyone' },
    proposerId: item.proposerId === null ? null : seedPersonId(item.proposerId),
    ownerId: seedPersonId(item.ownerId),
  })
  const byId = new Map(result.rows.map((row) => [row.doc.id, row.doc]))
  expect(byId.size).toBe(1500)
  for (const item of items) expect(byId.get(item.id), item.id).toEqual(normalize(item))
  expect(
    (
      await client.query<{ n: number }>(
        'select count(*)::int as n from editions where digest <> edition_content_digest(seq) or sealed_at is null',
      )
    ).rows[0]!.n,
  ).toBe(0)
  await expect(bulkSeed(client, items)).rejects.toThrow('empty Heed database')
  await expect(client.query("update item_versions set title='Changed'")).rejects.toMatchObject({
    code: '23001',
  })
})
it('exports the seeded live edition in the published item format with its sealed digest', async () => {
  const database = apiDatabase(url)
  try {
    const [{ label, served }] = (
      await client.query<{ label: string; served: number }>(
        `select e.label,(select count(*)::int from item_version_service s where s.editions @> e.seq) as served
         from editions e where e.seq=(select seq from live_edition)`,
      )
    ).rows as [{ label: string; served: number }]
    const document = await database.transaction(null, (tx) => exportEdition(tx, label))
    expect(editionExportSchema.safeParse(document).error).toBeUndefined()
    expect(document.items.length + document.withheld.length).toBe(served)
    // Seeded digests come from the stored content, so every one of them recomputes offline.
    expect(await verifyEditionExport(document)).toEqual({
      edition: true,
      items: [],
      vocabulary: [],
    })
  } finally {
    await database.close()
  }
})
// The newest sealed edition that serves a version no longer in service: going back serves it again.
const servesAnEarlierVersion = async () =>
  (
    await client.query<{ label: string; digest: string }>(
      `select e.label,encode(e.digest,'hex') as digest
         from editions e join item_version_service t on t.editions @> e.seq
        where e.sealed_at is not null and not exists (select 1 from item_version_service s
          where s.item_id=t.item_id and s.version_id=t.version_id and upper_inf(s.editions))
        order by e.seq desc,t.version_id limit 1`,
    )
  ).rows[0]!
const administrator = seedPersonId('per_ravi')
it('seeds the review history every served version needs, so going back works (F8)', async () => {
  expect(
    (
      await client.query<{ n: number }>(
        'select count(*)::int as n from item_versions v where cl_item_version_problem(v.id) is not null',
      )
    ).rows[0]!.n,
  ).toBe(0)
  // The roles that accepted part of that history have ended: today's roster is the mock's.
  const owners = await client.query<{ area: string; n: number }>(
    "select area_id as area, count(*)::int as n from area_assignments where role='owner' and valid_at @> now() group by 1 order by 1",
  )
  expect(owners.rows).toEqual(
    areas
      .filter((a) => a.ownerIds.length)
      .map((a) => ({ area: a.id, n: a.ownerIds.length }))
      .sort((a, b) => a.area.localeCompare(b.area)),
  )
  const target = await servesAnEarlierVersion()
  const database = apiDatabase(url)
  try {
    const restored = await database.transaction(administrator, (tx) =>
      rollbackTo(tx, target.label, 'Back to an edition that served an earlier version.'),
    )
    expect(restored).toMatchObject({
      reason: 'rollback',
      restores: target.label,
      digest: target.digest,
      live: true,
    })
  } finally {
    await database.close()
  }
})
it('refuses bulk loading through the migrator role', async () => {
  await client.query('set role context_layer_owner')
  await expect(bulkSeed(client, [])).rejects.toThrow('requires a superuser')
})
