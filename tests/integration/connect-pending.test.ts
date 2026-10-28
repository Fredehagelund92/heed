import { beforeEach, describe, expect, it } from 'vitest'
import { signInHarness } from './sign-in-harness.ts'

/*
  The live line of Connect an agent (FR-418, golden plan P11a): the page asks every few seconds
  whether the person's own agent signed in, or whether they declined it in the browser, since the
  wait began. Real sign-ins through the login server, on PostgreSQL: a code exchanged is connected,
  a no on the consent screen is declined, with the app's own name, and only the person's own count.
*/

const harness = await signInHarness()
const { admin, browser, registered, signInFlow, exchange, now } = harness

beforeEach(() => harness.advance(61))

type Pending = { state: string; agent: string | null; at: string | null }

/** What the live line reads for a person since a moment. */
async function pending(name: string, since: Date) {
  const person = browser()
  await person.signIn(name)
  const response = await person.api(
    `/connect/pending?since=${encodeURIComponent(since.toISOString())}`,
  )
  expect(response.status).toBe(200)
  return (await response.json()) as Pending
}

describe('connect.pending', () => {
  it('waits while nothing signed in since the wait began', async () => {
    expect(await pending('owner', now())).toEqual({ state: 'waiting', agent: null, at: null })
  })

  it('is connected once the agent has its tokens, naming the agent as it named itself', async () => {
    const since = now()
    const clientId = await registered()
    const flow = await signInFlow(clientId, { person: 'author' })
    // Allowing is not yet a connection: the agent still has to collect its tokens.
    expect((await pending('author', since)).state).toBe('waiting')
    expect((await exchange(clientId, flow.code!, flow.verifier)).status).toBe(200)
    const read = await pending('author', since)
    expect(read).toMatchObject({ state: 'connected', agent: 'Test client' })
    expect(Date.parse(read.at!)).toBeGreaterThanOrEqual(since.getTime())
    // Someone else's wait sees nothing of it.
    expect((await pending('owner', since)).state).toBe('waiting')
    // A wait that began after it sees nothing either.
    harness.advance(5)
    expect((await pending('author', now())).state).toBe('waiting')
  })

  it('is declined when the person says no on the consent screen, kept for them alone', async () => {
    const since = now()
    const clientId = await registered()
    const logged = async () =>
      Number((await admin.query<{ n: string }>('select count(*) as n from audit_log')).rows[0]!.n)
    const before = await logged()
    const flow = await signInFlow(clientId, { person: 'stranger', allow: false })
    expect(flow.code).toBeNull()
    expect(await pending('stranger', since)).toMatchObject({
      state: 'declined',
      agent: 'Test client',
    })
    expect((await pending('owner', since)).state).toBe('waiting')
    // Only who said no, the app's name and when are kept; the history log is not told.
    const [kept] = (
      await admin.query<{ columns: string[] }>(
        `select array_agg(column_name::text order by column_name) as columns
           from information_schema.columns where table_schema = 'auth' and table_name = 'oauth_declines'`,
      )
    ).rows
    expect(kept!.columns).toEqual(['client_name', 'declined_at', 'person_id'])
    expect(await logged()).toBe(before)
  })

  it('reads the newest outcome: a no, then a yes, is connected', async () => {
    const since = now()
    const clientId = await registered()
    await signInFlow(clientId, { person: 'admin', allow: false })
    harness.advance(2)
    const flow = await signInFlow(clientId, { person: 'admin' })
    expect((await exchange(clientId, flow.code!, flow.verifier)).status).toBe(200)
    expect((await pending('admin', since)).state).toBe('connected')
  })

  it('reads no further back than an hour, and keeps a no for an hour', async () => {
    const clientId = await registered()
    const flow = await signInFlow(clientId, { person: 'owner', allow: false })
    expect(flow.code).toBeNull()
    harness.advance(3_700)
    expect((await pending('owner', new Date(0))).state).toBe('waiting')
    // The next no, anyone's, clears the ones older than an hour.
    await signInFlow(clientId, { person: 'author', allow: false })
    const left = await admin.query(
      `select 1 from auth.oauth_declines d join people p on p.id = d.person_id
        where p.email = 'owner@example.test'`,
    )
    expect(left.rowCount).toBe(0)
  })

  it('refuses a moment that is not a date', async () => {
    const person = browser()
    await person.signIn('owner')
    expect((await person.api('/connect/pending?since=yesterday')).status).toBe(400)
  })
})
