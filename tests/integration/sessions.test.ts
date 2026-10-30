import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/server/app.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import type { DevPerson } from '../../src/server/modules/auth/index.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'
import { foundation, people, version } from './fixtures.ts'

const { client, url } = testDatabase()
const database = apiDatabase(url)
const devPeople: DevPerson[] = ['author', 'owner', 'approver', 'admin', 'stranger'].map((name) => ({
  email: `${name}@example.test`,
  name,
  roles: [],
}))
let runs = 0
const app = buildApp({
  database,
  logger: createLogger({ level: 'silent' }),
  devPeople,
  jobs: {
    ...idleJobs(),
    overview: () =>
      Promise.resolve({
        checkedAt: new Date(),
        runner: 'running',
        jobs: [],
        connectors: [],
        spend: {
          month: '2026-10',
          monthCostMicros: 0,
          monthCapMicros: null,
          todayCostMicros: 0,
          byFeature: [],
        },
      }),
    runNow: () => {
      runs++
      return Promise.resolve({ outcome: 'queued', id: 'job' })
    },
  },
})
const origin = 'http://localhost'
type Auth = { cookie: string; 'x-heed-csrf': string; origin: string }
async function login(name: string, cookie?: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin, 'x-heed-csrf': 'dev-sign-in', ...(cookie ? { cookie } : {}) },
    payload: { email: `${name}@example.test` },
  })
  expect(response.statusCode, response.body).toBe(200)
  return {
    response,
    headers: {
      cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-heed-csrf': response.json<{ csrfToken: string }>().csrfToken,
      origin,
    },
  }
}
const post = (path: string, headers: Auth, payload: object) =>
  app.inject({ method: 'POST', url: '/api/v1' + path, headers, payload })
beforeAll(async () => {
  await foundation(client)
  await app.ready()
})
afterAll(() => app.close())

describe('the sign-in list', () => {
  it('offers the dev people in the file order, with their roles and the domains of those roles', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/people' })
    expect(response.statusCode, response.body).toBe(200)
    const listed = response.json<
      {
        email: string
        name: string
        initials: string
        roles: string[]
        assignments: { role: string; area: { id: string; name: string; label: string } }[]
      }[]
    >()
    expect(listed.map((person) => person.email)).toEqual(devPeople.map((person) => person.email))
    const by = (name: string) => listed.find((person) => person.name === name)!
    expect(by('author')).toMatchObject({ initials: 'A', roles: [], assignments: [] })
    expect(by('owner').assignments).toMatchObject([
      { role: 'owner', area: { id: 'finance', name: 'Finance' } },
    ])
    expect(by('approver').assignments.map((a) => a.role)).toEqual(['approver'])
    expect(by('admin')).toMatchObject({ roles: ['administrator'], assignments: [] })
  })
})

describe('dev sessions over HTTP', () => {
  it('requires an allowed person, exact origin and a custom CSRF header at sign-in', async () => {
    for (const headers of [
      {},
      { origin },
      { origin: 'http://evil.test', 'x-heed-csrf': 'dev-sign-in' },
      { origin: 'https://localhost', 'x-heed-csrf': 'dev-sign-in' },
      { origin: 'null', 'x-heed-csrf': 'dev-sign-in' },
    ]) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/auth/sign-in',
            headers,
            payload: { email: 'admin@example.test' },
          })
        ).statusCode,
      ).toBe(403)
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/sign-in',
          headers: { origin, 'x-heed-csrf': 'dev-sign-in' },
          payload: { email: 'unknown@example.test' },
        })
      ).statusCode,
    ).toBe(401)
  })
  it('uses an opaque HttpOnly cookie, persists across app instances, and rotates on login', async () => {
    const first = await login('author')
    expect(first.response.headers['set-cookie']).toContain('HttpOnly; SameSite=Strict')
    expect(first.response.headers['cache-control']).toBe('no-store')
    const other = buildApp({
      database: apiDatabase(url),
      logger: createLogger({ level: 'silent' }),
      jobs: idleJobs(),
      devPeople,
    })
    try {
      expect((await other.inject({ url: '/api/v1/me', headers: first.headers })).statusCode).toBe(
        200,
      )
    } finally {
      await other.close()
    }
    const second = await login('owner', first.headers.cookie)
    expect(second.headers.cookie).not.toBe(first.headers.cookie)
    expect((await app.inject({ url: '/api/v1/me', headers: first.headers })).statusCode).toBe(401)
    const stored = await client.query<{ token_hash: string }>(
      'select token_hash from auth.sessions',
    )
    expect(stored.rows.map((r) => r.token_hash)).not.toContain(second.headers.cookie.split('=')[1])
    expect(second.response.body).not.toContain(second.headers.cookie.split('=')[1])
  })
  it('logs out, expires sessions, and rejects deactivated or erased people immediately', async () => {
    const { headers } = await login('stranger')
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/sign-out',
          headers: { cookie: headers.cookie, origin },
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/auth/sign-out', headers })).statusCode,
    ).toBe(200)
    expect((await app.inject({ url: '/api/v1/me', headers })).statusCode).toBe(401)
    const expired = await login('stranger')
    await client.query(
      "update auth.sessions set expires_at=now()-interval '1 second' where person_id=$1",
      [people.stranger],
    )
    expect((await app.inject({ url: '/api/v1/me', headers: expired.headers })).statusCode).toBe(401)
    for (const column of ['deactivated_at', 'erased_at']) {
      const active = await login('stranger')
      await client.query(`update people set ${column}=now() where id=$1`, [people.stranger])
      expect((await app.inject({ url: '/api/v1/me', headers: active.headers })).statusCode).toBe(
        401,
      )
      await client.query(`update people set ${column}=null where id=$1`, [people.stranger])
    }
  })
})

describe('roles, assignments and operations', () => {
  it('refuses anonymous and non-admin callers before reading operations or queuing work', async () => {
    for (const name of [null, 'author', 'owner', 'approver', 'stranger', 'admin']) {
      const headers = name ? (await login(name)).headers : { origin, 'x-heed-csrf': 'garbage' }
      const allowed = name === 'admin'
      const before = runs
      expect((await app.inject({ url: '/api/v1/operations', headers })).statusCode).toBe(
        allowed ? 200 : name ? 403 : 401,
      )
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/operations/jobs/retention.run/run',
            headers,
          })
        ).statusCode,
      ).toBe(allowed ? 202 : name ? 403 : 401)
      expect(runs - before).toBe(allowed ? 1 : 0)
      for (const path of [
        '/roles/grant',
        '/roles/revoke',
        '/assignments/grant',
        '/assignments/revoke',
      ]) {
        if (allowed) continue
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/api/v1' + path,
              headers,
              payload: path.startsWith('/roles')
                ? { personId: people.stranger, role: 'auditor' }
                : { personId: people.stranger, role: 'approver', areaId: 'finance' },
            })
          ).statusCode,
        ).toBe(name ? 403 : 401)
      }
    }
    const { headers } = await login('admin')
    for (const invalid of [
      { ...headers, origin: 'https://evil.test' },
      { ...headers, 'x-heed-csrf': 'wrong' },
    ]) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/operations/jobs/retention.run/run',
            headers: invalid,
          })
        ).statusCode,
      ).toBe(403)
    }
  })
  it('grants and revokes temporal permissions without caching them in sessions, with attributed audit history', async () => {
    const admin = (await login('admin')).headers
    const author = (await login('author')).headers
    const input = { personId: people.author, role: 'auditor' }
    expect((await post('/roles/grant', admin, input)).json()).toEqual({ changed: true })
    expect((await post('/roles/grant', admin, input)).json()).toEqual({ changed: false })
    expect((await app.inject({ url: '/api/v1/me', headers: author })).json()).toMatchObject({
      permissions: { roles: ['auditor'] },
    })
    expect((await post('/roles/revoke', admin, input)).json()).toEqual({ changed: true })
    expect((await app.inject({ url: '/api/v1/me', headers: author })).json()).toMatchObject({
      permissions: { roles: [] },
    })
    // Finance has an owner already; a domain may have several, so the author becomes another.
    const assignment = { personId: people.author, role: 'owner', areaId: 'finance' }
    expect((await post('/assignments/grant', admin, assignment)).json()).toEqual({ changed: true })
    expect((await post('/assignments/grant', admin, assignment)).json()).toEqual({ changed: false })
    expect((await app.inject({ url: '/api/v1/me', headers: author })).json()).toMatchObject({
      permissions: { assignments: [{ areaId: 'finance', role: 'owner' }] },
    })
    expect((await post('/assignments/revoke', admin, assignment)).json()).toEqual({ changed: true })
    const log = await client.query<{ actor_id: string; action: string }>(
      'select actor_id,action from audit_log order by seq',
    )
    expect(log.rows.slice(-4)).toEqual(
      ['role.granted', 'role.revoked', 'assignment.granted', 'assignment.revoked'].map(
        (action) => ({ actor_id: people.admin, action }),
      ),
    )
    expect((await client.query('select * from audit_verify()')).rows).toEqual([])
    expect(
      (
        await client.query(
          'select count(*)::int as n from global_role_grants where person_id=$1 and upper(valid_at) is not null',
          [people.author],
        )
      ).rows,
    ).toEqual([{ n: 1 }])
  })
  it.each(['administrator', 'auditor', 'owner', 'approver'] as const)(
    'gives and removes the %s role',
    async (role) => {
      const admin = (await login('admin')).headers
      const area = role !== 'administrator' && role !== 'auditor'
      // Finance has an owner already, so removing the one given leaves it one (FR-804).
      const areaId = role === 'owner' ? 'finance' : 'marketing'
      const input = { personId: people.stranger, role, ...(area ? { areaId } : {}) }
      const path = area ? '/assignments' : '/roles'
      expect((await post(`${path}/grant`, admin, input)).json()).toEqual({ changed: true })
      expect((await post(`${path}/revoke`, admin, input)).json()).toEqual({ changed: true })
    },
  )
  it('refuses to revoke the last active administrator, ignoring deactivated and erased people', async () => {
    const admin = (await login('admin')).headers
    const input = { personId: people.admin, role: 'administrator' }
    const extra = [people.stranger, people.author]
    for (const personId of extra)
      await post('/roles/grant', admin, { personId, role: 'administrator' })
    await client.query('update people set deactivated_at=now() where id=$1', [extra[0]])
    await client.query('update people set erased_at=now() where id=$1', [extra[1]])
    try {
      expect((await post('/roles/revoke', admin, input)).statusCode).toBe(409)
      expect((await app.inject({ url: '/api/v1/me', headers: admin })).json()).toMatchObject({
        permissions: { roles: ['administrator'] },
      })
    } finally {
      await client.query('update people set deactivated_at=null, erased_at=null where id=any($1)', [
        extra,
      ])
    }
    expect(
      (await post('/roles/revoke', admin, { personId: extra[0], role: 'administrator' })).json(),
    ).toEqual({ changed: true })
    expect(
      (await post('/roles/revoke', admin, { personId: extra[1], role: 'administrator' })).json(),
    ).toEqual({ changed: true })
  })
  it('does not restore bootstrap roles when a person signs in again', async () => {
    const bootstrap = buildApp({
      database: apiDatabase(url),
      logger: createLogger({ level: 'silent' }),
      jobs: idleJobs(),
      devPeople: [
        { email: 'bootstrap@example.test', name: 'Bootstrap admin', roles: ['administrator'] },
      ],
    })
    const request = {
      method: 'POST' as const,
      url: '/api/v1/auth/sign-in',
      headers: { origin, 'x-heed-csrf': 'dev-sign-in' },
      payload: { email: 'bootstrap@example.test' },
    }
    try {
      const first = await bootstrap.inject(request)
      expect(first.statusCode).toBe(200)
      const id = first.json<{ person: { id: string } }>().person.id
      expect(
        (
          await post('/roles/revoke', (await login('admin')).headers, {
            personId: id,
            role: 'administrator',
          })
        ).statusCode,
      ).toBe(200)
      const second = await bootstrap.inject(request)
      expect(second.statusCode).toBe(200)
      expect(second.json()).toMatchObject({ person: { permissions: { roles: [] } } })
    } finally {
      await bootstrap.close()
    }
  })
  it('rolls back the permission change if audit insertion fails', async () => {
    const { headers } = await login('admin')
    await client.query(
      "create function fail_audit_test() returns trigger language plpgsql as $$ begin raise exception 'audit unavailable'; end $$; create trigger fail_audit_test before insert on audit_log for each row execute function fail_audit_test()",
    )
    try {
      expect(
        (await post('/roles/grant', headers, { personId: people.author, role: 'auditor' }))
          .statusCode,
      ).toBe(500)
      expect(
        (
          await client.query(
            "select 1 from global_role_grants where person_id=$1 and role='auditor' and valid_at @> now()",
            [people.author],
          )
        ).rows,
      ).toEqual([])
    } finally {
      await client.query(
        'drop trigger fail_audit_test on audit_log; drop function fail_audit_test()',
      )
    }
  })
})

describe('acting-person transactions', () => {
  it('sets the acting person for SQL reached through concurrent HTTP requests', async () => {
    const author = (await login('author')).headers
    const stranger = (await login('stranger')).headers
    // A temporary policy makes the acting identity observable through the existing areas API.
    await client.query(`alter table areas enable row level security;
      create policy request_identity_test on areas for select using (
        (id='finance' and cl_person()='${people.author}') or
        (id='marketing' and cl_person()='${people.stranger}'))`)
    try {
      const responses = await Promise.all(
        [author, stranger, author, stranger].map((headers) =>
          app.inject({ url: '/api/v1/areas', headers }),
        ),
      )
      expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200, 200])
      expect(
        responses.map((response) => response.json<{ id: string }[]>().map((area) => area.id)),
      ).toEqual([['finance'], ['marketing'], ['finance'], ['marketing']])
    } finally {
      await client.query(
        'drop policy request_identity_test on areas; alter table areas disable row level security',
      )
    }
  })
  it('applies RLS to the same database connection, isolates concurrent people, and clears identity after commit and rollback', async () => {
    const { id } = await transaction(client, () => version(client))
    const results = await Promise.all(
      [people.author, people.owner, people.stranger, people.admin].map((person) =>
        database.transaction(person, (tx) =>
          tx.query('select id from item_versions where id=$1', [id]),
        ),
      ),
    )
    expect(results.map((rows) => rows.length)).toEqual([1, 1, 0, 1])
    await expect(
      database.transaction(people.admin, async (tx) => {
        await tx.query('select cl_person()')
        throw new Error('rollback')
      }),
    ).rejects.toThrow('rollback')
    for (let n = 0; n < 8; n++)
      expect(await database.query('select cl_person()::text as person')).toEqual([{ person: null }])
    await expect(
      database.transaction(people.author, (tx) =>
        tx.query("insert into global_role_grants(person_id,role) values($1,'administrator')", [
          people.author,
        ]),
      ),
    ).rejects.toThrow(/row-level security/)
  })
})
