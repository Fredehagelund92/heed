import { expect, go, inHttpOnly, inMockUntil, test } from './go.ts'

// J7: a new workspace reaches its first grounded answer: write first, connect later, about ten actions.
test('a new workspace gets its first grounded answer', async ({ page }) => {
  await go(page, '/inbox?demo=setup')
  await page.getByRole('button', { name: 'Write', exact: true }).click()
  const about = page.getByRole('textbox', { name: 'About our business' })
  await about.click()
  // Typed as one input, as a paste would be: key by key, a loaded machine ran past the time limit.
  await page.keyboard.insertText('We are an outdoor-gear retailer with a webshop and stores.')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  // Back on the checklist, What the business is about counts as written.
  await expect(page.getByText('1 of 5 done')).toBeVisible()
  // A new install on the service has no domain yet to write context in: Domains and owners in
  // Settings make the first one. The mock's new install keeps the demo's domains.
  await inHttpOnly('first domain, made in Settings, Domains and owners', async () => {
    await go(page, '/settings/domains/new')
    await page.getByRole('textbox', { name: 'Name' }).fill('Sales')
    await page.getByRole('button', { name: 'Add the domain' }).click()
    await expect(page).toHaveURL(/\/settings\/domains\/sales$/)
    await go(page, '/inbox')
    await expect(page.getByText('1 of 5 done')).toBeVisible()
  })
  // The service asks a context item for what it applies to, and a source for its quoted sentence;
  // the mockup publishes this one without either.
  await inMockUntil(
    'a follow-up to P7',
    'a context item published with no scope, from a source with no quoted sentence',
    async () => {
      await page.getByRole('button', { name: 'Write context', exact: true }).click()
      await page
        .getByRole('textbox', { name: 'Title' })
        .fill('Orders in Norway fell after the customs stop')
      const text = page.getByRole('textbox', { name: 'What agents should know' })
      await text.click()
      await page.keyboard.insertText(
        'Orders in Norway fell to almost nothing after a customs rule stopped online sales on 4 August 2026.',
      )
      await page.getByRole('button', { name: /Add a source/ }).click()
      await page.locator('#fact-source').fill('https://customs.example/norway')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Publish', exact: true }).click()
      // Published in one step, the checklist counts the first context item written.
      await expect(page.getByText('2 of 5 done')).toBeVisible()
    },
  )
  await inMockUntil('P10', 'Ask', async () => {
    await page.getByRole('button', { name: 'Ask', exact: true }).click()
    const box = page.getByRole('textbox', { name: 'Ask a question' })
    await box.click()
    await box.press('End')
    await box.press('Enter')
    await expect(page.getByRole('log').getByText('Checked', { exact: true })).toBeVisible()
  })
})
