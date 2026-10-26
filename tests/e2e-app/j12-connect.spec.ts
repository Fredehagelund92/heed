import { expect, test } from '@playwright/test'
import { go } from './go.ts'

// J12, connect an agent: copy the prompt, the page waits and checks every 3 seconds, the agent
// signs in and joins Connected agents; past 2 minutes it shows what usually helps, at 10 it stops
// and Check again resumes. One Claude cell switches between Claude Code and the app.

test('copy the prompt, wait, and the agent joins the list', async ({ page }) => {
  await page.clock.install()
  await go(page, '/settings/agents')
  const live = page.getByRole('status').filter({ hasText: /connected|connect…/i })
  await expect(live).toContainText('Not connected yet')
  await page.getByRole('button', { name: 'Copy prompt' }).click()
  await expect(live).toContainText('Waiting for your agent to connect…')
  await page.clock.runFor(9_000)
  await expect(live).toContainText('Connected: Claude Code, Jon Abara')
  const list = page.getByRole('list', { name: 'Connected agents' })
  await expect(list.getByRole('listitem').first()).toContainText('Claude CodeNew')
  await expect(page.getByText('5 agents people have connected.')).toBeVisible()
})

test('past 2 minutes it shows what helps; at 10 it stops, and Check again resumes', async ({
  page,
}) => {
  await page.clock.install()
  await go(page, '/settings/agents?connect=waiting')
  const live = page.getByRole('status').filter({ hasText: /waiting|checking/i })
  await page.clock.runFor(120_000)
  await expect(live).toContainText('Still waiting. Nothing has signed in yet.')
  await page.clock.runFor(480_000)
  await expect(live).toContainText('Stopped checking after 10 minutes.')
  await page.getByRole('button', { name: 'Check again' }).click()
  await expect(live).toContainText('Waiting for your agent to connect…')
})

test('each state has an address', async ({ page }) => {
  for (const [flag, text] of [
    ['idle', 'Not connected yet'],
    ['connected', 'It can call get_context'],
    ['timeout', 'Stopped checking after 10 minutes.'],
    ['declined', 'The connection was declined in the browser.'],
  ] as const) {
    await go(page, `/settings/agents?connect=${flag}`)
    await expect(page.getByText(text)).toBeVisible()
  }
})

test("one Claude cell: Claude Code or the app, and the app's steps by hand", async ({ page }) => {
  await go(page, '/settings/agents')
  const cells = page.getByRole('list', { name: 'Start from your agent' })
  await expect(cells.getByText('Claude', { exact: true })).toHaveCount(1)
  await expect(cells.getByRole('button', { name: 'Copy command' })).toBeVisible()
  await cells.getByRole('button', { name: 'Use the app instead' }).click()
  await expect(cells.getByText('The app, on the web or the desktop')).toBeVisible()
  await cells.getByRole('button', { name: 'Steps' }).first().click()
  await expect(
    page.getByText('In Claude, open Customize, then Connectors.', { exact: false }),
  ).toBeVisible()
  await expect(cells.getByRole('link', { name: 'Add to Cursor' })).toHaveAttribute(
    'href',
    /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=/,
  )
  await expect(cells.getByRole('link', { name: 'Install in VS Code' })).toHaveAttribute(
    'href',
    /^vscode:mcp\/install\?/,
  )
})

test('the dialog shows the same body, and a connect there reaches Settings', async ({ page }) => {
  await page.clock.install()
  await go(page, '/inbox?open=connect')
  const dialog = page.getByRole('dialog', { name: 'Connect an agent' })
  await dialog.getByRole('button', { name: 'Copy prompt' }).click()
  await page.clock.runFor(9_000)
  await expect(dialog.getByText('Connected: Claude Code, Jon Abara')).toBeVisible()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await go(page, '/settings/agents')
  await expect(
    page.getByRole('list', { name: 'Connected agents' }).getByRole('listitem').first(),
  ).toContainText('Claude CodeNew')
})
