import { expect, go, onMockOnly, test } from './go.ts'

// J3: someone asks, gets an answer that says how sure it is, and reports a part that is wrong.
test('someone asks, then reports a wrong part', async ({ page }) => {
  await go(page, '/ask?n=j3')
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially('Do Norway orders include gift-card money?')
  await box.press('Enter')
  await expect(page.getByText('Conflict', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Something wrong?' }).click()
  await page
    .getByRole('textbox', { name: "What's wrong?" })
    .fill('Gift cards are paid out separately since October.')
  await page.getByRole('button', { name: /^Send to the owner of/ }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'You reported this just now' }),
  ).toBeVisible()
})

test('an owner chooses which one stays among the items that disagree', async ({ page }) => {
  await go(page, '/ask?n=j3c')
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially('Do Norway orders include gift-card money?')
  await box.press('Enter')
  await expect(page.getByText('Conflict', { exact: true }).first()).toBeVisible()
  // The answer gives the customs stop too, but it disagrees with nothing: the choice opens one of
  // the two that do.
  await page.getByRole('button', { name: 'Choose which one stays' }).click()
  await expect(
    page.getByRole('heading', {
      level: 2,
      name: /^(Norway orders count store credit|Norway orders are card and cash payments only)$/,
    }),
  ).toBeVisible()
  // No button says it archived the other while doing nothing.
  await onMockOnly('choices beside a disagreement on the item page', async () => {
    await expect(page.getByRole('heading', { name: 'Disagrees with' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Keep this one' })).toHaveCount(0)
  })
})

test('a question that names nothing says nothing was looked up, never Not found', async ({
  page,
}) => {
  await go(page, '/ask?n=j3b')
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially('tell me a joke')
  await box.press('Enter')
  const log = page.getByRole('log')
  await expect(log.getByRole('button', { name: 'Nothing was looked up' })).toBeVisible()
  // The engine's own reason, and no state: Not found would say nobody wrote anything down.
  await expect(log.getByText(/^The question needs a metric or a market, such as \w/)).toBeVisible()
  await expect(log.getByText('Not found', { exact: true })).toHaveCount(0)
  await expect(log.getByText('Nothing is written about this yet.')).toHaveCount(0)
  await expect(log.getByText(/Ask also answers questions about the records/)).toBeVisible()
  // What Ask can answer today, from the workspace: picking one asks it in the same chat.
  const kinds = log.getByRole('group', { name: 'Questions Ask can answer' })
  const example = kinds.getByRole('button').first()
  const question = (await example.textContent())!
  await expect(kinds.getByRole('button')).toHaveCount(2)
  await example.click()
  await expect(log.getByText(question, { exact: true }).last()).toBeVisible()
  await expect(log.getByRole('button', { name: /^Looked up \d+ context items?/ })).toBeVisible()
})

test('a question that was looked up and found nothing still gets Not found', async ({ page }) => {
  await go(page, '/ask?n=j3n')
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially('Why did conversion drop in Sweden last month?')
  await box.press('Enter')
  await expect(
    page
      .getByRole('log')
      .getByRole('button', { name: /^Not found\W+Nothing is written about this yet\.$/ }),
  ).toBeVisible()
})
