import type { Page } from '@playwright/test'
import { expect, go, mode, test } from './go.ts'

// J21, following links (get_related): Related shows what an agent can follow both ways, the
// owners' relations labelled, a retired item not followed, a definition from another domain
// marked; Ask says what it followed, one step; the switch in Settings turns it off.

const details = async (page: Page) =>
  page.getByRole('button', { name: 'Details', exact: true }).click()

const grounded = 'Why did orders in Norway drop in August?'

/** Asks why orders in Norway dropped: the mock's example, typed on the service as J28 does. */
async function askGrounded(page: Page) {
  if (mode === 'mock') return go(page, '/ask?example=grounded')
  await go(page, `/ask?n=${Date.now()}`)
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially(grounded)
  await box.press('Enter')
}

/*
  What each mode looks up. The mock's answer is written by hand: two items, and from them one link
  to follow, the term Webshop. On the service the answer engine decides: Orders in Norway also gets
  the two items about gift cards, and the regulator's pause on price promotions, which is about
  Return on ad spend, is not one of them, so the agent follows the link to it as well as to
  Webshop. In both, the payment provider's switch in Norway is retired: listed, not followed.
*/
const looked = mode === 'http' ? 'Looked up 3 context items' : 'Looked up 2 context items'
const followed = mode === 'http' ? 'followed 2 links' : 'followed 1 link'

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
  await askGrounded(page)
  const line = page.getByRole('button', { name: new RegExp(`^${looked}, ${followed}`) })
  await line.click()
  await expect(page.getByText('Webshop', { exact: true })).toBeVisible()
  await expect(page.getByText('Links it followed, one step')).toBeVisible()
  await expect(page.getByText('no longer available, not followed')).toBeVisible()
  await expect(page.getByText('It follows one step, never a link from a link')).toBeVisible()
})

test('switched off in Settings, Ask follows nothing and Related says so', async ({ page }) => {
  await go(page, '/settings/agents')
  await page.getByRole('button', { name: /Show or hide Tools and access keys/ }).click()
  await page.getByRole('switch', { name: /Let agents follow links/ }).click()
  await askGrounded(page)
  await expect(
    page.getByRole('button', { name: new RegExp(`^${looked}, didn't follow links`) }),
  ).toBeVisible()
  await go(page, '/context?dock=context.itm_eprlkrz2')
  await details(page)
  await expect(
    page.getByText("Agents don't follow links: it is switched off in Agents and access."),
  ).toBeVisible()
})

test('the review shows a new link, and Try it says whether the answer follows it', async ({
  page,
}) => {
  await go(page, '/inbox/sug-ines/review')
  // The source shows the new link as its words; the preview says what it links to.
  await expect(
    page.getByRole('region', { name: 'Text' }).locator('ins').getByText('accounts'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Show the preview' }).click()
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
