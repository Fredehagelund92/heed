import { performance } from 'node:perf_hooks'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PeoplePage, PersonSheet } from '../../src/contract/people.ts'
import { buildApp } from '../../src/server/app.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import type { DevPerson } from '../../src/server/modules/auth/index.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { apiDatabase, testDatabase } from './support.ts'
import { foundation, people } from './fixtures.ts'

// The People page (people and roles decision, option C, slice 1): finding people on the server,
// their roles and last sign-in, a person's sheet, and the speed targets at 5,000 people.
const { client, url } = testDatabase()
const devPeople: DevPerson[] = ['author', 'owner', 'approver', 'admin', 'stranger'].map((name) => ({
  email: `${name}@example.test`,
  name,
  roles: [],
}))
const app = buildApp({
  database: apiDatabase(url),
  logger: createLogger({ level: 'silent' }),
  devPeople,
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
let admin: Auth
const search = async (query: Record<string, string | number>, headers: Auth = admin) => {
  const params = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))
  const response = await app.inject({ url: `/api/v1/people/search?${params.toString()}`, headers })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<PeoplePage>()
}
const names = (page: PeoplePage) => page.people.map((person) => person.name)

const extra = {
  anna: '00000000-0000-4000-8000-0000000000a1',
  annaToo: '00000000-0000-4000-8000-0000000000a2',
  joanna: '00000000-0000-4000-8000-0000000000a3',
  leaver: '00000000-0000-4000-8000-0000000000a4',
  erased: '00000000-0000-4000-8000-0000000000a5',
  percent: '00000000-0000-4000-8000-0000000000a6',
}

beforeAll(async () => {
  await foundation(client)
  await client.query(
    `insert into people (id,email,display_name,deactivated_at,erased_at) values
      ($1,'anna.larsen@example.test','Anna Larsen',null,null),
      ($2,'anna.larsen2@example.test','Anna Larsen',null,null),
      ($3,'jo.berg@example.test','Joanna Berg',null,null),
      ($4,'left.person@example.test','Annika Left',now(),null),
      ($5,'erased-a5@erased.invalid','Erased person',now(),now()),
      ($6,'percent@example.test','Ten 100% sure',null,null)`,
    Object.values(extra),
  )
  await app.ready()
  admin = await login('admin')
})
afterAll(() => app.close())

describe('who may find people and read a sheet', () => {
  it('lets administrators and auditors search, and only administrators read a sheet', async () => {
    expect((await app.inject({ url: '/api/v1/people/search' })).statusCode).toBe(401)
    const author = await login('author')
    expect((await app.inject({ url: '/api/v1/people/search', headers: author })).statusCode).toBe(
      403,
    )
    await client.query("insert into global_role_grants (person_id,role) values ($1,'auditor')", [
      people.stranger,
    ])
    try {
      const auditor = await login('stranger')
      expect((await search({ q: 'anna' }, auditor)).total).toBe(3)
      expect(
        (await app.inject({ url: `/api/v1/people/${people.author}/roles`, headers: auditor }))
          .statusCode,
      ).toBe(403)
    } finally {
      await client.query("delete from global_role_grants where person_id=$1 and role='auditor'", [
        people.stranger,
      ])
    }
  })
})

describe('finding people', () => {
  it('matches the start of the name or the email first, then a word, then anywhere', async () => {
    const page = await search({ q: 'anna' })
    // Annika Left is gone and Joanna only contains the words: "Joanna Berg" ranks after both Annas.
    expect(names(page)).toEqual(['Anna Larsen', 'Anna Larsen', 'Joanna Berg'])
    // Two people of one name are told apart by their email.
    expect(page.people.map((person) => person.email)).toEqual([
      'anna.larsen@example.test',
      'anna.larsen2@example.test',
      'jo.berg@example.test',
    ])
    expect(names(await search({ q: 'LARSEN' }))).toEqual(['Anna Larsen', 'Anna Larsen'])
    expect(names(await search({ q: 'jo.berg@' }))).toEqual(['Joanna Berg'])
    expect(names(await search({ q: '  anna   larsen ' }))).toEqual(['Anna Larsen', 'Anna Larsen'])
  })

  it('reads % and _ as themselves', async () => {
    expect(names(await search({ q: '100%' }))).toEqual(['Ten 100% sure'])
    expect((await search({ q: '%' })).total).toBe(1)
    expect((await search({ q: '_' })).total).toBe(0)
  })

  it('hides leavers unless asked, and never matches an erased address', async () => {
    expect(names(await search({ q: 'annika' }))).toEqual([])
    const left = await search({ status: 'left' })
    expect(left.people.map((person) => [person.name, person.status, person.email])).toEqual([
      ['Annika Left', 'left', 'left.person@example.test'],
      ['Erased person', 'erased', null],
    ])
    expect((await search({ q: 'erased.invalid', status: 'all' })).total).toBe(0)
    expect((await search({ status: 'all' })).total).toBe(11)
  })

  it('filters by role, area and no role, with each row carrying the roles held now', async () => {
    expect(names(await search({ role: 'owner' }))).toEqual(['owner'])
    expect(names(await search({ role: 'administrator' }))).toEqual(['admin'])
    expect(names(await search({ areaId: 'finance' }))).toEqual(['approver', 'owner'])
    expect(names(await search({ areaId: 'finance', role: 'approver' }))).toEqual(['approver'])
    expect(names(await search({ areaId: 'marketing' }))).toEqual([])
    const none = names(await search({ role: 'none' }))
    expect(none).toContain('author')
    expect(none).not.toContain('owner')
    expect(none).not.toContain('admin')
    const [owner] = (await search({ q: 'owner' })).people
    expect(owner?.roles).toEqual([{ role: 'owner', areaId: 'finance' }])
    expect((await search({ q: 'admin' })).people[0]?.roles).toEqual([
      { role: 'administrator', areaId: null },
    ])
  })

  it('records the last sign-in and filters by it', async () => {
    const [signedIn] = (await search({ q: 'admin@' })).people
    expect(Date.now() - Date.parse(signedIn!.lastSignedInAt!)).toBeLessThan(60_000)
    expect(names(await search({ signedIn: 'week', q: 'admin' }))).toEqual(['admin'])
    expect(names(await search({ signedIn: 'never', q: 'anna' }))).toEqual([
      'Anna Larsen',
      'Anna Larsen',
      'Joanna Berg',
    ])
    await client.query("update people set last_signed_in_at=now()-interval '45 days' where id=$1", [
      extra.joanna,
    ])
    expect(names(await search({ signedIn: 'older' }))).toEqual(['Joanna Berg'])
    expect(names(await search({ signedIn: 'month', q: 'joanna' }))).toEqual([])
  })

  it('pages with a total and the next offset', async () => {
    const first = await search({ status: 'all', limit: 4 })
    expect(first).toMatchObject({ total: 11, next: 4 })
    expect(first.people).toHaveLength(4)
    const last = await search({ status: 'all', limit: 4, offset: 8 })
    expect(last).toMatchObject({ total: 11, next: null })
    expect(last.people).toHaveLength(3)
    expect(await search({ status: 'all', offset: 50 })).toMatchObject({
      people: [],
      total: 11,
      next: null,
    })
  })

  it('refuses input outside the contract', async () => {
    for (const query of ['limit=0', 'limit=101', 'role=steward', 'areaId=Finance', 'status=gone'])
      expect(
        (await app.inject({ url: `/api/v1/people/search?${query}`, headers: admin })).statusCode,
      ).toBe(400)
  })
})

describe("a person's sheet", () => {
  it('shows every role held, since when and from whom, and every change from the history log', async () => {
    const grant = (path: string, payload: object) =>
      app.inject({ method: 'POST', url: `/api/v1${path}`, headers: admin, payload })
    const approver = { personId: extra.anna, role: 'approver', areaId: 'marketing' }
    expect((await grant('/assignments/grant', approver)).statusCode).toBe(200)
    expect(
      (await grant('/roles/grant', { personId: extra.anna, role: 'auditor' })).statusCode,
    ).toBe(200)
    expect(
      (await grant('/roles/revoke', { personId: extra.anna, role: 'auditor' })).statusCode,
    ).toBe(200)
    const response = await app.inject({ url: `/api/v1/people/${extra.anna}/roles`, headers: admin })
    expect(response.statusCode, response.body).toBe(200)
    const sheet = response.json<PersonSheet>()
    expect(sheet.person).toMatchObject({
      id: extra.anna,
      name: 'Anna Larsen',
      initials: 'AL',
      email: 'anna.larsen@example.test',
      status: 'active',
      roles: [{ role: 'approver', areaId: 'marketing' }],
    })
    expect(sheet.grants).toEqual([
      expect.objectContaining({ role: 'approver', areaId: 'marketing', grantedBy: people.admin }),
    ])
    expect(sheet.history.map((entry) => [entry.change, entry.role, entry.areaId])).toEqual([
      ['revoked', 'auditor', null],
      ['granted', 'auditor', null],
      ['granted', 'approver', 'marketing'],
    ])
    expect(sheet.history.every((entry) => entry.actorName === 'admin')).toBe(true)
  })

  it('reads a role the history log wrote as steward, before 0086, as owner', async () => {
    await client.query(
      `insert into audit_log (actor_id,actor_kind,action,area_id,subject_type,subject_id,details)
       values ($1,'person','assignment.granted','finance','person',$2,'{"role":"steward"}')`,
      [people.admin, people.approver],
    )
    const sheet = (
      await app.inject({ url: `/api/v1/people/${people.approver}/roles`, headers: admin })
    ).json<PersonSheet>()
    expect(sheet.history.map((entry) => [entry.change, entry.role, entry.areaId])).toEqual([
      ['granted', 'owner', 'finance'],
    ])
  })

  it('names a role given at set up without a giver, and answers 404 for nobody', async () => {
    const sheet = (
      await app.inject({ url: `/api/v1/people/${people.owner}/roles`, headers: admin })
    ).json<PersonSheet>()
    expect(sheet.grants).toEqual([
      expect.objectContaining({ role: 'owner', areaId: 'finance', grantedBy: null }),
    ])
    expect(sheet.history).toEqual([])
    expect(
      (
        await app.inject({
          url: '/api/v1/people/00000000-0000-4000-8000-0000000000ff/roles',
          headers: admin,
        })
      ).statusCode,
    ).toBe(404)
  })
})

describe('speed at 5,000 people (people and roles decision, section 6)', () => {
  it('answers a search in under 150 ms at the 95th percentile and the first 50 rows in under 300 ms', async () => {
    await client.query(
      `insert into people (email,display_name,last_signed_in_at)
         select 'person' || n || '@example.test',
                (array['Anna','Jon','Maria','Sofia','Tomas','Noor','Priya','Lars','Ines','Kofi'])[1 + n % 10]
                  || ' ' || (array['Larsen','Abara','Lindqvist','Brandt','Eriksen','Haddad','Nair','Dahl'])[1 + n / 10 % 8]
                  || ' ' || n,
                case when n % 3 = 0 then null else now() - (n % 90) * interval '1 day' end
           from generate_series(1, 5000) n`,
    )
    await client.query(
      `insert into area_assignments (area_id,person_id,role)
         select 'marketing', id, 'approver' from people where email like 'person%0@example.test' limit 40`,
    )
    await client.query('analyze people')
    // Each search's time is the best of three, so a machine busy with other work (other suites,
    // other lanes) measures the search, not the wait for a free core. Alone, p95 is about 14 ms.
    const time = async (query: Record<string, string | number>) => {
      let best = Infinity
      for (let run = 0; run < 3; run++) {
        const start = performance.now()
        await search(query)
        best = Math.min(best, performance.now() - start)
      }
      return best
    }
    // Warm the connection and the plans as a running service has them.
    for (let i = 0; i < 5; i++) await time({ q: 'anna' })
    const words = [
      'an',
      'anna',
      'lars',
      'larsen 1',
      'maria lind',
      'person12',
      '@example',
      'z',
      'kofi',
      'dahl 4',
    ]
    const samples: number[] = []
    for (let round = 0; round < 2; round++)
      for (const q of words) samples.push(await time({ q, limit: 20 }))
    for (const role of ['approver', 'none'] as const)
      samples.push(await time({ role, areaId: 'marketing' }), await time({ role }))
    samples.push(await time({ signedIn: 'never' }), await time({ signedIn: 'older', q: 'jon' }))
    samples.sort((a, b) => a - b)
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!
    expect(p95, `p95 ${p95.toFixed(1)} ms over ${samples.length} searches`).toBeLessThan(150)
    const firstPage = await time({})
    expect(firstPage, `first page ${firstPage.toFixed(1)} ms`).toBeLessThan(300)
  })
})
