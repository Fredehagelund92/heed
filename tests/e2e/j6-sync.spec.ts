import { expect, go, onServiceOnly, test } from './go.ts'

// J6: a read from a connected document arrives as a suggestion, and the owner publishes it.
test('a suggestion from a document read is reviewed and published', async ({ page }) => {
  await go(page, '/inbox?demo=week')
  await expect(page.getByText(/From Google Drive, today, 06:00/)).toBeVisible()
  await page.getByRole('button', { name: /Orders in Germany include marketplace orders/ }).click()
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page.getByText(/Created by the read,\s*not by a person/)).toBeVisible()
  await onServiceOnly('clash check, which finds a live item on Orders in Germany', () =>
    // It shares no words with the suggestion, so the overlap folds into one line with one answer.
    page.getByRole('button', { name: 'Mark it unrelated' }).click(),
  )
  await page.locator('#decision').getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.locator('#decision').getByRole('status')).toContainText('Published')
})
