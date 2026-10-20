import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { expectFlatRail, openPage, themes, widths } from './support'

/*
  A metric of the catalogue (FR-136, design contract 5, the term page): the note line header
  with the read chip, the On the shelf card, the Overview, Context and Source tabs in the
  address, the ways on (Add a fact about it, the library filtered by it, Suggest a name), the
  warm note for an active issue and for a definition gone from Cube, and the not found, error and
  loading states, at every width.
*/

const desktop = { ...widths[0], theme: 'light' as const }
const phone = { ...widths[2], theme: 'light' as const }

const header = (page: Page) => page.locator('[data-slot="term-header"]')
const note = (page: Page) => page.locator('[data-slot="state-note"]')
const tab = (page: Page, name: RegExp | string) => page.getByRole('tab', { name })
const fieldTable = (page: Page, label: string) =>
  page.locator(`[data-slot="field-table"][aria-label="${label}"]`)

async function scenario(page: Page, name: string) {
  await page.addInitScript((value) => window.localStorage.setItem('cl.mock-scenario', value), name)
}

async function metricReady(page: Page, name = 'Orders') {
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible({ timeout: 15_000 })
}

test.describe('the page', () => {
  test('a catalogue row opens it in the panel, and expand opens the page under Catalogue', async ({
    page,
  }) => {
    await openPage(page, '/catalogue', desktop)
    await page
      .locator('[data-term-key="metric:orders"]')
      .getByRole('link', { name: 'Orders' })
      .click({ timeout: 15_000 })
    await page.locator('[data-slot="dock-panel"]').getByRole('link', { name: 'Open page' }).click()
    await expect(page).toHaveURL(/\/catalogue\/metric\/orders$/)
    await metricReady(page)
    await expect(page).toHaveTitle('Orders - Heed')
    await expect(
      page.getByRole('banner').getByRole('navigation', { name: 'breadcrumb' }),
    ).toHaveText(/^Catalogue\s*Metric$/)
    await expect(header(page).locator('[data-slot="term-badges"]')).toContainText(
      /Metric\s*Sales\s*1 active issue\s*Copy read 7 Oct 2026/,
    )
    await expect(header(page).locator('[data-slot="term-description"]')).toHaveText(
      /^The value of orders customers completed and paid for, in euros at the daily rate\./,
    )
    // No formula anywhere: the page points to Cube for it (CON-207).
    await expect(page.getByText(/sum\(|SELECT|amount_eur/i)).toHaveCount(0)
  })

  test('the read chip opens where the copy comes from and what Heed keeps, in place', async ({
    page,
  }) => {
    await openPage(page, '/catalogue/metric/orders', desktop)
    await metricReady(page)
    const chip = page.locator('[data-slot="read-chip"]')
    await expect(chip).toHaveAttribute('aria-expanded', 'false')
    await chip.click()
    const detail = page.locator('[data-slot="read-detail"]')
    // The tool, never the member's view: people see metrics and dimensions, not views.
    await expect(detail).toContainText('From Cube')
    await expect(detail).not.toContainText('orders.orders')
    await expect(detail).toContainText('refreshed at every read, and keeps no formula')
    await chip.click()
    await expect(detail).toBeHidden()
  })

  test('an active issue gets the note line, linked to the issue', async ({ page }) => {
    await openPage(page, '/catalogue/metric/orders', desktop)
    await metricReady(page)
    await expect(note(page)).toHaveText(
      'AI apps warn about Payment provider delays order data in Poland in answers that touch Orders, until 14 Oct 2026.',
    )
    await note(page).getByRole('link').click()
    await expect(page).toHaveURL(/\/library\/itm_/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Payment provider delays order data in Poland',
    )
  })

  test('a calm metric has no note line and no tinted status', async ({ page }) => {
    await openPage(page, '/catalogue/metric/returns', desktop)
    await metricReady(page, 'Returns')
    await expect(note(page)).toHaveCount(0)
    await expect(header(page).locator('[data-slot="catalogue-status"]')).toHaveCount(0)
  })

  test('On the shelf counts the items by kind, in a flat rail', async ({ page }) => {
    await openPage(page, '/catalogue/metric/orders', desktop)
    await metricReady(page)
    const card = page.locator('[data-slot="shelf-card"]')
    await expect(card).toContainText(/93\s*facts about Orders/)
    await expect(card.getByRole('list', { name: 'Facts by kind' })).toHaveText(
      /28 events\s*28 notes\s*23 guides\s*13 examples\s*1 issue/,
    )
    await expect(card).toContainText('Newest change 2 Oct 2026.')
    // Beside the tabs on a wide page, above them on a phone.
    const tabs = page.getByRole('tablist', { name: 'Metric sections' })
    const [cardBox, tabsBox] = [await card.boundingBox(), await tabs.boundingBox()]
    expect(cardBox && tabsBox && cardBox.x > tabsBox.x + tabsBox.width).toBe(true)
    const rail = page.getByRole('complementary', { name: 'Orders on the shelf' })
    await expectFlatRail(rail, 'left')
    await page.setViewportSize({ width: phone.width, height: phone.height })
    const [phoneCard, phoneTabs] = [await card.boundingBox(), await tabs.boundingBox()]
    expect(phoneCard && phoneTabs && phoneCard.y + phoneCard.height < phoneTabs.y).toBe(true)
    await expectFlatRail(rail, 'bottom')
  })
})

test.describe('the tabs', () => {
  test('Overview holds what the library holds and the values used with it', async ({ page }) => {
    await openPage(page, '/catalogue/metric/orders', desktop)
    await metricReady(page)
    await expect(tab(page, 'Overview')).toHaveAttribute('aria-selected', 'true')
    const fields = fieldTable(page, 'What the library holds about Orders')
    await expect(fields.getByRole('term')).toHaveText([
      'Context',
      'Needs checking',
      'Active issues',
      'Gaps',
      'Mentioned by',
      'Last updated',
    ])
    await expect(fields).toContainText('93 facts')
    await expect(fields).toContainText('None open')
    // The items that only mention it live under Context, in one place for context.
    await expect(page.getByRole('heading', { name: 'Mentioned in' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Also mentioned/ })).toHaveCount(0)
    const values = page.getByRole('list', { name: 'Values often used with Orders' })
    await expect(values.getByRole('link').first()).toHaveText(/^Market \S+ \d+$/)
    await values.getByRole('link').first().click()
    await expect(page).toHaveURL(/\/library\?about=market%3A/)
  })

  test('the tab lives in the address: Context lists the newest items, Source the copy', async ({
    page,
  }) => {
    await openPage(page, '/catalogue/metric/orders', desktop)
    await metricReady(page)
    await tab(page, /Context/).click()
    await expect(page).toHaveURL(/\?tab=context$/)
    const items = page.getByRole('list', { name: 'Context about Orders' })
    await expect(items.getByRole('listitem')).toHaveCount(10)
    await expect(page.locator('[data-slot="term-items-footer"]')).toContainText(
      'Newest first. Showing 10 of 93.',
    )
    await page.getByRole('link', { name: 'Show all 93 in the library' }).click()
    await expect(page).toHaveURL(/\/library\?about=orders&ended=show$/)
    await expect(page.locator('#library-count')).toContainText('93')

    await openPage(page, '/catalogue/metric/orders?tab=source', desktop)
    await metricReady(page)
    await expect(tab(page, 'Source')).toHaveAttribute('aria-selected', 'true')
    const source = fieldTable(page, 'Where it comes from')
    await expect(source.getByRole('term')).toHaveText([
      'Source',
      'Cube name',
      'Description',
      'Type',
      'Model file',
      'Domain',
      'Owner',
      'Changed in Cube',
    ])
    // The address is built from the model folder setting and the file the read named.
    await expect(source.getByRole('link', { name: /Open the model file/ })).toHaveAttribute(
      'href',
      'https://github.com/Fredehagelund92/heed/blob/main/db/seed/cube/orders.yml',
    )
    await expect(page.locator('[data-slot="description-copy"]')).toHaveText(
      /^The value of orders customers completed and paid for/,
    )
    await expect(source).toContainText("A copy of Cube's description, at most 500 characters")
    await expect(source).toContainText('Jon Abara')

    await tab(page, 'Overview').click()
    await expect(page).toHaveURL(/\/catalogue\/metric\/orders$/)
  })

  test('Context ends in the items that only mention it, closed until asked for', async ({
    page,
  }) => {
    await openPage(page, '/catalogue/metric/orders?tab=context', desktop)
    await metricReady(page)
    const context = page.getByRole('tabpanel', { name: /Context/ })
    const trigger = context.getByRole('button', { name: /^Also mentioned \d+$/ })
    // A small heading under the context's own, and closed: nothing loads until it opens.
    await expect(context.getByRole('heading', { level: 3, name: /^Also mentioned/ })).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    const mentions = page.getByRole('list', { name: 'Facts that mention Orders' })
    await expect(mentions).toHaveCount(0)
    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(mentions.getByRole('listitem')).toHaveCount(5)
    await expect(context.getByText(/^The 5 newest of \d+\.$/)).toBeVisible()
    // A mention is not scope (FR-131), and the list says so.
    await expect(context).toContainText(
      "These facts name Orders in their text. A mention isn't what a fact is about, so AI apps don't get a fact for its mention alone.",
    )
    await trigger.click()
    await expect(mentions).toHaveCount(0)
  })

  test('an item opened from the Context tab steps through the same list', async ({ page }) => {
    await openPage(page, '/catalogue/metric/orders?tab=context', desktop)
    await metricReady(page)
    await page.getByRole('list', { name: 'Context about Orders' }).getByRole('link').first().click()
    await expect(page).toHaveURL(/\/library\/itm_\w+\?about=orders&ended=show$/)
    await expect(
      page.getByRole('navigation', { name: 'breadcrumb' }).getByText(/ · \d+ of 93$/),
    ).toBeVisible()
  })
})

test.describe('the ways on', () => {
  test('Add a fact about Orders starts the form with Orders in its scope', async ({ page }) => {
    await openPage(page, '/catalogue/metric/orders', desktop)
    await metricReady(page)
    await page.getByRole('link', { name: 'Add a fact about Orders' }).click()
    await expect(page).toHaveURL(/\/library\/new\?metric=orders$/)
    await expect(page.locator('[data-slot="scope-chip"]')).toHaveText([/^Orders/], {
      timeout: 15_000,
    })
  })

  test('Show all 93 facts opens the library filtered by the metric', async ({ page }) => {
    await openPage(page, '/catalogue/metric/orders', desktop)
    await metricReady(page)
    await header(page).getByRole('link', { name: 'Show all 93 facts' }).click()
    await expect(page).toHaveURL(/\/library\?about=orders&ended=show$/)
  })

  test('the More menu copies and leads to Suggest a name', async ({ page }) => {
    await openPage(page, '/catalogue/metric/orders', desktop)
    await metricReady(page)
    await page.getByRole('button', { name: 'More actions' }).click()
    await expect(page.getByRole('menuitem')).toHaveText([
      'Copy link',
      'Copy Cube name',
      'Suggest a name',
    ])
    await page.getByRole('menuitem', { name: 'Suggest a name' }).click()
    await expect(page).toHaveURL(/\/catalogue\/suggest$/)
  })
})

test.describe('states', () => {
  test('Gone from Cube: the last copy, and a note on what agents do and who acts', async ({
    page,
  }) => {
    await scenario(page, 'definition-gone')
    await openPage(page, '/catalogue/metric/gross_margin', desktop)
    await metricReady(page, 'Gross margin')
    await expect(header(page).locator('[data-slot="catalogue-status"]')).toHaveText(
      'Gone from Cube',
    )
    await expect(page.locator('[data-slot="read-chip"]')).toHaveText('Copy read 6 Oct 2026')
    await expect(note(page)).toHaveText(
      'Cube no longer lists basket.gross_margin. AI apps are told the 86 facts about Gross margin may be out of date until Jon Abara, who owns Sales, checks them.',
    )
    await tab(page, 'Source').click()
    await expect(fieldTable(page, 'Where it comes from')).toContainText(
      'The newest read of Cube no longer lists it. The copy here is from 6 Oct 2026.',
    )
  })

  test('a dimension links to its model file; with no model folder address there is no link', async ({
    page,
  }) => {
    // A dimension's page is not built yet; the catalogue's panel shows its Source tab. Market is
    // in two views: the file of the first, which speaks for it, is linked.
    await openPage(page, '/catalogue?panel=dim:market&tab=source', desktop)
    const source = fieldTable(page, 'Where it comes from')
    await expect(source.getByRole('link', { name: /Open the model file/ })).toHaveAttribute(
      'href',
      'https://github.com/Fredehagelund92/heed/blob/main/db/seed/cube/orders.yml',
    )
    await expect(source.getByRole('link', { name: /Open the model file/ })).toHaveAttribute(
      'target',
      '_blank',
    )
    await scenario(page, 'no-model-url')
    await openPage(page, '/catalogue/metric/orders?tab=source', desktop)
    await metricReady(page)
    await expect(source.getByRole('term').first()).toHaveText('Source')
    await expect(source).not.toContainText('Model file')
    await expect(page.getByRole('link', { name: /Open the model file/ })).toHaveCount(0)
  })

  test('a dimension in two views is one term: both Cube names, shared, reviewed by administrators', async ({
    page,
  }) => {
    await openPage(page, '/catalogue?panel=dim:market&tab=source', desktop)
    const source = fieldTable(page, 'Where it comes from')
    await expect(source.locator('[data-slot="source-names"] li')).toHaveText([
      'orders.market',
      'segments.market',
    ])
    await expect(source).toContainText('Read from Cube on 7 Oct 2026')
    await expect(source).toContainText('2 Cube names, one dimension in Heed.')
    await expect(source).toContainText(
      'A change to one marks only the facts about metrics in its view.',
    )
    // The two views describe it the same way, so the copy shows once.
    await expect(source.locator('[data-slot="description-copy"]')).toHaveText(
      'The country or region the order ships to.',
    )
    await expect(source).toContainText('Cube describes it the same in both views.')
    await expect(source).toContainText(
      'Shared: Cube has it in views of more than one domain, or of none, so it belongs to no one domain.',
    )
    await expect(source.getByRole('term').filter({ hasText: 'Reviewed by' })).toBeVisible()
    await expect(source).toContainText('Admins')
    await expect(source.getByRole('button', { name: 'Copy the Cube names' })).toBeVisible()
  })

  test('Changed in Cube: the note says items written before wait for a check', async ({ page }) => {
    await openPage(page, '/catalogue/metric/repeat_purchase_rate', desktop)
    await metricReady(page, 'Repeat purchase rate')
    await expect(note(page)).toContainText(
      'Cube changed customers.repeat_purchase_rate on 7 Oct 2026.',
    )
  })

  test('while Cube cannot be read, the chip turns amber and the copy says how old it is', async ({
    page,
  }) => {
    await scenario(page, 'source-down')
    await openPage(page, '/catalogue/metric/orders?tab=source', desktop)
    await metricReady(page)
    await expect(page.locator('[data-slot="read-chip"]')).toHaveAttribute('data-tone', 'warning')
    await expect(fieldTable(page, 'Where it comes from')).toContainText(
      'The newest read of Cube failed. The copy here is from 7 Oct 2026',
    )
  })

  test('an unknown metric says so and offers the catalogue and Suggest a name', async ({
    page,
  }) => {
    for (const id of ['no_such_metric', 'Not%20an%20id']) {
      await openPage(page, `/catalogue/metric/${id}`, desktop)
      await expect(page.locator('[data-slot="term-not-found"]')).toContainText(
        /There is no metric “.+” in the catalogue/,
      )
      await expect(page).toHaveTitle('Metric not found - Heed')
    }
    await page.getByRole('link', { name: 'Suggest a name' }).click()
    await expect(page).toHaveURL(/\/catalogue\/suggest$/)
  })

  test('a failed read says what failed, and Try again loads the page', async ({ page }) => {
    await scenario(page, 'error')
    await openPage(page, '/catalogue/metric/orders', desktop)
    await expect(page.getByRole('alert')).toContainText("We couldn't load this metric", {
      timeout: 15_000,
    })
    await page.evaluate(() => window.localStorage.removeItem('cl.mock-scenario'))
    await page.getByRole('button', { name: 'Try again' }).click()
    await metricReady(page)
    await expect(
      page.getByRole('banner').getByRole('navigation', { name: 'breadcrumb' }),
    ).toHaveText(/^Catalogue\s*Metric$/)
  })

  test('a slow read shows the loading placeholders', async ({ page }) => {
    await scenario(page, 'slow')
    await openPage(page, '/catalogue', desktop)
    await page.goto('/catalogue/metric/orders')
    await expect(page.getByRole('status', { name: 'Loading the metric' })).toBeVisible()
    await metricReady(page)
  })
})

for (const size of widths) {
  for (const theme of themes) {
    test(`axe and no sideways scroll on every tab at ${size.name}px, ${theme}`, async ({
      page,
    }) => {
      await openPage(page, '/catalogue/metric/orders', { ...size, theme })
      await metricReady(page)
      for (const name of ['Overview', /Context/, 'Source']) {
        await tab(page, name).click()
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze()
        expect(
          results.violations.map(
            (violation) =>
              `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(' ')).join(' | ')})`,
          ),
        ).toEqual([])
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0)
      }
    })
  }
}
