import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { domainId, expect, go, mode, signInAs, signOut, test } from './go.ts'

/*
  J38, publish without review (FR-421). An admin switches it on for the workspace; the owner of
  Sales lets Kofi's Claude Code publish low-risk new Rules there, sees it on the domain page and in
  the agent's Details, and turns it off from either. On the service an agent really sends a Rule
  under the policy: it is published at once as the owner's decision, its history says so, and the
  owner undoes it from there.
*/

const AGENT = 'Claude Code for Kofi Mensah'

async function switchOn(page: Page) {
  await go(page, '/settings/agents')
  await page.getByRole('button', { name: 'Show or hide Publish without review' }).click()
  const toggle = page.getByRole('switch', {
    name: 'Let owners choose agents that publish without review',
  })
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await expect(page.getByText('Owners can let an agent publish without review')).toBeVisible()
  await expect(toggle).toBeChecked()
}

test('an admin allows it, the owner lets one agent publish, and turns it off', async ({ page }) => {
  // Off as the workspace starts: the domain page says so, with where an admin turns it on.
  await go(page, '/settings/domains/sales')
  await expect(page.getByText('Off for the workspace.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Turn it on in Agents and access' })).toBeVisible()

  await switchOn(page)

  await go(page, '/settings/domains/sales')
  await expect(page.getByText('No agent. Every suggestion waits for an owner.')).toBeVisible()
  await page.getByRole('button', { name: 'Let an agent publish without review' }).click()
  const dialog = page.getByRole('dialog', { name: 'Publish without review in Sales' })
  await expect(dialog.getByRole('combobox', { name: 'Agent' })).toContainText(AGENT)
  // No kind to choose: only low-risk new items publish, today Rules.
  await expect(dialog.getByRole('checkbox')).toHaveCount(0)
  await expect(dialog).toContainText('Today that means Rules.')
  await dialog.getByRole('button', { name: 'Let it publish' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Say why, for the history log.')
  await dialog.getByRole('textbox', { name: 'Why' }).fill('Its rules have been right for weeks')
  await dialog.getByRole('button', { name: 'Let it publish' }).click()
  await expect(dialog).toBeHidden()
  const policies = page.getByRole('list', { name: 'Agents that publish without review in Sales' })
  await expect(policies).toContainText(AGENT)
  await expect(policies).toContainText('New low-risk items only, up to 10 a day.')
  await expect(policies).toContainText('Set by Jon Abara on')
  await expect(policies).toContainText('Why: Its rules have been right for weeks')

  // The agent's row says it publishes without review; its Details say where, with Turn off.
  await go(page, '/settings/agents')
  const row = page
    .getByRole('list', { name: 'Connected agents' })
    .getByRole('listitem')
    .filter({ hasText: 'Kofi Mensah' })
    .filter({ hasText: 'Publishes without review' })
  await expect(row).toHaveCount(1)
  await row.getByRole('button', { name: `Details of ${AGENT}` }).click()
  const where = row.getByRole('list', { name: 'Where Claude Code publishes without review' })
  await expect(where).toContainText('In Sales')
  await where
    .getByRole('button', {
      name: 'Turn off publishing without review for Claude Code in Sales',
    })
    .click()
  await expect(page.getByText('Turned off for Claude Code in Sales')).toBeVisible()
  await expect(row).toHaveCount(0)

  await go(page, '/settings/domains/sales')
  await expect(page.getByText('No agent. Every suggestion waits for an owner.')).toBeVisible()
})

test('turning it off for the workspace asks first, and ends every policy', async ({ page }) => {
  await switchOn(page)
  await go(page, '/settings/domains/sales')
  await page.getByRole('button', { name: 'Let an agent publish without review' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Why' }).fill('Trying it for a week')
  await dialog.getByRole('button', { name: 'Let it publish' }).click()
  await expect(dialog).toBeHidden()

  await go(page, '/settings/agents')
  await page.getByRole('button', { name: 'Show or hide Publish without review' }).click()
  await expect(page.getByText("On, with 1 policy. Each is in its agent's Details.")).toBeVisible()
  await page
    .getByRole('switch', { name: 'Let owners choose agents that publish without review' })
    .click()
  const ask = page.getByRole('dialog', { name: 'Turn off publishing without review?' })
  await ask.getByRole('button', { name: 'Turn off' }).click()
  await expect(page.getByText('1 policy turned off.')).toBeVisible()
  await go(page, '/settings/domains/sales')
  await expect(page.getByText('Off for the workspace.')).toBeVisible()
})

/* ---------- On the service: an agent publishes under the policy, and the owner undoes it ---------- */

/** Kofi's own agent: it signs in through the login server and calls tools with its token. */
async function kofisAgent(page: Page) {
  const issuer = `http://localhost:${process.env.GOLDEN_API_PORT}`
  const callback = 'http://127.0.0.1:43178/callback'
  const registered = await page.request.post(`${issuer}/oauth/register`, {
    data: {
      client_name: 'Claude Code',
      redirect_uris: [callback],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
  })
  const { client_id: clientId } = (await registered.json()) as { client_id: string }
  const verifier = randomBytes(32).toString('base64url')
  await page.route(`${callback}**`, (route) => route.fulfill({ body: 'Back in the agent' }))
  const authorize = new URL(`${issuer}/oauth/authorize`)
  for (const [key, value] of Object.entries({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: callback,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: 'j36',
    scope: 'read feedback propose',
    resource: `${issuer}/mcp`,
  }))
    authorize.searchParams.set(key, value)
  await page.goto(authorize.href)
  await page.getByRole('button', { name: /Kofi Mensah/ }).click()
  await page.getByRole('button', { name: 'Allow' }).click()
  await page.waitForURL((url) => url.href.startsWith(callback))
  const code = new URL(page.url()).searchParams.get('code')!
  const exchanged = await page.request.post(`${issuer}/oauth/token`, {
    form: {
      grant_type: 'authorization_code',
      code,
      redirect_uri: callback,
      client_id: clientId,
      code_verifier: verifier,
      resource: `${issuer}/mcp`,
    },
  })
  const token = ((await exchanged.json()) as { access_token: string }).access_token
  return async (args: Record<string, unknown>) => {
    const answer = await page.request.post(`${issuer}/mcp`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream' },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'suggest_context', arguments: args },
      },
    })
    const body = await answer.text()
    const json = body.startsWith('{') ? body : /^data: (.*)$/m.exec(body)![1]!
    return (JSON.parse(json) as { result: { structuredContent: Record<string, unknown> } }).result
      .structuredContent
  }
}

/** A write to the service as the signed-in person, as the app makes it. */
async function post(page: Page, path: string, data: object) {
  const { csrfToken } = (await (await page.request.get('/api/v1/auth/session')).json()) as {
    csrfToken: string
  }
  const answer = await page.request.post(`/api/v1${path}`, {
    headers: {
      'x-heed-csrf': csrfToken,
      'idempotency-key': randomUUID(),
      origin: new URL(page.url()).origin,
    },
    data,
  })
  expect(answer.status(), await answer.text()).toBe(200)
  return (await answer.json()) as Record<string, unknown>
}

test("an agent's Rule publishes under the owner's policy, and the owner undoes it from its history", async ({
  page,
}) => {
  test.skip(mode === 'mock', 'The mock has no agent to suggest')
  await go(page, '/inbox')
  await switchOn(page)
  await signOut(page)
  const suggest = await kofisAgent(page)
  // The browser is back in the agent: open the app again, signed in as Kofi, and switch to Jon.
  await page.goto('/inbox')
  await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible()
  await signInAs(page, 'Jon Abara')
  // Jon, owner of Sales, lets Kofi's new Claude Code publish Rules there.
  const agents = (await (await page.request.get('/api/v1/agents')).json()) as {
    id: string
    name: string
    person: { name: string } | null
    since: string
  }[]
  const agent = agents
    .filter((a) => a.name === 'Claude Code' && a.person?.name === 'Kofi Mensah')
    .sort((a, b) => b.since.localeCompare(a.since))[0]!
  await post(page, '/agent-policies', {
    agentId: agent.id,
    areaId: domainId('sales'),
    perDay: 5,
    reason: 'Its rules have been right for weeks',
  })

  const sent = await suggest({
    text: 'A gift card counts as revenue on the day it is spent.',
    kind: 'note',
    area: domainId('sales'),
    scope: { metrics: ['Gift card revenue'] },
    window: { from: '2026-10-01' },
    evidence: [
      {
        url: 'https://wiki.example/finance/gift-cards',
        quote: 'A gift card counts as revenue on the day it is spent.',
      },
    ],
    new_item: true,
  })
  expect(sent, JSON.stringify(sent)).toMatchObject({
    status: 'suggestion_published',
    policy: { published: true, set_by: 'Jon Abara', domain: 'Sales' },
  })

  // Its history says who sent it and whose policy published it, with Undo for the owner.
  await page.goto(new URL(sent.url as string).pathname)
  await page.getByRole('button', { name: /^1 change/ }).click()
  const row = page.getByRole('button', {
    name: /Published by Claude Code for Kofi Mensah under Jon's policy/,
  })
  await expect(row).toBeVisible()
  await row.click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toContainText("it was Jon Abara's decision, made in advance")
  await sheet.getByRole('button', { name: 'Undo this publish' }).click()
  await expect(page.getByText('Publish undone')).toBeVisible()
})
