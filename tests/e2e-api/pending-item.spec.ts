import { expect, test, type APIRequestContext } from '@playwright/test'

/*
  An item's address before the item is accepted (front end audit, 15 October 2026): an import or
  a sent proposal names the item's id at once, and opening it used to say "Page not found". It
  now says the item is waiting for review and leads to its proposal, for the proposer and for the
  domain's owner. An id nothing names still finds no page.
*/

async function signIn(request: APIRequestContext, origin: string, email: string) {
  const response = await request.post('/api/v1/auth/sign-in', {
    headers: { origin, 'x-heed-csrf': 'dev-sign-in' },
    data: { email },
  })
  expect(response.ok()).toBe(true)
  const { csrfToken } = (await response.json()) as { csrfToken: string }
  return { origin, 'x-heed-csrf': csrfToken }
}

function write(
  request: APIRequestContext,
  headers: Record<string, string>,
  url: string,
  data: unknown,
) {
  return request.post(url, {
    headers: { ...headers, 'idempotency-key': crypto.randomUUID() },
    data,
  })
}

test('a sent proposal’s item says it is waiting for review and leads to the proposal', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const origin = baseURL!
  const marker = `Run${Date.now().toString(36)}`
  const maria = await signIn(context.request, origin, 'per_maria@example.test')
  const created = await write(context.request, maria, '/api/v1/proposals', {
    channel: 'form',
    draft: {
      kind: 'event',
      summaryMarkup: `Orders in Norway were delayed by a bank holiday on 3 August 2026 ${marker}.`,
      scope: {
        metrics: ['metric:units_sold'],
        dimensions: [],
        dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
      },
      validity: { start: '2026-08-03', end: '2026-08-04' },
      evidence: [
        {
          url: 'https://news.example/norway-bank-holiday',
          quote: 'Banks in Norway were closed on 3 August.',
          date: '2026-08-04',
        },
      ],
      areaId: 'area_sales',
    },
  })
  expect(created.ok(), await created.text()).toBe(true)
  const draft = (await created.json()) as { id: string; revision: number }
  const submitted = await write(context.request, maria, `/api/v1/proposals/${draft.id}/submit`, {
    revision: draft.revision,
  })
  expect(submitted.ok(), await submitted.text()).toBe(true)
  const sent = (await submitted.json()) as { itemId: string; number: number }
  expect(sent.itemId).toMatch(/^itm_/)

  const expectWaiting = async (where: typeof page) => {
    await where.setViewportSize({ width: 1440, height: 900 })
    await where.goto(`/library/${sent.itemId}`)
    await expect(where.getByText('This fact is waiting for review')).toBeVisible()
    await expect(where.getByText('Page not found')).toHaveCount(0)
    const open = where.getByRole('link', { name: `Open proposal #${sent.number}` })
    await expect(open).toHaveAttribute('href', `/proposals/${draft.id}`)
    return open
  }

  // The proposer.
  const open = await expectWaiting(page)
  await open.click()
  await expect(page).toHaveURL(new RegExp(`/proposals/${draft.id}`))

  // The domain's owner, in a session of his own.
  const jonContext = await browser.newContext({ baseURL })
  await signIn(jonContext.request, origin, 'per_jon@example.test')
  await expectWaiting(await jonContext.newPage())
  await jonContext.close()

  // An id nothing names finds no page.
  await page.goto('/library/itm_zzzzzzzz00')
  await expect(page.getByText("This page doesn't exist")).toBeVisible()
})
