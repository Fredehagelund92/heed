import { expect, test, type Page } from '@playwright/test'
import { openPage, settle, TRY_IT_MATCH, widths } from './support'

/*
  What an agent would get (Try it) and Connect an AI app, as a person uses them: in the assistant's
  panel from any page, as the Try it page with the scope in its address, from Home's quick action
  and from the user menu. The reply is the mock's get_context on its live edition.
*/

const desktop = { ...widths[0], theme: 'light' } as const
const phone = { ...widths[2], theme: 'light' } as const
const launcher = (page: Page) => page.getByRole('button', { name: 'Assistant', exact: true })
const assistant = (page: Page) =>
  page.getByRole((page.viewportSize()?.width ?? 1440) < 768 ? 'dialog' : 'region', {
    name: 'Assistant',
  })
const delivered = (page: Page) => page.getByRole('list', { name: 'What the AI app gets, in order' })

/** The address as a person reads it: the router writes `:`, `,` and `/` percent-encoded. */
const address = (page: Page) => decodeURIComponent(page.url())

async function addChip(page: Page, words: string) {
  const chips = page.getByRole('combobox', { name: 'What it is about' })
  await chips.fill(words)
  // The picker searches the vocabulary, so its rows arrive after typing rests.
  await expect(page.getByRole('option', { name: new RegExp(`^${words}`) }).first()).toBeVisible()
  await chips.press('Enter')
}

test.describe('What an agent would get in the panel', () => {
  test('a scope typed in the bar shows the facts an agent gets, and expands to its page', async ({
    page,
  }) => {
    await openPage(page, '/', desktop)
    await launcher(page).click()
    await assistant(page).getByRole('tab', { name: 'Try a question' }).click()
    await expect(assistant(page).getByText('See what an AI app gets')).toBeVisible()
    // The dates start as the last 30 days of the service's day.
    await expect(assistant(page).getByLabel('From')).toHaveValue('8 Sept 2026')
    await expect(assistant(page).getByLabel('To')).toHaveValue('7 Oct 2026')

    // Nothing to ask yet: the bar says what is missing and keeps the focus in the chips.
    await assistant(page).getByRole('button', { name: 'Show what AI apps get' }).click()
    await expect(
      assistant(page).getByText('Add a metric, a market or a product first.'),
    ).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'What it is about' })).toBeFocused()

    await addChip(page, 'Average order')
    await addChip(page, 'United Kingdom')
    await page.keyboard.press('ControlOrMeta+Enter')
    await expect(delivered(page)).toBeVisible()
    await expect(assistant(page).locator('[data-slot="try-it-outcome"]')).toHaveText('Found')
    await expect(assistant(page).getByText(/^\d+ facts?(, \d+ held back)?\.$/)).toBeVisible()
    await expect(assistant(page).getByText('Applies to Product: Climbing only.')).toBeVisible()
    // Reviewed before served (FR-326): every fact says who accepted it, when and in which
    // edition; behind sign-in it names the person, and says the agent reads only the role.
    const stamps = delivered(page).locator('[data-slot="review-stamp"]')
    await expect(stamps).toHaveCount(await delivered(page).locator('li').count())
    await expect(stamps.first()).toHaveAttribute('data-by', 'person')
    await expect(stamps.first()).toContainText(
      /^Accepted \d{1,2} \w+ \d{4} by Jon Abara, owner of Sales/,
    )
    await expect(assistant(page).getByText(/never a person's name\.$/)).toBeVisible()
    await expect(
      assistant(page).getByLabel('what the AI app is told', { exact: true }),
    ).toContainText('State the documented fact')

    // A fact opens beside the panel, which stays open with its reply.
    const first = delivered(page).getByRole('link').first()
    const title = await first.innerText()
    await first.click()
    await expect(page).toHaveURL(/\/library\/itm_/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
    await expect(delivered(page)).toBeVisible()

    // Expanded, the page holds the same scope in its address, and the same reply.
    await assistant(page).getByRole('link', { name: 'Open page' }).click()
    await expect
      .poll(() => address(page))
      .toMatch(
        /\/try-it\?about=metric:average_order_value,val:market\/united_kingdom&from=2026-09-08&to=2026-10-07$/,
      )
    await expect(assistant(page)).toHaveCount(0)
    await expect(delivered(page).getByRole('link').first()).toHaveText(title)
  })

  test('the panel has Ask and What an agent would get, and points to Connect an AI app', async ({
    page,
  }) => {
    await openPage(page, '/library', desktop)
    await launcher(page).click()
    await expect(assistant(page).getByRole('tab')).toHaveText(['Ask', 'Try a question'])
    await assistant(page).getByRole('tab', { name: 'Try a question' }).click()
    // Using these facts in your own AI app is a setting of your own.
    await assistant(page).getByRole('link', { name: 'Connect an AI app' }).click()
    await expect(page).toHaveURL(/\/settings\?section=connect$/)
    await expect(page.getByRole('heading', { name: 'What to do next' })).toBeVisible()
  })

  test('on a phone the panel fills the screen, and a fact takes it', async ({ page }) => {
    await openPage(page, TRY_IT_MATCH.replace('/try-it', '/'), phone)
    await launcher(page).click()
    await assistant(page).getByRole('tab', { name: 'Try a question' }).click()
    await expect(assistant(page)).toHaveAttribute('data-mode', 'full')
    await addChip(page, 'Average order')
    await addChip(page, 'United Kingdom')
    await assistant(page).getByRole('button', { name: 'Show what AI apps get' }).click()
    await expect(delivered(page)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
    await delivered(page).getByRole('link').first().click()
    await expect(page).toHaveURL(/\/library\/itm_/)
    await expect(assistant(page)).toHaveCount(0)
  })
})

test.describe('the Try it page', () => {
  test('keeps the scope asked in its address, and Back goes to the one before', async ({
    page,
  }) => {
    await openPage(page, TRY_IT_MATCH, desktop)
    await expect(delivered(page)).toBeVisible()
    const count = await delivered(page).getByRole('listitem').count()
    expect(count).toBeGreaterThan(0)

    // Changing the bar does not change the reply until the person asks again.
    await page.getByRole('button', { name: 'Remove Market United Kingdom' }).click()
    await expect(delivered(page).getByRole('listitem')).toHaveCount(count)
    await addChip(page, 'Netherlands')
    await page.getByRole('button', { name: 'Show what AI apps get' }).click()
    await expect
      .poll(() => address(page))
      .toMatch(/about=metric:average_order_value,val:market\/netherlands/)
    await expect(delivered(page)).toBeVisible()

    await page.goBack()
    await expect.poll(() => address(page)).toMatch(/val:market\/united_kingdom/)
    await expect(page.getByRole('button', { name: 'Remove Market United Kingdom' })).toBeVisible()
    await expect(delivered(page).getByRole('listitem')).toHaveCount(count)
  })

  test('reads the scope at today when the dates are missing, and says so', async ({ page }) => {
    await openPage(page, '/try-it?about=metric:average_order_value', desktop)
    await expect(
      page.getByText(
        "You didn't choose dates, so this is what applies today, 7 October 2026. AI apps are told to say so. Add a first and last day to see another period.",
      ),
    ).toBeVisible()
    await expect(page.locator('[data-slot="try-it-outcome"]')).not.toHaveText('Needs more detail')
    await expect(page.getByRole('list', { name: 'What the scope needs' })).toHaveCount(0)
  })

  test('when nothing applies, Start a draft opens Add a fact with the scope and the day', async ({
    page,
  }) => {
    await openPage(
      page,
      '/try-it?about=metric:average_order_value,val:market/united_kingdom&from=1999-01-05&to=1999-01-06',
      desktop,
    )
    // An absence is a statement about the scope that was checked (contract 9.5).
    const absence = page.locator('[data-slot="try-it-no-match"]')
    await expect(absence).toBeVisible()
    await expect(absence).toContainText('Nothing is written down for this')
    await expect(absence).toContainText('which doesn’t mean nothing happened')
    // What the AI app tells the person names what was checked; the rule is its next step.
    await expect(page.locator('[data-slot="try-it-say"]')).toContainText(
      'Nothing is written down for Average order value in United Kingdom from 5 to 6 January 1999. Only that was checked.',
    )
    await expect(page.locator('[data-slot="try-it-next"]')).toContainText(
      'That does not prove there is no caveat',
    )
    await page.getByRole('link', { name: 'Start a draft' }).click()
    await expect(page).toHaveURL(/\/library\/new\?about=.*&from=1999-01-05/)
    const where = page.locator('[data-slot="scope-input"]').first()
    await expect(where.getByText('Average order value')).toBeVisible()
    await expect(where.getByText('United Kingdom')).toBeVisible()
    await expect(page.getByLabel('From').first()).toHaveValue('5 Jan 1999')
  })

  test('reports a gap about the scope, and the administrator finds it in Health', async ({
    page,
  }) => {
    // The mock's terms have no domain, so an administrator manages the new topic.
    await page.addInitScript(() => window.localStorage.setItem('cl.mock-person', 'per_ravi'))
    await openPage(
      page,
      '/try-it?about=metric:average_order_value,val:market/united_kingdom&from=1999-01-05&to=1999-01-06',
      desktop,
    )
    await expect(page.locator('[data-slot="try-it-no-match"]')).toBeVisible()
    await page.getByRole('button', { name: 'Report a gap' }).click()
    const dialog = page.getByRole('dialog', { name: 'Report a gap' })
    await expect(dialog.locator('[data-slot="report-gap-about"]')).toHaveText(
      'Average order value, United Kingdom, 5 January 1999 to 6 January 1999',
    )
    await expect(dialog.getByRole('combobox', { name: "What's wrong" })).toContainText('Missing')
    await dialog.getByRole('combobox', { name: "What's wrong" }).click()
    await page.getByRole('option', { name: 'Applies too narrowly' }).click()
    await expect(dialog.getByText('A fact applies too narrowly.')).toBeVisible()
    await dialog.getByRole('textbox').fill('The January promotion is not covered.')
    await dialog.getByRole('button', { name: 'Report gap' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText('Gap reported', { exact: true })).toBeVisible()

    // In the same session, Health's Gaps view has it, from people.
    await page.getByRole('navigation').getByRole('link', { name: 'Health' }).click()
    const list = page.getByRole('region', { name: 'Work list' })
    await list
      .getByRole('navigation', { name: 'Work list views' })
      .getByRole('link', { name: /^Gaps/ })
      .click()
    await list.getByRole('button', { name: 'Filter', exact: true }).click()
    await page.getByRole('tab', { name: 'Origin' }).click()
    await page.getByRole('checkbox', { name: 'Reported by people' }).click()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/view=gaps.*origin=person|origin=person.*view=gaps/)
    await list.getByRole('link', { name: /^Average order value in United Kingdom/ }).click()
    const record = page.locator('[data-slot="record-pane"]')
    await expect(record.locator('[data-slot="from-people-badge"]')).toBeVisible()
    await expect(record.getByText('January 1999. A person reported it.')).toBeVisible()
    await expect(record.getByText('The January promotion is not covered.')).toBeVisible()
    await expect(record.getByText("From a person's report")).toBeVisible()
  })

  test('the dialog fits a phone, and a note with personal data is refused', async ({ page }) => {
    await openPage(page, TRY_IT_MATCH, phone)
    await expect(delivered(page)).toBeVisible()
    await page.getByRole('button', { name: 'Report a gap' }).click()
    const dialog = page.getByRole('dialog', { name: 'Report a gap' })
    await expect(dialog.getByRole('combobox', { name: "What's wrong" })).toContainText('Missing')
    await dialog.getByRole('textbox').fill('Call me on +45 12 34 56 78')
    await dialog.getByRole('button', { name: 'Report gap' }).click()
    await expect(dialog.getByText(/It looks like it holds personal data or a secret/)).toBeVisible()
    const box = await dialog.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
  })

  test('a failed answer offers to try again', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('cl.mock-scenario', 'error'))
    await openPage(page, TRY_IT_MATCH, desktop)
    await expect(page.getByText("We couldn't get what AI apps get", { exact: true })).toBeVisible()
    await page.evaluate(() => window.localStorage.removeItem('cl.mock-scenario'))
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(delivered(page)).toBeVisible()
  })
})

test.describe('Connect an AI app', () => {
  test('Home, the user menu and the palette all lead to it', async ({ page }) => {
    await openPage(page, '/', desktop)
    await page.getByRole('link', { name: /Connect an AI app/ }).click()
    await expect(page).toHaveURL(/\/settings\?section=connect$/)

    await openPage(page, '/library', desktop)
    await page
      .locator('[data-slot="sidebar"]')
      .getByRole('button', { name: /Maria Lindqvist/ })
      .click()
    await expect(page.getByRole('menuitem', { name: /Connect an AI app/ })).toHaveText(
      /Connect an AI app\s*G\s*then\s*Y/,
    )
    await page.getByRole('menuitem', { name: /Connect an AI app/ }).click()
    await expect(page).toHaveURL(/\/settings\?section=connect$/)

    await openPage(page, '/library', desktop)
    await page.keyboard.press('g')
    await page.keyboard.press('y')
    await expect(page).toHaveURL(/\/settings\?section=connect$/)
    // No sidebar row: it is a section of the person's own Settings, from the user menu.
    await expect(
      page.locator('[data-slot="sidebar"]').getByRole('link', { name: 'Connect an AI app' }),
    ).toHaveCount(0)
  })

  test('says which clients connect today, and copies the setup', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openPage(page, '/settings?section=connect', desktop)
    await expect(page.getByText('Sign in from your AI app')).toBeVisible()
    await expect(page.getByLabel('the address for AI apps', { exact: true })).toHaveText(
      'http://localhost:3000/mcp',
    )
    const clients = page.locator('[data-slot="connect-client"]')
    await expect(clients).toHaveCount(1)
    await expect(clients).toContainText('Claude Code')
    await clients.getByRole('button', { name: 'Copy the setup for Claude Code' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Copied' })).toHaveCount(1)
    // A client that signs in needs the address alone: the token is for one that cannot.
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'claude mcp add --transport http heed http://localhost:3000/mcp',
    )
    const token = clients.getByLabel('the setup for Claude Code with an access key', {
      exact: true,
    })
    await expect(token).toBeHidden()
    await clients.getByRole('button', { name: /If your AI app can't sign in/ }).click()
    await expect(token).toHaveText(
      'claude mcp add --transport http heed http://localhost:3000/mcp \\\n  --header "Authorization: Bearer <your access key>"',
    )
    await settle(page)
  })

  test('a client the administrator switches on is offered at once', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('cl.mock-person', 'per_ravi'))
    await openPage(page, '/admin?section=gateway', desktop)
    await page.getByRole('button', { name: 'Edit Cursor' }).first().click()
    const editor = page.getByRole('dialog', { name: 'Edit Cursor' })
    await editor.getByRole('checkbox', { name: 'Allowed to connect' }).click()
    await editor.getByLabel('Why').fill('The team uses Cursor now')
    await editor.getByRole('button', { name: 'Save changes' }).click()
    await expect(editor).toHaveCount(0)
    await page.getByRole('link', { name: 'Go to Connect an AI app' }).click()
    await expect(page.locator('[data-slot="connect-client"]')).toHaveCount(2)
    await expect(page.getByLabel('the setup for Cursor', { exact: true })).toContainText(
      '"mcpServers"',
    )
  })
})
