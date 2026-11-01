import { expect, go, test } from './go.ts'

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
  // The answer gives the customs stop too, but it disagrees with nothing: the pair shown, and the
  // comparison it opens, are the two that do (FR-220).
  const pair = page.getByRole('group', { name: 'The two items' })
  await expect(pair).toContainText('Norway orders count store credit')
  await expect(pair).toContainText('Norway orders are card and cash payments only')
  await expect(pair).not.toContainText('Online sales to Norway stopped')
  await page.getByRole('button', { name: 'Compare and decide' }).click()
  const dock = page.getByRole('region', { name: 'Conflict', exact: true })
  await expect(
    dock.getByRole('heading', { name: 'Two items say different things about Orders in Norway.' }),
  ).toBeVisible()
  // Every choice there asks why before it acts: nothing is archived by one click.
  await dock.getByRole('button', { name: 'Keep this one' }).first().click()
  await expect(page.getByRole('dialog', { name: /^Keep “/ })).toBeVisible()
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
  // What the question lacks, and no state: Not found would say nobody wrote anything down.
  await expect(log.getByText("The question doesn't name a metric or a market.")).toBeVisible()
  await expect(log.getByText('Not found', { exact: true })).toHaveCount(0)
  await expect(log.getByText('Nothing is written about this yet.')).toHaveCount(0)
  // The three kinds of question Ask answers, one to try each, and where every definition is.
  const kinds = log.getByRole('list', { name: 'Questions Ask can answer' })
  await expect(kinds.getByRole('listitem')).toHaveCount(3)
  await expect(kinds).toContainText('About the records')
  await expect(kinds.getByRole('button', { name: 'What dimensions are there?' })).toBeVisible()
  await expect(
    log.getByText(/^Definitions lists \d+ definitions: \d+ metrics and \d+ dimensions\.$/),
  ).toBeVisible()
  await expect(log.getByRole('link', { name: 'Definitions', exact: true })).toBeVisible()
  // The one about a metric or a market comes from the workspace: picking it asks it in the same chat.
  const example = kinds.getByRole('button').first()
  const question = (await example.textContent())!
  await example.click()
  await expect(log.getByText(question, { exact: true }).last()).toBeVisible()
  await expect(log.getByRole('button', { name: /^Looked up \d+ context items?/ })).toBeVisible()
})

test('a typo in a name is offered the closest name, never read as it', async ({ page }) => {
  await go(page, '/ask?n=j3t')
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially('what about chrun rate')
  await box.press('Enter')
  const log = page.getByRole('log')
  await expect(log.getByRole('button', { name: 'Nothing was looked up' })).toBeVisible()
  await expect(
    log
      .getByRole('list', { name: 'Questions Ask can answer' })
      .getByRole('button', { name: 'What should I know about Churn rate?' }),
  ).toBeVisible()
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
