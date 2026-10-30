import { expect, go, onMockOnly, test } from './go.ts'

// J11, figures in Ask: off by default, an answer links into the tool; an admin switches figures on
// for Cube and the answer shows one figure with its source and freshness; a figure that doesn't
// fit a context item shows both; a metric nobody defines gets no figure. Figures are no integration
// of their own: Cube's page shows them as its second connection, where an admin tries a figure.

test('off by default, an answer links into the tool', async ({ page }) => {
  await go(page, '/ask?example=grounded')
  await expect(
    page.getByRole('link', { name: /See the figure in Cube: Orders in Norway, 1 to 31 Aug 2026/ }),
  ).toBeVisible()
})

test('switched on for Cube, the answer shows one figure, its source and its query in words', async ({
  page,
}) => {
  await go(page, '/settings/integrations/cube')
  await page.getByRole('switch', { name: 'Show figures in Ask' }).click()
  // A move inside the app is the same page, so the switch holds without a review flag.
  await go(page, '/ask?example=grounded')
  const log = page.getByRole('log')
  await expect(log.getByText('€43,600')).toBeVisible()
  await expect(log.getByText('From Cube, data as of today at 06:00.')).toBeVisible()
  await log.getByRole('button', { name: 'Show the query' }).click()
  await expect(log.getByText(/added up for Norway from 1 to 31 Aug 2026/)).toBeVisible()
})

test("a figure that doesn't fit a context item shows both, and both routes", async ({ page }) => {
  await go(page, '/ask?example=figconflict&figures=on')
  const log = page.getByRole('log')
  await expect(log.getByText("The figure doesn't fit a context item.")).toBeVisible()
  await expect(log.getByRole('button', { name: 'Tell the owner of Marketing' })).toBeVisible()
  await expect(
    log.getByRole('button', { name: /Tell Ravi Kapoor, the data contact/ }),
  ).toBeVisible()
})

test('a metric nobody defines gets no figure', async ({ page }) => {
  await onMockOnly('metric no definition covers', async () => {
    await go(page, '/ask?example=nodata&figures=on')
    await expect(page.getByRole('log').getByText('No figure.')).toBeVisible()
  })
})

test('figures are no integration of their own, and say so', async ({ page }) => {
  await go(page, '/settings/integrations')
  await expect(page.getByText(/warehouse/i)).toHaveCount(0)
  await expect(
    page.getByText(/Your workspace keeps no numbers\. Where a definitions tool can also read/),
  ).toBeVisible()
})

test("Cube's page shows figures as its second connection, where an admin tries one", async ({
  page,
}) => {
  await go(page, '/settings/integrations/cube')
  await expect(page.getByRole('heading', { name: 'Definitions connection' })).toBeVisible()
  const figures = page.getByRole('heading', { name: 'Figures connection' })
  await expect(figures).toBeVisible()
  await expect(page.getByText(/The second of Cube's two connections/)).toBeVisible()
  await expect(page.getByLabel('Token, set')).toBeVisible()
  await page.getByRole('button', { name: 'Try a figure' }).click()
  const dialog = page.getByRole('dialog', { name: 'Try a figure from Cube' })
  // Marketing is Cube's first view with a single date, and the demo week has no conversions in
  // its last 7 days: Cube still answered, so the endpoint and the token work.
  await expect(dialog.getByText('Conversion rate, 17 to 23 Oct 2026:')).toBeVisible()
  await expect(dialog.getByText('nothing for those days')).toBeVisible()
  await expect(dialog.getByText(/From Cube, data as of today at 06:00\./)).toBeVisible()
  await expect(dialog.getByText('The data endpoint and its token work.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Try again' }).click()
  await expect(dialog.getByText('The data endpoint and its token work.')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  // Trying switched nothing on.
  await expect(page.getByRole('switch', { name: 'Show figures in Ask' })).not.toBeChecked()
})
