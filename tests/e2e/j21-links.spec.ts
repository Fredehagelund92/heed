import type { Page } from '@playwright/test'
import { expect, go, mode, test, unfold } from './go.ts'

// J21, following links (get_related): Related shows what an agent can follow in two groups, one
// clean line per link: the owners' relations labelled and an archived item marked; Ask says what it
// followed, one step; the switch in Settings turns it off.

/**
 * Opens Details in the quick view once it shows the item: go moves inside the app and goes on at
 * once, and a click before the new item is in would fold the last one's Details instead.
 */
async function details(page: Page, title: string) {
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Details', exact: true }).click()
}

const campaign = 'Norway launch campaign started on 24 March 2026'

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

test("Related in the quick view: a definition, and the owners' relations", async ({ page }) => {
  await go(page, '/context?dock=context.itm_eprlkrz2')
  await details(page, campaign)
  const links = page.getByRole('list', { name: 'Links to' })
  await expect(links).toContainText('Orders')
  await expect(page.getByText('An agent can follow these')).toHaveCount(0)
  await go(page, '/context?dock=context.itm_0tmqp7o1')
  await details(page, 'Orders lags by one day in the source tool')
  await expect(page.getByRole('list', { name: 'Links to' })).toContainText('Replaces')
  await expect(page.getByRole('list', { name: 'Links to' })).toContainText('Archived')
  await go(page, '/context?dock=context.itm_gift_store_credit')
  await details(page, 'Norway orders count store credit')
  await expect(page.getByRole('list', { name: 'Links to' })).toContainText('Disagrees with')
})

test('the toolbar stays under Details, open or shut', async ({ page }) => {
  await go(page, '/context?dock=context.itm_0tmqp7o1')
  await expect(
    page.getByRole('heading', { name: 'Orders lags by one day in the source tool', exact: true }),
  ).toBeVisible()
  const toolbar = page.getByRole('group', { name: 'More about this context item' })
  await expect(toolbar.getByRole('button', { name: 'Try it', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Details', exact: true }).click()
  await expect(toolbar.getByText(/^History/)).toBeVisible()
  await expect(toolbar.getByText(/^Comments/)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Context' }).getByText(/^Status$/)).toHaveCount(0)
})

test('on the service, nothing counts zero, and a draft has no empty History', async ({ page }) => {
  test.skip(mode !== 'http', "The mock's drafts have versions, and its suggestions have questions")
  await go(page, '/context')
  await page.getByText('Store returns in Spain count on the day they are booked').first().click()
  const toolbar = page.getByRole('group', { name: 'More about this context item' })
  await expect(toolbar.getByText('History', { exact: true })).toBeVisible()
  const id = new URL(page.url()).searchParams.get('dock')!.replace('context.', '')
  await go(page, `/context/${id}`)
  await expect(
    page.getByRole('heading', { name: 'Store returns in Spain count on the day they are booked' }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toHaveCount(0)
  await go(page, '/inbox')
  await expect(page.getByText('Ines Duarte - 1 link', { exact: true })).toBeVisible()
  await expect(page.getByText(/\b0 questions/)).toHaveCount(0)
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
  await unfold(page, 'Tools and access keys')
  const toggle = page.getByRole('switch', { name: /Let agents follow links/ })
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await askGrounded(page)
  await expect(
    page.getByRole('button', { name: new RegExp(`^${looked}, didn't follow links`) }),
  ).toBeVisible()
  await go(page, '/context?dock=context.itm_eprlkrz2')
  await details(page, campaign)
  await expect(
    page.getByText("Agents don't follow links: it is switched off in Agents and access."),
  ).toBeVisible()
})

test('the review shows a new link, and Try it says whether the answer follows it', async ({
  page,
}) => {
  await go(page, '/inbox/sug-ines/review')
  // The source shows the new link as its words; the preview draws it as the item's page will.
  await expect(
    page.getByRole('region', { name: 'Text' }).locator('ins').getByText('accounts'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Show the preview' }).click()
  await expect(
    page.getByRole('region', { name: 'Preview' }).getByText('accounts', { exact: true }),
  ).toBeVisible()
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
