import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Member, OwnersSet } from '../../src/contract/members.ts'
import { buildApp } from '../../src/server/app.ts'
import { identifier, localRoles } from '../../src/server/db/roles.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  People as Heed v1 has them (FR-804; docs/product.md, section 11), end to end over HTTP and
  PostgreSQL: Admin or Member, ownership on each domain, owners who add owners to their own
  domain and nothing else, a removal that waits while a domain has the person as its only owner,
  and an Undo that puts back exactly what the removal ended. Row security holds the same lines
  for a holder of the API role who skips the service.
*/

const { client, url } = testDatabase()
const extra = {
  coowner: '00000000-0000-4000-8000-0000000000c1',
  auditor: '00000000-0000-4000-8000-0000000000c2',
  leaver: '00000000-0000-4000-8000-0000000000c3',
}
const names = ['author', 'owner', 'approver', 'admin', 'stranger', 'coowner', 'auditor', 'leaver']
const app = buildApp({
  database: apiDatabase(url),
  logger: createLogger({ level: 'silent' }),
  devPeople: names.map((name) => ({ email: `${name}@example.test`, name, roles: [] })),
  jobs: idleJobs(),
})
const origin = 'http://localhost'
type Auth = { cookie: string; 'x-heed-csrf': string; origin: string }
async function login(name: string): Promise<Auth> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin, 'x-heed-csrf': 'dev-sign-in' },
    payload: { email: `${name}@example.test` },
  })
  expect(response.statusCode, response.body).toBe(200)
  return {
    cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    'x-heed-csrf': response.json<{ csrfToken: string }>().csrfToken,
    origin,
  }
}
const call = (auth: Auth | null, method: 'GET' | 'POST' | 'PUT', path: string, payload?: object) =>
  app.inject({
    method,
    url: `/api/v1${path}`,
    headers: {
      ...(auth ?? { origin }),
      ...(method === 'GET' ? {} : { 'idempotency-key': randomUUID() }),
    },
    ...(payload ? { payload } : {}),
  })
const members = async (auth: Auth) => {
  const response = await call(auth, 'GET', '/members')
  expect(response.statusCode, response.body).toBe(200)
  return response.json<Member[]>()
}
const memberOf = async (auth: Auth, id: string) => (await members(auth)).find((m) => m.id === id)
const ownersOf = async (area: string) =>
  (
    await client.query<{ id: string }>(
      `select person_id::text as id from area_assignments
        where area_id=$1 and role='owner' and valid_at @> now() order by person_id`,
      [area],
    )
  ).rows.map((row) => row.id)

let admin: Auth
let owner: Auth
let author: Auth
let stranger: Auth

beforeAll(async () => {
  await transaction(client, async () => {
    await foundation(client)
    await client.query(
      `insert into people (id,email,display_name) values
         ($1,'coowner@example.test','coowner'),($2,'auditor@example.test','auditor'),($3,'leaver@example.test','leaver')`,
      [extra.coowner, extra.auditor, extra.leaver],
    )
    await client.query("insert into global_role_grants (person_id,role) values ($1,'auditor')", [
      extra.auditor,
    ])
    // Marketing has one owner, the stranger; finance has the owner (and an approver).
    await client.query(
      "insert into area_assignments (area_id,person_id,role) values ('marketing',$1,'owner')",
      [people.stranger],
    )
  })
  admin = await login('admin')
  owner = await login('owner')
  author = await login('author')
  stranger = await login('stranger')
})
afterAll(() => app.close())

describe('Admin and Member', () => {
  it('lists everyone active with their role, the domains they own and their last sign-in', async () => {
    const list = await members(author)
    expect(list.find((m) => m.id === people.admin)).toMatchObject({
      name: 'admin',
      email: 'admin@example.test',
      role: 'admin',
      owns: [],
    })
    expect(list.find((m) => m.id === people.owner)).toMatchObject({
      role: 'member',
      owns: ['finance'],
    })
    // An auditor of an earlier model reads as a Member: v1 has two roles.
    expect(list.find((m) => m.id === extra.auditor)).toMatchObject({ role: 'member' })
    expect(list.find((m) => m.id === people.author)!.lastSignedInAt).toMatch(/^\d{4}-/)
    expect(list.find((m) => m.id === extra.coowner)!.lastSignedInAt).toBeNull()
  })

  it('lets an admin make someone an Admin or a Member, never their own role', async () => {
    expect(
      (await call(admin, 'POST', `/members/${people.author}/role`, { role: 'admin' })).json(),
    ).toEqual({
      changed: true,
    })
    expect((await memberOf(admin, people.author))!.role).toBe('admin')
    // The same role again changes nothing.
    expect(
      (await call(admin, 'POST', `/members/${people.author}/role`, { role: 'admin' })).json(),
    ).toEqual({
      changed: false,
    })
    const own = await call(admin, 'POST', `/members/${people.admin}/role`, { role: 'member' })
    expect(own.statusCode).toBe(409)
    expect(own.json()).toMatchObject({
      message: "You can't change your own role. Ask another admin.",
    })
    expect(
      (await call(admin, 'POST', `/members/${people.author}/role`, { role: 'member' })).json(),
    ).toEqual({
      changed: true,
    })
    expect((await memberOf(admin, people.author))!.role).toBe('member')
    // A member can't, whoever it is for.
    expect(
      (await call(owner, 'POST', `/members/${people.author}/role`, { role: 'admin' })).statusCode,
    ).toBe(403)
    // Making an auditor a Member ends the auditor grant: v1 has no auditor role.
    await call(admin, 'POST', `/members/${extra.auditor}/role`, { role: 'member' })
    const held = await client.query(
      'select 1 from global_role_grants where person_id=$1 and valid_at @> now()',
      [extra.auditor],
    )
    expect(held.rowCount).toBe(0)
    const logged = await client.query<{ action: string; role: string }>(
      `select action, details->>'role' as role from audit_log
        where subject_id=$1 and action like 'role.%' order by seq`,
      [people.author],
    )
    expect(logged.rows).toEqual([
      { action: 'role.granted', role: 'administrator' },
      { action: 'role.revoked', role: 'administrator' },
    ])
  })
})

describe('owners of a domain', () => {
  it('add owners to their own domain, and nothing else', async () => {
    const added = await call(owner, 'PUT', '/areas/finance/owners', {
      personIds: [people.owner, extra.coowner],
    })
    expect(added.statusCode, added.body).toBe(200)
    expect(added.json<OwnersSet>()).toMatchObject({ areaId: 'finance', changed: true })
    expect(await ownersOf('finance')).toEqual([people.owner, extra.coowner].sort())
    // Another domain's owners are not theirs to set; a member who owns nothing sets none.
    const other = await call(owner, 'PUT', '/areas/marketing/owners', {
      personIds: [people.stranger, people.owner],
    })
    expect(other.statusCode).toBe(403)
    expect(other.json()).toMatchObject({ message: 'Only its owners and admins add owners.' })
    expect(
      (await call(author, 'PUT', '/areas/finance/owners', { personIds: [people.author] }))
        .statusCode,
    ).toBe(403)
    expect(await ownersOf('marketing')).toEqual([people.stranger])
  })

  it('keep at least one owner, and may hand their own ownership over', async () => {
    const none = await call(stranger, 'PUT', '/areas/marketing/owners', { personIds: [] })
    expect(none.statusCode).toBe(409)
    expect(none.json<{ message: string }>().message).toContain('must keep at least one owner')
    // The only owner hands over: the new owner arrives and they leave, in one step.
    const handed = await call(stranger, 'PUT', '/areas/marketing/owners', {
      personIds: [people.author],
    })
    expect(handed.statusCode, handed.body).toBe(200)
    expect(await ownersOf('marketing')).toEqual([people.author])
    // No longer an owner, they change it no more; an admin changes any domain.
    expect(
      (await call(stranger, 'PUT', '/areas/marketing/owners', { personIds: [people.stranger] }))
        .statusCode,
    ).toBe(403)
    const back = await call(admin, 'PUT', '/areas/marketing/owners', {
      personIds: [people.stranger, people.author],
    })
    expect(back.json<OwnersSet>()).toMatchObject({ changed: true })
    expect(await ownersOf('marketing')).toEqual([people.author, people.stranger].sort())
  })

  it('refuses a person who is not active, and a deleted domain', async () => {
    await client.query('update people set deactivated_at=now() where id=$1', [extra.leaver])
    expect(
      (
        await call(admin, 'PUT', '/areas/finance/owners', {
          personIds: [people.owner, extra.leaver],
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (await call(admin, 'PUT', '/areas/nowhere/owners', { personIds: [people.owner] })).statusCode,
    ).toBe(404)
  })
})

describe('removing someone from the workspace', () => {
  it('waits while a domain has them as its only owner, and names those domains', async () => {
    await call(admin, 'PUT', '/areas/marketing/owners', { personIds: [people.stranger] })
    const refused = await call(admin, 'POST', `/members/${people.stranger}/remove`, {})
    expect(refused.statusCode).toBe(409)
    expect(refused.json()).toMatchObject({
      message: 'Hand over first: they are the only owner of a domain.',
      data: { areas: ['marketing'] },
    })
    expect(await memberOf(admin, people.stranger)).toBeDefined()
  })

  it('ends their roles and sessions, and Undo puts back exactly those roles', async () => {
    await call(admin, 'PUT', '/areas/marketing/owners', {
      personIds: [people.stranger, extra.coowner],
    })
    const before = await call(stranger, 'GET', '/me')
    expect(before.statusCode).toBe(200)
    const removed = await call(admin, 'POST', `/members/${people.stranger}/remove`, {})
    expect(removed.statusCode, removed.body).toBe(200)
    expect(removed.json<{ removed: boolean; batchId: string }>()).toMatchObject({ removed: true })
    expect(removed.json<{ batchId: string }>().batchId).toMatch(/^[0-9a-f-]{36}$/)
    // Signed out at once, gone from the list, owning nothing.
    expect((await call(stranger, 'GET', '/me')).statusCode).toBe(401)
    expect(await memberOf(admin, people.stranger)).toBeUndefined()
    expect(await ownersOf('marketing')).toEqual([extra.coowner])
    expect(
      (await client.query('select 1 from auth.sessions where person_id=$1', [people.stranger]))
        .rowCount,
    ).toBe(0)
    // They can't sign in again until an admin brings them back.
    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin, 'x-heed-csrf': 'dev-sign-in' },
      payload: { email: 'stranger@example.test' },
    })
    expect(again.statusCode).not.toBe(200)

    expect((await call(admin, 'POST', `/members/${people.stranger}/restore`, {})).json()).toEqual({
      changed: true,
    })
    expect(await memberOf(admin, people.stranger)).toMatchObject({ owns: ['marketing'] })
    expect(await ownersOf('marketing')).toEqual([people.stranger, extra.coowner].sort())
    // A second Undo changes nothing.
    expect((await call(admin, 'POST', `/members/${people.stranger}/restore`, {})).json()).toEqual({
      changed: false,
    })
    const history = await client.query<{ action: string }>(
      `select action from audit_log where subject_id=$1 and action like 'person.%' order by seq`,
      [people.stranger],
    )
    expect(history.rows.map((row) => row.action)).toEqual(['person.removed', 'person.restored'])
  })

  it('is an admin’s, never one’s own, and never leaves the workspace without an admin', async () => {
    expect((await call(owner, 'POST', `/members/${people.author}/remove`, {})).statusCode).toBe(403)
    const own = await call(admin, 'POST', `/members/${people.admin}/remove`, {})
    expect(own.statusCode).toBe(409)
    expect(own.json()).toMatchObject({ message: "You can't remove yourself. Ask another admin." })
    expect((await call(admin, 'POST', `/members/${people.admin}/restore`, {})).json()).toEqual({
      changed: false,
    })
    expect((await call(admin, 'POST', `/members/${randomUUID()}/remove`, {})).statusCode).toBe(404)
  })
})

describe('row security, for a holder of the API role who skips the service', () => {
  const as = async <T>(person: string, work: () => Promise<T>) =>
    transaction(client, async () => {
      await client.query(`set local role ${identifier(localRoles.api)}`)
      await client.query("select set_config('cl.person_id',$1,true)", [person])
      return work()
    })

  it('lets an owner give and end ownership of their own domain only', async () => {
    await as(people.owner, () =>
      client.query(
        "insert into area_assignments (area_id,person_id,role,granted_by) values ('finance',$1,'owner',$2)",
        [people.author, people.owner],
      ),
    )
    for (const sql of [
      "insert into area_assignments (area_id,person_id,role) values ('marketing',$1,'owner')",
      "insert into area_assignments (area_id,person_id,role) values ('finance',$1,'approver')",
      "insert into global_role_grants (person_id,role) values ($1,'administrator')",
    ])
      await expect(
        as(people.owner, () => client.query(sql, [people.author])),
      ).rejects.toMatchObject({
        code: '42501',
      })
    // Ending another domain's ownership touches no row.
    const ended = await as(people.owner, () =>
      client.query(
        "update area_assignments set valid_at=tstzrange(lower(valid_at),now(),'[)') where area_id='marketing' and valid_at @> now()",
      ),
    )
    expect(ended.rowCount).toBe(0)
    // A member who owns nothing gives nothing.
    await expect(
      as(people.author, () =>
        client.query(
          "insert into area_assignments (area_id,person_id,role) values ('marketing',$1,'owner')",
          [people.author],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
