import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { run } from '../../src/cli/commands.ts'
import { operatorInvite } from '../../src/cli/invite.ts'
import { buildApp } from '../../src/server/app.ts'
import {
  createOidcSignIn,
  type OidcSettings,
  type SessionLifetime,
} from '../../src/server/modules/auth/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { startOidcProvider, type Account, type Tweaks } from './oidc-provider.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Company sign-in with OpenID Connect (FR-416; the threat note in docs/ai-sign-in.md), end to end
  against a local provider over real HTTP, on PostgreSQL: the code flow with PKCE, a sign-in tied
  to its browser and used once, every check of the ID token, a new session at every sign-in, who
  may sign in (a linked account, an active person or an open invite by a verified address, a
  mapped group) and one plain refusal for everyone else, the session's idle and absolute ends,
  and logs that hold no code, token, address or account.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const provider = await startOidcProvider()
const web = 'https://heed.example'
const redirectUrl = 'https://heed.example/api/v1/auth/oidc/callback'
const lifetime: SessionLifetime = { idleHours: 12, maxDays: 7 }
const logs: string[] = []
const settings: OidcSettings = {
  issuer: provider.issuer,
  clientId: provider.clientId,
  clientSecret: provider.clientSecret,
  redirectUrl,
  scopes: 'openid email profile',
  groupsClaim: 'groups',
  adminGroups: ['heed-admins'],
  memberGroups: ['heed-people'],
  name: 'Test provider',
}
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
  signIn: createOidcSignIn({ settings, database, webOrigin: web, lifetime }),
  origins: [web],
  jobs: idleJobs(),
})

/** A browser: the cookies the app set for it. */
function browser() {
  const jar = new Map<string, string>()
  const header = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
  const keep = (setCookie: string | string[] | undefined) => {
    for (const line of [setCookie ?? []].flat()) {
      const [pair, ...attributes] = line.split(';')
      const [name, value] = pair!.split('=') as [string, string]
      if (attributes.some((a) => a.trim().toLowerCase() === 'max-age=0')) jar.delete(name.trim())
      else jar.set(name.trim(), value)
    }
  }
  return {
    jar,
    header,
    keep,
    api: (path: string) =>
      app.inject({ url: `/api/v1${path}`, headers: { cookie: header(), origin: web } }),
  }
}
type Browser = ReturnType<typeof browser>

/** Starts a sign-in in the app; the provider's authorize address. */
async function start(person: Browser, returnTo = '/#/inbox') {
  const response = await app.inject({
    url: `/api/v1/auth/oidc/start?returnTo=${encodeURIComponent(returnTo)}`,
    headers: { cookie: person.header() },
  })
  expect(response.statusCode, response.body).toBe(302)
  person.keep(response.headers['set-cookie'])
  return response.headers.location as string
}
/** The provider signs the account in and sends the browser back: the callback address. */
async function atProvider(authorize: string) {
  const response = await fetch(authorize, { redirect: 'manual' })
  expect(response.status).toBe(302)
  return new URL(response.headers.get('location')!)
}
async function callback(person: Browser, back: URL) {
  const response = await app.inject({
    url: `${back.pathname}${back.search}`,
    headers: { cookie: person.header() },
  })
  expect(response.statusCode, response.body).toBe(302)
  person.keep(response.headers['set-cookie'])
  return response
}
/** A whole sign-in as an account; where the browser ends up. */
async function signIn(
  account: Account,
  tweaks: Tweaks = {},
  person = browser(),
  returnTo?: string,
) {
  provider.as(account, tweaks)
  const response = await callback(person, await atProvider(await start(person, returnTo)))
  return { person, location: response.headers.location as string, response }
}
const refusedWith = (reason: string) => `${web}/#/signin?error=${reason}`
const me = async (person: Browser) => {
  const response = await person.api('/me')
  return response.statusCode === 200
    ? response.json<{ id: string; name: string; permissions: { roles: string[] } }>()
    : null
}
const invite = (email: string, admin = false, domains: string[] = []) =>
  operatorInvite({ databaseUrl: url, webOrigin: web, email, admin, domains })

beforeAll(async () => {
  await transaction(client, () => foundation(client))
})
beforeEach(() => provider.as({ sub: 'nobody' }))
afterAll(async () => {
  await app.close()
  await provider.close()
})

describe('signing in with the company provider', () => {
  it('accepts an invite at the first sign-in by a verified address, and lands signed in', async () => {
    const invited = await invite('first.admin@larchwood.example', true)
    expect(invited.outcome).toBe('invited')
    const { person, location, response } = await signIn({
      sub: 'acct-first',
      email: 'First.Admin@larchwood.example',
      email_verified: true,
      name: 'First Admin',
    })
    expect(location).toBe(`${web}/#/inbox`)
    const cookies = [response.headers['set-cookie']].flat().join('\n')
    expect(cookies).toMatch(
      /heed_session=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=604800; Secure/,
    )
    expect(cookies).toMatch(
      /heed_oidc_browser=; Path=\/api\/v1\/auth\/oidc; HttpOnly; SameSite=Lax; Max-Age=0; Secure/,
    )
    const who = await me(person)
    expect(who).toMatchObject({ name: 'First Admin', permissions: { roles: ['administrator'] } })
    const session = await client.query('select method from auth.sessions where person_id=$1', [
      who!.id,
    ])
    expect(session.rows).toEqual([{ method: 'oidc' }])
    // The provider was asked for the code flow with PKCE (S256), a state and a nonce.
    const asked = provider.authorizations.at(-1)!
    expect(asked.get('code_challenge_method')).toBe('S256')
    expect(asked.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(asked.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(asked.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(asked.get('scope')).toBe('openid email profile')
    // A confidential client's secret went with the code, in the Authorization header.
    expect(provider.tokenRequests.at(-1)).toMatchObject({ secret: true })
    expect(provider.tokenRequests.at(-1)!.form.get('client_secret')).toBeNull()
  })

  it('finds the person by their account afterwards, whatever address the provider has now', async () => {
    const { person } = await signIn({
      sub: 'acct-first',
      email: 'renamed@elsewhere.example',
      email_verified: false,
    })
    expect((await me(person))?.name).toBe('First Admin')
  })

  it('signs in an active person by a verified address, and links the account', async () => {
    const { person, location } = await signIn({
      sub: 'acct-author',
      email: 'author@example.test',
      email_verified: 'true',
    })
    expect(location).toBe(`${web}/#/inbox`)
    expect((await me(person))?.id).toBe(people.author)
    const linked = await client.query(
      'select person_id::text as id from auth.identities where subject=$1',
      ['acct-author'],
    )
    expect(linked.rows).toEqual([{ id: people.author }])
  })

  it('makes a new session at every sign-in, so a planted session is worth nothing', async () => {
    const person = browser()
    person.jar.set('heed_session', 'a'.repeat(64))
    await signIn({ sub: 'acct-author' }, {}, person)
    const first = person.jar.get('heed_session')!
    expect(first).not.toBe('a'.repeat(64))
    await signIn({ sub: 'acct-author' }, {}, person)
    const second = person.jar.get('heed_session')!
    expect(second).not.toBe(first)
    // The session the browser had before ends with the new sign-in.
    const stale = browser()
    stale.jar.set('heed_session', first)
    expect(await me(stale)).toBeNull()
    expect(await me(person)).not.toBeNull()
  })

  it('goes back only to a path of the web app', async () => {
    for (const returnTo of [
      '//evil.example/x',
      'https://evil.example/',
      '/\\evil.example',
      'javascript:alert(1)',
    ])
      expect(
        (await signIn({ sub: 'acct-author' }, {}, browser(), returnTo)).location,
        returnTo,
      ).toBe(`${web}/`)
    expect(
      (await signIn({ sub: 'acct-author' }, {}, browser(), '/#/settings/people?x=1')).location,
    ).toBe(`${web}/#/settings/people?x=1`)
  })
})

describe('who may sign in', () => {
  it('tells everyone it does not let in one and the same thing, and makes nobody', async () => {
    await client.query(
      "insert into people (id,email,display_name,deactivated_at) values ($1,'gone@example.test','gone',now())",
      [randomUUID()],
    )
    const before = (await client.query('select count(*)::int as n from people')).rows
    const answers = new Set<string>()
    for (const account of [
      { sub: 'acct-x1', email: 'nobody@larchwood.example', email_verified: true }, // unknown
      { sub: 'acct-x2', email: 'gone@example.test', email_verified: true }, // removed
      { sub: 'acct-x3', email: 'author@example.test', email_verified: true }, // linked to another account
      { sub: 'acct-x4', email_verified: true }, // no address
    ]) {
      const { location, person } = await signIn(account)
      answers.add(location)
      expect(person.jar.has('heed_session')).toBe(false)
    }
    expect([...answers]).toEqual([refusedWith('not_allowed')])
    expect((await client.query('select count(*)::int as n from people')).rows).toEqual(before)
  })

  it('brings back a linked person an admin removed only on a new invite of their address', async () => {
    const email = 'comeback@larchwood.example'
    const account = { sub: 'acct-back', email, email_verified: true }
    await invite(email)
    const first = await signIn(account)
    const id = (await me(first.person))!.id
    await client.query('update people set deactivated_at=now() where id=$1', [id])
    const refused = await signIn(account)
    expect(refused.location).toBe(refusedWith('not_allowed'))
    expect(refused.person.jar.has('heed_session')).toBe(false)
    expect((await invite(email)).outcome).toBe('invited')
    const back = await signIn(account)
    expect((await me(back.person))?.id).toBe(id)
    expect(
      (
        await client.query<{ n: number }>(
          'select count(*)::int as n from auth.identities where person_id=$1',
          [id],
        )
      ).rows[0]!.n,
    ).toBe(1)
  })

  it('needs an address the provider has verified', async () => {
    const { location } = await signIn({
      sub: 'acct-x5',
      email: 'owner@example.test',
      email_verified: false,
    })
    expect(location).toBe(refusedWith('email_unverified'))
    expect((await signIn({ sub: 'acct-x6', email: 'owner@example.test' })).location).toBe(
      refusedWith('email_unverified'),
    )
  })

  it('lets in a member of a mapped group, as a Member or an Admin, and keeps the admin group in step', async () => {
    const member = await signIn({
      sub: 'acct-g1',
      email: 'g1@larchwood.example',
      email_verified: true,
      groups: ['heed-people'],
    })
    expect((await me(member.person))?.permissions.roles).toEqual([])
    const admin = await signIn({
      sub: 'acct-g2',
      email: 'g2@larchwood.example',
      email_verified: true,
      name: 'Gee Two',
      groups: ['heed-admins'],
    })
    const who = await me(admin.person)
    expect(who).toMatchObject({ name: 'Gee Two', permissions: { roles: ['administrator'] } })
    // Out of the admin group, the Admin role the group gave ends at the next sign-in.
    const later = await signIn({ sub: 'acct-g2', groups: ['heed-people'] })
    expect((await me(later.person))?.permissions.roles).toEqual([])
    // An Admin role given any other way is not the group's to end.
    await client.query(
      "insert into global_role_grants (person_id,role) values ($1,'administrator')",
      [people.author],
    )
    const author = await signIn({ sub: 'acct-author', groups: [] })
    expect((await me(author.person))?.permissions.roles).toEqual(['administrator'])
    // A group does not bring back someone an admin removed.
    expect(
      (
        await signIn({
          sub: 'acct-x7',
          email: 'gone@example.test',
          email_verified: true,
          groups: ['heed-admins'],
        })
      ).location,
    ).toBe(refusedWith('not_allowed'))
  })
})

describe('the checks on the provider’s answer', () => {
  const cases: [string, Account, Tweaks, string][] = [
    ['a refusal at the provider', { sub: 'acct-author' }, { error: 'access_denied' }, 'cancelled'],
    ['another nonce', { sub: 'acct-author' }, { claims: { nonce: 'x'.repeat(43) } }, 'failed'],
    ['another audience', { sub: 'acct-author' }, { claims: { aud: 'someone-else' } }, 'failed'],
    [
      'another issuer in the token',
      { sub: 'acct-author' },
      { claims: { iss: 'https://evil.example' } },
      'failed',
    ],
    [
      'an expired token',
      { sub: 'acct-author' },
      { claims: { exp: Math.floor(Date.now() / 1000) - 600 } },
      'failed',
    ],
    ['an unsigned token', { sub: 'acct-author' }, { unsigned: true }, 'failed'],
    ['a key the provider never published', { sub: 'acct-author' }, { foreignKey: true }, 'failed'],
    [
      'several audiences without this client as the authorized party',
      { sub: 'acct-author' },
      { claims: { aud: ['heed-test', 'other'], azp: 'other' } },
      'failed',
    ],
    [
      'another issuer with the code (mix-up)',
      { sub: 'acct-author' },
      { responseIss: 'https://evil.example' },
      'failed',
    ],
    [
      'no issuer with the code, which this provider always sends',
      { sub: 'acct-author' },
      { responseIss: null },
      'failed',
    ],
  ]
  it.each(cases)('refuses %s, and signs nobody in', async (_name, account, tweaks, reason) => {
    const { location, person } = await signIn(account, tweaks)
    expect(location).toBe(refusedWith(reason))
    expect(person.jar.has('heed_session')).toBe(false)
  })

  it('ties a sign-in to the browser that started it, and uses it once', async () => {
    provider.as({ sub: 'acct-author' })
    const starter = browser()
    const back = await atProvider(await start(starter))
    // Another browser with the same answer (a link sent to a victim) is refused.
    const other = browser()
    expect((await callback(other, back)).headers.location).toBe(refusedWith('expired'))
    // That used the sign-in up: the browser that started it is refused too now.
    expect((await callback(starter, back)).headers.location).toBe(refusedWith('expired'))
    // A replay of a finished sign-in is refused.
    const fresh = browser()
    const done = await atProvider(await start(fresh))
    expect((await callback(fresh, done)).headers.location).toBe(`${web}/#/inbox`)
    fresh.jar.set('heed_oidc_browser', starter.jar.get('heed_oidc_browser') ?? 'b'.repeat(64))
    expect((await callback(fresh, done)).headers.location).toBe(refusedWith('expired'))
    // No state, or one never given, is refused.
    for (const query of ['?code=x', '?code=x&state=' + 'y'.repeat(43)])
      expect((await callback(browser(), new URL(`${redirectUrl}${query}`))).headers.location).toBe(
        refusedWith('expired'),
      )
  })

  it('refuses a sign-in that took longer than ten minutes', async () => {
    provider.as({ sub: 'acct-author' })
    const person = browser()
    const back = await atProvider(await start(person))
    await client.query("update auth.oidc_requests set expires_at=now()-interval '1 second'")
    expect((await callback(person, back)).headers.location).toBe(refusedWith('expired'))
  })
})

describe('sessions', () => {
  it('end after the idle limit, slide while used, and never pass the absolute end', async () => {
    const { person } = await signIn({ sub: 'acct-author' })
    const token = person.jar.get('heed_session')!
    const row = () =>
      client.query<{ idle: number; absolute: number }>(
        `select extract(epoch from expires_at - now())::int as idle,
                extract(epoch from absolute_expires_at - now())::int as absolute
           from auth.sessions where token_hash=encode(sha256(convert_to($1,'UTF8')),'hex')`,
        [token],
      )
    expect((await row()).rows[0]!.idle).toBeGreaterThan(12 * 3600 - 60)
    expect((await row()).rows[0]!.absolute).toBeGreaterThan(7 * 86400 - 60)
    // Used again after a while, the idle end moves forward.
    await client.query(
      "update auth.sessions set last_seen_at=now()-interval '2 hours', expires_at=now()+interval '10 hours' where person_id=$1",
      [people.author],
    )
    expect(await me(person)).not.toBeNull()
    expect((await row()).rows[0]!.idle).toBeGreaterThan(12 * 3600 - 60)
    // Near the absolute end, the idle end stops there.
    await client.query(
      "update auth.sessions set last_seen_at=now()-interval '2 hours', expires_at=now()+interval '1 hour', absolute_expires_at=now()+interval '1 hour' where person_id=$1",
      [people.author],
    )
    expect(await me(person)).not.toBeNull()
    expect((await row()).rows[0]!.idle).toBeLessThanOrEqual(3600)
    // Unused past the idle end, or past the absolute end, it is over.
    await client.query(
      "update auth.sessions set expires_at=now()-interval '1 second' where person_id=$1",
      [people.author],
    )
    expect(await me(person)).toBeNull()
    const again = await signIn({ sub: 'acct-author' })
    await client.query(
      "update auth.sessions set absolute_expires_at=now()-interval '1 second', expires_at=now()-interval '1 second' where person_id=$1",
      [people.author],
    )
    expect(await me(again.person)).toBeNull()
  })
})

describe('the sign-in screen', () => {
  it('learns how to sign in, and offers no picker', async () => {
    const methods = await app.inject({ url: '/api/v1/auth/methods' })
    expect(methods.json()).toEqual({
      method: 'oidc',
      name: 'Test provider',
      start: '/api/v1/auth/oidc/start',
    })
    expect((await app.inject({ url: '/api/v1/auth/people' })).json()).toEqual([])
    const picked = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin: web, 'x-heed-csrf': 'dev-sign-in' },
      payload: { email: 'admin@example.test' },
    })
    expect(picked.statusCode).toBe(401)
  })

  it('reads what an invite link says, and the same nothing for any other link', async () => {
    const made = await invite('reader@larchwood.example', false, ['finance'])
    if (made.outcome !== 'invited') throw new Error(made.outcome)
    const token = new URL(made.link).hash.split('invite=')[1]!
    const read = await app.inject({ url: `/api/v1/invites/lookup?token=${token}` })
    expect(read.json()).toMatchObject({
      email: 'reader@larchwood.example',
      role: 'member',
      areas: [{ id: 'finance', name: 'Finance' }],
    })
    // Inviting the address again replaces the link; the old one says nothing any more.
    await invite('reader@larchwood.example')
    const replaced = await app.inject({ url: `/api/v1/invites/lookup?token=${token}` })
    const never = await app.inject({ url: `/api/v1/invites/lookup?token=${'z'.repeat(43)}` })
    expect(replaced.statusCode).toBe(404)
    expect(replaced.body).toBe(never.body)
    expect(replaced.json()).toMatchObject({
      message: "This invite link doesn't work any more. Ask whoever invited you for a new one.",
    })
  })
})

describe('what is kept and logged', () => {
  it('logs each sign-in by its result and reason only: no code, state, token, address or account', () => {
    const text = logs.join('\n')
    const lines = logs.map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(lines.some((line) => line.event === 'web_sign_in' && line.result === 'signed_in')).toBe(
      true,
    )
    expect(
      lines.some((line) => line.event === 'web_sign_in' && line.reason === 'not_allowed'),
    ).toBe(true)
    for (const asked of provider.authorizations)
      for (const key of ['state', 'nonce', 'code_challenge'])
        expect(text.includes(asked.get(key)!), key).toBe(false)
    for (const { form } of provider.tokenRequests)
      for (const key of ['code', 'code_verifier'])
        if (form.get(key)) expect(text.includes(form.get(key)!), key).toBe(false)
    for (const secret of [
      'acct-author',
      'acct-first',
      'author@example.test',
      'first.admin@larchwood.example',
      'test-secret',
    ])
      expect(text.includes(secret), secret).toBe(false)
  })
})

describe('a public client', () => {
  it('signs in with PKCE alone, sending no secret', async () => {
    const open = await startOidcProvider({ clientSecret: null })
    const publicApp = buildApp({
      database: apiDatabase(url),
      logger: createLogger({ level: 'silent' }),
      signIn: createOidcSignIn({
        settings: { ...settings, issuer: open.issuer, clientSecret: null },
        database: apiDatabase(url),
        webOrigin: web,
        lifetime,
      }),
      origins: [web],
      jobs: idleJobs(),
    })
    try {
      open.as({ sub: 'acct-owner', email: 'owner@example.test', email_verified: true })
      const started = await publicApp.inject({ url: '/api/v1/auth/oidc/start' })
      const back = await atProvider(started.headers.location as string)
      const done = await publicApp.inject({
        url: `${back.pathname}${back.search}`,
        headers: { cookie: String(started.headers['set-cookie']).split(';')[0]! },
      })
      expect(done.headers.location).toBe(`${web}/`)
      expect(String(done.headers['set-cookie'])).toMatch(/heed_session=[a-f0-9]{64}/)
      expect(open.tokenRequests.at(-1)).toMatchObject({ secret: false })
      expect(open.tokenRequests.at(-1)!.form.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    } finally {
      await publicApp.close()
      await open.close()
    }
  })
})

describe('the operator invite (heed invite)', () => {
  const cli = async (args: string[], env: Record<string, string | undefined> = {}) => {
    let stdout = ''
    let stderr = ''
    const code = await run(args, {
      stdout: (text) => void (stdout += text),
      stderr: (text) => void (stderr += text),
      env: { DATABASE_URL_MIGRATE: url, CL_WEB_ORIGINS: web, ...env },
    })
    return { code, stdout, stderr }
  }

  it('prints a link that lets the first admin in, and keeps only its hash', async () => {
    const made = await cli(['invite', 'boss@larchwood.example', '--admin', '--domain', 'marketing'])
    expect(made.code, made.stderr).toBe(0)
    const link = /https:\/\/heed\.example\/#\/signin\?invite=([A-Za-z0-9_-]{43})/.exec(made.stdout)
    expect(link, made.stdout).not.toBeNull()
    expect(
      (await client.query('select 1 from invites where token_hash=$1', [link![1]])).rowCount,
    ).toBe(0)
    const { person } = await signIn({
      sub: 'acct-boss',
      email: 'boss@larchwood.example',
      email_verified: true,
    })
    const who = await me(person)
    expect(who?.permissions).toMatchObject({
      roles: ['administrator'],
      assignments: [{ areaId: 'marketing', role: 'owner' }],
    })
    const history = await client.query<{ action: string; kind: string }>(
      `select action, actor_kind as kind from audit_log
        where subject_id=$1 and action in ('role.granted','assignment.granted') order by seq`,
      [who!.id],
    )
    expect(history.rows).toEqual([
      { action: 'role.granted', kind: 'service' },
      { action: 'assignment.granted', kind: 'service' },
    ])
  })

  it('names an address already in, a domain that is not there, and a missing credential', async () => {
    expect(await cli(['invite', 'admin@example.test'])).toMatchObject({ code: 1 })
    expect((await cli(['invite', 'x@larchwood.example', '--domain', 'nowhere'])).stdout).toContain(
      'There is no domain nowhere.',
    )
    const missing = await cli(['invite', 'x@larchwood.example'], {
      DATABASE_URL_MIGRATE: undefined,
    })
    expect(missing.code).toBe(2)
    expect(missing.stderr).toContain('DATABASE_URL_MIGRATE')
    expect((await cli(['invite', 'not-an-address'])).code).toBe(2)
  })
})
