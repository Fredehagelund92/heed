import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J33: Ask answers questions about the context's own records (FR-718). "Give me context created in
// the last 24 hours" is counted from the workspace's records, with no answer state: a Records chip,
// one source sentence, the answer in one plain sentence with its period in UTC, and at most five
// rows that open in the right panel, with the full list in Context. A question about one person's
// work is refused. Ask also answers what Definitions lists ("list 10 dimensions", "what markets
// are there"), counted from the vocabulary with no model, and a question about what a metric
// means gets its definition from the source beside the answer. The counts differ between the
// mock and the demo week; the shape does not.

async function ask(page: Page, question: string) {
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially(question)
  await box.press('Enter')
}

test('a question about the records gets a records answer, never Not found', async ({ page }) => {
  await go(page, '/ask?n=j33')
  await ask(page, 'give me context created in last 24 hours?')
  const log = page.getByRole('log')
  await expect(log.getByText('Records', { exact: true })).toBeVisible()
  await expect(log.getByText("Counted from the workspace's records.")).toBeVisible()
  await expect(
    log.getByText(
      /^(Nothing was created in the last 24 hours\.|[\d,]+ context items? (was|were) created in the last 24 hours\.)$/,
    ),
  ).toBeVisible()
  // The period it counted, in UTC: Heed keeps no time zone of its own.
  await expect(log.getByText(/^Context created, last 24 hours \(.+ to .+, UTC\)$/)).toBeVisible()
  await expect(
    log.getByText('Agents did not read this answer. It says nothing about what they get.'),
  ).toBeVisible()
  // No answer state: the records are not context, checked or not.
  await expect(log.getByText('Not found', { exact: true })).toHaveCount(0)
  await expect(log.getByRole('button', { name: 'Nothing was looked up' })).toHaveCount(0)

  // An answer suggests nothing to ask next: the next question is typed, in the same chat.
  await expect(log.getByRole('button', { name: 'What is due for a check?' })).toHaveCount(0)
  await ask(page, 'What is due for a check?')
  const due = log.getByText(/^[\d,]+ context items? (is|are) due for a check\.$/)
  await expect(due).toBeVisible()
  // At most five rows, each opening its context item in the right panel.
  const table = log.getByRole('table').last()
  const rows = table.getByRole('row')
  await expect(rows.first()).toContainText('Due since')
  expect(await rows.count()).toBeLessThanOrEqual(6)
  const first = table.getByRole('rowheader').first().getByRole('button')
  const title = (await first.textContent())!
  await first.click()
  await expect(page).toHaveURL(/dock=context\./)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()

  // The full list is Context's, filtered to what is due.
  await log.getByRole('link', { name: /^Show all [\d,]+ in Context$/ }).click()
  await expect(page).toHaveURL(/\/context\?due=1/)
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible()
})

test("a question about one person's work is refused, with what Ask can say instead", async ({
  page,
}) => {
  await go(page, '/ask?n=j33p')
  await ask(page, 'what did Tomas Eriksen write this week?')
  const log = page.getByRole('log')
  await expect(
    log.getByText("Ask does not answer questions about one person's work."),
  ).toBeVisible()
  await expect(log.getByText('Nothing was looked up')).toBeVisible()
  // It offers who owns a domain instead: asking it names that domain's owners.
  const owns = log
    .getByRole('group', { name: 'Questions Ask can answer' })
    .getByRole('button', { name: /^Who owns .+\?$/ })
  const domain = /^Who owns (.+)\?$/.exec((await owns.textContent())!)![1]!
  await owns.click()
  await expect(log.getByText(new RegExp(`^.+ owns? ${domain}\\.$`))).toBeVisible()
})

test('a question about what Definitions lists gets the names and exact counts, never Not found', async ({
  page,
}) => {
  await go(page, '/ask?n=j33c')
  await ask(page, 'list 10 dimensions')
  const log = page.getByRole('log')
  // Fewer than asked for: it says how many there are, and names them all.
  await expect(log.getByText(/^The workspace has \d+ dimensions: .+ and .+\.$/)).toBeVisible()
  await expect(log.getByText(/^You asked for 10; there are \d+\.$/)).toBeVisible()
  await expect(log.getByText('Records', { exact: true })).toBeVisible()
  await expect(log.getByText('Not found', { exact: true })).toHaveCount(0)
  await expect(log.getByRole('button', { name: 'Nothing was looked up' })).toHaveCount(0)
  // Each row opens its page in Definitions.
  const market = log.getByRole('table').getByRole('link', { name: 'Market', exact: true })
  await expect(market).toHaveAttribute('href', '/definitions/Market')

  // A dimension's values by its name in the plural; the full list is the dimension's page.
  await ask(page, 'what markets are there')
  await expect(log.getByText(/^Market has \d+ values\.$/)).toBeVisible()
  await expect(log.getByText(/^Values of Market$/)).toBeVisible()
  await log.getByRole('link', { name: /^Show all \d+ in Definitions$/ }).click()
  await expect(page).toHaveURL(/\/definitions\/Market$/)
})

test('a question about what a metric means gets its definition from the source, and keeps its state', async ({
  page,
}) => {
  await go(page, '/ask?n=j33d')
  await ask(page, 'What does Churn rate mean?')
  const log = page.getByRole('log')
  const definition = log.getByRole('figure')
  await expect(definition).toContainText('Churn rate, as Cube defines it')
  await expect(definition.getByRole('blockquote')).toHaveText(/\w/)
  // The state is the context's own, looked up as agents get it.
  await expect(log.getByRole('button', { name: 'Nothing was looked up' })).toHaveCount(0)
  await expect(log.getByRole('button', { name: /^Looked up/ })).toBeVisible()
})
