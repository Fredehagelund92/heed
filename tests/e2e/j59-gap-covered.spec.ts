import type { Page } from '@playwright/test'
import { agentSignsIn, expect, go, onServiceOnly, test } from './go.ts'

/*
  J59, a Not found card with nothing drafted (#201): the owner presses Write context, writes the
  item and publishes it, and the card leaves Needs you, because the publish names the gap it was
  written for and covers it. On the service an agent first reports that nothing is written about
  orders in Germany, which opens the gap and its card, as the mock's demo has it.
*/

const card = (page: Page) => page.getByRole('button', { name: /^Orders in Germany, / })
const publish = (page: Page) => page.getByRole('button', { name: 'Publish', exact: true })
const title = 'Orders in Germany are booked a day late around a month end'

test('publishing what was written from a Not found card closes the card', async ({ page }) => {
  await go(page, '/inbox')
  await onServiceOnly('gap, which an agent opens by reporting what it could not find', async () => {
    const call = await agentSignsIn(page)
    expect(
      await call!('report', {
        kind: 'missing',
        metrics: ['Orders'],
        dimension_filters: [{ dimension: 'Market', values: ['Germany'] }],
        window: { from: '2026-10-30', to: '2026-11-01' },
      }),
    ).toMatchObject({ recorded: true })
    await page.reload()
  })
  await card(page).click()
  await page.getByRole('button', { name: 'Write context', exact: true }).click()
  await expect(page).toHaveURL(/\/context\/new\?/)

  await page.getByRole('textbox', { name: 'Title' }).fill(title)
  await page.getByRole('textbox', { name: 'What agents should know' }).click()
  await page.keyboard.insertText('The source tool books German orders on the next working day.')
  await page.getByRole('button', { name: /Add a source/ }).click()
  await page.locator('#fact-source').fill('https://reports.example/germany')
  await page.locator('#fact-quote').fill('German orders are booked on the next working day.')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^When/ }).click()
  await page.getByRole('radio', { name: 'Always' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  // The card's scope is Orders in Germany; where the editor did not fill it in, the owner does.
  for (const name of ['Orders', 'Germany'])
    if (!(await page.getByRole('button', { name: `Remove ${name}`, exact: true }).count())) {
      await page.getByRole('button', { name: /^Applies to/ }).click()
      await page.getByRole('combobox', { name: 'Search Applies to' }).fill(name)
      await page
        .getByRole('listbox', { name: 'Applies to' })
        .getByRole('option', { name: new RegExp(`^${name}`) })
        .first()
        .click()
      await page.keyboard.press('Escape')
    }

  await publish(page).click()
  // A live item agents would get beside it is answered where it is asked: it is about another day.
  const heading = page.getByRole('heading', { level: 1, name: title })
  const before = page.getByRole('region', { name: 'Before it can be published' })
  await expect(heading.or(before.getByRole('radiogroup').first())).toBeVisible()
  if (!(await heading.count())) {
    for (const group of await before.getByRole('radiogroup').all())
      await group.getByRole('radio', { name: 'Unrelated' }).click()
    await publish(page).click()
  }
  await expect(heading).toBeVisible()

  // Back to the Inbox from the sidebar; a click while the page still cross-fades is lost, so
  // it is made again until the Inbox opens.
  const inbox = page.getByRole('heading', { name: 'Inbox', level: 1 })
  await expect(async () => {
    await page.getByRole('link', { name: /^Inbox/ }).click()
    await expect(inbox).toBeVisible({ timeout: 1000 })
  }).toPass()
  await expect(card(page)).toHaveCount(0)
})
