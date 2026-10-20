import { expect, test, type APIRequestContext, type BrowserContext } from '@playwright/test'

/*
  MCP and gateway on the real service (slice W11a): an administrator switches a tool off and on
  again from the Tools tab, and changes a client's request rate from the Clients tab, each with a
  reason; the service's own lists confirm every step. An owner is told who manages the gateway.
  Whatever a test changes it puts back, so the other tests and the next run see the seed.
*/

const admin = 'admin-gateway@example.test'
type Tool = { tool: string; enabled: boolean; updatedAt: string }
type Client = {
  label: string
  displayName: string
  toolsAllowed: string[] | null
  ratePerMinute: number | null
  maxResponseBytes: number | null
  enabled: boolean
}

async function signIn(context: BrowserContext, baseURL: string, email: string) {
  const response = await context.request.post('/api/v1/auth/sign-in', {
    headers: { origin: baseURL, 'x-heed-csrf': 'dev-sign-in' },
    data: { email },
  })
  expect(response.ok()).toBe(true)
}

/** A change as the browser makes it: the session's CSRF token and the page's origin. */
async function change(
  request: APIRequestContext,
  baseURL: string,
  method: 'post' | 'put',
  path: string,
  data: object,
) {
  const session = await request.get('/api/v1/auth/session')
  const { csrfToken } = (await session.json()) as { csrfToken: string }
  const response = await request[method](`/api/v1${path}`, {
    headers: { origin: baseURL, 'x-heed-csrf': csrfToken },
    data,
  })
  expect(response.ok(), await response.text()).toBe(true)
}

const tool = async (request: APIRequestContext, name: string) =>
  ((await (await request.get('/api/v1/tools')).json()) as Tool[]).find((t) => t.tool === name)

const client = async (request: APIRequestContext, label: string) =>
  ((await (await request.get('/api/v1/clients')).json()) as Client[]).find((c) => c.label === label)

test('an administrator switches a tool off and on again, each with a reason', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, admin)
  expect(await tool(context.request, 'improve_question')).toMatchObject({ enabled: true })
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/admin?section=gateway&tab=tools')
    const toggle = page.getByRole('switch', { name: 'Improve a question' })
    await expect(toggle).toBeChecked({ timeout: 15_000 })
    // The service's moment reads as a date, not "Invalid Date".
    await expect(page.locator('[data-tool="improve_question"]')).toContainText(/On since \d/)

    await toggle.click()
    const off = page.getByRole('alertdialog', { name: 'Switch off Improve a question?' })
    await expect(off).toContainText(
      'Claude Code with a token, Evaluation runner and AI apps people sign in with',
    )
    await off.getByRole('textbox', { name: 'Why' }).fill('End to end: off for a moment')
    await off.getByRole('button', { name: 'Switch off' }).click()
    await expect(off).toBeHidden({ timeout: 15_000 })
    await expect(toggle).not.toBeChecked()
    expect(await tool(context.request, 'improve_question')).toMatchObject({ enabled: false })

    await toggle.click()
    const on = page.getByRole('alertdialog', { name: 'Switch on Improve a question?' })
    await on.getByRole('textbox', { name: 'Why' }).fill('End to end: back on')
    await on.getByRole('button', { name: 'Switch on' }).click()
    await expect(on).toBeHidden({ timeout: 15_000 })
    await expect(toggle).toBeChecked()
    expect(await tool(context.request, 'improve_question')).toMatchObject({ enabled: true })
  } finally {
    if (!(await tool(context.request, 'improve_question'))?.enabled)
      await change(context.request, baseURL!, 'post', '/tools/improve_question', {
        enabled: true,
        reason: 'End to end: put back',
      })
  }
})

test("an administrator changes a client's request rate with a reason", async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, admin)
  const before = (await client(context.request, 'eval'))!
  expect(before).toMatchObject({ displayName: 'Evaluation runner', enabled: true })
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/admin?section=gateway')
    const row = page.locator('[data-client="eval"]')
    await expect(row).toContainText('Evaluation runner', { timeout: 15_000 })
    await page.getByRole('button', { name: 'Edit Evaluation runner' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit Evaluation runner' })
    await dialog.getByRole('textbox', { name: /Requests a minute/ }).fill('60')
    await dialog.getByRole('textbox', { name: 'Why' }).fill('End to end: a slower runner')
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(dialog).toBeHidden({ timeout: 15_000 })
    await expect(row.getByRole('cell').nth(2)).toHaveText('60')
    expect(await client(context.request, 'eval')).toEqual({ ...before, ratePerMinute: 60 })
  } finally {
    await change(context.request, baseURL!, 'put', '/clients/eval', {
      ...before,
      reason: 'End to end: put back',
    })
  }
})

test('an owner is told whose place Administration is', async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!, 'per_jon@example.test')
  await page.goto('/mcp')
  await expect(page).toHaveURL(/\/admin\?section=gateway$/)
  await expect(page.getByText('Administration is for admins and auditors')).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByRole('switch')).toHaveCount(0)
})
