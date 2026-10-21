import { expect, test, type Page } from '@playwright/test'
import { openPage, widths } from './support'

/*
  Release and editions (slice W6 of the front end plan, Editions design slice S3) on the mock: the
  editions as release notes with the live edition, an edition open in the docked panel, What
  changed one click from everywhere, the table, going back and the stop switch as guarded actions
  in the overflow menus (Editions design slice S5: the real effect first, then the reason and the
  typed confirmation, then what happened and its undo; a refused go back names the versions that
  stop it), the banner, the edition page, the phone, and retiring, proposing
  a retirement and recording a check from the item page. The mock world lives in the page, so each
  test plays its steps in one page load.
*/

const desktop = { ...widths[0], theme: 'light' as const }
const tablet = { ...widths[1], theme: 'light' as const }
const phone = { ...widths[2], theme: 'light' as const }

/** The live edition once the demo proposals are in, and the one the mock publishes next. */
const LIVE = '2026-10-07.2'
const NEXT = '2026-10-07.3'
/** The newest edition that changes items: the demo week's accepted note adds none. */
const CHANGED = '2026-10-07.1'
/** In the `rollback-blocked` scenario, an edition whose version of one item failed a check later. */
const BLOCKED = '2026-08-02.1'

async function signInAs(page: Page, personId: string) {
  await page.addInitScript((id) => window.localStorage.setItem('cl.mock-person', id), personId)
}

const liveCard = (page: Page) => page.locator('[data-slot="live-edition"]')
const feed = (page: Page) => page.locator('[data-slot="edition-entry"]')
const entry = (page: Page, label: string) =>
  feed(page).filter({ has: page.getByRole('link', { name: `Edition ${label}`, exact: true }) })
const grid = (page: Page) => page.getByRole('table', { name: 'All editions' })
const panel = (page: Page) => page.locator('[data-slot="dock-panel"]')
const views = (page: Page) => page.getByRole('navigation', { name: 'How to show the editions' })
const banner = (page: Page) => page.getByRole('region', { name: 'Sharing stopped' })
const escaped = (label: string) => label.replace('.', '\\.')

test.describe('the editions feed', () => {
  test('reads the editions as release notes, newest first, and opens one in the docked panel', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/editions', desktop)
    await expect(
      page
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('link', { name: 'Editions', exact: true }),
    ).toHaveAttribute('aria-current', 'page')
    await expect(views(page).getByRole('link', { name: 'Feed' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(views(page).getByRole('link', { name: 'Table' })).not.toHaveAttribute(
      'aria-current',
    )
    await expect(liveCard(page)).toContainText(LIVE)
    await expect(liveCard(page)).toContainText('Shared with agents')
    // The live edition is the first entry, with the sentence that says what changed and who.
    await expect(feed(page).first()).toContainText(LIVE)
    await expect(feed(page).first()).toContainText('Live')
    await expect(liveCard(page)).toContainText('Accepted by Jon Abara.')
    await expect(entry(page, CHANGED)).toContainText('was added to Customer value')
    await expect(page.getByRole('heading', { name: '7 October 2026' })).toBeVisible()

    // The number opens the edition in the docked panel, with what it changed field by field.
    await entry(page, CHANGED)
      .getByRole('link', { name: `Edition ${CHANGED}`, exact: true })
      .click()
    await expect(page).toHaveURL(new RegExp(`edition=${escaped(CHANGED)}$`))
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText(`Edition ${CHANGED}`)
    await expect(panel(page).locator('[data-slot="dock-meta"]')).toContainText('2 of 20')
    await expect(
      panel(page).getByRole('article', {
        name: 'Comparing Average order value between France and other markets',
      }),
    ).toBeVisible()
    await panel(page).getByRole('tab', { name: 'Details' }).click()
    await expect(panel(page)).toContainText('Proposal accepted')

    // j and k step through the editions; Escape closes the panel and focus returns to the entry.
    await page.keyboard.press('j')
    await expect(panel(page).getByRole('heading', { level: 2 })).not.toHaveText(
      `Edition ${CHANGED}`,
    )
    await page.keyboard.press('k')
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText(`Edition ${CHANGED}`)
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/editions$/)
    await expect(
      entry(page, CHANGED).getByRole('link', { name: `Edition ${CHANGED}`, exact: true }),
    ).toBeFocused()

    // Twenty at a time; older editions load below.
    await expect(feed(page)).toHaveCount(20)
    await page.getByRole('button', { name: 'Show older editions' }).click()
    await expect(feed(page)).toHaveCount(40)
  })

  test('What changed is one click from the live card, every entry and an open edition', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/editions', desktop)
    await liveCard(page).getByRole('link', { name: 'What changed', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/editions/compare\\?.*until=${escaped(LIVE)}`))
    await expect(page.getByRole('combobox', { name: 'Until edition' })).toHaveValue(LIVE)

    await page.goBack()
    await page.getByRole('link', { name: `What changed in edition ${CHANGED}` }).click()
    await expect(page).toHaveURL(new RegExp(`/editions/compare\\?.*until=${escaped(CHANGED)}`))
    await expect(page.getByRole('combobox', { name: 'Until edition' })).toHaveValue(CHANGED)

    // Since an edition: it against the live edition.
    await page.goBack()
    await page.getByRole('link', { name: `What changed since edition ${CHANGED}` }).click()
    await expect(page.getByRole('combobox', { name: 'Since edition' })).toHaveValue(CHANGED)
    await expect(page.getByRole('combobox', { name: 'Until edition' })).toHaveValue(LIVE)

    // An item of an entry opens straight to its change, in the panel of What changed.
    await page.goBack()
    await entry(page, CHANGED)
      .getByRole('link', {
        name: 'Comparing Average order value between France and other markets: what changed',
      })
      .click()
    await expect(page).toHaveURL(/\/editions\/compare\?.*item=itm_/)
    await expect(panel(page)).toBeVisible()

    // From an open edition, the panel's one primary.
    await openPage(page, `/editions?edition=${CHANGED}`, desktop)
    await panel(page).getByRole('link', { name: 'What changed', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/editions/compare\\?.*until=${escaped(CHANGED)}`))

    // The last days are ranges that end at the live edition.
    await openPage(page, '/editions', desktop)
    const week = liveCard(page).getByRole('link', { name: 'Last 7 days' })
    await expect(week).toHaveAttribute('href', new RegExp(`until=${escaped(LIVE)}`))
    await week.click()
    await expect(page.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('the table is one click away, a page at a time, and its rows open the panel too', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/editions', desktop)
    await views(page).getByRole('link', { name: 'Table' }).click()
    await expect(page).toHaveURL(/view=table/)
    const rows = grid(page).getByRole('row')
    await expect(rows.nth(1)).toContainText(LIVE)
    await expect(rows.nth(1)).toContainText('Live')
    // 50 to a page; the next page holds the rest and the first edition.
    await expect(rows).toHaveCount(51)
    await grid(page)
      .getByRole('link', { name: `Edition ${CHANGED}`, exact: true })
      .click()
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText(`Edition ${CHANGED}`)
    await expect(panel(page).locator('[data-slot="dock-meta"]')).toContainText('2 of 50')
    await page.keyboard.press('Escape')
    await page.getByRole('link', { name: 'Older' }).click()
    await expect(page).toHaveURL(/page=2/)
    await expect(grid(page)).toContainText('First edition')
    await expect(page.getByRole('button', { name: 'Older' })).toBeDisabled()
    await views(page).getByRole('link', { name: 'Feed' }).click()
    await expect(page).toHaveURL(/\/editions$/)
    await expect(feed(page).first()).toContainText(LIVE)
  })

  test('an administrator goes back to an earlier edition: the effect first, then the reason and the number', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/editions?view=table', desktop)
    const earlier = await grid(page).getByRole('row').nth(4).locator('a').first().innerText()
    await grid(page)
      .getByRole('link', { name: `Edition ${earlier}`, exact: true })
      .click()
    await panel(page)
      .getByRole('button', { name: `Actions for edition ${earlier}` })
      .click()
    await page.getByRole('menuitem', { name: 'Go back to this edition…' }).click()

    // Step 1: what changes for agents, fact by fact, from the live edition read backwards.
    const dialog = page.getByRole('alertdialog', { name: /^Go back to how it was on / })
    await expect(dialog).toContainText('Step 1 of 2 · Check what changes')
    await expect(dialog).toContainText('2 facts change for agents: 2 stop being shared.')
    const changes = dialog.getByRole('list', {
      name: `What changes for agents, from edition ${LIVE} back to ${earlier}`,
    })
    await expect(changes.getByRole('listitem')).toHaveCount(2)
    await expect(changes.getByRole('listitem').first()).toContainText('Stops being shared')
    await expect(dialog.getByRole('textbox')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Continue' }).click()

    // Step 2: the reason and the number typed to confirm; nothing happens without them.
    await expect(dialog).toContainText('Step 2 of 2 · Confirm')
    await expect(dialog).toContainText('2 facts change for agents: 2 stop being shared.')
    await dialog.getByRole('button', { name: 'Go back', exact: true }).click()
    await expect(dialog).toContainText('Give a reason.')
    await dialog
      .getByRole('textbox', { name: 'Why are you going back?' })
      .fill('The newer items were wrong.')
    const typed = dialog.getByRole('textbox', { name: `Type ${earlier} to confirm` })
    await typed.fill('2026-10-0')
    await dialog.getByRole('button', { name: 'Go back', exact: true }).click()
    await expect(dialog).toContainText(`This doesn't match ${earlier}.`)
    await expect(liveCard(page)).toContainText(LIVE)

    await typed.fill(earlier)
    await dialog.getByRole('button', { name: 'Go back', exact: true }).click()

    // Done: what happened, from the history log, and the way to undo it.
    const done = page.getByRole('alertdialog', { name: /^Went back to / })
    await expect(done).toContainText(
      `agents get the facts of edition ${earlier} again, saved as the new edition ${NEXT}.`,
    )
    await expect(done.locator('[data-slot="release-history"]')).toContainText(
      `Ravi Kapoor went back to ${earlier}, as edition ${NEXT}, on`,
    )
    await expect(done.locator('[data-slot="release-history"]')).toContainText(
      'Why: The newer items were wrong.',
    )
    await expect(liveCard(page)).toContainText(NEXT)
    await expect(liveCard(page)).toContainText(`Went back to ${earlier}`)

    // Undo is going back again, to the edition that was live, with its own preview.
    await done.getByRole('button', { name: `Go back to ${LIVE}…` }).click()
    const undo = page.getByRole('alertdialog', { name: 'Go back to how it was on 7 October 2026?' })
    await expect(undo).toContainText(`Agents get the facts of edition ${LIVE} again.`)
    await expect(undo).toContainText('2 facts change for agents: 2 come back.')
    await undo.getByRole('button', { name: 'Continue' }).click()
    await undo.getByRole('textbox', { name: 'Why are you going back?' }).fill('Undo the test.')
    await undo.getByRole('textbox', { name: `Type ${LIVE} to confirm` }).fill(LIVE)
    await undo.getByRole('button', { name: 'Go back', exact: true }).click()
    const undone = page.getByRole('alertdialog', { name: 'Went back to 7 October 2026' })
    await expect(undone).toContainText(
      `agents get the facts of edition ${LIVE} again, saved as the new edition 2026-10-07.4.`,
    )
    await undone.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    // Both are new editions: going back deletes nothing, it is undone by going back again.
    await expect(grid(page).getByRole('row').nth(1)).toContainText('2026-10-07.4')
    await expect(grid(page).getByRole('row').nth(1)).toContainText('Live')
    await expect(grid(page).getByRole('row').nth(2)).toContainText(NEXT)
    await expect(grid(page).getByRole('row').nth(3)).toContainText(LIVE)
    // The live card keeps the history log's line for the last going back or stop.
    await expect(liveCard(page).locator('[data-slot="release-history"]')).toContainText(
      `Ravi Kapoor went back to ${LIVE}, as edition 2026-10-07.4, on`,
    )
    await expect(
      liveCard(page).getByRole('link', { name: 'Open in the history log' }),
    ).toHaveAttribute('href', /\/admin\?section=audit&entry=\d+$/)
  })

  test("going back is refused, with the versions named, when one can't be shared again", async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await page.addInitScript(() =>
      window.localStorage.setItem('cl.mock-scenario', 'rollback-blocked'),
    )
    await openPage(page, `/editions/${BLOCKED}`, desktop)
    await page
      .locator('[data-slot="edition-header"]')
      .getByRole('button', { name: `Actions for edition ${BLOCKED}` })
      .click()
    await page.getByRole('menuitem', { name: 'Go back to this edition…' }).click()
    const dialog = page.getByRole('alertdialog', {
      name: 'Go back to how it was on 2 August 2026?',
    })
    await expect(dialog.getByRole('alert')).toContainText("You can't go back to this edition")
    await expect(dialog.getByRole('alert')).toContainText(
      `One of its fact versions can't be shared with agents again. Nothing has changed: agents still get edition ${LIVE}.`,
    )
    const blocked = dialog.getByRole('list', { name: "Versions that can't be shared again" })
    await expect(blocked).toContainText('Average order value lags by one day in the source tool')
    await expect(blocked).toContainText('Version 1')
    await expect(blocked).toContainText("A check this version needs hasn't passed.")
    await expect(dialog.getByRole('button', { name: 'Continue' })).toHaveCount(0)
    await expect(dialog.getByRole('textbox')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()
    await openPage(page, '/editions', desktop)
    await expect(liveCard(page)).toContainText(LIVE)
  })

  test('an administrator stops delivery for a domain; everyone sees the banner until it is back on', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/editions', desktop)
    await expect(banner(page)).toHaveCount(0)
    // Stop sharing is no red button beside Export: it is in the live card's menu.
    await expect(liveCard(page).getByRole('button', { name: /Stop sharing/ })).toHaveCount(0)
    await liveCard(page).getByRole('button', { name: 'More actions for this edition' }).click()
    await page.getByRole('menuitem', { name: 'Stop sharing…' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Stop sharing with agents?' })
    await expect(dialog).toContainText('Step 1 of 2 · Choose what to stop')
    await expect(dialog.getByRole('radio', { name: 'One domain' })).toBeChecked()
    await expect(dialog).toContainText('Within a minute, agents get no facts from Customer value.')
    await expect(dialog).toContainText(
      /Agents stop getting the \d+ facts in Customer value\. Other domains stay as they are\./,
    )
    await expect(dialog).toContainText('People still read these facts in the Library.')
    await dialog.getByRole('button', { name: 'Continue' }).click()
    await dialog
      .getByRole('textbox', { name: 'Why are you stopping it?' })
      .fill('A wrong caveat is reaching answers.')
    await dialog
      .getByRole('textbox', { name: 'Type Customer value to confirm' })
      .fill('Customer value')
    await dialog.getByRole('button', { name: 'Stop sharing' }).click()

    const done = page.getByRole('alertdialog', { name: 'Stopped for Customer value' })
    await expect(done.locator('[data-slot="release-history"]')).toContainText(
      'Ravi Kapoor stopped sharing Customer value with agents on',
    )
    await expect(done.locator('[data-slot="release-history"]')).toContainText(
      'Why: A wrong caveat is reaching answers.',
    )
    await done.getByRole('button', { name: 'Close' }).click()
    await expect(done).toBeHidden()

    await expect(banner(page)).toContainText('Agents get no facts from Customer value for now.')
    await expect(banner(page)).toContainText('Why: A wrong caveat is reaching answers.')
    await expect(liveCard(page)).toContainText('Sharing is stopped')
    // The banner is part of the shell: it stays on every page.
    await page.getByRole('link', { name: 'Library' }).first().click()
    await expect(page).toHaveURL(/\/library$/)
    await expect(banner(page)).toContainText('no facts from Customer value')
    await banner(page).getByRole('link', { name: 'Open Editions' }).click()

    await liveCard(page).getByRole('button', { name: 'Start again…' }).click()
    const resume = page.getByRole('alertdialog', { name: 'Start sharing Customer value again?' })
    await resume.getByRole('textbox', { name: /Why/ }).fill('The caveat is fixed.')
    await resume.getByRole('button', { name: 'Start again' }).click()
    await expect(banner(page)).toHaveCount(0)
    await expect(liveCard(page)).toContainText('Shared with agents')
    await expect(liveCard(page).locator('[data-slot="release-history"]')).toContainText(
      'Ravi Kapoor started sharing Customer value with agents again on',
    )
  })

  test('a stop is undone from where it was made: starting again', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, `/editions?edition=${LIVE}`, desktop)
    await panel(page)
      .getByRole('button', { name: `Actions for edition ${LIVE}` })
      .click()
    await page.getByRole('menuitem', { name: 'Stop sharing…' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Stop sharing with agents?' })
    await dialog.getByRole('radio', { name: 'Everything' }).check()
    await expect(dialog).toContainText(/Agents stop getting the [\d,]+ facts, in every domain\./)
    await dialog.getByRole('button', { name: 'Continue' }).click()
    await dialog
      .getByRole('textbox', { name: 'Why are you stopping it?' })
      .fill('Everything is wrong.')
    await dialog.getByRole('textbox', { name: 'Type everything to confirm' }).fill('everything')
    await dialog.getByRole('button', { name: 'Stop sharing' }).click()
    const done = page.getByRole('alertdialog', { name: 'Stopped for everything' })
    await done.getByRole('button', { name: 'Start again…' }).click()
    const resume = page.getByRole('alertdialog', { name: 'Start sharing everything again?' })
    await resume.getByRole('textbox', { name: /Why/ }).fill('A false alarm.')
    await resume.getByRole('button', { name: 'Start again' }).click()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(banner(page)).toHaveCount(0)
    await expect(liveCard(page)).toContainText('Shared with agents')
  })

  test('stopping everything asks for "everything"; one fact needs it chosen first', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/editions', desktop)
    await liveCard(page).getByRole('button', { name: 'More actions for this edition' }).click()
    await page.getByRole('menuitem', { name: 'Stop sharing…' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Stop sharing with agents?' })
    await dialog.getByRole('radio', { name: 'Everything' }).check()
    await expect(dialog).toContainText('Within a minute, agents get no facts at all.')
    await dialog.getByRole('button', { name: 'Continue' }).click()
    await expect(dialog.getByRole('textbox', { name: 'Type everything to confirm' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Back' }).click()

    // A popup opened in the dialog sits above it, so its options can be chosen.
    await dialog.getByRole('radio', { name: 'One domain' }).check()
    await dialog.getByRole('combobox', { name: 'Domain' }).click()
    await page.getByRole('option', { name: 'Marketing' }).click()
    await expect(dialog).toContainText('Within a minute, agents get no facts from Marketing.')
    await expect(dialog).toContainText(/Agents stop getting the (one fact|\d+ facts) in Marketing/)
    await dialog.getByRole('button', { name: 'Continue' }).click()
    await expect(dialog.getByRole('textbox', { name: 'Type Marketing to confirm' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Back' }).click()

    await dialog.getByRole('radio', { name: 'One fact' }).check()
    await dialog.getByRole('button', { name: 'Continue' }).click()
    await expect(dialog).toContainText('Choose the fact to stop.')
    await expect(dialog.getByRole('combobox', { name: 'Fact' })).toBeFocused()
    await dialog
      .getByRole('combobox', { name: 'Fact' })
      .fill('Comparing Units per order between the Netherlands and other markets')
    // Two facts share that title in the fixtures; either will do.
    await page
      .getByRole('option', { name: /Comparing Units per order between the Netherlands/ })
      .first()
      .click()
    await expect(dialog).toContainText('Agents stop getting only this fact.')
    await dialog.getByRole('button', { name: 'Continue' }).click()
    await expect(dialog.getByRole('textbox', { name: /to confirm/ })).toHaveCount(0)
    await dialog.getByRole('textbox', { name: 'Why are you stopping it?' }).fill('One wrong fact.')
    await dialog.getByRole('button', { name: 'Stop sharing' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(banner(page)).toContainText(
      `Agents don't get the fact "Comparing Units per order between the Netherlands and other markets" for now.`,
    )
  })

  test('below the docking width the panel lies over the list', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/editions', tablet)
    await entry(page, CHANGED)
      .getByRole('link', { name: `Edition ${CHANGED}`, exact: true })
      .click()
    await expect(panel(page)).toHaveAttribute('data-mode', 'overlay')
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText(`Edition ${CHANGED}`)
  })

  test('on a phone an edition opens as a full-screen sheet, and back returns to the feed', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/editions', phone)
    await expect(grid(page)).toHaveCount(0)
    await entry(page, CHANGED)
      .getByRole('link', { name: `Edition ${CHANGED}`, exact: true })
      .click()
    await expect(panel(page)).toHaveAttribute('data-mode', 'full')
    await expect(panel(page).getByRole('link', { name: 'What changed', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await panel(page).getByRole('button', { name: 'Close' }).click()
    await expect(panel(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/editions$/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })
})

test.describe('who may open editions', () => {
  test('a contributor is refused the editions and an edition, and is not offered them', async ({
    page,
  }) => {
    await openPage(page, '/editions', desktop)
    await expect(page.getByText('Editions are for owners and admins')).toBeVisible()
    await expect(liveCard(page)).toHaveCount(0)
    const sidebar = page.getByRole('navigation', { name: 'Main navigation' })
    await expect(sidebar.getByRole('link', { name: 'Editions' })).toHaveCount(0)
    await openPage(page, `/editions/${LIVE}`, desktop)
    await expect(page.getByText('Editions are for owners and admins')).toBeVisible()
    await expect(page.locator('[data-slot="edition-header"]')).toHaveCount(0)
  })

  test('an owner reads and exports the editions, without the administrator’s actions', async ({
    page,
  }) => {
    await signInAs(page, 'per_jon')
    await openPage(page, '/', desktop)
    const sidebar = page.getByRole('navigation', { name: 'Main navigation' })
    await sidebar.getByRole('link', { name: 'Editions' }).click()
    await expect(page).toHaveURL(/\/editions$/)
    await expect(liveCard(page)).toContainText(LIVE)
    await expect(liveCard(page).getByRole('button', { name: 'Export JSON' })).toBeVisible()
    // Stopping delivery and going back stay with administrators, and the history log too.
    await liveCard(page).getByRole('button', { name: 'More actions for this edition' }).click()
    await expect(page.getByRole('menuitem', { name: /Stop sharing/ })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Open edition' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(liveCard(page).locator('[data-slot="release-history"]')).toHaveCount(0)
    await openPage(page, `/editions/${LIVE}`, desktop)
    await expect(page.locator('[data-slot="edition-header"]')).toContainText(
      'What agents get today',
    )
    await expect(page.getByRole('button', { name: /Actions for edition/ })).toHaveCount(0)
  })

  test('the retired Evals and releases addresses lead to where their tabs went', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, `/evals?edition=${CHANGED}&page=2`, desktop)
    await expect(page).toHaveURL(
      new RegExp(`/editions\\?edition=${CHANGED.replace('.', '\\.')}&page=2$`),
    )
    await openPage(page, '/evals?tab=areas', desktop)
    await expect(page).toHaveURL(/\/health\?open=domain%3Aarea_customer_value$/)
    await openPage(page, '/evals?tab=evals', desktop)
    await expect(page).toHaveURL(/\/health$/)
    await openPage(page, `/evals/editions/${LIVE}`, desktop)
    await expect(page).toHaveURL(new RegExp(`/editions/${LIVE.replace('.', '\\.')}$`))
    await expect(page.locator('[data-slot="edition-header"]')).toContainText(
      'What agents get today',
    )
  })
})

test.describe('the edition page', () => {
  test('shows the facts, every change and export; an unknown number says so', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, `/editions/${LIVE}`, desktop)
    const header = page.locator('[data-slot="edition-header"]')
    await expect(header).toContainText('What agents get today')
    await expect(header).toContainText('Proposal accepted')
    await expect(header.getByRole('button', { name: 'Export JSON' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toContainText(LIVE)

    const download = page.waitForEvent('download')
    await header.getByRole('button', { name: 'Export JSON' }).click()
    expect((await download).suggestedFilename()).toBe(`edition-${LIVE}.json`)

    await openPage(page, `/editions/${CHANGED}`, desktop)
    await expect(
      page.getByRole('article', {
        name: 'Comparing Average order value between France and other markets',
      }),
    ).toBeVisible()
    await expect(header.getByRole('link', { name: 'Since this edition' })).toHaveAttribute(
      'href',
      `/editions/compare?since=${CHANGED}`,
    )
    await header.getByRole('link', { name: 'What changed' }).click()
    await expect(page.getByRole('combobox', { name: 'Until edition' })).toHaveValue(CHANGED)

    await openPage(page, '/editions/2020-01-01.9', desktop)
    await expect(page.getByText('There is no edition 2020-01-01.9')).toBeVisible()
  })
})

test.describe('item actions', () => {
  test('an administrator retires an item at once; it reads as retired', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/library/itm_gjdvl50x', desktop)
    await page.getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'Archive fact' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Archive this fact?' })
    await expect(dialog).toContainText(
      'Agents stop getting it at once. You can still read it and its history.',
    )
    await dialog.getByRole('textbox', { name: /Why/ }).fill('The source tool fixed it.')
    await dialog.getByRole('button', { name: 'Archive fact' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('Fact archived')).toBeVisible()
    await expect(page.locator('[data-slot="item-note"]')).toContainText('Archived')
    await expect(page.getByRole('link', { name: 'Suggest a change' })).toHaveCount(0)

    // The mock world lives in the page: move on without a reload.
    await page.getByRole('link', { name: 'Editions', exact: true }).first().click()
    await expect(liveCard(page)).toContainText(NEXT)
    await expect(liveCard(page)).toContainText('Fact archived')
  })

  test('a contributor proposes a retirement; a second proposal is refused in the dialog', async ({
    page,
  }) => {
    await openPage(page, '/library/itm_jyfuvl07', desktop)
    const propose = async () => {
      await page.getByRole('button', { name: 'More actions' }).click()
      await page.getByRole('menuitem', { name: 'Suggest archiving' }).click()
      const dialog = page.getByRole('alertdialog', { name: 'Suggest archiving this fact?' })
      await expect(dialog).toContainText('An owner of Paid media decides.')
      await dialog.getByRole('textbox', { name: /Why/ }).fill('No longer true.')
      await dialog.getByRole('button', { name: 'Suggest archiving' }).click()
      return dialog
    }
    const first = await propose()
    await expect(first).toBeHidden()
    await expect(page.getByText('Proposal sent')).toBeVisible()
    const second = await propose()
    await expect(second.getByRole('alert')).toContainText(
      'Someone already proposed to archive this fact.',
    )
  })

  test('the owner records a check and a new edition is published', async ({ page }) => {
    await signInAs(page, 'per_tomas')
    await openPage(page, '/library/itm_6n54lyca', desktop)
    await page.getByRole('button', { name: 'Mark as checked' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Checked, still correct?' })
    await expect(dialog).toContainText('Why it needs checking')
    await expect(dialog).toContainText('Source changed')
    await dialog.getByRole('textbox', { name: 'What you checked' }).fill('Still excludes tests.')
    await dialog.getByRole('button', { name: 'Checked, still correct' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('Check recorded')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark as checked' })).toHaveCount(0)
  })

  test('a check against a missing definition is refused with the service words', async ({
    page,
  }) => {
    await signInAs(page, 'per_jon')
    await openPage(page, '/library/itm_gjdvl50x', desktop)
    await page.getByRole('button', { name: 'Mark as checked' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Checked, still correct?' })
    await expect(dialog).toContainText('A definition this fact uses is gone')
    await dialog.getByRole('textbox', { name: 'What you checked' }).fill('Looked again.')
    await dialog.getByRole('button', { name: 'Checked, still correct' }).click()
    await expect(dialog.getByRole('alert')).toContainText(
      'A definition this fact uses is gone. Suggest a change instead.',
    )
  })
})
