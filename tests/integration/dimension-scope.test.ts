import { beforeAll, describe, expect, it } from 'vitest'
import { accept, foundation, publish, version } from './fixtures.ts'
import { testDatabase, transaction } from './support.ts'

/*
  A scope may name a dimension with any value ("market: any value", FR-126). The database holds
  the rule for every code path: only a dimension, never next to its own values, append-only, and
  scope on its own. The read models, the links, the overlap check (FR-109, FR-511) and topics
  (FR-604) carry it.
*/
const { client } = testDatabase()
beforeAll(async () => {
  await foundation(client)
  await client.query("insert into vocab_terms (key,kind) values ('dim:product','dimension')")
})

/** A version scoped to any market and nothing else. */
async function anyMarket() {
  const v = await version(client, { scope: false })
  await client.query("insert into item_version_dimensions values ($1,'dim:market')", [v.id])
  return v
}

describe('a dimension with any value in the database', () => {
  it('is scope on its own', async () => {
    const v = await transaction(client, anyMarket)
    const rows = await client.query('select * from item_version_dimensions where version_id=$1', [
      v.id,
    ])
    expect(rows.rows).toEqual([{ version_id: v.id, dimension_key: 'dim:market' }])
  })

  it('refuses a term that is not a dimension', async () => {
    for (const key of ['metric:orders', 'val:market/norway'])
      await expect(
        transaction(client, async () => {
          const v = await version(client)
          await client.query('insert into item_version_dimensions values ($1,$2)', [v.id, key])
        }),
      ).rejects.toThrow('is not a dimension')
  })

  it('refuses any value next to values of the same dimension, in either order', async () => {
    await expect(
      transaction(client, async () => {
        const v = await anyMarket()
        await client.query(
          "insert into item_version_dimension_values values ($1,'dim:market','val:market/norway')",
          [v.id],
        )
      }),
    ).rejects.toThrow('cannot also list its values')
    await expect(
      transaction(client, async () => {
        const v = await version(client)
        await client.query(
          "insert into item_version_dimension_values values ($1,'dim:market','val:market/norway')",
          [v.id],
        )
        await client.query("insert into item_version_dimensions values ($1,'dim:market')", [v.id])
      }),
    ).rejects.toThrow('cannot also list its values')
    // Another dimension with any value is fine.
    await transaction(client, async () => {
      const v = await version(client)
      await client.query(
        "insert into item_version_dimension_values values ($1,'dim:market','val:market/norway')",
        [v.id],
      )
      await client.query("insert into item_version_dimensions values ($1,'dim:product')", [v.id])
    })
  })

  it('never changes once written, and only in the transaction of its version', async () => {
    const v = await transaction(client, anyMarket)
    await expect(
      client.query("update item_version_dimensions set dimension_key='dim:product'"),
    ).rejects.toThrow()
    await expect(client.query('delete from item_version_dimensions')).rejects.toThrow()
    await expect(
      client.query("insert into item_version_dimensions values ($1,'dim:product')", [v.id]),
    ).rejects.toThrow('in the transaction that creates their version')
  })

  it('reaches the library, serving and the links once published', async () => {
    const v = await transaction(client, async () => {
      const v = await anyMarket()
      await accept(client, v.id)
      await publish(client, v.id)
      return v
    })
    const doc = await client.query<{ scope: unknown }>(
      "select doc->'scope' as scope from v_item_api where id=$1",
      [v.item],
    )
    expect(doc.rows[0]!.scope).toEqual({
      metrics: [],
      dimensions: ['market'],
      dimensionValues: [],
    })
    const served = await client.query<{ dimension_keys: string[] }>(
      'select dimension_keys from serving_items((select seq from live_edition)) where item_id=$1',
      [v.item],
    )
    expect(served.rows).toEqual([{ dimension_keys: ['dim:market'] }])
    const links = await client.query(
      "select rel,to_kind,to_id from v_version_links where version_id=$1 and rel='applies_to'",
      [v.id],
    )
    expect(links.rows).toEqual([{ rel: 'applies_to', to_kind: 'dimension', to_id: 'dim:market' }])
  })
})

describe('overlap (FR-109, FR-511)', () => {
  const draft = (scope: object, start = '2026-08-01', end: string | null = null) =>
    JSON.stringify({ scope, validity: { start, end } })
  const overlaps = async (a: string, b: string) =>
    (
      await client.query<{ overlap: boolean }>(
        'select cl_scopes_overlap($1::jsonb,$2::jsonb) as overlap',
        [a, b],
      )
    ).rows[0]!.overlap

  it('treats any value as overlapping every value of its dimension, and as scope', async () => {
    const any = draft({ metrics: [], dimensions: ['dim:market'], dimensionValues: [] })
    const norway = draft({
      metrics: ['metric:orders'],
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
    })
    const spain = draft({
      metrics: ['metric:orders'],
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/spain' }],
    })
    expect(await overlaps(any, norway)).toBe(true)
    expect(await overlaps(norway, any)).toBe(true)
    expect(await overlaps(norway, spain)).toBe(false)
    // Dates still keep scopes apart.
    expect(
      await overlaps(
        draft(
          { metrics: [], dimensions: ['dim:market'], dimensionValues: [] },
          '2025-01-01',
          '2025-02-01',
        ),
        norway,
      ),
    ).toBe(false)
    expect(await overlaps(draft({ metrics: [], dimensions: [], dimensionValues: [] }), any)).toBe(
      false,
    )
  })
})

describe('topics (FR-604)', () => {
  it('keeps the dimensions a question named without a value', async () => {
    const [row] = (
      await client.query<{ id: string }>(
        "select serving_report_gap('|metric:orders||2026-08|dim:market',null,'{metric:orders}','{}','{dim:market}','2026-08-01',null) as id",
      )
    ).rows
    expect(row!.id).toBeTruthy()
    const topic = await client.query(
      "select metric_keys, value_keys, dimension_keys from topics where key='|metric:orders||2026-08|dim:market'",
    )
    expect(topic.rows).toEqual([
      { metric_keys: ['metric:orders'], value_keys: [], dimension_keys: ['dim:market'] },
    ])
  })
})
