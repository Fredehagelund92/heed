import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { MOCK_CONNECT_REQUEST } from '../../src/web/api/mock-connections'
import { openPage, settle, themes, widths } from './support'

/*
  An AI app sign-in on the mock (FR-403): the consent screen outside the shell, signing in on
  the page itself, Allow and Deny, a link that ended, a page inside a frame, and the Connected AI
  apps list with Disconnect. axe checks every state in both appearances at every width.
*/

const approve = (request = MOCK_CONNECT_REQUEST) => `/connect/approve?request=${request}`

async function axe(page: Page) {
  await settle(page)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
}

test('the consent screen names the app and what it may do, outside the shell', async ({ page }) => {
  await openPage(page, approve(), { ...widths[0], theme: 'light' })
  await expect(
    page.getByRole('heading', { name: 'Allow Claude Desktop to use Heed as you?' }),
  ).toBeVisible()
  await expect(
    page.getByText('The app registered itself with Heed.', { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByRole('list', { name: 'It will be able to' }).getByRole('listitem'),
  ).toHaveText([/Read facts/, /Report gaps and give feedback/])
  await expect(page.getByText('Signed in as Maria Lindqvist')).toBeVisible()
  await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(0)
})

test('Allow sends the browser on to where the app asked', async ({ page }) => {
  await openPage(page, approve(), { ...widths[0], theme: 'light' })
  await page.getByRole('button', { name: 'Allow' }).click()
  // The mock sends the browser to Connect an AI app in place of a real app's address. That is a
  // new page load, which starts the mock world afresh.
  await expect(page).toHaveURL(/\/settings\?section=connect$/)
  await expect(page.getByRole('table', { name: 'Connected AI apps' })).toBeVisible()
})

test('Disconnect asks first, then removes the app from the list', async ({ page }) => {
  await openPage(page, '/settings?section=connect', { ...widths[0], theme: 'light' })
  const grid = page.getByRole('table', { name: 'Connected AI apps' })
  await expect(grid).toContainText('Cursor')
  await grid.getByRole('button', { name: 'Disconnect' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Disconnect Cursor?' })
  await expect(dialog).toContainText('It stops working at once.')
  await dialog.getByRole('button', { name: 'Disconnect' }).click()
  await expect(page.getByText('No AI apps are connected')).toBeVisible()
})

test('Deny sends the browser on too, and the sign-in is answered', async ({ page }) => {
  await openPage(page, approve(), { ...widths[0], theme: 'light' })
  await page.getByRole('button', { name: 'Deny' }).click()
  await expect(page).toHaveURL(/\/settings\?section=connect$/)
})

test('a signed-out person signs in on the page itself, then decides', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('cl.mock-scenario', 'signed-out'))
  await openPage(page, approve(), { ...widths[0], theme: 'light' })
  await expect(page.getByRole('heading', { name: 'Sign in to Heed' })).toBeVisible()
  await expect(page).toHaveURL(/\/connect\/approve/)
  await page.getByRole('combobox', { name: 'Sign in as' }).click()
  await page.getByRole('option', { name: /Jon Abara/ }).click()
  await page.getByRole('button', { name: 'Continue as Jon Abara' }).click()
  await expect(page.getByText('Signed in as Jon Abara')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Allow' })).toBeVisible()
})

test('an ended or incomplete link says to connect again', async ({ page }) => {
  await openPage(page, approve('x'.repeat(43)), { ...widths[0], theme: 'light' })
  await expect(page.getByRole('heading', { name: 'This sign-in has ended' })).toBeVisible()
  await page.goto('/connect/approve?request=not-a-handle')
  await expect(
    page.getByRole('heading', { name: "This sign-in link isn't complete" }),
  ).toBeVisible()
})

test('the consent screen refuses to work inside a frame', async ({ page }) => {
  await openPage(page, '/', { ...widths[0], theme: 'light' })
  await page.setContent(
    `<iframe title="framed" src="${approve()}" width="800" height="600"></iframe>`,
  )
  const frame = page.frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: "This page can't open here" })).toBeVisible()
  await expect(frame.getByRole('button', { name: 'Allow' })).toHaveCount(0)
})

test('Connect an AI app lists the connected apps, and says what to do when there are none', async ({
  page,
}) => {
  await openPage(page, '/', { ...widths[0], theme: 'light' })
  await page.locator('[data-slot="sidebar"]').getByRole('button', { name: /Maria/ }).click()
  await page.getByRole('menuitem', { name: 'Connect an AI app' }).click()
  await expect(page).toHaveURL(/\/settings\?section=connect$/)
  await expect(page.getByText('Sign in from your AI app')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your connected AI apps' })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Connected AI apps' })).toContainText('Cursor')
  await page.evaluate(() => window.localStorage.setItem('cl.mock-scenario', 'empty'))
  await page.reload()
  await expect(page.getByText('No AI apps are connected')).toBeVisible()
})

test('Ask first gives the line for the instructions to copy, and promises no call', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openPage(page, '/settings?section=connect', { ...widths[0], theme: 'light' })
  const section = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Ask first' }),
  })
  await expect(section).toContainText('Add this line to its instructions so it checks more often.')
  const labels = ['the line for CLAUDE.md or AGENTS.md', "the line for a data tool's instructions"]
  for (const label of labels) {
    const line = section.getByLabel(label, { exact: true })
    await expect(line).toContainText('get_context')
    await section.getByRole('button', { name: `Copy ${label}` }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await line.textContent())
  }
  // What to do next points at the line, and the page never says the client always asks.
  await expect(
    page.getByText("Add the line under Ask first to your AI app's instructions."),
  ).toBeVisible()
  await expect(page.locator('[data-slot="connect"]')).not.toContainText(
    /asks Heed before it answers|It asks Heed with Get facts for a question first/,
  )
})

test('the connect card copies one prompt with the Ask first line, and does not claim a sign-in by another app', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openPage(page, '/settings?section=connect', { ...widths[0], theme: 'light' })
  // The mock has only Cursor connected, so the card for Claude Code does not claim it as its own.
  const card = page.getByRole('region', { name: 'Connect Claude Code in one paste' })
  await expect(card.getByText('Not connected yet')).toBeVisible()
  await expect(card.getByText('Connected', { exact: true })).toHaveCount(0)
  await card.getByRole('button', { name: 'Copy prompt for Claude Code' }).click()
  const prompt = await page.evaluate(() => navigator.clipboard.readText())
  expect(prompt).toContain('claude mcp add --transport http heed http://localhost:3000/mcp')
  expect(prompt).toContain(
    'Before you answer a question about company data, ask Heed first: call its get_context tool',
  )
  await expect(card.getByRole('button', { name: 'Copy prompt for Claude Code' })).toHaveText(
    'Copied',
  )
  // The card sits above the setup by hand, which keeps every step on its own.
  await expect(page.getByRole('heading', { name: 'Set it up by hand' })).toBeVisible()
})

test('with no app connected the card waits for a sign-in after the copy', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.addInitScript(() => window.localStorage.setItem('cl.mock-scenario', 'empty'))
  await openPage(page, '/settings?section=connect', { ...widths[0], theme: 'light' })
  const card = page.getByRole('region', { name: 'Connect Claude Code in one paste' })
  await expect(card.getByText('Not connected yet')).toBeVisible()
  await card.getByRole('button', { name: 'Copy prompt for Claude Code' }).click()
  await expect(card.getByText(/Waiting for Claude Code to sign in/)).toBeVisible()
})

test('the Heed skill downloads as SKILL.md with the ask-first rule and the statuses', async ({
  page,
}) => {
  await openPage(page, '/settings?section=connect', { ...widths[0], theme: 'light' })
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download SKILL.md' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('SKILL.md')
  const text = readFileSync(await download.path(), 'utf8')
  expect(text).toMatch(/^---\nname: heed\n/)
  for (const words of [
    'ask Heed first',
    '- matched:',
    '- need_more_detail:',
    '- no_match:',
    'claude mcp add --transport http heed http://localhost:3000/mcp',
  ])
    expect(text).toContain(words)
})

for (const size of widths)
  for (const theme of themes)
    test(`axe on Connect an AI app with the connected apps at ${size.name}px, ${theme}`, async ({
      page,
    }) => {
      await openPage(page, '/settings?section=connect', { ...size, theme })
      await expect(page.getByRole('table', { name: 'Connected AI apps' })).toBeVisible()
      await axe(page)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        size.width,
      )
    })

for (const size of widths)
  for (const theme of themes)
    test(`axe on the consent screen and its sign-in step at ${size.name}px, ${theme}`, async ({
      page,
    }) => {
      await openPage(page, approve(), { ...size, theme })
      await expect(page.getByRole('button', { name: 'Allow' })).toBeVisible()
      await axe(page)
      // No horizontal scroll at phone width (contract: 16 px gutter, nothing wider).
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        size.width,
      )
      await page.evaluate(() => window.localStorage.setItem('cl.mock-scenario', 'signed-out'))
      await page.reload()
      await expect(page.getByRole('heading', { name: 'Sign in to Heed' })).toBeVisible()
      await axe(page)
    })
