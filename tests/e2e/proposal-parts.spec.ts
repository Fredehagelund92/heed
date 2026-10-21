import { expect, test } from '@playwright/test'
import { expectFlatRail, openPage, themes, widths } from './support'

/*
  The proposal parts (slice W1b of the front end plan) in a real browser, on the design preview
  page that composes them as the status page will: the checks open by keyboard on a phone, name
  the day of what agents got rather than an edition number, an edition number reaches the
  clipboard, overlaps link to their item and proposal, the companion
  stacks under the activity below 1280, and nothing scrolls sideways at any width. axe and the
  screenshots run on the same page through `previews` in support.ts.
*/

const path = '/design-preview/proposal-parts'

test('the activity is one list, newest first, with a time in UTC', async ({ page }) => {
  await openPage(page, path, { ...widths[0], theme: 'light' })
  const activity = page.getByRole('list', { name: 'Activity' })
  const events = activity.locator('[data-slot="timeline-event"]')
  await expect(events).toHaveCount(6)
  await expect(events.first()).toContainText('You replied')
  await expect(events.nth(1)).toContainText('Jon Abara asked for changes')
  await expect(events.last()).toContainText('You started this draft')
  const time = events.nth(1).locator('time')
  await expect(time).toHaveText('8 Oct, 09:12')
  await expect(time).toHaveAttribute('title', '8 October 2026 at 09:12 UTC')
  await expect(events.nth(3).getByRole('list', { name: 'Check outcomes' })).toContainText(
    'CompleteFinds the right questionsReaches agentsAnswers stay right',
  )
})

test('the checks card names each level and its outcome', async ({ page }) => {
  await openPage(page, path, { ...widths[0], theme: 'light' })
  const card = page.locator('aside [data-slot="gate-result"]')
  await expect(card.getByRole('heading', { name: 'Checks' })).toBeVisible()
  await expect(card.locator('[data-slot="check-row"]')).toHaveCount(4)
  await expect(card.getByRole('img', { name: 'Passed' })).toHaveCount(4)
  await expect(card).toContainText('Agents get it. No test answer got worse (31 checked)')
  await expect(card).toContainText('Checked against what agents got on 7 October 2026')
  await expect(card).not.toContainText('2026-10-07.2')
})

test('folded checks open and close from the keyboard', async ({ page }) => {
  await openPage(page, path, { ...widths[2], theme: 'light' })
  const trigger = page.getByRole('button', { name: /Checks: 4 of 4 passed/ })
  await trigger.focus()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('Enter')
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  const panel = trigger.locator('xpath=..').locator('[data-slot="collapsible-content"]')
  await expect(panel.getByText('All 7 test questions find it when they should')).toBeVisible()
  await page.keyboard.press('Space')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  const box = await trigger.boundingBox()
  expect(box?.height, 'a phone target is at least 44 high').toBeGreaterThanOrEqual(44)
})

test('copy puts the edition number on the clipboard and says Copied', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openPage(page, path, { ...widths[0], theme: 'light' })
  const label = page
    .locator('[data-slot="edition-label"]')
    .filter({ has: page.getByRole('button', { name: 'Copy edition 2026-10-07.2' }) })
  await label.getByRole('button', { name: 'Copy edition 2026-10-07.2' }).click()
  await expect(label.getByRole('status')).toHaveText('Copied')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('2026-10-07.2')
  await expect(label.getByRole('status')).toHaveText('', { timeout: 4000 })
})

test('an overlap links to its item, and a source opens in a new tab', async ({ page }) => {
  await openPage(page, path, { ...widths[0], theme: 'light' })
  const companion = page.getByRole('complementary', { name: 'Checks and overlaps' })
  const source = companion.getByRole('link', { name: 'regulator.example' })
  await expect(source).toHaveAttribute('target', '_blank')
  await expect(source).toHaveAttribute('rel', 'noreferrer noopener')
  await companion
    .getByRole('link', { name: 'Norway launch campaign started on 21 September 2025' })
    .click()
  await expect(page).toHaveURL(/\/library\/itm_jyfuvl07$/)
})

for (const size of widths) {
  test(`the flat rail sits beside the activity only from 1280, at ${size.name}px`, async ({
    page,
  }) => {
    await openPage(page, path, { ...size, theme: 'light' })
    const paper = await page.locator('[data-slot="paper"]').boundingBox()
    const companion = await page
      .getByRole('complementary', { name: 'Checks and overlaps' })
      .boundingBox()
    if (!paper || !companion) throw new Error('the page has no paper or companion')
    if (size.width >= 1280) {
      expect(companion.x).toBeGreaterThan(paper.x + paper.width)
      expect(companion.width).toBe(320)
    } else {
      expect(companion.y).toBeGreaterThanOrEqual(paper.y + paper.height)
    }
    await expectFlatRail(
      page.getByRole('complementary', { name: 'Checks and overlaps' }),
      size.width >= 1280 ? 'left' : 'top',
    )
  })

  for (const theme of themes) {
    test(`nothing scrolls sideways at ${size.name}px, ${theme}`, async ({ page }) => {
      await openPage(page, path, { ...size, theme })
      const overflow = await page.evaluate(() => {
        const main = document.querySelector('[data-slot="sidebar-inset"]')
        return main ? main.scrollWidth - main.clientWidth : 0
      })
      expect(overflow).toBeLessThanOrEqual(0)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0)
    })
  }
}
