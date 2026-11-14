import { expect, go, onMockOnly, onServiceOnly, test } from './go.ts'

// J6: a read from a connected document arrives as a suggestion, and the owner publishes it.
test('a suggestion from a document read is reviewed and published', async ({ page }) => {
  await go(page, '/inbox?demo=week')
  await expect(page.getByText(/From Google Drive, today, 06:00/)).toBeVisible()
  await page.getByRole('button', { name: /Orders in Germany include marketplace orders/ }).click()
  // The button names the decision: on the service the read overlaps a live item, so it asks how they relate.
  await page.getByRole('button', { name: /^(Review|Decide how they relate)$/ }).click()
  await expect(page.getByText(/Created by the read,\s*not by a person/)).toBeVisible()
  await onServiceOnly('clash check, which finds a live item on Orders in Germany', () =>
    // It shares no words with the suggestion, so the overlap folds into one line with one answer.
    page.getByRole('button', { name: 'Mark it unrelated' }).click(),
  )
  await page.locator('#decision').getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.locator('#decision').getByRole('status')).toContainText('Published')
})

// A key Google refused does not pause the read: each read tries it again, and the page says so.
test('a refused key is tried again at each read, and Integrations says when', async ({ page }) => {
  await onMockOnly('refused key of the demo', async () => {
    await go(page, '/settings/integrations?state=reauth')
    const refused = page.getByRole('alert')
    await expect(refused).toHaveText(
      'Google Drive needs a new key. Google refused the service account key. Tried again at 06:00. Published context is not affected.Replace key',
    )
    await expect(page.getByText(/paused/i)).toHaveCount(0)
    await go(page, '/settings/integrations/google-drive?state=reauth')
    await expect(page.getByText('refused: it needs a new key')).toBeVisible()
    await expect(page.getByText(/paused/i)).toHaveCount(0)
  })
})
