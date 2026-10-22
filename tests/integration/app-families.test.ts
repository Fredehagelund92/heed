import { afterAll, beforeAll, expect, it } from 'vitest'
import type { AppFamilyCounts } from '../../src/contract/quality.ts'
import type { TrafficSummary } from '../../src/contract/admin.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  How the agents that called the MCP server fared (FR-410), over HTTP as Health and the gateway's
  Activity tab read it: per app family from the fixed list and week, tool calls and of them the
  reads that needed more detail or matched nothing, the malformed calls and Heed's errors. Each
  week is a cell of its own and a count below the minimum is hidden (FR-614). Starting a session
  or listing tools is no tool call. Owners and administrators read it; nobody else does.
*/

const { client, url } = testDatabase()
const appOptions = () => ({
  database: apiDatabase(url),
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock: systemClock(),
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})
const app = buildApp(appOptions())

type Who = keyof typeof people
const headers: Partial<Record<Who, Record<string, string>>> = {}
const read = (who: Who, path: string) =>
  app.inject({ method: 'GET', url: `/api/v1${path}`, headers: headers[who] })

/** Requests in the hour `weeksAgo` weeks before now, all alike. */
async function log(
  n: number,
  family: string,
  { weeksAgo = 0, tool = 'get_facts', status = 'ok', result = null as string | null } = {},
) {
  await client.query(
    `insert into mcp_requests (hour, client_label, app_family, tool, status, result_status)
     select date_trunc('hour', now(), 'UTC') - make_interval(weeks => $2), 'signed-in', $3, $4, $5, $6
       from generate_series(1, $1)`,
    [n, weeksAgo, family, tool, status, result],
  )
}

beforeAll(async () => {
  await foundation(client)
  for (const name of Object.keys(people) as Who[]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin: 'http://localhost', 'x-heed-csrf': 'dev-sign-in' },
      payload: { email: `${name}@example.test` },
    })
    expect(response.statusCode, response.body).toBe(200)
    headers[name] = {
      origin: 'http://localhost',
      cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-heed-csrf': response.json<{ csrfToken: string }>().csrfToken,
    }
  }
  // The log keeps a partition per month from this one on; earlier weeks may fall in the last.
  await client.query(`do $$
    declare m date := (date_trunc('month', now() at time zone 'UTC') - interval '1 month')::date;
    begin
      execute format('create table mcp_requests_last_month partition of mcp_requests for values from (%L) to (%L)',
        m::timestamp at time zone 'UTC', (m + interval '1 month')::timestamp at time zone 'UTC');
    end $$`)
  // This week: Claude Code reads that mostly needed more detail, one that matched nothing, one
  // malformed call and sessions started; Cursor two calls. Earlier: Claude Code's errors.
  await log(5, 'claude_code', { result: 'need_more_detail' })
  await log(1, 'claude_code', { result: 'no_match' })
  await log(1, 'claude_code', { status: 'invalid_input' })
  await log(3, 'claude_code', { tool: 'protocol' })
  await log(2, 'cursor', { result: 'matched' })
  await log(6, 'claude_code', { weeksAgo: 1, status: 'error' })
  await log(9, 'chatgpt', { weeksAgo: 3 })
})
afterAll(() => app.close())

it('counts tool calls per app family this week, hiding counts below the minimum', async () => {
  const response = await read('owner', '/quality/apps')
  expect(response.statusCode, response.body).toBe(200)
  const body = response.json<AppFamilyCounts>()
  expect(body.minimumCount).toBe(5)
  expect(body.rows.map(({ week: _week, ...row }) => row)).toEqual([
    {
      family: 'claude_code',
      calls: 7,
      needMoreDetail: 5,
      noMatch: null,
      invalidInput: null,
      errors: 0,
    },
    { family: 'cursor', calls: null, needMoreDetail: 0, noMatch: 0, invalidInput: 0, errors: 0 },
  ])
})

it('gives each week a cell of its own, and nothing before the weeks asked for', async () => {
  const body = (await read('admin', '/quality/apps?weeks=2')).json<AppFamilyCounts>()
  const claude = body.rows.filter((row) => row.family === 'claude_code')
  expect(claude.map((row) => [row.calls, row.errors])).toEqual([
    [6, 6],
    [7, 0],
  ])
  expect(claude[0]!.week < claude[1]!.week).toBe(true)
  expect(body.rows.some((row) => row.family === 'chatgpt')).toBe(false)
})

it('keeps one cell per family and week when the database is not on UTC', async () => {
  const database = (await client.query<{ name: string }>('select current_database() as name'))
    .rows[0]!.name
  await client.query(`alter database "${database}" set timezone to 'Pacific/Auckland'`)
  try {
    const fresh = buildApp(appOptions())
    const response = await fresh.inject({
      method: 'GET',
      url: '/api/v1/quality/apps?weeks=1',
      headers: headers.admin,
    })
    await fresh.close()
    const body = response.json<AppFamilyCounts>()
    const families = body.rows.map((row) => row.family)
    expect(new Set(families).size).toBe(families.length)
    expect(new Set(body.rows.map((row) => row.week)).size).toBe(1)
  } finally {
    await client.query(`alter database "${database}" reset timezone`)
  }
})

it('is for owners and administrators only', async () => {
  expect((await read('author', '/quality/apps')).statusCode).toBe(403)
  expect((await read('stranger', '/quality/apps')).statusCode).toBe(403)
  expect((await read('admin', '/quality/apps?weeks=13')).statusCode).toBe(400)
})

it('counts malformed calls apart from errors in the traffic by client and tool', async () => {
  const response = await read('admin', '/traffic?days=7')
  expect(response.statusCode, response.body).toBe(200)
  const { total } = response.json<TrafficSummary>()
  expect(total).toMatchObject({ invalidInput: 1, ok: 11, calls: 12 })
})
