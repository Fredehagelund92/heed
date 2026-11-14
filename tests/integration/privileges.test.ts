import pg from 'pg'
import { beforeAll, describe, expect, it } from 'vitest'
import { localRoles, identifier } from '../../src/server/db/roles.ts'
import { accept, foundation, people, publish, version } from './fixtures.ts'
import { testDatabase, transaction } from './support.ts'

const { client, url } = testDatabase()
let draft: string
let accepted: string
const children = [
  'item_version_metrics',
  'item_version_dimension_values',
  'item_version_evidence',
  'item_version_refs',
  'item_version_replaces',
  'item_version_conflicts',
  'item_version_mentions',
]
beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    for (const live of [false, true]) {
      const v = await version(client, { markup: '@[Orders](metric:orders)' })
      await client.query(
        "insert into item_version_dimension_values values ($1,'dim:market','val:market/norway')",
        [v.id],
      )
      await client.query(
        "insert into item_version_evidence (version_id,position,url,quote,read_on) values ($1,0,'https://example.test','Private quote','2026-10-07')",
        [v.id],
      )
      await client.query("insert into item_version_refs values ($1,'demo:orders','1')", [v.id])
      await client.query("insert into item_version_replaces values ($1,'itm_target0001')", [v.id])
      await client.query(
        "insert into item_version_conflicts (version_id,other_item_id,authority_quote) values ($1,'itm_target0001','Private conflict')",
        [v.id],
      )
      await client.query(
        "insert into item_version_mentions (version_id,field,position,term_key,label) values ($1,'summary',0,'metric:orders','Orders')",
        [v.id],
      )
      if (live) {
        await accept(client, v.id)
        await publish(client, v.id)
        accepted = v.id
      } else draft = v.id
    }
  })
})
async function asRole<T>(role: string, person: string | null, work: () => Promise<T>) {
  await client.query(`set role ${identifier(role)}`)
  try {
    return await transaction(client, async () => {
      await client.query("select set_config('cl.person_id',$1,true)", [person ?? ''])
      return work()
    })
  } finally {
    await client.query(`set role ${identifier(localRoles.owner)}`)
  }
}

it.each([
  ['author', people.author, true],
  ['owner', people.owner, true],
  ['admin', people.admin, true],
  ['stranger', people.stranger, false],
  ['anonymous', null, false],
] as const)('filters all children and link view for %s', async (_, person, visible) => {
  await asRole(localRoles.api, person, async () => {
    for (const table of ['item_versions', ...children, 'v_version_links']) {
      const key = table === 'item_versions' ? 'id' : 'version_id'
      const hidden = await client.query(`select * from ${identifier(table)} where ${key}=$1`, [
        draft,
      ])
      expect(Boolean(hidden.rowCount), table).toBe(visible)
      const publicRows = await client.query(`select * from ${identifier(table)} where ${key}=$1`, [
        accepted,
      ])
      expect(publicRows.rowCount, table).toBeGreaterThan(0)
    }
  })
})
it('does not retain the request principal after a transaction', async () => {
  await asRole(localRoles.api, people.author, async () => {
    expect(
      (await client.query<{ person: string | null }>('select cl_person() as person')).rows[0]!
        .person,
    ).toBe(people.author)
  })
  expect(
    (await client.query<{ person: string | null }>('select cl_person() as person')).rows[0]!.person,
  ).toBeNull()
})
it.each([
  'item_versions',
  'item_version_mentions',
  'decisions',
  'check_results',
  'proposal_events',
  'audit_log',
  'settings_versions',
  'editions',
  'live_edition',
])('denies API update/delete/truncate on %s', async (table) => {
  for (const verb of ['delete from', 'truncate']) {
    await expect(
      asRole(localRoles.api, people.admin, () => client.query(`${verb} ${identifier(table)}`)),
    ).rejects.toMatchObject({ code: '42501' })
  }
  const privileges = await client.query<{ allowed: boolean }>(
    "select has_table_privilege($1,$2,'UPDATE') as allowed",
    [localRoles.api, table],
  )
  expect(privileges.rows[0]!.allowed).toBe(false)
})
it.each(['item_version_service', 'vocab_term_service', 'area_state_service'])(
  'denies API direct service changes in %s',
  async (table) => {
    await expect(
      asRole(localRoles.api, people.admin, () => client.query(`delete from ${identifier(table)}`)),
    ).rejects.toMatchObject({ code: '42501' })
  },
)
it('lets API create a complete version under its principal', async () => {
  await asRole(localRoles.api, people.author, async () => {
    const v = await version(client)
    expect((await client.query('select id from item_versions where id=$1', [v.id])).rows).toEqual([
      { id: v.id },
    ])
  })
})
it("denies inserting a child on another principal's version", async () => {
  await expect(
    asRole(localRoles.api, people.stranger, () =>
      client.query(
        "insert into item_version_evidence (version_id,position,url,quote,read_on) values ($1,2,'https://example.test','Leaked','2026-10-07')",
        [draft],
      ),
    ),
  ).rejects.toMatchObject({ code: '23001' })
})
it('allows children of a version created inside a savepoint', async () => {
  await client.query('begin')
  try {
    await client.query('savepoint made')
    const v = await version(client)
    await client.query('release savepoint made')
    await client.query(
      "insert into item_version_evidence (version_id,position,url,quote,read_on) values ($1,1,'https://example.test','Quote','2026-10-07')",
      [v.id],
    )
  } finally {
    await client.query('rollback')
  }
})
it('serving role can read serving models but no raw versions, people or private notes', async () => {
  await asRole(localRoles.serve, null, async () => {
    const result = await client.query(
      'select version_id from serving_items((select seq from live_edition))',
    )
    expect(result.rows).toContainEqual({ version_id: accepted })
    expect(result.rows).not.toContainEqual({ version_id: draft })
  })
  for (const table of [
    'people',
    'invites',
    'item_versions',
    'item_version_mentions',
    'audit_log',
    'gap_notes',
    'v_version_links',
    'v_item_index',
    // The current settings are readable (per-tool limits); who changed them is not.
    'settings_versions',
  ]) {
    await expect(
      asRole(localRoles.serve, null, () => client.query(`select * from ${identifier(table)}`)),
    ).rejects.toMatchObject({ code: '42501' })
  }
  await expect(
    asRole(localRoles.serve, null, () => client.query("select edition_open('bootstrap',null)")),
  ).rejects.toMatchObject({ code: '42501' })
})
it('analytics cannot read personal columns or change data', async () => {
  for (const table of [
    'people',
    'invites',
    'audit_log',
    'v_item_list',
    'v_item_index',
    'editions',
    'eval_runs',
    'item_versions',
  ]) {
    await expect(
      asRole(localRoles.readonly, null, () => client.query(`select * from ${identifier(table)}`)),
    ).rejects.toMatchObject({ code: '42501' })
  }
  await asRole(localRoles.readonly, null, async () => {
    expect((await client.query('select * from v_topic_counts_public')).rows).toEqual([])
  })
  await expect(
    asRole(localRoles.readonly, null, () => client.query('select * from topic_week_counts')),
  ).rejects.toMatchObject({ code: '42501' })
  await expect(
    asRole(localRoles.readonly, null, () =>
      client.query(
        "insert into topics (key,metric_keys,value_keys,month) values ('x','{}','{}','2026-10-01')",
      ),
    ),
  ).rejects.toMatchObject({ code: '42501' })
})
it('chains API audit writes even when RLS hides earlier audit rows', async () => {
  for (let i = 0; i < 2; i++)
    await asRole(localRoles.api, people.author, () =>
      client.query(
        "insert into audit_log (actor_id,actor_kind,action) values ($1,'person','proposal.submitted')",
        [people.author],
      ),
    )
  await asRole(localRoles.api, people.stranger, async () => {
    expect((await client.query('select * from audit_log')).rows).toEqual([])
  })
  await client.query("set timezone='Pacific/Auckland'")
  expect((await client.query('select * from audit_verify()')).rows).toEqual([])
  await client.query("set timezone='UTC'")
})
it('keeps the chain in seq order when two writers meet', async () => {
  const other = new pg.Client({ connectionString: url })
  await other.connect()
  const write = (on: pg.Client, action: string) =>
    on.query("insert into audit_log (actor_id,actor_kind,action) values ($1,'person',$2)", [
      people.author,
      action,
    ])
  try {
    await other.query(`set role ${identifier(localRoles.owner)}`)
    // The first writer holds the chain lock while the second one's insert has already begun.
    await client.query('begin')
    await client.query("select pg_advisory_xact_lock(hashtextextended('context_layer.audit',0))")
    const second = write(other, 'audit.second')
    for (let tries = 0; tries < 100; tries++) {
      const waiting = await client.query(
        "select 1 from pg_locks where locktype='advisory' and not granted",
      )
      if (waiting.rowCount) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    await write(client, 'audit.first')
    await client.query('commit')
    await second
    const rows = await client.query<{ action: string }>(
      "select action from audit_log where action in ('audit.first','audit.second') order by seq",
    )
    expect(rows.rows.map((row) => row.action)).toEqual(['audit.first', 'audit.second'])
    expect((await client.query('select * from audit_verify()')).rows).toEqual([])
  } finally {
    await other.end()
  }
})
const maintenance = [
  'select cl_retention_run()',
  'select cl_ensure_delivery_partitions(2)',
  'select cl_ensure_request_partitions(2)',
]
it('grants the scheduled maintenance functions to the API role only', async () => {
  for (const sql of maintenance) {
    await asRole(localRoles.api, null, () => client.query(sql))
    for (const role of [localRoles.serve, localRoles.readonly])
      await expect(asRole(role, null, () => client.query(sql))).rejects.toMatchObject({
        code: '42501',
      })
  }
  await expect(
    asRole(localRoles.api, null, () => client.query('select cl_ensure_delivery_partitions(13)')),
  ).rejects.toMatchObject({ code: '22023' })
})
it('refuses retention periods under one day, even from a settings change', async () => {
  for (const value of ['0', '-30']) {
    await client.query(
      `insert into settings_versions (key, version, value, reason)
       select 'retention.delivery_days', max(version) + 1, $1, 'test' from settings_versions
       where key = 'retention.delivery_days'`,
      [value],
    )
    await expect(
      asRole(localRoles.api, null, () => client.query('select cl_retention_run()')),
    ).rejects.toMatchObject({ code: '22023' })
  }
  await client.query(
    `insert into settings_versions (key, version, value, reason)
     select 'retention.delivery_days', max(version) + 1, '180', 'test' from settings_versions
     where key = 'retention.delivery_days'`,
  )
})
it('does not grant arbitrary DDL helpers to runtime roles', async () => {
  for (const role of [localRoles.api, localRoles.serve, localRoles.readonly])
    await expect(
      asRole(role, null, () => client.query("select cl_make_append_only('people')")),
    ).rejects.toMatchObject({ code: '42501' })
})
it('keeps the job queue to the API role, without DDL', async () => {
  await asRole(localRoles.api, null, async () => {
    await client.query('select count(*) from pgboss.job')
    await expect(client.query('create table pgboss.intruder (id int)')).rejects.toMatchObject({
      code: '42501',
    })
  })
  await expect(
    asRole(localRoles.api, null, () =>
      client.query("select pgboss.job_table_run('select 1', null, null)"),
    ),
  ).rejects.toMatchObject({ code: '42501' })
  for (const role of [localRoles.serve, localRoles.readonly])
    await expect(
      asRole(role, null, () => client.query('select count(*) from pgboss.job')),
    ).rejects.toMatchObject({ code: '42501' })
})

describe('attached tests (0043)', () => {
  let draft: string
  let submitted: string
  beforeAll(async () => {
    await transaction(client, async () => {
      await client.query(`insert into golden_questions (id,area_id,wordings,scope,expected,source,split) values
        ('finance-open','finance','["a","b"]','{}','{}','test','development'),
        ('finance-later','finance','["a","b"]','{}','{}','test','development'),
        ('finance-held','finance','["a","b"]','{}','{}','test','held_out'),
        ('marketing-open','marketing','["a","b"]','{}','{}','test','development')`)
      const proposal = await client.query<{ id: string }>(
        "insert into proposals (action,area_id,proposer_id,channel) values ('create','finance',$1,'form') returning id",
        [people.author],
      )
      draft = proposal.rows[0]!.id
      const v = await version(client)
      const sent = await client.query<{ id: string }>(
        `insert into proposals (action,state,area_id,item_id,item_version_id,proposer_id,channel,submitted_at)
         select 'create','submitted',area_id,item_id,id,proposer_id,'form',now() from item_versions where id=$1 returning id`,
        [v.id],
      )
      submitted = sent.rows[0]!.id
    })
  })
  const attach = (person: string, proposal: string, question: string) =>
    asRole(localRoles.api, person, () =>
      client.query('insert into proposal_tests (proposal_id,question_id) values ($1,$2)', [
        proposal,
        question,
      ]),
    )

  it("attaches a development test of the draft's area, never a held-out one (FR-503)", async () => {
    await attach(people.author, draft, 'finance-open')
    await expect(attach(people.author, draft, 'finance-held')).rejects.toMatchObject({
      code: '23514',
    })
    await expect(attach(people.owner, draft, 'finance-held')).rejects.toMatchObject({
      code: '23514',
    })
    await expect(attach(people.author, draft, 'marketing-open')).rejects.toMatchObject({
      code: '23514',
    })
  })

  it("lets the author attach to their draft, the area's maintainers until a decision", async () => {
    // Someone else's draft, and the author's own proposal once it is sent.
    await expect(attach(people.stranger, draft, 'finance-later')).rejects.toMatchObject({
      code: '42501',
    })
    await expect(attach(people.author, submitted, 'finance-open')).rejects.toMatchObject({
      code: '42501',
    })
    await attach(people.owner, submitted, 'finance-open')
    await attach(people.admin, draft, 'finance-later')
    await expect(
      asRole(localRoles.api, people.admin, () =>
        client.query("update proposal_tests set question_id='finance-later'"),
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await client.query("update proposals set state='withdrawn',closed_at=now() where id=$1", [
      submitted,
    ])
    await expect(attach(people.owner, submitted, 'finance-later')).rejects.toMatchObject({
      code: '42501',
    })
    const detached = await asRole(localRoles.api, people.owner, () =>
      client.query('delete from proposal_tests where proposal_id=$1', [submitted]),
    )
    expect(detached.rowCount).toBe(0)
    const own = await asRole(localRoles.api, people.author, () =>
      client.query(
        "delete from proposal_tests where proposal_id=$1 and question_id='finance-later'",
        [draft],
      ),
    )
    expect(own.rowCount).toBe(1)
  })

  it('refuses holding out or moving a question that an open proposal still uses', async () => {
    await expect(
      client.query("update golden_questions set split='held_out' where id='finance-open'"),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      client.query("update golden_questions set area_id='marketing' where id='finance-open'"),
    ).rejects.toMatchObject({ code: '23514' })
    // Attached to nothing open: it may be held out and moved.
    await expect(
      client.query("update golden_questions set split='held_out' where id='finance-later'"),
    ).resolves.toMatchObject({ rowCount: 1 })
    await expect(
      client.query("update golden_questions set area_id='marketing' where id='finance-later'"),
    ).resolves.toMatchObject({ rowCount: 1 })
  })

  it('hides a test held out after its proposal closed from everyone but its maintainers', async () => {
    // The withdrawn proposal still lists the test the owner attached while it was open.
    const seen = (person: string) =>
      asRole(localRoles.api, person, async () =>
        (
          await client.query<{ question_id: string }>(
            'select question_id from proposal_tests where proposal_id=$1',
            [submitted],
          )
        ).rows.map((row) => row.question_id),
      )
    expect(await seen(people.author)).toEqual(['finance-open'])
    await asRole(localRoles.api, people.author, () =>
      client.query('delete from proposal_tests where proposal_id=$1', [draft]),
    )
    await client.query("update golden_questions set split='held_out' where id='finance-open'")
    expect(await seen(people.author)).toEqual([])
    expect(await seen(people.owner)).toEqual(['finance-open'])
    expect(await seen(people.admin)).toEqual(['finance-open'])
  })
})
