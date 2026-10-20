import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuditEntry } from '../../src/contract/index.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  A history entry names the request that wrote it (0029): the id in `x-request-id` and in every
  log line of that request. Work outside a request, such as a scheduled job, writes no id.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const logs: string[] = []
const app = buildApp({
  database,
  logger: createLogger({
    level: 'info',
    destination: { write: (line: string) => logs.push(line) },
  }),
  jobs: idleJobs(),
  clock: systemClock('2026-10-08'),
  devPeople: [{ name: 'admin', email: 'admin@example.test', roles: [] }],
})
let headers: Record<string, string> = {}

beforeAll(async () => {
  await transaction(client, () => foundation(client))
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin: 'http://localhost', 'x-heed-csrf': 'dev-sign-in' },
    payload: { email: 'admin@example.test' },
  })
  expect(response.statusCode, response.body).toBe(200)
  headers = {
    origin: 'http://localhost',
    cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    'x-heed-csrf': response.json<{ csrfToken: string }>().csrfToken,
  }
})
afterAll(() => app.close())

describe('request ids in the history log', () => {
  it('gives an entry written through the API the id of the request that wrote it', async () => {
    const write = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings/review.default_days',
      headers,
      payload: { version: 1, value: 60, reason: 'Shorter review cycle for the pilot' },
    })
    expect(write.statusCode, write.body).toBe(200)
    const requestId = String(write.headers['x-request-id'])
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(logs.some((line) => (JSON.parse(line) as { reqId?: string }).reqId === requestId)).toBe(
      true,
    )

    const found = await app.inject({
      method: 'GET',
      url: `/api/v1/audit?requestId=${requestId}`,
      headers,
    })
    const entries = found.json<{ entries: AuditEntry[] }>().entries
    expect(entries.map((e) => [e.action, e.requestId])).toEqual([['setting.changed', requestId]])
    const verify = await app.inject({ method: 'GET', url: '/api/v1/audit/verify', headers })
    expect(verify.json()).toEqual({ verified: true, firstBadSeq: null })
  })

  it('writes no request id outside a request, even on a connection a request used', async () => {
    const pooled = apiDatabase(url)
    try {
      await pooled.transaction(
        null,
        (tx) => tx.query("insert into audit_log(actor_kind,action) values('system','job.ran')"),
        { requestId: '00000000-0000-4000-8000-000000000001' },
      )
      await pooled.transaction(null, (tx) =>
        tx.query("insert into audit_log(actor_kind,action) values('system','job.ran')"),
      )
      const rows = await client.query<{ request_id: string | null }>(
        "select request_id from audit_log where action='job.ran' order by seq",
      )
      expect(rows.rows.map((r) => r.request_id)).toEqual([
        '00000000-0000-4000-8000-000000000001',
        null,
      ])
    } finally {
      await pooled.close()
    }
    expect(people.admin).toBeTruthy()
  })
})
