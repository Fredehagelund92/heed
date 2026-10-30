import { beforeAll, expect, it } from 'vitest'
import { identifier, localRoles } from '../../src/server/db/roles.ts'
import { foundation, openEdition } from './fixtures.ts'
import { testDatabase, transaction } from './support.ts'
const { client } = testDatabase()
beforeAll(() => foundation(client))

// Exact column contracts catch new identity/content fields even if their names evade a denylist.
const columns = {
  deliveries: [
    'id',
    'delivered_hour',
    'client_label',
    'caller',
    'edition_seq',
    'overlay_seq',
    'tool_schema_digest',
    'topic_id',
    'scope',
    'audience_groups',
    'status',
    'delivered',
    'withheld',
    'cut',
    'response_bytes',
    'duration_ms',
    // What Observability counts (FR-620): the answer state, and the kind of agent from FR-410's
    // fixed list, never the name it gave itself.
    'answer_state',
    'app_family',
  ],
  topics: ['id', 'key', 'area_id', 'metric_keys', 'value_keys', 'month', 'dimension_keys'],
  gaps: [
    'id',
    'ref',
    'topic_id',
    'type',
    'status',
    'severity',
    'opened_by_case',
    'first_seen',
    'last_seen',
    'verified_at',
    'created_at',
    'status_since',
    'resolved_edition_seq',
    'verified_edition_seq',
  ],
  feedback: [
    'id',
    'delivery_id',
    'verdict',
    'note',
    'client_label',
    'gap_id',
    'created_hour',
    'area_id',
  ],
  gap_notes: ['id', 'gap_id', 'source', 'note', 'created_hour', 'delete_after'],
  // An assistant rating (FR-712): the verdict, the domain and the hour, never who or what was asked.
  assistant_ratings: ['id', 'verdict', 'area_id', 'created_hour'],
  topic_week_counts: ['topic_id', 'week', 'status', 'calls', 'no_item_calls'],
  gap_weekly_counts: ['gap_id', 'week', 'reports', 'no_item_calls', 'human_reports'],
  // Observability's weekly counts, kept without limit (FR-612): a week, a domain, an answer state
  // from fixed lists, and a count. Never a topic, a question or who asked.
  obs_weekly: ['week', 'area_id', 'answer_state', 'calls'],
  // A person's report (FR-606 case 5) keeps digests of its retry key and request, never who sent it.
  gap_report_keys: ['retry_digest', 'request_digest', 'gap_id', 'expires_hour'],
  // FR-410: the agent is kept as its family from a fixed list, never its own name or version.
  mcp_requests: [
    'id',
    'hour',
    'client_label',
    'tool',
    'status',
    'duration_ms',
    'edition_seq',
    'response_bytes',
    'app_family',
    'result_status',
  ],
}
it.each(Object.entries(columns))('keeps the anonymous %s column contract', async (table, names) => {
  const result = await client.query<{ column_name: string }>(
    "select column_name from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position",
    [table],
  )
  expect(result.rows.map((r) => r.column_name)).toEqual(names)
})
it('generates random UUIDs and only hour precision in anonymous records', async () => {
  await transaction(client, async () => {
    const seq = await openEdition(client)
    const delivery = await client.query(
      `insert into deliveries (client_label,edition_seq,overlay_seq,tool_schema_digest,scope,status)
      values ('test',$1,0,'sha256:test','{}','no_match') returning uuid_extract_version(id) as version,uuid_extract_timestamp(id) as timestamp,
      delivered_hour=date_trunc('hour',delivered_hour,'UTC') as rounded`,
      [seq],
    )
    expect(delivery.rows[0]).toEqual({ version: 4, timestamp: null, rounded: true })
    const feedback = await client.query(
      "insert into feedback (verdict,client_label) values ('helpful','test') returning uuid_extract_version(id) as version,created_hour=date_trunc('hour',created_hour,'UTC') as rounded",
    )
    expect(feedback.rows[0]).toEqual({ version: 4, rounded: true })
    const rating = await client.query(
      "insert into assistant_ratings (verdict) values ('wrong') returning uuid_extract_version(id) as version,uuid_extract_timestamp(id) as timestamp,created_hour=date_trunc('hour',created_hour,'UTC') as rounded",
    )
    expect(rating.rows[0]).toEqual({ version: 4, timestamp: null, rounded: true })
  })
})
it('rejects precise delivery and request timestamps', async () => {
  const seq = await openEdition(client)
  await expect(
    client.query(
      `insert into deliveries (delivered_hour,client_label,edition_seq,overlay_seq,tool_schema_digest,scope,status)
    values (date_trunc('hour',now())+interval '1 second','test',$1,0,'digest','{}','no_match')`,
      [seq],
    ),
  ).rejects.toMatchObject({ code: '23514' })
  await expect(
    client.query(
      "insert into mcp_requests (hour,client_label,tool,status) values (date_trunc('hour',now())+interval '1 second','test','get_facts','ok')",
    ),
  ).rejects.toMatchObject({ code: '23514' })
})
it('keeps only an app family from the fixed list on a request, never the name an app sent', async () => {
  const insert = (family: string, status = 'ok', result: string | null = null) =>
    client.query(
      'insert into mcp_requests (client_label,app_family,tool,status,result_status) values ($1,$2,$3,$4,$5)',
      ['test', family, 'get_facts', status, result],
    )
  await insert('claude_code', 'invalid_input')
  await insert('other', 'ok', 'need_more_detail')
  // A raw client string, a version or any other free text is refused by the database itself.
  for (const family of ['Claude Code', 'claude-code', 'cursor 1.4', 'Alice Smith', ''])
    await expect(insert(family), family).rejects.toMatchObject({ code: '23514' })
  await expect(insert('cursor', 'ok', 'Orders in Norway')).rejects.toMatchObject({
    code: '23514',
  })
  await expect(insert('cursor', 'Orders in Norway')).rejects.toMatchObject({ code: '23514' })
  // A request written before the app was recorded, or that names none, is unknown.
  const defaulted = await client.query<{ family: string }>(
    "insert into mcp_requests (client_label,tool,status) values ('test','get_facts','ok') returning app_family as family",
  )
  expect(defaulted.rows).toEqual([{ family: 'unknown' }])
})

it('suppresses topic aggregates below the minimum count', async () => {
  const topic = await client.query<{ id: string }>(
    "insert into topics (key,metric_keys,value_keys,month) values ('test','{}','{}','2026-10-01') returning id",
  )
  await client.query(
    "insert into topic_week_counts (topic_id,week,status,calls,no_item_calls) values ($1,'2026-10-05','no_match',4,4)",
    [topic.rows[0]!.id],
  )
  expect((await client.query('select * from cl_topic_counts_public(5)')).rows).toEqual([])
  await client.query('update topic_week_counts set calls=5 where topic_id=$1', [topic.rows[0]!.id])
  expect((await client.query('select * from cl_topic_counts_public(5)')).rows).toHaveLength(1)
})

it('refuses timestamp-bearing ids, precise times and other verdicts on a rating', async () => {
  await expect(
    client.query("insert into assistant_ratings (id,verdict) values (uuidv7(),'helpful')"),
  ).rejects.toMatchObject({ code: '23514' })
  await expect(
    client.query(
      "insert into assistant_ratings (verdict,created_hour) values ('helpful',date_trunc('hour',now())+interval '1 second')",
    ),
  ).rejects.toMatchObject({ code: '23514' })
  // Thumbs up and down only: give_feedback's other verdicts are not a person's rating.
  for (const verdict of ['missing', 'unclear'])
    await expect(
      client.query('insert into assistant_ratings (verdict) values ($1)', [verdict]),
    ).rejects.toMatchObject({ code: '23514' })
})

it('refuses timestamp-bearing ids and precise feedback times', async () => {
  await expect(
    client.query(
      "insert into feedback (id,verdict,client_label) values (uuidv7(),'helpful','test')",
    ),
  ).rejects.toMatchObject({ code: '23514' })
  await expect(
    client.query(
      "insert into feedback (verdict,client_label,created_hour) values ('helpful','test',date_trunc('hour',now())+interval '1 second')",
    ),
  ).rejects.toMatchObject({ code: '23514' })
})

// The anonymity suite (NFR-031, FR-613): what a reviewer must change on purpose before any record of
// asking can name, date or follow a person. The runtime canary is in canary.test.ts.
const anonymous = [...Object.keys(columns), 'llm_spend_monthly']

it('names no column of an anonymous table after a person, session, device or address', async () => {
  const result = await client.query<{ table_name: string; column_name: string }>(
    "select table_name, column_name from information_schema.columns where table_schema='public' and table_name = any($1)",
    [anonymous],
  )
  expect(result.rows.length).toBeGreaterThan(60)
  const deny =
    /user|person|people|session|device|addr|email|subject|account|token|author|actor|owner|created_by|decided_by|proposer|owner|fingerprint|agent_string|(^|_)(ip|ua|sub)(_|$)/i
  expect(result.rows.filter((r) => deny.test(r.column_name))).toEqual([])
})

it('lets anonymous tables reference only non-person tables, in every schema', async () => {
  const references = await client.query<{ source: string; target: string }>(
    `select c.conrelid::regclass::text as source, c.confrelid::regclass::text as target
       from pg_constraint c where c.contype = 'f' and c.conparentid = 0
        and (c.conrelid::regclass::text = any($1) or c.confrelid::regclass::text = any($1))
      order by c.conrelid::regclass::text collate "C", c.confrelid::regclass::text collate "C"`,
    [anonymous],
  )
  // Outbound: editions, areas and each other. Inbound: each other, plus the remedy side, where a
  // proposal or a linked test question names the gap it answers (it names its writer, never who
  // asked).
  expect(references.rows).toEqual([
    { source: 'assistant_ratings', target: 'areas' },
    { source: 'deliveries', target: 'editions' },
    { source: 'deliveries', target: 'topics' },
    { source: 'feedback', target: 'areas' },
    { source: 'feedback', target: 'gaps' },
    { source: 'gap_notes', target: 'gaps' },
    { source: 'gap_proposals', target: 'gaps' },
    { source: 'gap_report_keys', target: 'gaps' },
    { source: 'gap_tests', target: 'gaps' },
    { source: 'gap_weekly_counts', target: 'gaps' },
    // The editions that resolved it and verified it.
    { source: 'gaps', target: 'editions' },
    { source: 'gaps', target: 'editions' },
    { source: 'gaps', target: 'topics' },
    { source: 'obs_weekly', target: 'areas' },
    { source: 'proposals', target: 'gaps' },
    { source: 'topic_week_counts', target: 'topics' },
    { source: 'topics', target: 'areas' },
  ])
})

it('keeps every time on an anonymous record to the hour, by constraint', async () => {
  const times = await client.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
      where table_schema='public' and table_name = any($1) and data_type like 'timestamp%'`,
    [anonymous],
  )
  expect(times.rows.length).toBe(10)
  for (const { table_name: table, column_name: column } of times.rows) {
    const checks = await client.query<{ def: string }>(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = $1::regclass and contype = 'c'",
      [table],
    )
    expect(
      checks.rows.some((c) => c.def.includes(`date_trunc('hour'::text, ${column}, 'UTC'::text)`)),
      `${table}.${column}`,
    ).toBe(true)
  }
})

it('gives every anonymous id a random version 4 UUID, by constraint', async () => {
  const ids = await client.query<{ table_name: string }>(
    `select table_name from information_schema.columns
      where table_schema='public' and table_name = any($1) and column_name='id'`,
    [anonymous],
  )
  expect(ids.rows.map((r) => r.table_name).sort()).toEqual([
    'assistant_ratings',
    'deliveries',
    'feedback',
    'gap_notes',
    'gaps',
    'mcp_requests',
    'topics',
  ])
  for (const { table_name: table } of ids.rows) {
    const checks = await client.query<{ def: string }>(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = $1::regclass and contype = 'c'",
      [table],
    )
    expect(
      checks.rows.map((c) => c.def),
      table,
    ).toContain('CHECK ((uuid_extract_version(id) = 4))')
  }
})

it('lets the serving role write anonymous records but never read them back', async () => {
  for (const table of [
    'deliveries',
    'feedback',
    'gap_notes',
    'mcp_requests',
    'topic_week_counts',
    'gap_weekly_counts',
  ]) {
    await client.query(`set role ${identifier(localRoles.serve)}`)
    try {
      await expect(client.query(`select * from ${identifier(table)}`), table).rejects.toMatchObject(
        {
          code: '42501',
        },
      )
    } finally {
      await client.query(`set role ${identifier(localRoles.owner)}`)
    }
  }
})

it('lets the API role add a rating, never change or remove one, and no other role touch them', async () => {
  const as = async (role: string, sql: string) => {
    await client.query(`set role ${identifier(role)}`)
    try {
      return await client.query(sql)
    } finally {
      await client.query(`set role ${identifier(localRoles.owner)}`)
    }
  }
  await as(localRoles.api, "insert into assistant_ratings (verdict) values ('helpful')")
  for (const sql of [
    "update assistant_ratings set verdict = 'wrong'",
    'delete from assistant_ratings',
  ])
    await expect(as(localRoles.api, sql), sql).rejects.toMatchObject({ code: '42501' })
  for (const role of [localRoles.serve, localRoles.readonly])
    for (const sql of [
      'select * from assistant_ratings',
      "insert into assistant_ratings (verdict) values ('helpful')",
    ])
      await expect(as(role, sql), `${role}: ${sql}`).rejects.toMatchObject({ code: '42501' })
})

// FR-610 and FR-524: the links from a gap or a proposal to test questions are remedy records. Who
// linked or attached a test is in the history log; the rows name nobody and keep only the hour.
const testLinks = {
  gap_tests: [
    'gap_id',
    'question_id',
    'evidence_run',
    'linked_hour',
    'passed_run',
    'passed_edition_seq',
    'passed_revision',
    'passed_hour',
  ],
  proposal_tests: ['proposal_id', 'question_id', 'attached_hour'],
}
it.each(Object.entries(testLinks))(
  'keeps the %s column contract: no person, only hours',
  async (table, names) => {
    const result = await client.query<{ column_name: string; data_type: string }>(
      "select column_name, data_type from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position",
      [table],
    )
    expect(result.rows.map((r) => r.column_name)).toEqual(names)
    const checks = await client.query<{ def: string }>(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = $1::regclass and contype = 'c'",
      [table],
    )
    for (const { column_name: column } of result.rows.filter((r) =>
      r.data_type.startsWith('timestamp'),
    ))
      expect(
        checks.rows.some((c) => c.def.includes(`date_trunc('hour'::text, ${column}, 'UTC'::text)`)),
        `${table}.${column}`,
      ).toBe(true)
  },
)
