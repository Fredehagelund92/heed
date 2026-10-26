import { expect, test } from '@playwright/test'
import { go } from './go.ts'

// J1: an owner reviews a suggestion and publishes it. Three steps from the Inbox: select, Review, Publish.
test('an owner reviews and publishes a suggestion', async ({ page }) => {
  await go(page, '/inbox?demo=week&card=sug-ines')
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page).toHaveURL(/\/inbox\/sug-ines\/review/)
  const decision = page.locator('#decision')
  await expect(decision.getByText('Ready.', { exact: true })).toBeVisible()
  await decision.getByRole('button', { name: 'Publish', exact: true }).click()
  // What it did, in place, then the next suggestion opens.
  await expect(
    page.getByRole('complementary', { name: 'Try it and decide' }).getByText('Agents now say'),
  ).toBeVisible()
  await expect(page).not.toHaveURL(/sug-ines\/review/, { timeout: 6000 })
})
