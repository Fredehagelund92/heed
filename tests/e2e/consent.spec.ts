import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, go, mode, signOut, test } from './go.ts'

/*
  An agent's consent page (FR-403, golden plan 2.3: the real app's page, in the new app's design).
  A person's agent asks to connect; the login server sends them to /connect/approve, where they
  sign in, read which agent asks and what it may do, and allow or deny. On the mock the demo's
  waiting sign-in plays the agent. On the service it is a real one: it registers, the browser goes
  through the login server, a yes gives it tokens that read over MCP, and a revoke in Settings ends
  them.
*/

/** The demo's agent sign-in waiting at the consent page (src/web/api/mock/data/agents.ts). */
const MOCK_REQUEST = 'demo-agent-sign-in-waiting-for-your-answer0'
const AGENT = 'Claude Code'

/**
 * Opens an address of the app. On the mock, inside the running app, which keeps what the journey
 * did; on the service the browser may be with the agent, so it loads the app again.
 */
const open = (page: Page, address: string) =>
  mode === 'mock' ? go(page, address) : page.goto(address).then(() => undefined)

type Agent = {
  /** The consent page's address, once the agent sent the browser there. */
  consent: string
  /** After an answer: the browser is back with the agent, which collects its tokens on a yes. */
  back: (allowed: boolean) => Promise<void>
  /** Whether the agent's token still reads over MCP: 200, or 401 once it was revoked. */
  reads: () => Promise<number>
  /** A tool call over MCP with the agent's token, and what it gave back (on the service only). */
  calls: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>
}

/** The agent asks to connect, and the browser lands on the consent page. */
async function agentAsks(page: Page): Promise<Agent> {
  if (mode === 'mock') {
    await go(page, `/connect/approve?request=${MOCK_REQUEST}`)
    return {
      consent: `/connect/approve?request=${MOCK_REQUEST}`,
      // The demo has no agent to go back to: it lands in the Inbox.
      back: async () => {
        await expect(page).toHaveURL(/\/inbox$/)
        await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible()
      },
      reads: () => Promise.resolve(200),
      calls: () => Promise.reject(new Error('The mock has no agent')),
    }
  }
  // The login server's address, the issuer: on the web app's host (http/harness.ts), so the
  // cookie the browser gets when the sign-in starts goes with the consent page's requests.
  const issuer = `http://localhost:${process.env.GOLDEN_API_PORT}`
  const callback = 'http://127.0.0.1:43177/callback'
  const registered = await page.request.post(`${issuer}/oauth/register`, {
    data: {
      client_name: AGENT,
      redirect_uris: [callback],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
  })
  expect(registered.status()).toBe(201)
  const { client_id: clientId } = (await registered.json()) as { client_id: string }
  const verifier = randomBytes(32).toString('base64url')
  // Nothing listens at the agent's own callback: the journey reads the code from its address.
  await page.route(`${callback}**`, (route) => route.fulfill({ body: 'Back in the agent' }))
  const authorize = new URL(`${issuer}/oauth/authorize`)
  for (const [key, value] of Object.entries({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: callback,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: 'consent-journey',
    scope: 'read feedback propose',
    resource: `${issuer}/mcp`,
  }))
    authorize.searchParams.set(key, value)
  await page.goto(authorize.href)
  await expect(page).toHaveURL(/\/connect\/approve\?request=[\w-]{43}$/)
  const consent = new URL(page.url()).pathname + new URL(page.url()).search
  let token = ''
  return {
    consent,
    back: async (allowed) => {
      await page.waitForURL((url) => url.href.startsWith(callback))
      const answer = new URL(page.url()).searchParams
      expect(answer.get('state')).toBe('consent-journey')
      if (!allowed) {
        expect(answer.get('error')).toBe('access_denied')
        return
      }
      const exchanged = await page.request.post(`${issuer}/oauth/token`, {
        form: {
          grant_type: 'authorization_code',
          code: answer.get('code')!,
          redirect_uri: callback,
          client_id: clientId,
          code_verifier: verifier,
          resource: `${issuer}/mcp`,
        },
      })
      expect(exchanged.status()).toBe(200)
      token = ((await exchanged.json()) as { access_token: string }).access_token
    },
    reads: async () => (await mcp(page, issuer, token, 'tools/list', {})).status(),
    calls: async (name, args) => {
      const answer = await mcp(page, issuer, token, 'tools/call', { name, arguments: args })
      expect(answer.status()).toBe(200)
      // The answer is JSON, or one server-sent event that holds it.
      const body = await answer.text()
      const json = body.startsWith('{') ? body : /^data: (.*)$/m.exec(body)![1]!
      const { result } = JSON.parse(json) as {
        result: { structuredContent: Record<string, unknown> }
      }
      return result.structuredContent
    },
  }
}

/** One request to the MCP server with the agent's token. */
const mcp = (page: Page, issuer: string, token: string, method: string, params: object) =>
  page.request.post(`${issuer}/mcp`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method, params },
  })

test('signed out, sign in on the page, allow, and the agent reads until an admin revokes it', async ({
  page,
}) => {
  await go(page, '/inbox')
  await signOut(page)
  const agent = await agentAsks(page)
  await expect(page.getByRole('heading', { name: 'Sign in to Heed' })).toBeVisible()
  await expect(page.getByText('An agent asked to connect as you.')).toBeVisible()
  await page.getByRole('button', { name: /Ines Duarte/ }).click()

  await expect(
    page.getByRole('heading', { name: `Allow ${AGENT} to use Heed as you?` }),
  ).toBeVisible()
  const can = page.getByRole('region', { name: 'It will be able to' })
  await expect(can.getByText('Read context', { exact: true })).toBeVisible()
  await expect(can.getByText('Suggest changes', { exact: true })).toBeVisible()
  await expect(page.getByText('Signed in as Ines Duarte')).toBeVisible()
  await page.getByRole('button', { name: 'Allow' }).click()
  await agent.back(true)
  expect(await agent.reads()).toBe(200)

  // Answered, the link ends.
  await open(page, agent.consent)
  await expect(page.getByRole('heading', { name: 'This sign-in has ended' })).toBeVisible()

  // An admin sees every person's agents in Settings, and revokes Ines's.
  await open(page, '/inbox')
  await signOut(page)
  await page.getByRole('button', { name: /Jon Abara/ }).click()
  await expect(page).toHaveURL(/\/inbox$/)
  await open(page, '/settings/agents')
  const row = page
    .getByRole('list', { name: 'Connected agents' })
    .getByRole('listitem')
    .filter({ hasText: AGENT })
    .filter({ hasText: 'Ines Duarte' })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Revoke' }).click()
  await page
    .getByRole('dialog', { name: /^Revoke / })
    .getByRole('button', { name: 'Revoke' })
    .click()
  await expect(row).toHaveCount(0)
  if (mode === 'http') await expect.poll(() => agent.reads()).toBe(401)
})

test('deny sends the browser back with a no, and the agent gets nothing', async ({ page }) => {
  const agent = await agentAsks(page)
  await expect(page.getByText('Signed in as Jon Abara')).toBeVisible()
  await page.getByRole('button', { name: 'Deny' }).click()
  await agent.back(false)
  await open(page, '/settings/agents')
  await expect(
    page
      .getByRole('list', { name: 'Connected agents' })
      .getByRole('listitem')
      .filter({ hasText: AGENT })
      .filter({ hasText: 'Jon Abara' }),
  ).toHaveCount(0)
})

test('a link with no sign-in in it, or one that ended, says to connect again', async ({ page }) => {
  await go(page, '/connect/approve')
  await expect(
    page.getByRole('heading', { name: "This sign-in link isn't complete" }),
  ).toBeVisible()
  await go(page, `/connect/approve?request=${'x'.repeat(43)}`)
  await expect(page.getByRole('heading', { name: 'This sign-in has ended' })).toBeVisible()
})

test("an agent's suggestion links to where it waits, in the person's Inbox", async ({ page }) => {
  test.skip(mode === 'mock', 'The mock has no agent to suggest')
  await go(page, '/inbox')
  await signOut(page)
  const agent = await agentAsks(page)
  await page.getByRole('button', { name: /Ines Duarte/ }).click()
  await page.getByRole('button', { name: 'Allow' }).click()
  await agent.back(true)
  const sent = await agent.calls('suggest_context', {
    text: 'Orders in Norway include the accounts our teams use to test the webshop until 1 November 2026.',
    scope: { metrics: ['Orders'] },
    window: { from: '2026-10-01' },
    evidence: [{ url: 'https://wiki.example/test-accounts', quote: 'Test accounts are counted.' }],
    new_item: true,
  })
  expect(sent).toMatchObject({ status: 'suggestion_sent' })
  const url = sent.url as string
  expect(url).toMatch(/\/inbox\?tab=all&card=waiting:[0-9a-f-]{36}$/)
  await page.goto(url)
  await expect(
    page.getByText(/Waiting for .+\. You'll see here when it is published or returned\./),
  ).toBeVisible()

  // A draft the agent saved without sending (a check refused it) links to the editor at its own
  // address, as tests/integration/draft-tool.test.ts says; it opens there with what it holds.
  const { csrfToken } = (await (await page.request.get('/api/v1/auth/session')).json()) as {
    csrfToken: string
  }
  const saved = await page.request.post('/api/v1/proposals', {
    headers: {
      'x-heed-csrf': csrfToken,
      'idempotency-key': randomUUID(),
      origin: new URL(page.url()).origin,
    },
    data: {
      draft: {
        areaId: 'area_sales',
        kind: 'note',
        title: 'Test accounts in Norway',
        summary: 'Orders in Norway include the accounts our teams use to test the webshop.',
      },
    },
  })
  expect(saved.status()).toBe(200)
  const { id } = (await saved.json()) as { id: string }
  await page.goto(`/context/${id}/edit`)
  await expect(page.getByRole('textbox', { name: /title/i })).toHaveValue('Test accounts in Norway')
})
