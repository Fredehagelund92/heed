import { expect, test, type BrowserContext } from '@playwright/test'

/*
  Sources on the real service (integrations decision, 12 October 2026): an administrator finds
  the Cube model the bulk seed read, opens its page and reads its views, issues and reads from
  the operations view; the model folder address is on that page and no longer on Limits; the
  catalogue leads there; an auditor is told whose section it is; the form to add a source tests
  one and shows the service's refusals. Nothing here changes data.
*/

async function signIn(context: BrowserContext, baseURL: string, email: string) {
  const response = await context.request.post('/api/v1/auth/sign-in', {
    headers: { origin: baseURL, 'x-heed-csrf': 'dev-sign-in' },
    data: { email },
  })
  expect(response.ok()).toBe(true)
}

test('an administrator reads the Cube source from the list to its page', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, 'admin-sources@example.test')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/admin?section=sources')
  const cube = page.locator('[data-source="cube"]')
  await expect(cube).toContainText('Cube local model', { timeout: 15_000 })
  // The seed's demo model leaves two views without a domain on purpose (CON-516).
  await expect(cube).toContainText('2 views have no domain')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440)

  await cube.getByRole('link', { name: 'Cube local model' }).click()
  const body = page.locator('[data-slot="source-page"]')
  await expect(body.getByRole('heading', { level: 1, name: 'Cube local model' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toContainText('cube')
  await expect(body.locator('[data-issue="missing_domain"]')).toContainText(
    'operations and segments name no domain in Cube',
  )
  await expect(body.locator('[data-view]')).toHaveCount(7)
  await expect(body.locator('[data-view="segments"]')).toContainText('No domain')
  await expect(body.locator('[data-read]').first()).toBeVisible()
  await expect(body.locator('[data-setting-value="sources.cube_model_url"]')).toContainText(
    'db/seed/cube',
  )

  await page.goto('/admin?section=limits')
  await expect(page.locator('[data-setting="review.default_days"]')).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.locator('[data-setting="sources.cube_model_url"]')).toHaveCount(0)
})

test("the old address of the model folder setting opens it on the source's page", async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, 'admin-sources@example.test')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/admin?section=limits&setting=sources.cube_model_url')
  await expect(page).toHaveURL(/section=sources&source=cube&setting=sources\.cube_model_url$/)
  await expect(
    page.locator('[data-slot="dock-panel"]').getByRole('heading', { name: 'Model folder address' }),
  ).toBeVisible({ timeout: 15_000 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
})

test("the catalogue's source line leads an administrator to the source", async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, 'admin-sources@example.test')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/catalogue')
  const line = page.locator('[data-slot="source-line"]')
  await expect(line).toContainText('Cube defines them', { timeout: 15_000 })
  await line.getByRole('link', { name: 'See the source' }).click()
  await expect(page).toHaveURL(/section=sources&source=cube$/)
})

test('an auditor is told Sources is for admins', async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!, 'auditor@example.test')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/admin?section=sources&source=cube')
  await expect(page.locator('[data-slot="settings-refused"]')).toContainText(
    'Sources is for admins',
    { timeout: 15_000 },
  )
  const response = await context.request.get('/api/v1/operations')
  expect(response.status()).toBe(403)
})

test('the form to add a source tests it on the service, and shows its refusals by field', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, 'admin-sources@example.test')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/admin?section=sources')
  await page.getByRole('link', { name: 'Add a connector' }).click()
  // The connectors come from the service's registry, each with its manifest.
  const connectors = page.locator('[data-slot="connectors-definitions"]')
  await expect(connectors.locator('[data-connector]')).toHaveText(
    [/^Cube model in a Git repository/, /^Static list of definitions/],
    { timeout: 15_000 },
  )
  await connectors.getByRole('link', { name: 'Cube model in a Git repository' }).click()
  const form = page.getByRole('form', { name: 'Add Cube model in a Git repository' })
  await expect(
    page.getByRole('heading', { level: 1, name: 'Cube model in a Git repository' }),
  ).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-slot="source-type"]')).toContainText('We never write to it.')
  await form.getByRole('textbox', { name: 'Name', exact: true }).fill('Unreachable model')
  await form
    .getByRole('textbox', { name: 'Repository', exact: true })
    .fill('https://unreachable.invalid/analytics.git')
  await form.getByLabel(/^Read-only token/).fill('e2e-api-token-not-kept')
  // A test reads once and keeps nothing: the service says why it could not read.
  await form.getByRole('button', { name: 'Test connection' }).click()
  await expect(page.locator('[data-slot="source-check"]')).toContainText(
    "We couldn't reach the repository",
    { timeout: 30_000 },
  )
  // The service checks every value again: a ref git could read as an option is refused.
  await form.getByRole('textbox', { name: 'Branch, tag or commit', exact: true }).fill('--all')
  await form.getByLabel(/^Read-only token/).fill('')
  await form.getByRole('textbox', { name: 'Why', exact: true }).fill('Trying the form')
  await form.getByRole('button', { name: 'Add connector' }).click()
  await expect(form).toContainText('Use letters, digits, dots, dashes, underscores and slashes')
  await expect(page).toHaveURL(/section=sources&add=true&connector=cube$/)
  await page.goto('/admin?section=sources')
  await expect(page.locator('[data-source="cube"]')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-source="unreachable-model"]')).toHaveCount(0)
})

test('Market is one dimension with both Cube names, and its Values action opens on the service', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, 'admin-sources@example.test')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/catalogue?panel=dim:market&tab=source')
  const panel = page.locator('[data-slot="dock-panel"]')
  const source = panel.locator('[data-slot="field-table"][aria-label="Where it comes from"]')
  // The demo model has market in the marketing, payments and segments views: one term links all.
  await expect(source.locator('[data-slot="source-names"] li')).toHaveText(
    ['marketing.market', 'orders.market', 'segments.market'],
    { timeout: 15_000 },
  )
  await expect(source).toContainText('3 Cube names, one dimension in Heed.')
  await expect(source).toContainText('Admins')

  await panel.getByRole('link', { name: 'Add values of Market' }).click()
  // Sources reads the operations view first, which takes a moment on the service.
  await expect(page.getByRole('heading', { level: 1, name: 'Add values' })).toBeVisible({
    timeout: 15_000,
  })
  await expect(
    page.locator('[data-slot="propose-terms-value-list"]').getByRole('combobox', {
      name: 'Dimension of values 1',
    }),
  ).toHaveValue('dim:market')
  // The two days figures read by (orders.order_day, marketing.marketing_day) are no name; values
  // of a dimension are added through Propose names.
  await page.goto('/admin?section=sources&source=cube')
  await expect(page.locator('[data-slot="source-terms"]')).toContainText(
    "2 metrics and dimensions aren't yet.",
    { timeout: 15_000 },
  )
  await expect(
    page.locator('[data-slot="source-terms"]').getByRole('link', {
      name: 'Propose names',
    }),
  ).toBeVisible()
})
