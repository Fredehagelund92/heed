import type { Page } from '@playwright/test'
import { expect, go, inMockUntil, test, untilInHttp } from './go.ts'

// J21, following links (get_related): Related shows what an agent can follow both ways, the
// owners' relations labelled, a retired item not followed, a definition from another domain
// marked; Ask says what it followed, one step; the switch in Settings turns it off.

const details = async (page: Page) =>
  page.getByRole('button', { name: 'Details', exact: true }).click()

test("Related in the quick view: another domain's definition, and the owners' relations", async ({
  page,
}) => {
  await go(page, '/context?dock=context.itm_eprlkrz2')
  await details(page)
  const links = page.getByRole('list', { name: 'Links to' })
  await expect(links).toContainText('Orders')
  await expect(links).toContainText('from Sales')
  await go(page, '/context?dock=context.itm_0tmqp7o1')
  await details(page)
  await expect(page.getByRole('list', { name: 'Links to' })).toContainText('replaces')
  await expect(page.getByRole('list', { name: 'Links to' })).toContainText('not followed')
  await go(page, '/context?dock=context.itm_gift_store_credit')
  await details(page)
  await expect(page.getByRole('list', { name: 'Links to' })).toContainText('disagrees with')
})

test('Ask says what it followed, one step, and what it left alone', async ({ page }) => {
  untilInHttp('P7c, part 3', "the links Ask's answer follows")
  await go(page, '/ask?example=grounded')
  const line = page.getByRole('button', { name: /^Looked up 2 context items, followed 1 link/ })
  await line.click()
  await expect(page.getByText('Links it followed, one step')).toBeVisible()
  await expect(page.getByText('no longer available, not followed')).toBeVisible()
  await expect(page.getByText('It follows one step, never a link from a link')).toBeVisible()
})

test('switched off in Settings, Ask follows nothing and Related says so', async ({ page }) => {
  await go(page, '/settings/agents')
  await page.getByRole('button', { name: /Show or hide Tools and access keys/ }).click()
  await page.getByRole('switch', { name: /Let agents follow links/ }).click()
  await inMockUntil('P7c, part 3', "the links Ask's answer follows", async () => {
    await go(page, '/ask?example=grounded')
    await expect(
      page.getByRole('button', { name: /^Looked up 2 context items, didn't follow links/ }),
    ).toBeVisible()
  })
  await go(page, '/context?dock=context.itm_eprlkrz2')
  await details(page)
  await expect(
    page.getByText("Agents don't follow links: it is switched off in Agents and access."),
  ).toBeVisible()
})

test('the review shows a new link, and Try it says whether the answer follows it', async ({
  page,
}) => {
  untilInHttp('P7c, part 3', 'a mention of a term written in Definitions')
  await go(page, '/inbox/sug-ines/review')
  await expect(page.getByText('Now links to')).toBeVisible()
  const decide = page.getByRole('complementary', { name: 'Try it and decide' })
  await expect(
    decide.getByText(
      'The answer would follow the new link to Test account, one step, to read what it means.',
    ),
  ).toBeVisible()
  await go(page, '/inbox/sug-ines/review?links=off')
  await expect(
    decide.getByText(
      "Following links is off, so the answer won't follow the new link to Test account.",
    ),
  ).toBeVisible()
})
