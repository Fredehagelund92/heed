import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { choosePerson, openPage, settle, themes, widths } from './support'

/*
  Where am I and how to get back (contract 9.11) on the mock: one trail on every page from the
  crumb tree, ancestors that reopen their list as it was left, the history rules (what pushes,
  what replaces, what never touches history), Escape on a record page, and the phone's one way up.
  The Editions chain is the captain's case: the feed, an edition's panel, What changed, an item's
  panel, the item's page, and back.
*/

const desktop = { ...widths[0], theme: 'light' as const }
const phone = { ...widths[2], theme: 'light' as const }

const signInAs = (page: Page, person: string) =>
  page.addInitScript((id) => window.localStorage.setItem('cl.mock-person', id), person)

/** The trail as text, `[Link] › Page`, read from the header at 1440. */
async function trail(page: Page) {
  const items = page
    .getByRole('banner')
    .getByRole('navigation', { name: 'breadcrumb' })
    .locator('[data-slot="breadcrumb-item"]')
  return (
    await items.evaluateAll((elements) =>
      elements.map((element) =>
        element.querySelector('a') ? `[${element.textContent}]` : (element.textContent ?? ''),
      ),
    )
  ).join(' › ')
}

const expectTrail = (page: Page, text: string) =>
  expect.poll(() => trail(page), { timeout: 10_000 }).toBe(text)

/** The router's place in the tab's history: 0 is the first entry the tab has of Heed. */
const historyIndex = (page: Page) =>
  page.evaluate(() => (window.history.state as { __TSR_index: number }).__TSR_index)

const panel = (page: Page) => page.locator('[data-slot="dock-panel"]')
const crumbLink = (page: Page, name: string) =>
  page
    .getByRole('banner')
    .getByRole('navigation', { name: 'breadcrumb' })
    .getByRole('link', { name, exact: true })

test.describe('the Editions chain', () => {
  test('keeps a trail at every step, links each changed item, and Back retraces it', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/editions', desktop)
    await expectTrail(page, 'Editions')
    const start = await historyIndex(page)

    // An edition opens in the panel with a new entry; the trail stays the list's.
    await page.locator('[data-slot="edition-entry"] a[data-row-link]').nth(1).click()
    await expect(page).toHaveURL(/\/editions\?edition=2026-10-07\.1$/)
    expect(await historyIndex(page)).toBe(start + 1)
    await expectTrail(page, 'Editions')
    // Its changed items lead to their pages.
    await expect(
      panel(page)
        .getByRole('link', { name: /^Open fact: / })
        .first(),
    ).toHaveAttribute('href', /^\/library\/itm_/)
    // The panel's tab is in the address, and stays from one edition to the next (replace).
    await panel(page).getByRole('tab', { name: 'Details' }).click()
    await expect(page).toHaveURL(/edition=2026-10-07\.1&tab=details/)
    await page.keyboard.press('j')
    await expect(page).toHaveURL(/edition=2026-10-03\.1&tab=details/)
    expect(await historyIndex(page)).toBe(start + 1)
    await page.keyboard.press('k')
    await panel(page).getByRole('tab', { name: 'What changed' }).click()
    await expect(page).toHaveURL(/\/editions\?edition=2026-10-07\.1$/)

    // What changed is a page under Editions, and names the editions it compares as links.
    await panel(page).getByRole('link', { name: 'What changed', exact: true }).click()
    await expect(page).toHaveURL(/\/editions\/compare\?since=.+&until=2026-10-07\.1/)
    await expectTrail(page, '[Editions] › What changed')
    const summary = page.locator('[data-slot="compare-summary"]')
    await expect(summary.getByRole('link', { name: '2026-10-07.1' })).toHaveAttribute(
      'href',
      '/editions/2026-10-07.1',
    )
    const compared = await historyIndex(page)

    // An item opens in What changed's panel; its page is the panel's expand.
    await page.locator('[data-slot="compare-list"] a[data-row-link]').first().click()
    await expect(page).toHaveURL(/&item=itm_/)
    expect(await historyIndex(page)).toBe(compared + 1)
    await panel(page).getByRole('link', { name: "Open the fact's page" }).click()
    await expect(page).toHaveURL(/\/library\/itm_[a-z0-9]+$/)

    // Not opened from the library: no list position, no previous and next.
    await expectTrail(page, '[Library] › Guide')
    await expect(page.getByRole('button', { name: 'Next fact' })).toHaveCount(0)

    // Back retraces every step, each panel reopening.
    await page.goBack()
    await expect(page).toHaveURL(/\/editions\/compare\?.*&item=itm_/)
    await expect(panel(page)).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(/\/editions\/compare\?since=.+&until=2026-10-07\.1$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/editions\?edition=2026-10-07\.1$/)
    await expect(panel(page)).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(/\/editions$/)
  })

  test('Escape closes a panel by going back to the list it opened over', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/editions', desktop)
    const start = await historyIndex(page)
    await page.locator('[data-slot="edition-entry"] a[data-row-link]').nth(1).click()
    await expect(panel(page)).toBeVisible()
    await page.keyboard.press('j')
    await expect(page).toHaveURL(/edition=2026-10-03\.1/)
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/editions$/)
    // Back, not a new entry: nothing closed is left in the history.
    expect(await historyIndex(page)).toBe(start)
  })

  test('a panel opened by its link closes by taking itself out of the address', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/editions?edition=2026-10-07.1', desktop)
    await expect(panel(page)).toBeVisible()
    const start = await historyIndex(page)
    await panel(page).getByRole('button', { name: 'Close' }).click()
    await expect(page).toHaveURL(/\/editions$/)
    expect(await historyIndex(page)).toBe(start)
  })

  test('What changed keeps the open item when a filter changes, as a new entry', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/editions/compare?since=2026-09-10.2&until=2026-10-07.1', desktop)
    await page.locator('[data-slot="compare-list"] a[data-row-link]').first().click()
    await expect(panel(page)).toBeVisible()
    await panel(page)
      .getByRole('tab', { name: /Edition by edition/ })
      .click()
    await expect(page).toHaveURL(/&tab=steps/)
    const before = await historyIndex(page)
    await page.getByRole('button', { name: 'Filter' }).click()
    await page.getByRole('tab', { name: 'Change', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Added' }).click()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/change=added/)
    await expect(page).toHaveURL(/&item=itm_/)
    await expect(page).toHaveURL(/&tab=steps/)
    expect(await historyIndex(page)).toBe(before + 1)
    await expect(panel(page)).toBeVisible()
  })
})

/** The way back to where a page was opened from, before the trail at 1440. */
const originBack = (page: Page) => page.locator('[data-slot="origin-back"]')

test.describe('back to origin', () => {
  test('the Editions chain: an item from What changed goes back to it, panel and all', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/editions', desktop)
    await page.locator('[data-slot="edition-entry"] a[data-row-link]').nth(1).click()
    await panel(page).getByRole('link', { name: 'What changed', exact: true }).click()
    await expect(page).toHaveURL(/\/editions\/compare\?since=.+&until=2026-10-07\.1$/)
    // Opened from the feed's panel: Editions is on the trail, so the trail is the way back.
    await expectTrail(page, '[Editions] › What changed')
    await expect(originBack(page)).toHaveCount(0)

    await page.locator('[data-slot="compare-list"] a[data-row-link]').first().click()
    await expect(page).toHaveURL(/&item=itm_/)
    const opened = page.url()
    const at = await historyIndex(page)
    await panel(page).getByRole('link', { name: "Open the fact's page" }).click()
    await expect(page).toHaveURL(/\/library\/itm_[a-z0-9]+$/)
    const item = page.url()
    await expectTrail(page, '[Library] › Guide')
    await expect(originBack(page)).toHaveText('What changed')
    await expect(originBack(page)).toHaveAccessibleName('Back to What changed')

    // Back, not a new entry: What changed comes back with its item open.
    await originBack(page).click()
    await expect(page).toHaveURL(opened)
    await expect(panel(page)).toBeVisible()
    expect(await historyIndex(page)).toBe(at)

    // Escape on the item page does the same.
    await page.goForward()
    await expect(page).toHaveURL(item)
    await expect(originBack(page)).toBeVisible()
    await page.locator('main').click({ position: { x: 4, y: 4 } })
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(opened)
    await expect(panel(page)).toBeVisible()
    expect(await historyIndex(page)).toBe(at)

    // A reload in the same tab keeps the origin.
    await page.goForward()
    await expect(page).toHaveURL(item)
    await page.reload()
    await expect(originBack(page)).toHaveText('What changed')
    await originBack(page).click()
    await expect(page).toHaveURL(opened)
  })

  test('an edition and What changed lead back to each other', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/editions/compare?since=2026-10-03.1&until=2026-10-07.1', desktop)
    // A deep link: no origin, the trail is the way back.
    await expect(originBack(page)).toHaveCount(0)
    await page
      .locator('[data-slot="compare-summary"]')
      .getByRole('link', { name: '2026-10-07.1' })
      .click()
    await expect(page).toHaveURL(/\/editions\/2026-10-07\.1$/)
    await expectTrail(page, '[Editions] › 2026-10-07.1')
    await expect(originBack(page)).toHaveText('What changed')

    await page.getByRole('main').getByRole('link', { name: 'What changed', exact: true }).click()
    await expect(page).toHaveURL(/\/editions\/compare\?/)
    await expect(originBack(page)).toHaveText('2026-10-07.1')
    // A filter is a new entry of the same page: the edition is further back now, so the way
    // back is a new entry to it.
    const before = await historyIndex(page)
    await page.getByRole('button', { name: 'Filter' }).click()
    await page.getByRole('tab', { name: 'Change', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Added' }).click()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/change=added/)
    expect(await historyIndex(page)).toBe(before + 1)
    await expect(originBack(page)).toHaveText('2026-10-07.1')
    await originBack(page).click()
    await expect(page).toHaveURL(/\/editions\/2026-10-07\.1$/)
    expect(await historyIndex(page)).toBe(before + 2)
  })

  test("an edition's changed item goes back to the edition's panel", async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/editions', desktop)
    await page.locator('[data-slot="edition-entry"] a[data-row-link]').nth(1).click()
    const opened = page.url()
    await panel(page)
      .getByRole('link', { name: /^Open fact: / })
      .first()
      .click()
    await expect(page).toHaveURL(/\/library\/itm_/)
    await expect(originBack(page)).toHaveText('Editions')
    await originBack(page).click()
    await expect(page).toHaveURL(opened)
    await expect(panel(page)).toBeVisible()
  })

  test('the palette to an item goes back to the page it was opened on', async ({ page }) => {
    await openPage(page, '/', desktop)
    await page.keyboard.press('Control+k')
    const dialog = page.getByRole('dialog', { name: 'Command palette' })
    await expect(dialog.getByRole('combobox')).toBeFocused()
    await page.keyboard.type('Comparing Average order value between France')
    await dialog
      .getByRole('option', { name: /Comparing Average order value between France/ })
      .first()
      .click()
    await expect(page).toHaveURL(/\/library\/itm_/)
    await expect(originBack(page)).toHaveText('Home')
    await originBack(page).click()
    await expect(page).toHaveURL(/\/$/)
  })

  test('a deep link and a new tab have no origin; the trail is the way back', async ({
    page,
    context,
  }) => {
    await openPage(page, '/library/itm_jyfuvl07', desktop)
    await expectTrail(page, '[Library] › Guide')
    await expect(originBack(page)).toHaveCount(0)

    await signInAs(page, 'per_ravi')
    await openPage(page, '/editions?edition=2026-10-07.1', desktop)
    const href = await panel(page)
      .getByRole('link', { name: /^Open fact: / })
      .first()
      .getAttribute('href')
    const tab = await context.newPage()
    await openPage(tab, href!, desktop)
    await expectTrail(tab, '[Library] › Guide')
    await expect(originBack(tab)).toHaveCount(0)
    await tab.close()
  })

  test('on a phone the one way back is the origin, else the parent', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/editions/compare?since=2026-10-03.1&until=2026-10-07.1', phone)
    const header = page.getByRole('banner')
    await expect(header.getByRole('link', { name: 'Back to Editions' })).toBeVisible()
    await page.locator('[data-slot="compare-list"] a[data-row-link]').first().click()
    await expect(panel(page)).toBeVisible()
    const opened = page.url()
    await panel(page).getByRole('link', { name: "Open the fact's page" }).click()
    await expect(page).toHaveURL(/\/library\/itm_/)
    const back = header.getByRole('link', { name: 'Back to What changed' })
    await expect(back).toBeVisible()
    await expect(header.getByRole('link', { name: /^Back to / })).toHaveCount(1)
    await expect(originBack(page)).toBeHidden()
    expect((await back.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    await settle(page)
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([])
    await back.click()
    await expect(page).toHaveURL(opened)
  })
})

test.describe('an item and the list it came from', () => {
  test('expanded from the list, it carries the list and Escape goes back to it, panel and all', async ({
    page,
  }) => {
    await openPage(page, '/library?kind=guide', desktop)
    const start = await historyIndex(page)
    await page.locator('a[data-row-link]').nth(2).click()
    await expect(panel(page)).toBeVisible()
    const opened = page.url()
    await panel(page).getByRole('link', { name: 'Open page' }).click()
    await expect(page).toHaveURL(/\/library\/itm_[a-z0-9]+\?kind=guide$/)
    await expectTrail(page, '[Library] › Guide · 3 of 296')
    await expect(crumbLink(page, 'Library')).toHaveAttribute('href', '/library?kind=guide')
    // j steps through the list it came from, replacing the entry.
    await page.keyboard.press('j')
    await expectTrail(page, '[Library] › Guide · 4 of 296')
    expect(await historyIndex(page)).toBe(start + 2)
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(opened)
    await expect(panel(page)).toBeVisible()
    expect(await historyIndex(page)).toBe(start + 1)
  })

  test('a link to the item alone has no list position; Escape goes up to the library', async ({
    page,
  }) => {
    await openPage(page, '/library/itm_jyfuvl07', desktop)
    await expectTrail(page, '[Library] › Guide')
    await expect(page.getByRole('button', { name: 'Previous fact' })).toHaveCount(0)
    const start = await historyIndex(page)
    await page.locator('main').click({ position: { x: 4, y: 4 } })
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/library$/)
    // Nothing of Heed was behind it, so going up is a new entry.
    expect(await historyIndex(page)).toBe(start + 1)
  })

  test('a link with its list keeps the position, and suggesting a change goes up through it', async ({
    page,
  }) => {
    await openPage(page, '/library/itm_jyfuvl07?kind=guide', desktop)
    await expectTrail(page, '[Library] › Guide · 1 of 296')
    await openPage(page, '/library/itm_jyfuvl07/suggest', desktop)
    await expectTrail(page, '[Library] › [Guide] › Suggest a change')
    await expect(crumbLink(page, 'Guide')).toHaveAttribute('href', '/library/itm_jyfuvl07')
  })
})

test.describe('the trail', () => {
  test('names the sections that have their own navigation', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/settings', desktop)
    await expectTrail(page, '[Settings] › Profile and appearance')
    await openPage(page, '/settings?section=connect', desktop)
    await expectTrail(page, '[Settings] › Connect an agent')
    await openPage(page, '/admin?section=audit', desktop)
    await expectTrail(page, '[Administration] › History log')
    await expect(page).toHaveTitle('History log - Administration - Heed')
    await openPage(page, '/library?view=attention', desktop)
    await expectTrail(page, '[Library] › Needs checking')
    // A view chip of a list that has no sidebar entry for it is not a crumb.
    await openPage(page, '/proposals?view=mine', desktop)
    await expectTrail(page, 'Proposals')
  })

  test('an auditor has one section, which is Administration itself', async ({ page }) => {
    await signInAs(page, 'per_ella')
    await openPage(page, '/admin', desktop)
    await expectTrail(page, 'Administration')
  })

  test('ends a record page with its short identity, never its title', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/catalogue/metric/orders', desktop)
    await expectTrail(page, '[Catalogue] › Metric')
    await openPage(page, '/editions/2026-10-07.1', desktop)
    await expectTrail(page, '[Editions] › 2026-10-07.1')
    await openPage(page, '/proposals/00000000-0000-4000-8000-000000000035', desktop)
    await expect.poll(() => trail(page), { timeout: 10_000 }).toMatch(/^\[Proposals\] › #\d+$/)
    await openPage(page, '/catalogue/suggest', desktop)
    await expectTrail(page, '[Catalogue] › Suggest a name')
    await expect(page.getByRole('link', { name: 'Back to the catalogue' })).toHaveCount(0)
  })

  test('says where a page was not found', async ({ page }) => {
    await openPage(page, '/nope', desktop)
    await expectTrail(page, 'Page not found')
    await openPage(page, '/library/itm_nope0000', desktop)
    await expectTrail(page, '[Library] › Page not found')
  })

  test('reopens an ancestor list as it was left, without its panel', async ({ page }) => {
    await openPage(page, '/proposals?view=mine', desktop)
    await page.locator('a[data-row-link]').first().click()
    await expect(panel(page)).toBeVisible()
    await panel(page).getByRole('link', { name: 'Open page' }).click()
    await expect(page).toHaveURL(/\/proposals\/[0-9a-f-]+$/)
    await expect(crumbLink(page, 'Proposals')).toHaveAttribute('href', '/proposals?view=mine')
  })
})

test.describe('the history rules', () => {
  test('a view chip and a history log filter are new entries; the open entry stays', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/catalogue', desktop)
    const start = await historyIndex(page)
    await page.getByRole('navigation', { name: 'Catalogue views' }).getByRole('link').nth(1).click()
    await expect(page).toHaveURL(/kind=metric/)
    expect(await historyIndex(page)).toBe(start + 1)

    await openPage(page, '/admin?section=audit&entry=1', desktop)
    await expect(panel(page)).toBeVisible()
    const before = await historyIndex(page)
    await choosePerson(page.locator('[data-slot="audit-filters"]'), 'Ravi', 'Ravi Kapoor')
    await expect(page).toHaveURL(/actor=/)
    await expect(page).toHaveURL(/entry=1/)
    expect(await historyIndex(page)).toBe(before + 1)
  })

  test('stepping through the review queue replaces the entry', async ({ page }) => {
    await signInAs(page, 'per_jon')
    await openPage(page, '/proposals', desktop)
    await page.getByRole('table', { name: 'Proposals to review' }).getByRole('link').first().click()
    await panel(page).getByRole('link', { name: 'Open page' }).click()
    // The page has replaced the queue (the panel has a decision bar of its own).
    await expect(page.getByRole('table', { name: 'Proposals to review' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Your decision' })).toBeVisible()
    const at = await historyIndex(page)
    const first = page.url()
    await expect(async () => {
      await page.keyboard.press('j')
      expect(page.url()).not.toBe(first)
    }).toPass()
    expect(await historyIndex(page)).toBe(at)
    // Escape goes up, back to the queue with the panel the page was expanded from.
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/proposals\?panel=/)
  })
})

test.describe('the phone header', () => {
  for (const theme of themes) {
    test(`a place shows its title; deeper, one way up that goes back to its list, ${theme}`, async ({
      page,
    }) => {
      await openPage(page, '/library', { ...phone, theme })
      const header = page.getByRole('banner')
      await expect(header.getByRole('button', { name: 'Open navigation' })).toBeVisible()
      await expect(header.locator('[data-slot="breadcrumb-page"]')).toHaveText('Library')
      await expect(header.getByRole('link', { name: /^Back to / })).toHaveCount(0)

      await page.locator('a[data-row-link]').first().click()
      await expect(panel(page)).toBeVisible()
      await panel(page).getByRole('link', { name: 'Open page' }).click()
      await expect(page).toHaveURL(/\/library\/itm_/)
      const up = header.getByRole('link', { name: 'Back to Library' })
      await expect(up).toBeVisible()
      await expect(header.getByRole('navigation', { name: 'breadcrumb' })).toBeHidden()
      expect((await up.boundingBox())?.height).toBeGreaterThanOrEqual(44)
      await settle(page)
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
            .analyze()
        ).violations,
      ).toEqual([])
      await up.click()
      await expect(page).toHaveURL(/\/library\?panel=itm_/)
    })
  }

  test('a section shows its title in the content', async ({ page }) => {
    await openPage(page, '/settings?section=connect', phone)
    await expect(
      page.getByRole('banner').getByRole('link', { name: 'Back to Settings' }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Connect an agent' })).toBeVisible()
  })
})
