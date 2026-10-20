import { createHash, randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'

/*
  An AI app signs in as a person on the real service (FR-403): it registers, sends the person
  to the login server, the person signs in on the consent page and allows it, the app trades
  the code for tokens and calls the MCP server, and the person disconnects it on Connected AI
  apps, after which the MCP server refuses its token.
*/

const apiPort = Number(process.env.PW_API_PORT ?? 3100)
const issuer = `http://localhost:${apiPort}`
const callback = 'http://127.0.0.1:43177/callback'

test('a person connects an AI app, it calls a tool, and they disconnect it', async ({ page }) => {
  const registered = await page.request.post(`${issuer}/oauth/register`, {
    data: { client_name: 'Playwright AI app', redirect_uris: [callback] },
  })
  expect(registered.status()).toBe(201)
  const { client_id: clientId } = (await registered.json()) as { client_id: string }
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  // The app's own callback address: nothing listens there, the test reads the code from it.
  await page.route(`${callback}**`, (route) => route.fulfill({ body: 'back in the app' }))

  const authorize = new URL(`${issuer}/oauth/authorize`)
  for (const [key, value] of Object.entries({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: callback,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'pw-state',
    resource: `${issuer}/mcp`,
  }))
    authorize.searchParams.set(key, value)
  await page.goto(authorize.href)
  await expect(page).toHaveURL(/\/connect\/approve\?request=/)
  await expect(page.getByRole('heading', { name: 'Sign in to Heed' })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('combobox', { name: 'Sign in as' }).click()
  await page.getByRole('option', { name: /Maria Lindqvist/ }).click()
  await page.getByRole('button', { name: 'Continue as Maria Lindqvist' }).click()
  await expect(
    page.getByRole('heading', { name: 'Allow Playwright AI app to use Heed as you?' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Allow' }).click()
  await page.waitForURL((url) => url.href.startsWith(callback))
  const back = new URL(page.url())
  expect(back.searchParams.get('state')).toBe('pw-state')
  expect(back.searchParams.get('iss')).toBe(issuer)

  const exchanged = await page.request.post(`${issuer}/oauth/token`, {
    form: {
      grant_type: 'authorization_code',
      code: back.searchParams.get('code')!,
      redirect_uri: callback,
      client_id: clientId,
      code_verifier: verifier,
    },
  })
  expect(exchanged.status()).toBe(200)
  const { access_token: accessToken } = (await exchanged.json()) as { access_token: string }
  const listTools = () =>
    page.request.post(`${issuer}/mcp`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json, text/event-stream',
      },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    })
  expect((await listTools()).status()).toBe(200)

  await page.goto('/settings?section=connect')
  await expect(page.getByText('Sign in from your AI app')).toBeVisible({ timeout: 15_000 })
  const row = page.getByRole('row').filter({ hasText: 'Playwright AI app' })
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.getByRole('button', { name: 'Disconnect' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click()
  // While the dialog is open the page behind it is hidden; the row counts once it has closed.
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(row).toHaveCount(0)
  expect((await listTools()).status()).toBe(401)
})
