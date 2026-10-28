import { beforeAll, expect, it } from 'vitest'
import { foundation, version, accept, publish, people } from './fixtures.ts'
import { testDatabase, transaction } from './support.ts'

const { client } = testDatabase()
beforeAll(() => foundation(client))
const mention = (id: string, target = 'metric:orders', label = 'Orders', position = 0) =>
  client.query(
    "insert into item_version_mentions (version_id,field,position,term_key,label) values ($1,'summary',$4,$2,$3)",
    [id, target, label, position],
  )

it('M1 commits ordered summary/body mentions and serves them separately from scope', async () => {
  await transaction(client, async () => {
    const v = await version(client, {
      markup: '@[Orders](metric:orders)',
      body: 'Target',
      bodyMarkup: '@[Target](item:itm_target0001)',
    })
    await mention(v.id)
    await client.query(
      "insert into item_version_mentions (version_id,field,position,item_id,label) values ($1,'body',0,'itm_target0001','Target')",
      [v.id],
    )
    await accept(client, v.id)
    const seq = await publish(client, v.id)
    const links = await client.query(
      'select rel,to_id,label from serving_links($1) where from_item=$2 order by rel,to_id',
      [seq, v.item],
    )
    expect(links.rows).toEqual([
      { rel: 'applies_to', to_id: 'metric:orders', label: null },
      { rel: 'mentions', to_id: 'itm_target0001', label: 'Target' },
      { rel: 'mentions', to_id: 'metric:orders', label: 'Orders' },
    ])
  })
})
it('M2 refuses unknown vocabulary', async () => {
  await expect(
    transaction(client, async () => {
      const v = await version(client)
      await mention(v.id, 'metric:unknown')
    }),
  ).rejects.toMatchObject({ code: '23503' })
})
it.each([true, false])('M3 requires exactly one target (two=%s)', async (two) => {
  await expect(
    transaction(client, async () => {
      const v = await version(client)
      await client.query(
        "insert into item_version_mentions (version_id,field,position,term_key,area_id,label) values ($1,'summary',0,$2,$3,'Orders')",
        [v.id, two ? 'metric:orders' : null, two ? 'finance' : null],
      )
    }),
  ).rejects.toMatchObject({ code: '23514' })
})
it('M4 refuses text/markup disagreement', async () => {
  await expect(
    transaction(client, () => version(client, { markup: '@[Wrong](metric:orders)' })),
  ).rejects.toMatchObject({ code: '23514' })
})
it('M5 checks missing rows at COMMIT', async () => {
  await expect(
    transaction(client, () => version(client, { markup: '@[Orders](metric:orders)' })),
  ).rejects.toMatchObject({ code: '23514' })
})
it('M6 checks surplus rows at COMMIT', async () => {
  await expect(
    transaction(client, async () => {
      const v = await version(client)
      await mention(v.id)
    }),
  ).rejects.toMatchObject({ code: '23514' })
})
it('M7 refuses self mentions', async () => {
  await expect(
    transaction(client, async () => {
      const item = 'itm_self000001'
      const v = await version(client, { item, summary: 'Self', markup: `@[Self](item:${item})` })
      await client.query(
        "insert into item_version_mentions (version_id,field,position,item_id,label) values ($1,'summary',0,$2,'Self')",
        [v.id, item],
      )
    }),
  ).rejects.toThrow('mentions itself')
})
it('M8 does not treat a mention as scope', async () => {
  await expect(
    transaction(client, async () => {
      const v = await version(client, { markup: '@[Orders](metric:orders)', scope: false })
      await mention(v.id)
    }),
  ).rejects.toThrow('names no metric')
})
it.each([
  "update item_version_mentions set label='Changed'",
  'delete from item_version_mentions',
  'truncate item_version_mentions',
])('M9 refuses owner mutation: %s', async (sql) => {
  await expect(client.query(sql)).rejects.toMatchObject({ code: '23001' })
})
it.each([
  "delete from vocab_terms where key='metric:orders'",
  "delete from items where id='itm_target0001'",
])('M10 refuses target hard deletion: %s', async (sql) => {
  await expect(client.query(sql)).rejects.toMatchObject({ code: '23503' })
})
it('M11 refuses unknown item', async () => {
  await expect(
    transaction(client, async () => {
      const v = await version(client)
      await client.query(
        "insert into item_version_mentions (version_id,field,position,item_id,label) values ($1,'summary',0,'itm_unknown0001','Unknown')",
        [v.id],
      )
    }),
  ).rejects.toMatchObject({ code: '23503' })
})
it.each([
  { label: 'Different', position: 0 },
  { label: 'Orders', position: 1 },
])('matches labels and zero-based token positions: %o', async ({ label, position }) => {
  await expect(
    transaction(client, async () => {
      const v = await version(client, { markup: '@[Orders](metric:orders)' })
      await mention(v.id, 'metric:orders', label, position)
    }),
  ).rejects.toThrow('do not match')
})
it('refuses adding rows to a committed version', async () => {
  const v = await transaction(client, () => version(client))
  await expect(mention(v.id)).rejects.toMatchObject({ code: '23001' })
})
it('does not accept markup against a null body', async () => {
  await expect(
    transaction(client, () => version(client, { bodyMarkup: '@[Orders](metric:orders)' })),
  ).rejects.toMatchObject({ code: '23514' })
})
it('refuses metric group targets', async () => {
  await expect(
    transaction(client, async () => {
      const v = await version(client)
      await mention(v.id, 'group:payments')
    }),
  ).rejects.toMatchObject({ code: '23514' })
})
it('keeps escaped tokens literal and handles accents and adjacent mentions', async () => {
  const result = await client.query<{ plain: string }>('select cl_strip_mentions($1) as plain', [
    '\\@[literal](metric:x) @[Æøå](metric:orders)@[Cost (EUR)](area:finance)',
  ])
  expect(result.rows[0]!.plain).toBe('@[literal](metric:x) ÆøåCost (EUR)')
})
it('limits a version to 50 mentions across both fields', async () => {
  await expect(
    transaction(client, async () => {
      const v = await version(client, {
        summary: 'D'.repeat(51),
        markup: '@[D](metric:orders)'.repeat(51),
      })
      for (let i = 0; i < 51; i++) await mention(v.id, 'metric:orders', 'D', i)
    }),
  ).rejects.toThrow('at most 50')
})

it('matches the domain parser for escaped text and tokens stored at submit', async () => {
  const { parseMentions, serializeMentions } = await import('../../src/domain/mentions.ts')
  for (const prefix of Array.from({ length: 4 }, (_, n) => '\\'.repeat(n))) {
    const markup =
      prefix +
      serializeMentions([
        { kind: 'text', text: 'Literal @[x](metric:x) \\ ' },
        { kind: 'mention', target: 'metric:orders', label: 'Æøå (EUR)' },
        { kind: 'mention', target: 'area:finance', label: '[Finance' },
      ])
    const parsed = parseMentions(markup)
    const result = await client.query<{ parsed: { text: string; mentions: unknown[] } }>(
      'select cl_parse_mention_text($1) as parsed',
      [markup],
    )
    expect(result.rows[0]!.parsed).toEqual({ text: parsed.text, mentions: parsed.mentions })
  }
})

it('keeps a mention of a term written in Definitions by its id, linked as term:<id>', async () => {
  await transaction(client, async () => {
    const [term] = (
      await client.query<{ id: string }>(
        `insert into terms (name, meaning, area_id, created_by, updated_by)
         select 'Webshop', 'Orders placed on our site.', 'finance', id, id from people limit 1
         returning id::text`,
      )
    ).rows
    const v = await version(client, {
      summary: 'the webshop',
      markup: `@[the webshop](term:${term!.id})`,
    })
    await client.query(
      "insert into item_version_mentions (version_id,field,position,term_id,label) values ($1,'summary',0,$2,'the webshop')",
      [v.id, term!.id],
    )
    await accept(client, v.id)
    const seq = await publish(client, v.id)
    const links = await client.query(
      "select to_kind,to_id,label from serving_links($1) where from_item=$2 and rel='mentions'",
      [seq, v.item],
    )
    expect(links.rows).toEqual([
      { to_kind: 'term', to_id: `term:${term!.id}`, label: 'the webshop' },
    ])
    const status = () =>
      client.query<{ target_type: string; status: string }>(
        'select target_type,status from v_mention_status where version_id=$1',
        [v.id],
      )
    expect((await status()).rows).toEqual([{ target_type: 'term', status: 'current' }])
    await client.query("select set_config('cl.person_id',$1,true)", [people.owner])
    await client.query('update terms set deleted_at=now() where id=$1', [term!.id])
    expect((await status()).rows).toEqual([{ target_type: 'term', status: 'retired' }])
  })
})

it('refuses a mention of a term that is not one', async () => {
  await expect(
    transaction(client, async () => {
      const v = await version(client, {
        summary: 'nothing',
        markup: '@[nothing](term:0190a0a0-0000-7000-8000-000000000000)',
      })
      await client.query(
        "insert into item_version_mentions (version_id,field,position,term_id,label) values ($1,'summary',0,'0190a0a0-0000-7000-8000-000000000000','nothing')",
        [v.id],
      )
    }),
  ).rejects.toThrow(/foreign key/)
})
