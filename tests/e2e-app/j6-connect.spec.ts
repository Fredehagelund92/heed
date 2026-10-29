import type { Page } from '@playwright/test'
import { expect, go, mode, test } from './go.ts'

// J6, connecting a tool: an admin connects Markdown in Git in five steps (Pick, Connect, Choose,
// Map, Schedule), changes the folders it reads, and disconnects it. Nothing is published by any of
// it. On the service the repository is a Git host on this machine, behind a token invented here;
// the mock reads the address its form starts with.

const token = `j6-${Math.random().toString(36).slice(2, 14)}`
let host: { address: (name: string) => string; close: () => Promise<void> } | undefined

test.beforeAll(async () => {
  if (mode !== 'http') return
  const { gitHost } = await import('../server/connectors/git-server.ts')
  const started = await gitHost({ token })
  await started.repository('handbook', {
    'docs/sales/orders.md':
      '# Orders in Germany\n\nOrders in Germany include marketplace orders.\n',
    'docs/marketing/campaigns.md': '# Spring campaigns\n\nThe spring sale runs in April.\n',
  })
  host = started
})
test.afterAll(async () => {
  await host?.close()
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
