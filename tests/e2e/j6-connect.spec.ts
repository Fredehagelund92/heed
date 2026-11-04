import type { Page } from '@playwright/test'
import type { ObjectHost } from '../server/connectors/object-server.ts'
import { expect, go, mode, test } from './go.ts'

// J6, connecting a tool: an admin connects Markdown in Git in five steps (Pick, Connect, Choose,
// Map, Schedule), changes the folders it reads, and disconnects it. Nothing is published by any of
// it. On the service the repository is a Git host on this machine, behind a token invented here;
// the mock reads the address its form starts with. dbt's file also lives at an address and in
// object storage, which on the service is a store on this machine with a key invented when it
// starts.

const token = `j6-${Math.random().toString(36).slice(2, 14)}`
let host: { address: (name: string) => string; close: () => Promise<void> } | undefined
let store: ObjectHost | undefined

test.beforeAll(async () => {
  if (mode !== 'http') return
  const { gitHost } = await import('../server/connectors/git-server.ts')
  const started = await gitHost({ token })
  await started.repository('handbook', {
    'docs/sales/orders.md':
      '# Orders in Germany\n\nOrders in Germany include marketplace orders.\n',
    'docs/marketing/campaigns.md': '# Spring campaigns\n\nThe spring sale runs in April.\n',
  })
  const { legacyManifest } = await import('../server/connectors/dbt-metricflow-fixture.ts')
  await started.repository('shop-metrics', {
    'semantic/semantic_manifest.json': JSON.stringify(legacyManifest),
  })
  host = started
  const { objectHost } = await import('../server/connectors/object-server.ts')
  store = await objectHost()
  store.put('/link/semantic_manifest.json', JSON.stringify(legacyManifest))
  store.put('/bucket/dbt/semantic_manifest.json', JSON.stringify(legacyManifest))
})
test.afterAll(async () => {
  await host?.close()
  await store?.close()
})

const step = (page: Page, name: string) =>
  expect(page.getByRole('list', { name: 'Steps' }).locator('[aria-current=step]')).toContainText(
    name,
  )
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

/** Connect, after Test connection: the tool's checks pass, and Continue goes on. */
async function testAndGoOn(page: Page) {
  await button(page, 'Test connection').click()
  await expect(page.getByText('Testing the connection…')).toBeHidden({ timeout: 30_000 })
  await expect(button(page, 'Continue')).toBeEnabled()
  await button(page, 'Continue').click()
}

/** Map: every folder still to map goes to Sales. */
async function mapToSales(page: Page) {
  while (await button(page, 'Choose').count()) {
    await button(page, 'Choose').first().click()
    await page.getByRole('menuitemradio', { name: 'Sales' }).click()
    // The menu stays open on a pick, as every radio menu does: Escape closes it.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toBeHidden()
  }
}

test('an admin connects a repository in five steps, changes its folders, and disconnects it', async ({
  page,
}) => {
  await go(page, '/settings/integrations')
  const cell = page.locator('div', { has: page.getByRole('heading', { name: 'Markdown in Git' }) })
  await cell.getByRole('link', { name: 'Connect' }).last().click()

  // Pick: what it will hold, and never hold.
  await step(page, 'Pick')
  await expect(page.getByText('What it will never hold')).toBeVisible()
  await button(page, 'Continue').click()

  // Connect: the manifest's form, then Test connection, before anything goes on.
  await step(page, 'Connect')
  await expect(button(page, 'Continue')).toBeDisabled()
  if (host) {
    await page.getByLabel('Repository address').fill(host.address('handbook'))
    await page.getByLabel('Folder').fill('docs')
    await page.getByLabel('Read-only token').fill(token)
  }
  await testAndGoOn(page)

  // Choose: the folders the test found.
  await step(page, 'Choose')
  const folders = page.getByRole('checkbox')
  await expect(folders.first()).toBeVisible()
  await button(page, 'Continue').click()

  // Map: each folder to one domain, before it is read.
  await step(page, 'Map')
  await mapToSales(page)
  await expect(page.getByText(/(\d+) of \1 mapped/)).toBeVisible()
  await button(page, 'Continue').click()

  // Schedule: what happens on each read, and why it is added.
  await step(page, 'Schedule')
  await expect(page.getByText('Nothing is published by a read.', { exact: false })).toBeVisible()
  await expect(button(page, 'Connect Markdown in Git')).toBeDisabled()
  await page.getByLabel('Why are you adding this?').fill('Our handbook lives in Git')
  await button(page, 'Connect Markdown in Git').click()
  await expect(page.getByText('Markdown in Git connected')).toBeVisible()
  await expect(page).toHaveURL(/\/settings\/integrations\/[a-z0-9-]+$/)
  await expect(page.getByRole('heading', { name: /Markdown in Git/ }).first()).toBeVisible()

  // Change settings: the same steps, filled in, from its menu.
  const more = button(page, 'More for Markdown in Git')
  await more.click()
  await page.getByRole('menuitem', { name: 'Change settings' }).click()
  await step(page, 'Connect')
  await expect(page.getByLabel('Repository address')).not.toHaveValue('')
  await testAndGoOn(page)
  await step(page, 'Choose')
  const ticked = page.getByRole('checkbox', { checked: true })
  await expect(ticked.first()).toBeVisible()
  const before = await ticked.count()
  if (before > 1) await ticked.last().click()
  await button(page, 'Continue').click()
  await mapToSales(page)
  await button(page, 'Continue').click()
  await page.getByLabel('Why are you changing it?').fill('Only the sales folder for now')
  await button(page, 'Save changes').click()
  await expect(page.getByText('Markdown in Git settings saved')).toBeVisible()

  // Disconnect: it leaves Integrations, and can be connected again.
  await more.click()
  await page.getByRole('menuitem', { name: 'Disconnect' }).click()
  const dialog = page.getByRole('dialog', { name: 'Disconnect Markdown in Git?' })
  await expect(dialog).toContainText('open suggestions are withdrawn')
  await dialog.getByRole('button', { name: 'Disconnect' }).click()
  await expect(page.getByText('Markdown in Git disconnected')).toBeVisible()
  await expect(page).toHaveURL(/\/settings\/integrations$/)
  await expect(cell.getByRole('link', { name: 'Connect' }).last()).toBeVisible()
})

test('an admin connects dbt in five steps: no calculation, no link to a file', async ({ page }) => {
  await go(page, '/settings/integrations')
  await page.locator('a[href$="/dbt-metricflow/connect"]').click()

  await step(page, 'Pick')
  await expect(page.getByRole('heading', { name: 'dbt', exact: true })).toBeVisible()
  await expect(page.getByText('What it will never hold')).toBeVisible()
  await expect(page.getByText('A link back to')).toBeHidden()
  await button(page, 'Continue').click()

  // Connect: where the file lives, then that place's fields, its defaults filled in.
  await step(page, 'Connect')
  await page.getByRole('radio', { name: /^Git repository/ }).click()
  await expect(page.getByLabel('Branch, tag or commit')).toHaveValue('main')
  await expect(page.getByLabel('File', { exact: true })).toHaveValue('semantic_manifest.json')
  await page
    .getByLabel('Repository', { exact: true })
    .fill(host?.address('shop-metrics') ?? 'https://git.example.com/analytics/shop-metrics.git')
  if (host) {
    await page.getByLabel('Folder', { exact: true }).fill('semantic')
    await page.getByLabel('Read-only token').fill(token)
  }
  await testAndGoOn(page)

  // Choose: its semantic models, and the metrics that span them.
  await step(page, 'Choose')
  await expect(page.getByText('It would hold 12 metrics and 7 dimensions.')).toBeVisible()
  await expect(page.getByText('_shared')).toBeVisible()
  await button(page, 'Continue').click()

  await step(page, 'Map')
  await expect(page.getByText('dbt view')).toBeVisible()
  await mapToSales(page)
  await button(page, 'Continue').click()

  await step(page, 'Schedule')
  await expect(page.getByText("If dbt can't be reached", { exact: false })).toBeVisible()
  await button(page, 'Add dbt').click()
  await expect(page).toHaveURL(/\/settings\/integrations\/[a-z0-9-]+$/)
  await expect(page.getByRole('heading', { name: /dbt/ }).first()).toBeVisible()
})

/** dbt's connect form, at Connect. */
async function atDbtConnect(page: Page) {
  await go(page, '/settings/integrations/dbt-metricflow/connect?step=2')
  await step(page, 'Connect')
}

/** The test's result: what a read would hold, and that nothing is kept yet. */
async function testRead(page: Page) {
  await button(page, 'Test connection').click()
  await expect(page.getByText('Testing the connection…')).toBeHidden({ timeout: 30_000 })
  await expect(page.getByText('A read would hold 12 metrics and 7 dimensions.')).toBeVisible()
  await expect(page.getByText('Nothing is saved until you finish.')).toBeVisible()
  await expect(page.getByText('No domain named')).toBeVisible()
}

test('an admin connects dbt from a signed link: masked, with a recipe and a test read', async ({
  page,
}) => {
  await atDbtConnect(page)
  await expect(page.getByRole('radio', { name: /^Address/ })).toBeChecked()
  await expect(
    page.getByText('Upload target/semantic_manifest.json', { exact: false }),
  ).toBeVisible()
  await expect(page.getByText('aws s3 presign', { exact: false })).toBeVisible()
  const address = page.getByLabel('File address')
  await expect(address).toHaveAttribute('type', 'password')
  await expect(button(page, 'Continue')).toBeDisabled()
  await address.fill(store?.link('/link/semantic_manifest.json') ?? 'https://files.example.com/a')
  await testRead(page)
  await button(page, 'Continue').click()
  await step(page, 'Choose')
  await button(page, 'Continue').click()
  await step(page, 'Map')
  await mapToSales(page)
  await button(page, 'Continue').click()
  await step(page, 'Schedule')
  await button(page, 'Add dbt').click()
  await expect(page).toHaveURL(/\/settings\/integrations\/[a-z0-9-]+$/)

  // Change settings: the link is set, and never shown again.
  await button(page, 'More for dbt').click()
  await page.getByRole('menuitem', { name: 'Change settings' }).click()
  await step(page, 'Connect')
  await expect(page.getByRole('radio', { name: /^Address/ })).toBeChecked()
  await expect(page.getByLabel('File address')).toHaveValue('')
  await expect(page.getByLabel('File address')).toHaveAttribute(
    'placeholder',
    'Set. Leave it empty to keep it',
  )

  await button(page, 'Cancel').click()
  await button(page, 'More for dbt').click()
  await page.getByRole('menuitem', { name: 'Disconnect' }).click()
  await page
    .getByRole('dialog', { name: 'Disconnect dbt?' })
    .getByRole('button', { name: 'Disconnect' })
    .click()
  await expect(page.getByText('dbt disconnected')).toBeVisible()
})

test('object storage asks for each service what that service needs', async ({ page }) => {
  await atDbtConnect(page)
  await page.getByRole('radio', { name: /^Object storage/ }).click()
  await expect(page.getByLabel('Access key')).toHaveAttribute('type', 'password')
  await expect(page.getByLabel('Secret key')).toHaveAttribute('type', 'password')
  await expect(page.getByText('s3:GetObject', { exact: false })).toBeVisible()
  const service = async (name: string) => {
    await page.getByLabel('Storage service').click()
    await page.getByRole('option', { name }).click()
  }

  await service('Google Cloud Storage')
  await expect(page.getByText('gcloud storage cp', { exact: false })).toBeVisible()
  await service('Azure Blob Storage')
  await expect(page.getByText('az storage blob upload', { exact: false })).toBeVisible()
  await expect(page.getByLabel('Shared access signature')).toBeVisible()
  await expect(page.getByLabel('Access key')).toBeHidden()

  await service('S3-compatible store')
  await expect(page.getByLabel('Region')).toBeVisible()
  await page
    .getByLabel('File address')
    .fill(store?.address('/bucket/dbt/semantic_manifest.json') ?? 'https://s3.example.com/b/f')
  await page.getByLabel('Access key').fill(store?.accessKey ?? 'an-access-key')
  await page.getByLabel('Secret key').fill(store?.secretKey ?? 'a-secret-key')
  await testRead(page)
  await expect(button(page, 'Continue')).toBeEnabled()

  // A change to the settings asks for a new test.
  await page.getByLabel('Region').fill('eu-west-1')
  await expect(button(page, 'Continue')).toBeDisabled()
})

test('a server folder explains itself, and nothing can be sent from here', async ({ page }) => {
  await atDbtConnect(page)
  await page.getByRole('radio', { name: /^Server folder/ }).click()
  await expect(page.getByText('HEED_SERVER_FOLDERS', { exact: false })).toBeVisible()
  await expect(button(page, 'Test connection')).toBeHidden()
  await expect(button(page, 'Continue')).toBeDisabled()
  await expect(page.getByLabel('File address')).toBeHidden()
})

test('moving between places sends only the place chosen', async ({ page }) => {
  await atDbtConnect(page)
  await page.getByLabel('File address').fill('https://files.example.com/left-behind')
  await page.getByRole('radio', { name: /^Git repository/ }).click()
  await page
    .getByLabel('Repository', { exact: true })
    .fill(host?.address('shop-metrics') ?? 'https://git.example.com/analytics/shop-metrics.git')
  if (host) {
    await page.getByLabel('Folder', { exact: true }).fill('semantic')
    await page.getByLabel('Read-only token').fill(token)
  }
  await button(page, 'Test connection').click()
  await expect(page.getByText('Testing the connection…')).toBeHidden({ timeout: 30_000 })
  await expect(button(page, 'Continue')).toBeEnabled()
})
