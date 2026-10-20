import { beforeEach, describe, expect, it } from 'vitest'
import { people } from './fixtures.ts'
import { signInHarness } from './sign-in-harness.ts'

/*
  An administrator's view of every person's AI apps (FR-403, FR-807), end to end on PostgreSQL:
  the list names the person and the app as it names itself, a disconnect needs a reason that the
  history log keeps, a disconnected app's access token is refused at its very next request and
  its refresh token is refused, all of one person's apps end in one step, and nobody but an
  administrator may read the list or end a connection.
*/

const harness = await signInHarness()
const { admin, browser, registered, signInFlow, exchange, mcpStatus, token } = harness

beforeEach(() => harness.advance(61))

type Listed = {
  id: string
  clientName: string
  clientHost: string
  scopes: string[]
  person: { id: string; name: string; initials: string; email: string | null }
}

/** One person signs in an app: its tokens, and the client it signed in with. */
async function connect(person: string, scope = 'read feedback') {
  const clientId = await registered()
  const flow = await signInFlow(clientId, { person, scope })
  const tokens = await exchange(clientId, flow.code!, flow.verifier)
  expect(tokens.status).toBe(200)
  return {
    clientId,
    access_token: tokens.body.access_token!,
    refresh_token: tokens.body.refresh_token!,
  }
}

async function signedIn(name: string) {
  const person = browser()
  await person.signIn(name)
  return person
}

const refresh = (app: { clientId: string; refresh_token: string }) =>
  token({ grant_type: 'refresh_token', refresh_token: app.refresh_token, client_id: app.clientId })

describe('an administrator and the AI apps people connected', () => {
  it('lists every person’s apps and disconnects one with a reason, at its next request', async () => {
    const authorApp = await connect('author', 'read feedback propose')
    const ownerApp = await connect('owner')
    const boss = await signedIn('admin')

    const response = await boss.api('/ai-connections')
    expect(response.status).toBe(200)
    const listed = (await response.json()) as Listed[]
    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientName: 'Test client',
          clientHost: '127.0.0.1',
          scopes: ['read', 'feedback', 'propose'],
          person: {
            id: people.author,
            name: 'author',
            initials: 'A',
            email: 'author@example.test',
          },
        }),
      ]),
    )
    expect(listed.find((connection) => connection.person.id === people.owner)).toMatchObject({
      scopes: ['read', 'feedback'],
    })
    const target = listed.find((connection) => connection.person.id === people.author)!
    expect(await mcpStatus(authorApp.access_token)).toBe(200)

    // A reason is required, and blank words are no reason.
    for (const body of [{}, { reason: '' }, { reason: '   ' }])
      expect((await boss.api(`/ai-connections/${target.id}/disconnect`, body)).status).toBe(400)
    // It is kept in the history log for good, so it must hold no secret.
    const secret = await boss.api(`/ai-connections/${target.id}/disconnect`, {
      reason: 'password: hunter22',
    })
    expect(secret.status).toBe(422)
    expect(await mcpStatus(authorApp.access_token)).toBe(200)

    const ended = await boss.api(`/ai-connections/${target.id}/disconnect`, {
      reason: '  The laptop it ran on was lost  ',
    })
    expect(ended.status).toBe(200)
    expect(await ended.json()).toEqual({ disconnected: 1 })

    // The very next request with its access token is refused, and so is its refresh token.
    expect(await mcpStatus(authorApp.access_token)).toBe(401)
    expect((await refresh(authorApp)).status).toBe(400)
    // The other person's app keeps working.
    expect(await mcpStatus(ownerApp.access_token)).toBe(200)
    // The person no longer sees it among their own apps, and a second disconnect finds nothing.
    const author = await signedIn('author')
    expect(await (await author.api('/connections')).json()).toEqual([])
    expect(
      (await boss.api(`/ai-connections/${target.id}/disconnect`, { reason: 'Again' })).status,
    ).toBe(404)
    const after = (await (await boss.api('/ai-connections')).json()) as Listed[]
    expect(after.map((connection) => connection.id)).not.toContain(target.id)

    // The history log names who disconnected it, for whom, and why.
    const audit = await admin.query<{
      action: string
      actor: string
      reason: string
      code: string
      person: string
      batch: string | null
    }>(
      `select action, actor_id::text as actor, reason, details->>'reason' as code,
              details->>'person' as person, batch_id::text as batch
         from audit_log where subject_type='ai_connection' and subject_id=$1 and action <> 'ai_client.connected'`,
      [target.id],
    )
    expect(audit.rows).toEqual([
      {
        action: 'ai_client.disconnected',
        actor: people.admin,
        reason: 'The laptop it ran on was lost',
        code: 'disconnected_by_admin',
        person: people.author,
        batch: null,
      },
    ])
  })

  it('disconnects every app of one person in one step, with one reason', async () => {
    const first = await connect('stranger')
    const second = await connect('stranger', 'read')
    const kept = await connect('owner')
    const boss = await signedIn('admin')
    const ended = await boss.api(`/ai-connections/people/${people.stranger}/disconnect`, {
      reason: 'Left the company',
    })
    expect(ended.status).toBe(200)
    expect(await ended.json()).toEqual({ disconnected: 2 })
    for (const app of [first, second]) {
      expect(await mcpStatus(app.access_token)).toBe(401)
      expect((await refresh(app)).status).toBe(400)
    }
    expect(await mcpStatus(kept.access_token)).toBe(200)
    const listed = (await (await boss.api('/ai-connections')).json()) as Listed[]
    expect(listed.some((connection) => connection.person.id === people.stranger)).toBe(false)

    // Two history entries, one per connection, sharing the step's batch and its reason.
    const audit = await admin.query<{ reason: string; batch: string }>(
      `select reason, batch_id::text as batch from audit_log
        where action='ai_client.disconnected' and details->>'person'=$1 order by seq`,
      [people.stranger],
    )
    expect(audit.rows).toHaveLength(2)
    expect(new Set(audit.rows.map((row) => row.batch)).size).toBe(1)
    expect(audit.rows[0]!.batch).toMatch(/^[0-9a-f-]{36}$/)
    expect(audit.rows.map((row) => row.reason)).toEqual(['Left the company', 'Left the company'])

    // Nothing left to end: none, and no history entry.
    const again = await boss.api(`/ai-connections/people/${people.stranger}/disconnect`, {
      reason: 'Left the company',
    })
    expect(await again.json()).toEqual({ disconnected: 0 })
    expect(
      (
        await admin.query(
          "select 1 from audit_log where action='ai_client.disconnected' and details->>'person'=$1",
          [people.stranger],
        )
      ).rowCount,
    ).toBe(2)
  })

  it('refuses anyone but an administrator, and leaves their apps working', async () => {
    const app = await connect('author')
    const boss = await signedIn('admin')
    const [target] = ((await (await boss.api('/ai-connections')).json()) as Listed[]).filter(
      (connection) => connection.person.id === people.author,
    )
    for (const name of ['author', 'owner', 'stranger']) {
      const person = await signedIn(name)
      expect((await person.api('/ai-connections')).status).toBe(403)
      expect(
        (await person.api(`/ai-connections/${target!.id}/disconnect`, { reason: 'Mine now' }))
          .status,
      ).toBe(403)
      expect(
        (
          await person.api(`/ai-connections/people/${people.author}/disconnect`, {
            reason: 'Mine now',
          })
        ).status,
      ).toBe(403)
    }
    // Signed out, the list is not there at all.
    expect((await browser().api('/ai-connections')).status).toBe(401)
    expect(await mcpStatus(app.access_token)).toBe(200)
    expect((await refresh(app)).status).toBe(200)
  })
})
