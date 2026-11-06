import { expect, go, inMockUntil, test } from './go.ts'

// J22, help: one Help row opens a small menu; ? opens the keys from anywhere; the Help page has the
// answer lines, words and how agents use it, and sends a "how do I" to the documentation, which is
// its own site, drawn from docs/help, with a search and an index for agents; the answer line
// explains itself; Report a problem is one box, sent as an issue on GitHub when the install names no
// support address.

test('one Help row opens the menu; Documentation lives in it', async ({ page }) => {
  await go(page, '/inbox')
  const sidebar = page.locator('[data-sidebar=sidebar]').first()
  await expect(sidebar.getByRole('link', { name: /Documentation/ })).toHaveCount(0)
  await sidebar.getByRole('button', { name: 'Help' }).click()
  const menu = page.getByRole('menu')
  for (const row of [
    'Answer lines and words',
    'Keyboard shortcuts',
    'Documentation',
    "What's new",
    'Contact support',
    'Report a problem',
  ])
    await expect(menu.getByRole('menuitem', { name: new RegExp(row) })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Get started/ })).toHaveCount(0)
  await menu.getByRole('menuitem', { name: 'Answer lines and words' }).click()
  await expect(page).toHaveURL(/\/help$/)
})

test('Get started shows in the menu while setup is unfinished', async ({ page }) => {
  await go(page, '/inbox?demo=setup')
  await page.locator('[data-sidebar=sidebar]').first().getByRole('button', { name: 'Help' }).click()
  await expect(page.getByRole('menuitem', { name: /Get started/ })).toContainText('1 of 6')
})

test('? opens the keys from anywhere, and once in the review', async ({ page }) => {
  await go(page, '/inbox')
  // The keys work once the shell is drawn, which on the service waits for its first reads.
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible()
  await page.keyboard.press('?')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toContainText(
    'Search, or go anywhere',
  )
  await page.keyboard.press('Escape')
  await go(page, '/inbox/sug-ines-link/review')
  await expect(
    page
      .getByRole('complementary', { name: 'Try it and decide' })
      .getByRole('button', { name: 'Publish', exact: true }),
  ).toBeVisible()
  await page.keyboard.press('?')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(1)
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toContainText(
    'Close the note, keeping it',
  )
})

test('the Help page searches its own words, and sends the rest to the documentation', async ({
  page,
}) => {
  await go(page, '/help')
  await expect(page.getByRole('table', { name: 'Answer lines' })).toContainText('Checked')
  await page.getByRole('searchbox', { name: 'Search help' }).fill('synonym')
  await expect(page.getByText('Another name for a metric or a dimension')).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search help' }).fill('refund')
  await expect(page.getByText('Nothing in Help matches “refund”')).toBeVisible()
  await expect(
    page.getByRole('link', { name: /Search the documentation/ }).first(),
  ).toHaveAttribute('href', '/docs?q=refund')
})

test('the answer line explains itself', async ({ page }) => {
  await inMockUntil('P10', "Ask's answers from the service", async () => {
    await go(page, '/ask?example=missing')
    await page.getByRole('log').getByRole('button', { name: 'Not found', exact: true }).click()
    await expect(page.getByText('Nothing is written about this yet.')).toBeVisible()
    await expect(page.getByText('What you do.')).toBeVisible()
    await expect(page.getByRole('link', { name: /All answer lines/ })).toHaveAttribute(
      'href',
      '/help',
    )
  })
})

test('Report a problem is one box, sent as an issue with the page it came from', async ({
  page,
}) => {
  await go(page, '/inbox?open=report')
  const dialog = page.getByRole('dialog', { name: 'Report a problem' })
  await expect(dialog.getByRole('button', { name: 'Send' })).toBeDisabled()
  await dialog
    .getByRole('textbox', { name: 'What happened' })
    .fill('The review jumped to another item.')
  // An issue the person writes on GitHub: nothing goes through the service, and the page goes
  // without its query or where this install is. A real address is the build's to set.
  const send = dialog.getByRole('link', { name: 'Send' })
  const issue = new URL((await send.getAttribute('href'))!)
  expect(issue.origin).toBe('https://github.com')
  expect(issue.pathname).toMatch(/\/issues\/new$/)
  expect(issue.searchParams.get('what-happened')).toBe(
    'The review jumped to another item.\n\nPage: /inbox',
  )
  // The Inbox under the dialog marks its cards read on its own; on the service that can take a
  // moment, so the page goes quiet first and only what sending does is counted.
  await page.waitForLoadState('networkidle')
  const writes: string[] = []
  page.on('request', (r) => r.method() !== 'GET' && writes.push(`${r.method()} ${r.url()}`))
  // GitHub is the browser's to open; the page only needs to let it.
  await page.evaluate(() =>
    document.addEventListener('click', (e) => e.preventDefault(), { capture: true, once: true }),
  )
  await send.click()
  await expect(page.getByText('Finish it there. Replies come on the issue.')).toBeVisible()
  await expect(dialog).toHaveCount(0)
  expect(writes).toEqual([])
})

test('Contact support goes to GitHub issues, and asks for a connector the same way', async ({
  page,
}) => {
  await go(page, '/inbox')
  await page.locator('[data-sidebar=sidebar]').first().getByRole('button', { name: 'Help' }).click()
  await expect(page.getByRole('menuitem', { name: 'Contact support' })).toHaveAttribute(
    'href',
    /github\.com\/.+\/issues\/new\/choose$/,
  )
  await page.keyboard.press('Escape')
  await go(page, '/settings/integrations')
  for (const link of [
    page.getByRole('link', { name: 'Request a connector' }),
    page.getByRole('link', { name: 'Open an issue' }),
  ])
    await expect(link).toHaveAttribute(
      'href',
      /github\.com\/.+\/issues\/new\?template=connector\.yml$/,
    )
  await expect(page.getByRole('button', { name: 'Tell us' })).toHaveCount(0)
})

test("the documentation is its own site, with the app's prompt and an index for agents", async ({
  page,
}) => {
  await go(page, '/docs/connect-an-agent')
  await expect(page.locator('[data-sidebar=sidebar]')).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1, name: 'Connect an agent' })).toBeVisible()
  await expect(page.locator('pre').first()).toContainText('claude mcp add --transport http')
  await expect(page.getByRole('navigation', { name: 'On this page' })).toBeVisible()
  await go(page, '/docs/llms.txt')
  await expect(page.locator('pre')).toContainText('- [Privacy](/docs/privacy)')
})

test('the documentation searches the words of its pages, and opens the part that holds them', async ({
  page,
}) => {
  await go(page, '/docs?q=nothing%20signs%20in')
  const search = page.getByRole('dialog', { name: 'Search the docs' })
  await expect(search.getByRole('option').first()).toContainText('Connect an agent')
  await expect(search.getByRole('option').first()).toContainText('If nothing signs in')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/docs\/connect-an-agent#if-nothing-signs-in$/)
  await expect(page.getByRole('heading', { level: 2, name: 'If nothing signs in' })).toBeVisible()
  // What's new, newest first, from the same pages.
  await go(page, '/docs/changelog')
  await expect(page.getByRole('heading', { level: 1, name: "What's new" })).toBeVisible()
  await expect(page.locator('time').first()).toHaveText('3 Nov')
})
