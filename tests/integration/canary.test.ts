import { resolverStatusOf } from '../../src/domain/answer-state.ts'
import { execFile } from 'node:child_process'
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildApp } from '../../src/server/app.ts'
import { identifier, localRoles } from '../../src/server/db/roles.ts'
import { createDevVerifier, mintDevToken } from '../../src/server/mcp/auth.ts'
import { createAnonymousStore } from '../../src/server/mcp/store.ts'
import { createEditionSource } from '../../src/server/modules/editions/index.ts'
import { gapDetectionJob } from '../../src/server/modules/gaps/index.ts'
import { retentionJob, type JobContext } from '../../src/server/modules/jobs/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, servingEdition } from './fixtures.ts'
import { apiDatabase, servingPool, testDatabase, transaction } from './support.ts'

/**
 * The runtime canary (requirements section 12, FR-602, FR-613): one signed-in test person makes
 * 1,000 get_facts calls carrying a marker sentence, through the real HTTP and MCP path, with a
 * browser cookie, a user agent and a forwarded address attached, from an agent whose self-chosen
 * name and version carry markers too. Afterwards no new database row, no log line and no export
 * may hold the person, their session, their token, their address, the sentence or the app's own
 * name (FR-410 keeps only its family, here `other`). The database side is read twice: as a logical dump (every row of every table in every
 * schema) and as a real `pg_dump` of the whole database, each compared before and after. The
 * metrics endpoint's output is searched too.
 */
const { client, url } = testDatabase()
const database = apiDatabase(url)
const serving = servingPool(url)
const resource = 'http://127.0.0.1/mcp'
const { privateKey } = generateKeyPairSync('ed25519')
const marker = randomBytes(8).toString('hex')
const sentenceMarker = randomBytes(8).toString('hex')
const sentence = `Canary ${sentenceMarker} wonders whether orders fell`
const person = {
  id: randomUUID(),
  email: `canary.${marker}@example.test`,
  name: `Canary ${marker}`,
}
const address = `203.0.113.${1 + (randomBytes(1)[0]! % 250)}`
const userAgent = `CanaryAgent/${marker}`
const appMarker = randomBytes(8).toString('hex')
const connectedAgent = { name: `Canary app ${appMarker}`, version: `1.0.${appMarker}` }
const logs: string[] = []
const metricsToken = randomBytes(24).toString('hex')
const app = buildApp({
  database,
  jobs: idleJobs(),
  logger: createLogger({
    level: 'trace',
    destination: {
      write(line: string) {
        logs.push(line)
      },
    },
  }),
  devPeople: [
    { email: person.email, name: person.name, roles: [] },
    { email: 'admin@example.test', name: 'admin', roles: [] },
  ],
  mcp: {
    source: createEditionSource(serving),
    store: createAnonymousStore(serving),
    verifier: createDevVerifier(privateKey, resource, 'test'),
    resource,
  },
  metricsToken,
})
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const run = promisify(execFile)
/** The lines of a plain pg_dump of the test database: schema, and every row as a COPY line. */
const pgDump = async () =>
  (await run('pg_dump', ['--dbname', url], { maxBuffer: 256 * 1024 * 1024 })).stdout.split('\n')
const origin = 'http://localhost'

async function signIn(email: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin, 'x-heed-csrf': 'dev-sign-in' },
    payload: { email },
  })
  expect(response.statusCode, response.body).toBe(200)
  const cookie = response.cookies[0]!
  return {
    token: cookie.value,
    csrf: response.json<{ csrfToken: string }>().csrfToken,
    headers: { cookie: `${cookie.name}=${cookie.value}` },
  }
}

/** Every row of every table outside the system schemas, as one JSON line each. */
async function dump() {
  const tables = await client.query<{ name: string }>(
    `select format('%I.%I', n.nspname, c.relname) as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and not c.relispartition
        and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%'
      order by 1`,
  )
  const lines: string[] = []
  for (const { name } of tables.rows) {
    const rows = await client.query<{ row: string }>(
      `select row_to_json(t)::text as row from ${name} t`,
    )
    for (const { row } of rows.rows) lines.push(`${name} ${row}`)
  }
  expect(tables.rows.map((t) => t.name)).toEqual(
    expect.arrayContaining(['auth.sessions', 'pgboss.job', 'public.deliveries', 'public.people']),
  )
  return lines
}

beforeAll(async () => {
  await foundation(client)
  await transaction(client, () => servingEdition(client))
  await client.query('insert into people (id,email,display_name) values ($1,$2,$3)', [
    person.id,
    person.email,
    person.name,
  ])
  // One person making a thousand calls in a minute is a test load, not a rate to defend against.
  await client.query(
    "update client_policies set rate_per_minute = 10000 where client_label = 'claude-code'",
  )
  await client.query(
    `insert into settings_versions (key,version,value,reason)
     select key,version+1,'{"get_facts":10000}','canary load' from settings_current
     where key='limits.mcp_rate_per_minute'`,
  )
  await client.query(
    `insert into settings_versions (key,version,value,reason)
     select key,version+1,'{"person":10000,"client":10000}','canary load' from settings_current
     where key='limits.mcp_requests_per_minute'`,
  )
  await app.listen({ host: '127.0.0.1', port: 0 })
})
afterAll(async () => {
  await app.close()
  await serving.end()
})

it(
  'leaves no trace of the person, their session, token, address or question after 1,000 calls',
  { timeout: 180_000 },
  async () => {
    const session = await signIn(person.email)
    const [stored] = (
      await client.query<{ token_hash: string; csrf_token: string }>(
        'select token_hash, csrf_token from auth.sessions where person_id = $1',
        [person.id],
      )
    ).rows
    expect(stored?.token_hash).toBe(sha256(session.token))
    const accessToken = await mintDevToken(privateKey, resource)
    const markers = {
      marker,
      sentence: sentenceMarker,
      personId: person.id,
      address,
      sessionToken: session.token,
      sessionHash: stored!.token_hash,
      csrf: session.csrf,
      accessToken,
      accessTokenHash: sha256(accessToken),
      accessSignature: accessToken.split('.')[2]!,
      appName: appMarker,
    }
    const before = await dump()
    const beforeRows = new Set(before)
    const beforeDump = new Set(await pgDump())

    const listening = app.server.address() as { port: number }
    const wire = new Client(
      { name: connectedAgent.name, version: connectedAgent.version },
      { versionNegotiation: { mode: 'auto' } },
    )
    await wire.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${listening.port}/mcp`), {
        requestInit: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Cookie: session.headers.cookie,
            'User-Agent': userAgent,
            'X-Forwarded-For': markers.address,
            'X-Real-IP': markers.address,
          },
        },
      }),
    )
    const statuses = new Map<string, number>()
    const unmatched: string[] = []
    try {
      const shapes = [
        { question: `${sentence} in August 2026` },
        { question: `${sentence} in July 2026` },
        {
          question: sentence,
          metrics: ['orders'],
          window: { from: '2026-08-01', to: '2026-08-31' },
        },
      ]
      for (let batch = 0; batch < 100; batch++) {
        const replies = await Promise.all(
          Array.from({ length: 10 }, (_, i) =>
            wire.callTool({ name: 'get_context', arguments: shapes[(batch * 10 + i) % 3]! }),
          ),
        )
        for (const reply of replies) {
          expect(reply.isError).not.toBe(true)
          const content = reply.structuredContent as { status: string; reply_id: string }
          // Partial and Outdated answers are matches the resolver found.
          const status = resolverStatusOf(content.status)
          statuses.set(status, (statuses.get(status) ?? 0) + 1)
          if (status === 'no_match') unmatched.push(content.reply_id)
        }
      }
      for (let i = 0; i < 5; i++) {
        const gap = await wire.callTool({
          name: 'report',
          arguments: { kind: 'missing', question: `${sentence} in July 2026` },
        })
        expect(gap.isError).not.toBe(true)
        const feedback = await wire.callTool({
          name: 'report',
          arguments: { kind: 'missing', reply_id: unmatched[i]! },
        })
        expect(feedback.isError).not.toBe(true)
      }
    } finally {
      await wire.close()
    }
    expect(statuses.get('matched')).toBeGreaterThan(600)
    expect(statuses.get('no_match')).toBeGreaterThan(300)

    // The anonymous queue writes after each response; wait for all thousand deliveries.
    for (let tries = 0; tries < 100; tries++) {
      const count = await client.query<{ n: number }>('select count(*)::int as n from deliveries')
      if (count.rows[0]!.n === 1000) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    // A bounded queue drops records it cannot write in time; under this burst it must drop none.
    expect(logs.filter((line) => line.includes('records dropped'))).toEqual([])
    expect((await client.query('select count(*)::int as n from deliveries')).rows).toEqual([
      { n: 1000 },
    ])
    // The app is kept as its family only: its name is on no list, so it is another app.
    expect(
      (
        await client.query(
          "select distinct app_family from mcp_requests where tool = 'get_context' and status = 'ok'",
        )
      ).rows,
    ).toEqual([{ app_family: 'other' }])
    const jobContext = { database } as JobContext
    await gapDetectionJob.run(jobContext)
    await retentionJob.run(jobContext)

    const after = await dump()
    const added = after.filter((row) => !beforeRows.has(row))
    expect(added.length).toBeGreaterThan(2000)
    for (const [name, value] of Object.entries(markers))
      expect(
        added.filter((row) => row.includes(value)),
        `${name} in a new database row`,
      ).toEqual([])
    expect(after.filter((row) => row.includes(sentenceMarker))).toEqual([])
    const dumped = (await pgDump()).filter((line) => !beforeDump.has(line))
    expect(dumped.length).toBeGreaterThan(2000)
    for (const [name, value] of Object.entries(markers))
      expect(
        dumped.filter((line) => line.includes(value)),
        `${name} in the pg_dump`,
      ).toEqual([])
    const counts = await client.query<{ calls: number }>(
      'select sum(calls)::int as calls from topic_week_counts',
    )
    expect(counts.rows).toEqual([{ calls: 1000 }])

    // Exports: what an administrator and the analytics role can read out.
    const admin = await signIn('admin@example.test')
    const exported: string[] = []
    for (const path of ['/gaps?limit=200', '/areas/finance/dashboard', '/topics/counts']) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1' + path,
        headers: admin.headers,
      })
      expect(response.statusCode, response.body).toBe(200)
      exported.push(response.body)
    }
    const gaps = JSON.parse(exported[0]!) as { id: string }[]
    expect(gaps.length).toBeGreaterThan(0)
    const metrics = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: `Bearer ${metricsToken}` },
    })
    expect(metrics.statusCode).toBe(200)
    expect(metrics.body).toContain(
      'heed_mcp_requests_total{app_family="other",status="ok",tool="get_context"} 1000',
    )
    exported.push(metrics.body)
    for (const gap of gaps)
      exported.push(
        (await app.inject({ method: 'GET', url: `/api/v1/gaps/${gap.id}`, headers: admin.headers }))
          .body,
      )
    await client.query(`set role ${identifier(localRoles.readonly)}`)
    try {
      for (const view of ['v_topic_counts_public', 'v_gap_totals', 'mcp_requests'])
        exported.push(JSON.stringify((await client.query(`select * from ${view}`)).rows))
    } finally {
      await client.query(`set role ${identifier(localRoles.owner)}`)
    }
    for (const [name, value] of Object.entries(markers))
      expect(
        exported.filter((text) => text.includes(value)),
        `${name} in an export`,
      ).toEqual([])

    expect(logs.length).toBeGreaterThan(0)
    for (const [name, value] of Object.entries(markers))
      expect(
        logs.filter((line) => line.includes(value)),
        `${name} in a log line`,
      ).toEqual([])
  },
)
