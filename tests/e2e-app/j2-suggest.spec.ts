import { expect, test } from '@playwright/test'
import { go, signInAs } from './go.ts'

// J2: someone who owns no domain suggests a change, and can see it waiting afterwards.
test('a person suggests a change and sees it waiting', async ({ page }) => {
  await signInAs(page, 'Ines Duarte')
  await go(page, '/context/itm_s90n5xps')
  await page.getByRole('button', { name: 'Suggest a change' }).click()
  const send = page.getByRole('button', { name: /^Send/ })
  // Nothing changed yet: Send says why instead of sending.
  await expect(send).toHaveAttribute('aria-disabled', 'true')
  await page
    .getByRole('textbox', { name: 'Title' })
    .fill('Units sold excludes test and app accounts')
  await expect(send).toHaveAttribute('aria-disabled', 'false')
  await send.click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Your suggestion is waiting for Jon Abara' }),
  ).toBeVisible()
  await go(page, '/inbox?tab=all')
  await expect(
    page.getByRole('button', {
      name: /Units sold excludes test and app accounts.*Waiting for Jon Abara/,
    }),
  ).toBeVisible()
})
