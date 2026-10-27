import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Invite, InviteResent, InvitesCreated } from '../../src/contract/members.ts'
import { buildApp } from '../../src/server/app.ts'
import { identifier, localRoles } from '../../src/server/db/roles.ts'
import { acceptInvite, inviteTokenHash } from '../../src/server/modules/auth/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, tableContents, testDatabase, transaction } from './support.ts'

/*
  Invites (FR-417), end to end over HTTP and PostgreSQL. The link carries 256 random bits and
  only their SHA-256 is kept: no table and no log line holds a working link. A link works for a
  week from when it was last sent; sending it again replaces it. An invite is accepted once, at
  the sign-in that proves its address, and gives its role and domains; an address with no open
  invite in time gets the same nothing whatever the reason, so acceptance tells no one which
  addresses were invited. Who may invite, send again and take back is held by the service and
  by row security alike.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const logs: string[] = []
const web = 'https://heed.example'
const app = buildApp({
  database,
  logger: createLogger({
    level: 'trace',
    destination: {
      write(line: string) {
        logs.push(line)
      },
    },
  }),
  devPeople: ['author', 'owner', 'admin', 'stranger'].map((name) => ({
    email: `${name}@example.test`,
    name,
    roles: [],
  })),
  origins: [web],
  jobs: idleJobs(),
})
type Auth = { cookie: string; 'x-heed-csrf': string; origin: string }
async function login(name: string): Promise<Auth> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin: web, 'x-heed-csrf': 'dev-sign-in' },
    payload: { email: `${name}@example.test` },
  })
  expect(response.statusCode, response.body).toBe(200)
  return {
    cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    'x-heed-csrf': response.json<{ csrfToken: string }>().csrfToken,
    origin: web,
  }
}
const call = (auth: Auth, method: 'GET' | 'POST', path: string, payload?: object) =>
  app.inject({
    method,
    url: `/api/v1${path}`,
    headers: { ...auth, ...(method === 'GET' ? {} : { 'idempotency-key': randomUUID() }) },
    ...(payload ? { payload } : {}),
  })
const invite = async (auth: Auth, payload: object) => {
  const response = await call(auth, 'POST', '/invites', payload)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<InvitesCreated>().results
}
const tokenOf = (link: string) => {
  const match = /^https:\/\/heed\.example\/#\/signin\?invite=([A-Za-z0-9_-]{43})$/.exec(link)
  expect(match, link).not.toBeNull()
  return match![1]!
}
/** Every link any test was shown, to look for in the tables and the logs. */
const shown: string[] = []
const linkOf = (result: InvitesCreated['results'][number] | InviteResent) => {
  expect('link' in result, JSON.stringify(result)).toBe(true)
  const token = tokenOf((result as { link: string }).link)
  shown.push(token)
  return token
}
const accept = (email: string, name = 'Someone') =>
  transaction(client, async () => {
    await client.query(`set local role ${identifier(localRoles.api)}`)
    const tx = {
      query: async <T>(sql: string, values?: unknown[]) =>
        (await client.query(sql, values)).rows as T[],
    }
    return acceptInvite(tx, { email, name })
  })
const openInvites = async (auth: Auth) => (await call(auth, 'GET', '/invites')).json<Invite[]>()

let admin: Auth
let owner: Auth
let author: Auth
let stranger: Auth

beforeAll(async () => {
  await transaction(client, () => foundation(client))
  await client.query("insert into areas (id,name,archived_at) values ('old','Old',now())")
  admin = await login('admin')
  owner = await login('owner')
  author = await login('author')
  stranger = await login('stranger')
})
afterAll(() => app.close())

describe('inviting', () => {
  it('invites each address once, with a link shown only to its sender, and keeps only its hash', async () => {
    const results = await invite(admin, {
      emails: [
        'Nina@Larchwood.example',
        'omar@larchwood.example',
        'nina@larchwood.example',
        'author@example.test',
      ],
      role: 'member',
      areaIds: ['marketing'],
    })
    expect(results.map((r) => [r.email, r.outcome])).toEqual([
      ['nina@larchwood.example', 'invited'],
      ['omar@larchwood.example', 'invited'],
      ['author@example.test', 'member'],
    ])
    const nina = linkOf(results[0]!)
    const omar = linkOf(results[1]!)
    expect(nina).not.toBe(omar)
    const stored = await client.query<{ token_hash: string }>(
      "select token_hash from invites where email='nina@larchwood.example'",
    )
    expect(stored.rows).toEqual([{ token_hash: inviteTokenHash(nina) }])
    // Everyone signed in sees the open invites, never a link.
    const listed = await openInvites(author)
    expect(listed.map((i) => i.email).sort()).toEqual([
      'nina@larchwood.example',
      'omar@larchwood.example',
    ])
    expect(listed[0]).toMatchObject({
      role: 'member',
      areaIds: ['marketing'],
      invitedBy: people.admin,
      expired: false,
    })
    expect(JSON.stringify(listed)).not.toContain(nina)
    // An open invite is named, not sent again.
    const again = await invite(admin, {
      emails: ['nina@larchwood.example'],
      role: 'admin',
      areaIds: [],
    })
    expect(again).toEqual([expect.objectContaining({ outcome: 'pending' })])
    expect('link' in again[0]!).toBe(false)
  })

  it('lets an owner invite a member to their own domains, and nothing more', async () => {
    const results = await invite(owner, {
      emails: ['pia@larchwood.example'],
      role: 'member',
      areaIds: ['finance'],
    })
    linkOf(results[0]!)
    for (const [who, payload] of [
      [owner, { emails: ['x1@larchwood.example'], role: 'admin', areaIds: ['finance'] }],
      [owner, { emails: ['x2@larchwood.example'], role: 'member', areaIds: ['marketing'] }],
      [owner, { emails: ['x3@larchwood.example'], role: 'member', areaIds: [] }],
      [author, { emails: ['x4@larchwood.example'], role: 'member', areaIds: [] }],
    ] as const) {
      const refused = await call(who, 'POST', '/invites', payload)
      expect(refused.statusCode, JSON.stringify(payload)).toBe(403)
      expect(refused.json()).toMatchObject({
        message:
          'Only an admin invites people. An owner invites people to their own domains, but not as an admin.',
      })
    }
    expect((await client.query("select 1 from invites where email like 'x%'")).rowCount).toBe(0)
    // A deleted domain, or one that never was, is not offered.
    for (const areaIds of [['old'], ['nowhere']])
      expect(
        (
          await call(admin, 'POST', '/invites', {
            emails: ['x5@larchwood.example'],
            role: 'member',
            areaIds,
          })
        ).statusCode,
      ).toBe(404)
  })

  it('sends an invite again with a new link that replaces the old, by its sender or an admin', async () => {
    const [pia] = (await openInvites(admin)).filter((i) => i.email === 'pia@larchwood.example')
    expect((await call(stranger, 'POST', `/invites/${pia!.id}/resend`, {})).statusCode).toBe(403)
    const resent = await call(owner, 'POST', `/invites/${pia!.id}/resend`, {})
    expect(resent.statusCode, resent.body).toBe(200)
    const token = linkOf(resent.json<InviteResent>())
    const byAdmin = await call(admin, 'POST', `/invites/${pia!.id}/resend`, {})
    const newest = linkOf(byAdmin.json<InviteResent>())
    expect(newest).not.toBe(token)
    const stored = await client.query<{ token_hash: string }>(
      'select token_hash from invites where id=$1',
      [pia!.id],
    )
    expect(stored.rows[0]!.token_hash).toBe(inviteTokenHash(newest))
  })

  it('takes an invite back, by its sender or an admin; a taken-back invite is not accepted', async () => {
    const [omar] = (await openInvites(admin)).filter((i) => i.email === 'omar@larchwood.example')
    expect((await call(owner, 'POST', `/invites/${omar!.id}/revoke`, {})).statusCode).toBe(403)
    expect((await call(admin, 'POST', `/invites/${omar!.id}/revoke`, {})).json()).toEqual({
      revoked: true,
    })
    expect((await call(admin, 'POST', `/invites/${omar!.id}/revoke`, {})).statusCode).toBe(404)
    expect((await call(admin, 'POST', `/invites/${omar!.id}/resend`, {})).statusCode).toBe(404)
    expect((await openInvites(admin)).map((i) => i.email)).not.toContain('omar@larchwood.example')
    expect(await accept('omar@larchwood.example')).toBeNull()
  })
})

describe('accepting', () => {
  it('accepts once, at the sign-in that proves the address, with the role and the domains', async () => {
    const person = await accept('NINA@larchwood.example ', 'Nina Berg')
    expect(person).toMatch(/^[0-9a-f-]{36}$/)
    const made = await client.query(
      `select p.display_name as name, p.email,
              (select array_agg(area_id) from area_assignments where person_id=p.id and role='owner' and valid_at @> now()) as owns,
              (select count(*)::int from global_role_grants where person_id=p.id and valid_at @> now()) as roles
         from people p where p.id=$1`,
      [person],
    )
    expect(made.rows).toEqual([
      { name: 'Nina Berg', email: 'nina@larchwood.example', owns: ['marketing'], roles: 0 },
    ])
    expect((await openInvites(admin)).map((i) => i.email)).not.toContain('nina@larchwood.example')
    // Single use: the same address again gets nothing, and changes nothing.
    expect(await accept('nina@larchwood.example')).toBeNull()
    const history = await client.query<{ action: string; actor: string }>(
      `select action, actor_id::text as actor from audit_log
        where (subject_type='person' and subject_id=$1) or action='invite.accepted' order by seq`,
      [person],
    )
    expect(history.rows).toEqual([
      { action: 'invite.accepted', actor: person },
      { action: 'assignment.granted', actor: people.admin },
    ])
  })

  it('gives an admin invite the admin role, and brings back someone who was removed', async () => {
    await client.query('update people set deactivated_at=now() where id=$1', [people.stranger])
    await client.query(
      "update area_assignments set valid_at=tstzrange(lower(valid_at),now(),'[)') where person_id=$1 and valid_at @> now()",
      [people.stranger],
    )
    // An owner's invite does not bring back someone an admin removed.
    const byOwner = await invite(owner, {
      emails: ['stranger@example.test'],
      role: 'member',
      areaIds: ['finance'],
    })
    linkOf(byOwner[0]!)
    expect(await accept('stranger@example.test', 'Ignored')).toBeNull()
    await call(admin, 'POST', `/invites/${(byOwner[0] as { invite: Invite }).invite.id}/revoke`, {})
    const results = await invite(admin, {
      emails: ['stranger@example.test'],
      role: 'admin',
      areaIds: ['finance'],
    })
    linkOf(results[0]!)
    expect(await accept('stranger@example.test', 'Ignored')).toBe(people.stranger)
    const back = await client.query(
      `select display_name as name, deactivated_at is null as active,
              exists (select 1 from global_role_grants where person_id=p.id and role='administrator' and valid_at @> now()) as admin
         from people p where id=$1`,
      [people.stranger],
    )
    expect(back.rows).toEqual([{ name: 'stranger', active: true, admin: true }])
  })

  it('does not accept an expired invite, and answers every address without one alike', async () => {
    const results = await invite(admin, {
      emails: ['late@larchwood.example'],
      role: 'member',
      areaIds: [],
    })
    linkOf(results[0]!)
    await client.query(
      "update invites set sent_at=now()-interval '8 days', expires_at=now()-interval '1 day' where email='late@larchwood.example'",
    )
    const before = await client.query('select count(*)::int as n from people')
    for (const address of [
      'late@larchwood.example', // expired
      'omar@larchwood.example', // taken back
      'nina@larchwood.example', // used
      'nobody@larchwood.example', // never invited
    ])
      expect(await accept(address), address).toBeNull()
    expect((await client.query('select count(*)::int as n from people')).rows).toEqual(before.rows)
    // An expired invite lists as expired; inviting the address again replaces it.
    const [late] = (await openInvites(admin)).filter((i) => i.email === 'late@larchwood.example')
    expect(late).toMatchObject({ expired: true })
    const again = await invite(admin, {
      emails: ['late@larchwood.example'],
      role: 'member',
      areaIds: [],
    })
    expect(again[0]).toMatchObject({ outcome: 'invited' })
    linkOf(again[0]!)
    expect(await accept('late@larchwood.example')).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('row security, for a holder of the API role who skips the service', () => {
  const as = <T>(person: string, work: () => Promise<T>) =>
    transaction(client, async () => {
      await client.query(`set local role ${identifier(localRoles.api)}`)
      await client.query("select set_config('cl.person_id',$1,true)", [person])
      return work()
    })
  it('holds who may invite, send again and take back, and what an invite is', async () => {
    const insert = (by: string, role: string, areas: string[]) =>
      client.query(
        `insert into invites (email,role,area_ids,invited_by,token_hash,expires_at)
         values ($1,$2,$3,$4,$5,now()+interval '7 days')`,
        [`${randomUUID()}@larchwood.example`, role, areas, by, inviteTokenHash(randomUUID())],
      )
    for (const [person, by, role, areas] of [
      [people.owner, people.owner, 'admin', ['finance']],
      [people.owner, people.owner, 'member', ['marketing']],
      [people.owner, people.owner, 'member', []],
      [people.author, people.author, 'member', []],
      [people.owner, people.admin, 'member', ['finance']],
    ] as const)
      await expect(as(person, () => insert(by, role, [...areas]))).rejects.toMatchObject({
        code: '42501',
      })
    await as(people.owner, () => insert(people.owner, 'member', ['finance']))
    // Another's invite is not theirs to send again or take back.
    const [made] = await invite(admin, {
      emails: ['rls@larchwood.example'],
      role: 'member',
      areaIds: [],
    })
    linkOf(made!)
    const pending = (made as { invite: Invite }).invite
    const touched = await as(people.owner, () =>
      client.query('update invites set revoked_at=now(), revoked_by=$2 where id=$1', [
        pending.id,
        people.owner,
      ]),
    )
    expect(touched.rowCount).toBe(0)
    // An invite's address, role and domains never change, even for an admin.
    await expect(
      as(people.admin, () =>
        client.query("update invites set role='admin' where id=$1", [pending.id]),
      ),
    ).rejects.toMatchObject({ code: '42501' })
    // Nothing deletes an invite through the API role.
    await expect(as(people.admin, () => client.query('delete from invites'))).rejects.toMatchObject(
      {
        code: '42501',
      },
    )
    // Signed out, nothing reads them.
    expect((await as('', () => client.query('select 1 from invites'))).rowCount).toBe(0)
  })
})

describe('what is kept', () => {
  it('holds no working link in any table or log line, and no address in the history log', async () => {
    expect(shown.length).toBeGreaterThan(5)
    const tables = await tableContents(client)
    const text = JSON.stringify(tables) + logs.join('\n')
    for (const token of shown) expect(text.includes(token), 'a link token').toBe(false)
    const addresses = await client.query(
      "select 1 from audit_log where action like 'invite.%' and details::text like '%@%'",
    )
    expect(addresses.rowCount).toBe(0)
  })
})
