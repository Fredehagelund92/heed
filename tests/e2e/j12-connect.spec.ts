import { agentSignsIn, expect, go, test } from './go.ts'

// J12, connect an agent: copy the prompt, the page waits and checks every 3 seconds, the agent
// signs in and joins Connected agents; past 2 minutes it shows what usually helps, at 10 it stops
// and Check again resumes. One Claude cell switches between Claude Code and the app. On the
// service the agent really signs in (agentSignsIn), and each state of the live line happens.

test('copy the prompt, wait, and the agent joins the list', async ({ page }) => {
  await page.clock.install()
  await go(page, '/settings/agents')
  const live = page.getByRole('status').filter({ hasText: /connected|connect…/i })
  await expect(live).toContainText('Not connected yet')
  await page.getByRole('button', { name: 'Copy prompt' }).click()
  await expect(live).toContainText('Waiting for your agent to connect…')
  await agentSignsIn(page)
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
  // Settings is a lazy route that can arrive after the load event: the wait starts once it is on
  // screen, so the clock moves from there.
  await expect(live).toContainText('Waiting for your agent to connect…')
  await page.clock.runFor(120_000)
  await expect(live).toContainText('Still waiting. Nothing has signed in yet.')
  await page.clock.runFor(480_000)
  await expect(live).toContainText('Stopped checking after 10 minutes.')
  await page.getByRole('button', { name: 'Check again' }).click()
  await expect(live).toContainText('Waiting for your agent to connect…')
})

test('each state has an address', async ({ page }) => {
  // On the service a wait runs out in ten minutes of the page's own time.
  await page.clock.install()
  for (const [flag, text] of [
    ['idle', 'Not connected yet'],
    ['connected', 'It can call get_context'],
    ['declined', 'The connection was declined in the browser.'],
    // Last: on the service, ten minutes of the page's own time pass.
    ['timeout', 'Stopped checking after 10 minutes.'],
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
  await agentSignsIn(page)
  await page.clock.runFor(9_000)
  await expect(dialog.getByText('Connected: Claude Code, Jon Abara')).toBeVisible()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await go(page, '/settings/agents')
  await expect(
    page.getByRole('list', { name: 'Connected agents' }).getByRole('listitem').first(),
  ).toContainText('Claude CodeNew')
})

test('an admin makes an access key, shown once, lists it, and revokes it', async ({ page }) => {
  await go(page, '/settings/agents')
  await page.getByRole('button', { name: /Show or hide Tools and access keys/ }).click()
  await expect(
    page.getByText("For a bot or a scheduled job that can't sign in. None yet."),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Create an access key' }).click()
  await expect(page.getByText('Copy it now: it is shown once.')).toBeVisible()
  await expect(
    page.getByText(
      "For a bot or a scheduled job that can't sign in. 1 key, in Connected agents above.",
    ),
  ).toBeVisible()
  const key = page
    .getByRole('list', { name: 'Connected agents' })
    .getByRole('listitem')
    .filter({ hasText: 'Access key' })
  await expect(key).toHaveCount(1)
  await expect(key).toContainText('Access keyNew')
  await expect(key).toContainText('Jon Abara')
  await expect(key).toContainText(/never used/i)
  await key.getByRole('button', { name: 'Revoke' }).click()
  const dialog = page.getByRole('dialog', { name: 'Revoke this access key?' })
  await dialog.getByRole('button', { name: 'Revoke' }).click()
  await expect(page.getByText('Access key revoked')).toBeVisible()
  await expect(key).toHaveCount(0)
  await expect(
    page.getByText("For a bot or a scheduled job that can't sign in. None yet."),
  ).toBeVisible()
})
