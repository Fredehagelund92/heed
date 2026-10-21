import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { stringify } from 'yaml'
import { openPage, settle, themes, widths } from './support'

/*
  Settings and Administration (slice W11b of the front end plan; navigation decision, 12 October
  2026) on the mock: a person's own Settings, who sees which section of Administration, the old
  Settings, MCP and gateway and Connect an AI app addresses landing where their sections went, an
  administrator changing a limit with a reason and reading it back in its history and in the
  history log, creating, editing and deleting a domain, giving and removing roles, searching, exporting and
  checking the history log, running a job, importing a file of items, the MCP traffic by client
  and tool, and the sections as a menu on a phone. The mock world lives in the page, so each test
  plays its steps in one page load and moves between sections by link.
*/

const desktop = { ...widths[0], theme: 'light' as const }
const phone = { ...widths[2], theme: 'light' as const }

async function signInAs(page: Page, personId: string) {
  await page.addInitScript((id) => window.localStorage.setItem('cl.mock-person', id), personId)
}

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' })
const settingsSections = (page: Page) => page.getByRole('navigation', { name: 'Settings sections' })
const sections = (page: Page) => page.getByRole('navigation', { name: 'Administration sections' })
const section = async (page: Page, name: string) => {
  await sections(page).getByRole('link', { name, exact: true }).click()
  await expect(sections(page).getByRole('link', { name, exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
}

test.describe("a person's own Settings", () => {
  test('everyone has their profile and Connect an AI app, from the user menu', async ({ page }) => {
    await openPage(page, '/', desktop)
    await expect(sidebar(page).getByRole('link', { name: 'Settings' })).toHaveCount(0)
    await sidebar(page)
      .getByRole('button', { name: /Maria Lindqvist/ })
      .click()
    await page.getByRole('menuitem', { name: /Profile and appearance/ }).click()
    await expect(page).toHaveURL(/\/settings\?section=profile$/)
    await expect(settingsSections(page).getByRole('link')).toHaveText([
      'Profile and appearance',
      'Connect an AI app',
    ])
    await expect(page.getByRole('heading', { name: 'You', exact: true })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Your roles' })).toHaveText('Contributor')
    await expect(page.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible()
    await expect(page.getByRole('table', { name: 'Connected AI apps' })).toHaveCount(0)

    await sidebar(page)
      .getByRole('button', { name: /Maria Lindqvist/ })
      .click()
    await page.getByRole('menuitem', { name: /Connect an AI app/ }).click()
    await expect(page).toHaveURL(/\/settings\?section=connect$/)
    await expect(page).toHaveTitle('Connect an AI app - Settings - Heed')
    await expect(page.getByRole('heading', { name: 'The address' })).toBeVisible()
    await expect(page.getByRole('table', { name: 'Connected AI apps' })).toBeVisible()
  })

  test('the old Connect an AI app addresses land on its section', async ({ page }) => {
    for (const from of ['/connect', '/try-it?tab=connect']) {
      await openPage(page, from, desktop)
      await expect(page).toHaveURL(/\/settings\?section=connect$/)
      await expect(page.getByRole('heading', { name: 'The address' })).toBeVisible()
    }
  })
})

test.describe('who sees which section of Administration', () => {
  test('a contributor is not offered it, and is told whose it is', async ({ page }) => {
    await openPage(page, '/admin', desktop)
    await expect(page.getByText('Administration is for admins and auditors')).toBeVisible()
    await expect(page.getByRole('table')).toHaveCount(0)
    await expect(sidebar(page).getByRole('link', { name: 'Administration' })).toHaveCount(0)
    // An old Settings link to a section Administration took over says the same.
    await page.goto('/admin?section=roles')
    await expect(page).toHaveURL(/\/admin\?section=people$/)
    await expect(page.getByText('Administration is for admins and auditors')).toBeVisible()
  })

  test("an owner's old Areas section is Administration's, which is not theirs", async ({
    page,
  }) => {
    await signInAs(page, 'per_jon')
    await openPage(page, '/settings?section=areas', desktop)
    await expect(page).toHaveURL(/\/admin\?section=domains$/)
    await expect(page.getByText('Administration is for admins and auditors')).toBeVisible()
    await expect(sidebar(page).getByRole('link', { name: 'Administration' })).toHaveCount(0)
  })

  test('an auditor reads the history log in one click, checks its chain, and nothing else', async ({
    page,
  }) => {
    await signInAs(page, 'per_ella')
    await openPage(page, '/', desktop)
    await sidebar(page).getByRole('link', { name: 'Administration' }).click()
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page).toHaveTitle('History log - Administration - Heed')
    // One section, so no section links.
    await expect(sections(page)).toHaveCount(0)
    await expect(
      page.getByRole('table', { name: 'History log' }).locator('[data-entry]'),
    ).not.toHaveCount(0)
    await page.getByRole('button', { name: 'Check the chain' }).click()
    await expect(page.locator('[data-slot="chain-result"]')).toContainText('Every entry checks out')

    await page.goto('/admin?section=limits')
    await expect(page.locator('[data-slot="settings-refused"]')).toContainText(
      'Limits is for admins',
    )
    await page.getByRole('link', { name: 'Open the history log' }).click()
    await expect(page.locator('[data-entry]').first()).toBeVisible()
  })

  test('an administrator has every section, in two groups', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/', desktop)
    await sidebar(page).getByRole('link', { name: 'Administration' }).click()
    await expect(page).toHaveTitle('Domains - Administration - Heed')
    await expect(sections(page).getByRole('link')).toHaveText([
      'Domains',
      'About our business',
      'People',
      'Sources',
      'Limits',
      'MCP and gateway',
      'Import facts',
      'History log',
      'Operations',
    ])
    await expect(sidebar(page).getByRole('link', { name: 'Administration' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  test('old Settings, MCP and gateway addresses keep their section, filters and tab', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    for (const [from, to] of [
      ['/settings?section=audit&entry=4', /\/admin\?section=audit&entry=4$/],
      [
        '/settings?section=limits&setting=review.default_days',
        /\/admin\?section=limits&setting=review\.default_days/,
      ],
      ['/mcp', /\/admin\?section=gateway$/],
      ['/mcp?tab=activity&days=30', /\/admin\?section=gateway&tab=activity&days=30$/],
      ['/settings?section=export', /\/editions$/],
    ] as const) {
      await openPage(page, from, desktop)
      await expect(page).toHaveURL(to)
    }
  })
})

test.describe('limits', () => {
  test('an administrator changes a limit with a reason and reads it in its history and the log', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=limits', desktop)
    const row = page.locator('[data-setting="review.default_days"]')
    await expect(row).toContainText('90 days')
    await row.getByRole('link', { name: 'Check facts again after' }).click()
    const panel = page.locator('[data-slot="dock-panel"]')
    await expect(panel.getByRole('heading', { name: 'Check facts again after' })).toBeVisible()
    await expect(page).toHaveURL(/setting=review\.default_days/)

    // What the schema refuses, the form refuses in words, before anything is sent.
    const days = panel.getByRole('textbox', { name: 'Days' })
    await days.fill('4000')
    await panel.getByRole('button', { name: 'Save new version' }).click()
    await expect(panel).toContainText('Use at most 3,650 days.')
    await expect(panel).toContainText("Say why you're changing it.")
    await expect(days).toBeFocused()

    await days.fill('120')
    await panel.getByRole('textbox', { name: 'Why' }).fill('Owners asked for a longer review time')
    await panel.getByRole('button', { name: 'Save new version' }).click()
    await expect(page.getByText('Check facts again after saved')).toBeVisible()
    await expect(row).toContainText('120 days')
    await expect(panel.locator('[data-slot="setting-current"]')).toHaveText('120 days')

    await panel.getByRole('tab', { name: 'History' }).click()
    const history = panel.locator('[data-slot="setting-history"] li')
    await expect(history.first()).toContainText('120 days · now')
    await expect(history.first()).toContainText('Version 4')
    await expect(history.first()).toContainText('Ravi Kapoor')
    await expect(history.first()).toContainText('Owners asked for a longer review time')
    await expect(history).toHaveCount(4)

    // j and k move through the settings while the panel is open; Escape closes it.
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)

    await section(page, 'History log')
    const latest = page.locator('[data-entry]').first()
    await expect(latest).toContainText('Setting changed')
    await expect(latest).toContainText('Check facts again after')
    await expect(latest).toContainText('Ravi Kapoor')
  })

  test('the judge is another model line, or a model named here', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=limits&setting=models.judge', desktop)
    const panel = page.locator('[data-slot="dock-panel"]')
    await expect(panel.getByRole('radio', { name: 'Another model line' })).toBeChecked()
    await expect(panel.getByRole('textbox', { name: 'Model' })).toHaveCount(0)
    await panel.getByRole('radio', { name: 'A model named here' }).check()
    await panel.getByRole('textbox', { name: 'Provider' }).fill('anthropic')
    await panel.getByRole('textbox', { name: 'Model' }).fill('claude-haiku-4-5')
    await panel.getByRole('textbox', { name: 'Why' }).fill('A cheaper judge for the trial')
    await panel.getByRole('button', { name: 'Save new version' }).click()
    await expect(page.locator('[data-setting="models.judge"]')).toContainText(
      'claude-haiku-4-5 (anthropic)',
    )
  })
})

/** Chooses an option of a combobox field by typing part of its name. */
async function choose(page: Page, field: Locator, text: string, option: string | RegExp) {
  await field.click()
  await field.fill(text)
  await page.getByRole('option', { name: option }).click()
}

test.describe('about our business', () => {
  test('an administrator edits the text in the Markdown editor with its count and preview, resets it, and saves a version with who and when', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=business', desktop)
    await expect(page).toHaveTitle('About our business - Administration - Heed')
    await expect(page.getByText('Background, not a source')).toBeVisible()
    const text = page.getByRole('textbox', { name: 'About our business' })
    await expect(text).toContainText(/^We are an outdoor-gear retailer\./)
    // The starter's words show as the list they are written as; mentions are off.
    await expect(text.getByRole('listitem').first()).toContainText(
      'Order: a purchase a customer completed',
    )
    const block = page.locator('[data-slot="business-text"]')
    const counter = block.locator('[data-slot="body-counter"]')
    await expect(counter).toHaveText('1,102 of 1,200 characters')
    // The box says what to write, in two parts, and what to leave out, so nobody has to guess.
    const guide = block.locator('[data-slot="business-guide"]')
    await expect(guide.getByRole('listitem')).toHaveText([
      /^What the company does\. One or two sentences: what it sells, to whom and where\.$/,
      /^Words an outsider would misread\. One per line, as the word, a colon and what it means\. For example, First-time buyer: .*everyday talk\.$/,
    ])
    await expect(guide).toContainText(
      'Leave out: numbers, deals, dates and what happened in a market',
    )
    await expect(guide).toContainText('legal conclusions, and secrets or personal data')
    await expect(guide).toContainText(
      'Leave it empty to give the assistant and AI apps no background.',
    )
    await expect(block.locator('[data-slot="business-saved"]')).toContainText('Version 1, saved')
    await expect(block.locator('[data-slot="business-saved"]')).toContainText(
      'when the app was set up',
    )
    // The preview is exactly what the models get: the text between Heed's own lines.
    const preview = page.locator('[data-slot="business-preview"] pre')
    await expect(preview).toContainText('It is not evidence: not an item and not a source.')
    await expect(preview).toContainText('First-time buyer: a customer whose first paid order')
    await expect(preview).toContainText(/End of about our business\.$/)

    // The count and the preview follow what is typed; too long is refused in words.
    await text.fill('x'.repeat(1201))
    await expect(counter).toHaveText('1,201 of 1,200 characters, 1 too many')
    await page.getByRole('button', { name: 'Save new version' }).click()
    await expect(block).toContainText('Keep it to 1,200 characters.')
    await expect(block).toContainText("Say why you're changing it.")
    await expect(text).toBeFocused()
    const reset = page.getByRole('button', { name: 'Reset to the starter text' })
    await reset.click()
    await expect(text).toContainText(/^We are an outdoor-gear retailer/)
    await expect(reset).toBeDisabled()

    await text.click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('We run a webshop in Norway.')
    await page.keyboard.press('Enter')
    await page.keyboard.type('- First-time buyer: a first paid order.')
    await expect(text.getByRole('listitem')).toHaveText('First-time buyer: a first paid order.')
    await page.keyboard.type(' @')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await expect(counter).toHaveText('68 of 1,200 characters')
    await expect(preview).toContainText(
      'We run a webshop in Norway.\n\n- First-time buyer: a first paid order.',
    )
    await expect(preview).toContainText('We run a webshop in Norway.')
    await expect(preview).not.toContainText('outdoor-gear')
    await expect(reset).toBeEnabled()
    await page.getByRole('textbox', { name: 'Why' }).fill('We only sell in Norway now')
    await page.getByRole('button', { name: 'Save new version' }).click()
    await expect(page.getByText('About our business saved')).toBeVisible()
    await expect(block.locator('[data-slot="business-saved"]')).toContainText('Version 2, saved')
    await expect(block.locator('[data-slot="business-saved"]')).toContainText('by Ravi Kapoor')
    const history = page.locator('[data-slot="setting-history"] li')
    await expect(history).toHaveCount(2)
    await expect(history.first()).toContainText('We run a webshop in Norway. (68 characters) · now')
    await expect(history.first()).toContainText('Ravi Kapoor')
    await expect(history.first()).toContainText('We only sell in Norway now')

    await section(page, 'History log')
    const latest = page.locator('[data-entry]').first()
    await expect(latest).toContainText('Setting changed')
    await expect(latest).toContainText('About our business')
    await expect(latest).toContainText('Ravi Kapoor')
  })

  test('an empty text gives nothing, and the page fits a phone', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=business', phone)
    await page.getByRole('textbox', { name: 'About our business' }).fill('')
    await expect(page.locator('[data-slot="business-preview"]')).toContainText(
      'Nothing. With the text empty, the assistant and AI apps get no background',
    )
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(phone.width)
  })

  for (const width of widths)
    for (const theme of themes)
      test(`the text editor's layout and accessibility, ${width.name} ${theme}`, async ({
        page,
      }, info) => {
        await signInAs(page, 'per_ravi')
        await openPage(page, '/admin?section=business', { ...width, theme })
        const text = page.getByRole('textbox', { name: 'About our business' })
        await expect(text.getByRole('listitem').first()).toBeVisible()
        await expect(text).toHaveAccessibleDescription(
          /What the company does\. .*Words an outsider would misread\. .*Leave out: .*Leave it empty to give the assistant and AI apps no background\. 1,102 of 1,200 characters/,
        )
        // Words selected show the formatting toolbar, which has no mention.
        await text.getByRole('listitem').first().selectText()
        const toolbar = page.getByRole('toolbar', { name: 'Format the selected words' })
        await expect(toolbar).toBeVisible()
        await expect(toolbar.getByRole('button', { name: 'Mention these words' })).toHaveCount(0)
        await settle(page)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width.width,
        )
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
        await page.screenshot({
          path: info.outputPath(`business-text-${width.name}-${theme}.png`),
          fullPage: true,
        })
      })
})

test.describe('domains and roles', () => {
  test('an administrator creates a domain with its team, edits it, and replaces its owner on the Team tab', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=domains', desktop)
    await page.getByRole('button', { name: 'Create a domain' }).click()
    const dialog = page.getByRole('dialog', { name: 'Create a domain' })
    await dialog.getByRole('button', { name: 'Create domain' }).click()
    await expect(dialog).toContainText('Enter a name.')
    await expect(dialog.getByRole('textbox', { name: 'Name' })).toBeFocused()

    await dialog.getByRole('textbox', { name: 'Name' }).fill('Sales')
    await expect(dialog.getByRole('textbox', { name: 'Id' })).toHaveValue('sales')
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Retention')
    await expect(dialog.getByRole('textbox', { name: 'Id' })).toHaveValue('retention')
    await dialog.getByRole('textbox', { name: 'Id' }).fill('area_retention')
    // A first domain needs no reason; the rest waits under More details.
    await expect(dialog.getByRole('textbox', { name: 'Why' })).toHaveCount(0)
    await expect(dialog.getByRole('combobox', { name: 'Colour' })).toBeHidden()
    await dialog.getByRole('button', { name: /More details/ }).click()
    await dialog.getByRole('combobox', { name: 'Colour' }).selectOption('lime')
    const owners = dialog.getByRole('combobox', { name: 'Owners' })
    await choose(page, owners, 'Kofi', /Kofi Mensah/)
    await choose(page, owners, 'Maria', /Maria/)
    const approvers = dialog.getByRole('combobox', { name: 'High-risk approvers' })
    await choose(page, approvers, 'Ines', /Ines Duarte/)
    await choose(page, approvers, 'Lars', /Lars Dahl/)
    await expect(
      dialog.getByRole('button', { name: /^Remove (Ines Duarte|Lars Dahl)$/ }),
    ).toHaveCount(2)
    await dialog.getByRole('button', { name: 'Create domain' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('Retention created')).toBeVisible()
    await expect(page.getByText('Kofi Mensah and Maria Lindqvist are its owners')).toBeVisible()
    const row = page.locator('[data-row-id="area_retention"]')
    await expect(row).toContainText('Not described yet')
    await expect(row).toContainText('Kofi Mensah')
    await expect(row).toContainText('Maria Lindqvist')

    await row.getByRole('button', { name: 'Edit Retention' }).click()
    const edit = page.getByRole('dialog', { name: 'Edit Retention' })
    await expect(edit).toContainText('area_retention · fixed once a domain is created')
    await expect(edit.locator('[data-slot="area-team"]')).toHaveCount(0)
    await edit.getByRole('textbox', { name: /Review time/ }).fill('40')
    await edit.getByRole('textbox', { name: 'Why' }).fill('Longer reviews while the team is new')
    await edit.getByRole('button', { name: 'Save changes' }).click()
    await expect(edit).toContainText('Enter a whole number of working days, from 1 to 30.')
    await edit.getByRole('textbox', { name: /Review time/ }).fill('10')
    await edit.getByRole('button', { name: 'Save changes' }).click()
    await expect(edit).toBeHidden()

    await row.getByRole('link', { name: 'Retention team in Health' }).click()
    await expect(page).toHaveURL(/open=domain(%3A|:)area_retention/)
    const team = page.locator('[data-slot="domain-team"]')
    const ownerList = team.getByRole('list', { name: 'Owners of Retention' })
    await expect(ownerList.getByRole('listitem')).toContainText(['Kofi Mensah', 'Maria Lindqvist'])
    await expect(
      team.getByRole('list', { name: 'High-risk approvers of Retention' }).getByRole('listitem'),
    ).toContainText(['Ines Duarte', 'Lars Dahl'])
    // Removing one of two owners leaves the other, so nothing waits.
    await team.getByRole('button', { name: 'Remove Kofi Mensah as owner' }).click()
    const remove = page.getByRole('alertdialog', {
      name: 'Remove Kofi Mensah as owner of Retention?',
    })
    await expect(remove).toContainText('They stop deciding for the domain at once.')
    await remove.getByRole('button', { name: 'Remove role' }).click()
    await expect(remove).toBeHidden()
    await expect(ownerList.getByRole('listitem')).toHaveCount(1)
    await expect(ownerList.getByRole('listitem')).toContainText('Maria Lindqvist')
    // The last one stays: the dialog says why and offers the next step, giving the role first.
    await team.getByRole('button', { name: 'Remove Maria Lindqvist as owner' }).click()
    const last = page.getByRole('alertdialog', {
      name: 'Maria Lindqvist is the last owner of Retention',
    })
    await expect(last).toContainText(
      'Retention must keep at least one owner. Make someone else an owner first',
    )
    await expect(
      page.getByRole('alertdialog').getByRole('button', { name: 'Remove role' }),
    ).toHaveCount(0)
    await last.getByRole('button', { name: 'Give the role to someone else' }).click()
    const give = page.getByRole('dialog', { name: 'Give a role' })
    await choose(page, give.getByRole('combobox', { name: 'People' }), 'Tomas', /Tomas/)
    await expect(give).toContainText('Tomas Eriksen becomes an owner of Retention.')
    await give.getByRole('textbox', { name: 'Why' }).fill('Tomas helps with Retention')
    await give.getByRole('button', { name: 'Give role' }).click()
    await expect(give).toBeHidden()
    await expect(ownerList.getByRole('listitem')).toContainText([
      'Maria Lindqvist',
      'Tomas Eriksen',
    ])
  })

  test('an administrator deletes a domain and everything under it in one step, and restores it', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=domains', desktop)
    await page.getByRole('button', { name: 'Delete Sales' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Delete Sales?' })
    await expect(dialog).toHaveAccessibleDescription(/you don't have to move anything first/)
    // What goes, by kind, with every one named behind a toggle; no link to go anywhere.
    const lines = dialog.getByRole('list', { name: 'What deleting Sales does' })
    const items = lines.locator('[data-kind="items"]')
    await expect(items).toContainText(/\d+ accepted facts/)
    await expect(items).toContainText('They move to the Bin, and AI apps stop getting them at once')
    await items.getByRole('button', { name: 'See the facts' }).click()
    await expect(items.getByRole('listitem').first()).toBeVisible()
    await expect(lines.locator('[data-kind="terms"]')).toContainText(/\d+ names/)
    await expect(lines.locator('[data-kind="history"]')).toContainText('Its history')
    await expect(dialog.getByRole('link')).toHaveCount(0)
    // As AWS asks: disabled until the exact words are typed.
    const button = dialog.getByRole('button', { name: 'Delete domain' })
    const words = dialog.getByRole('textbox', { name: 'Type permanently delete to confirm' })
    await expect(button).toBeDisabled()
    await words.fill('Sales')
    await expect(button).toBeDisabled()
    await words.fill('permanently delete')
    await expect(button).toBeEnabled()
    await dialog.getByRole('textbox', { name: /Why/ }).fill('The desk closed')
    await button.click()
    // The dialog is named by what happened now.
    const done = page.getByRole('alertdialog')
    await expect(done.getByRole('heading', { name: 'Sales deleted' })).toBeVisible()
    await expect(done).toContainText(/facts moved to the Bin/)
    await expect(done).toContainText(/Restore it from Deleted domains/)
    await done.getByRole('button', { name: 'Close' }).click()
    await expect(
      page
        .getByRole('table', { name: 'Domains', exact: true })
        .locator('[data-row-id="area_sales"]'),
    ).toHaveCount(0)
    const deleted = page.getByRole('table', { name: 'Deleted domains' })
    await expect(deleted).toContainText('Sales')
    await expect(deleted).toContainText(/Restoring gives back .* facts wait in the Bin\./)

    // Restoring brings back the domain and its team; its items come back from the Bin.
    await deleted.getByRole('button', { name: 'Restore Sales' }).click()
    const restore = page.getByRole('alertdialog', { name: 'Restore Sales?' })
    await restore.getByRole('button', { name: 'Restore domain' }).click()
    const restored = page.getByRole('alertdialog')
    await expect(restored.getByRole('heading', { name: 'Sales restored' })).toBeVisible()
    await expect(restored.getByRole('list', { name: 'Its facts in the Bin' })).toBeVisible()
    await restored.getByRole('button', { name: /^Restore the \d+ facts$/ }).click()
    await expect(restored).toContainText(/facts are back in the library/)
    await restored.getByRole('button', { name: 'Close' }).click()
    await expect(
      page
        .getByRole('table', { name: 'Domains', exact: true })
        .locator('[data-row-id="area_sales"]'),
    ).toBeVisible()
    await expect(page.getByRole('table', { name: 'Deleted domains' })).toHaveCount(0)
  })

  test('a domain that holds nothing is deleted for good, and undone by creating it again', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=domains', desktop)
    await page.getByRole('button', { name: 'Create a domain' }).click()
    const create = page.getByRole('dialog', { name: 'Create a domain' })
    await create.getByRole('textbox', { name: 'Name' }).fill('Oops')
    await create.getByRole('button', { name: 'Create domain' }).click()
    await expect(create).toBeHidden()
    await page.getByRole('button', { name: 'Delete Oops' }).click()
    const remove = page.getByRole('alertdialog', { name: 'Delete Oops?' })
    await expect(remove).toContainText("Oops is empty, so it's deleted for good.")
    await remove
      .getByRole('textbox', { name: 'Type permanently delete to confirm' })
      .fill('permanently delete')
    await remove.getByRole('button', { name: 'Delete domain' }).click()
    const done = page.getByRole('alertdialog')
    await expect(done.getByRole('heading', { name: 'Oops deleted' })).toBeVisible()
    await expect(page.locator('[data-row-id="oops"]')).toHaveCount(0)
    await done.getByRole('button', { name: 'Undo: create it again' }).click()
    await expect(done.getByRole('heading', { name: 'Oops is back' })).toBeVisible()
    await done.getByRole('button', { name: 'Close' }).click()
    await expect(page.locator('[data-row-id="oops"]')).toBeVisible()
  })

  test('the demo domain is never deleted', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=domains', desktop)
    await page.getByRole('button', { name: 'Delete Sandbox' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Delete Sandbox?' })
    await expect(dialog).toContainText('Sandbox is the demo domain, so it always stays.')
    await expect(dialog.getByRole('textbox')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Delete domain' })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Close' }).click()
  })

  test('one person owners several domains: given in one step, and one removed keeps the rest', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=people', desktop)
    await page.getByRole('button', { name: 'Give a role' }).click()
    const give = page.getByRole('dialog', { name: 'Give a role' })
    await expect(give.getByRole('combobox', { name: 'Role' })).toHaveValue('owner')
    // Found by the address, not only the name.
    await choose(page, give.getByRole('combobox', { name: 'People' }), 'per_kofi@', /Kofi Mensah/)
    const domains = give.getByRole('combobox', { name: 'Domains' })
    await choose(page, domains, 'Mark', /Marketing/)
    await choose(page, domains, 'Paid', /Paid media/)
    // Each domain keeps the owners it has: Kofi joins them.
    await expect(give.locator('[data-slot="give-outcome"]')).toContainText(
      'Kofi Mensah becomes an owner of Marketing.',
    )
    await expect(give.locator('[data-slot="give-outcome"]')).toContainText(
      'Kofi Mensah becomes an owner of Paid media.',
    )
    await give.getByRole('button', { name: 'Give roles' }).click()
    await expect(give).toBeHidden()
    const kofi = page.locator('[data-person="per_kofi"]')
    await expect(kofi).toContainText('Owner of Marketing, Owner of Paid media')
    await expect(page.locator('[data-person="per_tomas"]')).toContainText('Owner of Marketing')

    // Removing one of his domains happens on his sheet, and leaves the other.
    await page.locator('[data-person="per_kofi"] [data-row-link]').click()
    const sheet = page.locator('[data-slot="person-sheet"]')
    await page.getByRole('button', { name: 'Remove Kofi Mensah as owner of Marketing' }).click()
    const confirm = page.getByRole('alertdialog', {
      name: 'Remove Kofi Mensah as owner of Marketing?',
    })
    await expect(confirm).toContainText('Its other owners carry on')
    await confirm.getByRole('textbox', { name: 'Why' }).fill('Kofi moves to Payments')
    await confirm.getByRole('button', { name: 'Remove role' }).click()
    await expect(sheet.locator('[data-grant="area_marketing.owner"]')).toHaveCount(0)
    await expect(sheet.locator('[data-grant="area_paid_media.owner"]')).toHaveCount(1)
    await expect(sheet.locator('[data-slot="person-history"]')).toContainText(
      'Removed: owner of Marketing',
    )
    await expect(sheet.locator('[data-slot="person-history"]')).toContainText(
      'Kofi moves to Payments',
    )
  })

  test('an administrator makes someone an auditor, and removes the role', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=people', desktop)
    await page.getByRole('button', { name: 'Give a role' }).click()
    const give = page.getByRole('dialog', { name: 'Give a role' })
    await give.getByRole('button', { name: 'Give role' }).click()
    await expect(give).toContainText('Choose a person.')
    await choose(page, give.getByRole('combobox', { name: 'People' }), 'Maria', /Maria/)
    await give.getByRole('combobox', { name: 'Role' }).selectOption('auditor')
    await give.getByRole('button', { name: 'Give role' }).click()
    await expect(give).toBeHidden()
    await expect(page.locator('[data-person="per_maria"]')).toContainText('Auditor')
    await page.locator('[data-person="per_maria"] [data-row-link]').click()
    const sheet = page.locator('[data-slot="person-sheet"]')
    await expect(sheet.locator('[data-grant="auditor"]')).toContainText('given by Ravi Kapoor')
    await page.getByRole('button', { name: 'Remove Maria Lindqvist as auditor' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove role' }).click()
    await expect(sheet.locator('[data-grant="auditor"]')).toHaveCount(0)
    await expect(page.locator('[data-person="per_maria"]')).toContainText('No role')
  })

  test('an administrator selects people, gives them a role, and removes it from them together, with one step in the history', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=people', desktop)
    await page.getByRole('checkbox', { name: 'Select Lars Dahl' }).check()
    await page.getByRole('checkbox', { name: 'Select Priya Nair' }).check()
    // Ticking a person selects them; it does not open their sheet.
    await expect(page.locator('[data-slot="person-sheet"]')).toHaveCount(0)
    const bar = page.getByRole('region', { name: 'Selected people' })
    await expect(bar).toContainText('2 selected')
    await bar.getByRole('button', { name: 'Give a role' }).click()
    const give = page.getByRole('dialog', { name: 'Give a role' })
    await expect(give.getByRole('button', { name: 'Remove Lars Dahl' })).toBeVisible()
    await expect(give.getByRole('button', { name: 'Remove Priya Nair' })).toBeVisible()
    await expect(give.getByRole('combobox', { name: 'Role' })).toHaveValue('approver')
    await choose(page, give.getByRole('combobox', { name: 'Domains' }), 'Sand', /Sandbox/)
    await give.getByRole('textbox', { name: 'Why' }).fill('More reviewers for the sandbox')
    await give.getByRole('button', { name: 'Give roles' }).click()
    await expect(give).toBeHidden()
    await expect(page.getByText('2 roles given')).toBeVisible()
    await expect(bar).toBeHidden()
    for (const person of ['per_lars', 'per_priya'])
      await expect(page.locator(`[data-person="${person}"]`)).toContainText('Approver of Sandbox')

    await page.getByRole('checkbox', { name: 'Select Lars Dahl' }).check()
    await page.getByRole('checkbox', { name: 'Select Priya Nair' }).check()
    await bar.getByRole('button', { name: 'Remove a role' }).click()
    const remove = page.getByRole('dialog', { name: 'Remove a role from 2 people' })
    await expect(remove.locator('[data-slot="remove-roles"]')).toContainText(
      'Approver of SandboxAll 2',
    )
    await remove.getByRole('button', { name: 'Remove role' }).click()
    await expect(remove).toContainText('Choose a role to remove.')
    await remove.getByRole('checkbox', { name: 'Approver of Sandbox' }).check()
    await remove.getByRole('button', { name: 'Remove 2 roles' }).click()
    await expect(page.getByText('2 roles removed')).toBeVisible()
    for (const person of ['per_lars', 'per_priya'])
      await expect(page.locator(`[data-person="${person}"]`)).not.toContainText('Sandbox')
    await expect(bar).toBeHidden()

    await section(page, 'History log')
    await page
      .getByRole('combobox', { name: 'Kind of change' })
      .selectOption({ label: 'Domain roles' })
    await page.locator('[data-entry]').nth(2).getByRole('link').click()
    const panel = page.locator('[data-slot="dock-panel"]')
    await expect(panel).toContainText('More reviewers for the sandbox')
    await expect(panel).toContainText('Named in the app')
    await panel.getByRole('link', { name: 'Same step' }).click()
    await expect(page.locator('[data-slot="audit-step"]')).toBeVisible()
    await expect(page.locator('[data-entry]')).toHaveCount(2)
  })
})

test.describe('the history log', () => {
  test('filters by kind of change, opens an entry, exports and checks the chain', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=audit', desktop)
    await page.getByRole('combobox', { name: 'Kind of change' }).selectOption({ label: 'Settings' })
    await expect(page).toHaveURL(/action=setting/)
    const rows = page.locator('[data-entry]')
    await expect(rows).toHaveCount(3)
    for (const row of await rows.all()) await expect(row).toContainText('Setting changed')

    await rows.first().getByRole('link').click()
    const panel = page.locator('[data-slot="dock-panel"]')
    await expect(panel.locator('[data-slot="audit-entry"]')).toContainText('setting.changed')
    await expect(panel).toContainText('review.default_days')
    await expect(panel.getByText(/^[0-9a-f]{64}$/)).toBeVisible()
    await page.keyboard.press('Escape')

    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export' }).click()
    await page.getByRole('menuitem', { name: /CSV/ }).click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/^heed-history-\d{4}-\d{2}-\d{2}\.csv$/)
    await expect(page.getByText('3 entries exported')).toBeVisible()
  })

  test('names a proposal by its number and title, and credits the checks to Heed', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=audit&action=proposal.checked', desktop)
    const row = page.locator('[data-entry]').first()
    await expect(row).toContainText('Proposal checked')
    await expect(row.getByRole('cell').nth(2)).toHaveText('Heed')
    const subject = row.getByRole('link', { name: /^#\d+ / })
    await expect(subject).toHaveAttribute('href', /^\/proposals\/[0-9a-f-]+$/)

    await row.getByRole('link', { name: 'Proposal checked' }).click()
    const panel = page.locator('[data-slot="dock-panel"]')
    await expect(panel.locator('[data-slot="audit-entry"]')).toContainText(/Ran for \w+/)
    const name = (await subject.textContent())!
    await panel.getByRole('link', { name }).click()
    await expect(page).toHaveURL(/\/proposals\/[0-9a-f-]+$/)
  })

  test('says which entry no longer checks out', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await page.addInitScript(() => window.localStorage.setItem('cl.mock-scenario', 'audit-broken'))
    await openPage(page, '/admin?section=audit', desktop)
    await page.getByRole('button', { name: 'Check the chain' }).click()
    await expect(page.locator('[data-slot="chain-result"]')).toContainText(
      /Entry \d+ doesn't check out/,
    )
  })
})

test.describe('operations and import', () => {
  test('an administrator runs a job now, once', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=operations', desktop)
    const job = page.locator('[data-job="gaps.detect"]')
    await expect(job).toContainText('Failing')
    await expect(job).toContainText('statement timeout')
    await job.getByRole('button', { name: 'Run Find gaps now' }).click()
    await expect(page.getByText('Find gaps queued')).toBeVisible()
    await expect(job).toContainText('Queued')
    await expect(page.locator('[data-connector="cube"]')).toContainText('Up to date')
  })

  test('with the job runner stopped, Run now says why it cannot', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await page.addInitScript(() =>
      window.localStorage.setItem('cl.mock-scenario', 'runner-stopped'),
    )
    await openPage(page, '/admin?section=operations', desktop)
    await expect(page.locator('[data-slot="runner-stopped"]')).toContainText(
      "The job runner isn't running",
    )
    // A blocked button stays in the tab order and says why when it is pressed.
    await page
      .locator('[data-job="retention.run"]')
      .getByRole('button', { name: 'Run now' })
      .focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toContainText("The job runner isn't running")
  })

  test('an administrator checks a file of items, then makes the proposals', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=import', desktop)
    const entry = {
      areaId: 'area_sandbox',
      title: 'Norway stop, imported',
      summary: 'Online sales to Norway stopped',
      scope: {
        metrics: ['metric:orders'],
        dimensions: [],
        dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
      },
      validity: { start: '2026-08-04', end: null },
      evidence: [
        { url: 'https://example.test/law', quote: 'Online sales stopped', date: '2026-08-04' },
      ],
    }
    const content = page.getByRole('textbox', { name: 'The facts' })
    // No anchors or aliases: the service refuses a file that has them.
    await content.fill(
      stringify([entry, { ...entry, id: 'itm_doesnotexist' }], { aliasDuplicateObjects: false }),
    )
    await page.getByRole('button', { name: 'Check the file' }).click()
    const report = page.locator('[data-slot="import-report"]')
    await expect(report).toContainText('1 entry needs a fix first')
    await expect(page.locator('[data-entry-index="1"]')).toContainText(
      "We couldn't find an accepted fact with this id.",
    )
    await page.getByRole('button', { name: 'Make proposals' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toContainText('Fix the entries with a problem')
    await page.keyboard.press('Escape')

    await content.fill(stringify([entry]))
    await page.getByRole('button', { name: 'Check the file' }).click()
    await expect(report).toContainText('Every entry is ready')
    await page.getByRole('button', { name: 'Make 1 proposal' }).click()
    await expect(page.getByText('1 proposal made')).toBeVisible()
    await expect(report).toContainText('Proposals made')
  })
})

test.describe('MCP traffic and the server address', () => {
  test('an administrator reads the traffic by client and tool, for the days chosen', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=gateway&tab=activity', desktop)
    const grid = page.getByRole('table', { name: 'Calls by AI app and tool' })
    await expect(grid.locator('[data-traffic="claude-code.get_context"]')).toContainText('1,842')
    await expect(grid.locator('[data-traffic="unknown.protocol"]')).toContainText('No AI app named')
    await expect(page.locator('[data-slot="traffic-calls"]')).toContainText('4,456')
    // Malformed calls are the AI app's mistake, counted apart from Heed's errors.
    await expect(page.getByText('Malformed', { exact: true }).first()).toBeVisible()
    const apps = page.getByRole('table', { name: 'Tool calls this week per AI app' })
    await expect(apps.locator('[data-app-family="claude_code"]')).toContainText('142')
    await page.getByRole('link', { name: '30 days' }).click()
    await expect(page).toHaveURL(/days=30/)
    await expect(grid.locator('[data-traffic="claude-code.get_context"]')).toContainText('7,894')
  })

  test('the Clients tab shows the address AI clients connect to', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=gateway', desktop)
    await expect(page.locator('[data-slot="server-address"]')).toContainText(
      'http://localhost:3000/mcp',
    )
  })
})

test.describe('on a phone', () => {
  test('the sections are one menu, and the grids fit the screen', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=limits', phone)
    await expect(sections(page)).toBeHidden()
    await page.getByRole('button', { name: 'Section: Limits' }).click()
    await page.getByRole('menuitemradio', { name: 'History log' }).click()
    await expect(page).toHaveURL(/section=audit/)
    await expect(page.locator('[data-entry]').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(phone.width)

    await page.locator('[data-entry]').first().locator('[data-row-link]').click()
    const panel = page.locator('[data-slot="dock-panel"]')
    await expect(panel).toHaveAttribute('data-mode', 'full')
    await panel.getByRole('button', { name: 'Close' }).click()
    await expect(panel).toHaveCount(0)
  })
})
