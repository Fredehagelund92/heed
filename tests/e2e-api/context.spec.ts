import { expect, test } from '@playwright/test'
import { fillContext, waitForSaved } from '../e2e/context-support'

test('Maria creates an issue, reloads the draft, and submits it to the domain', async ({
  page,
  context,
  baseURL,
}) => {
  const signIn = await context.request.post('/api/v1/auth/sign-in', {
    headers: { origin: baseURL!, 'x-heed-csrf': 'dev-sign-in' },
    data: { email: 'per_maria@example.test' },
  })
  expect(signIn.ok()).toBe(true)
  await page.goto('/library/new')
  await fillContext(page, { issue: true, mention: true })
  await waitForSaved(page)
  const id = new URL(page.url()).searchParams.get('draft')!
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Summary', exact: true })).toContainText('Norway')
  await expect(page.getByRole('radio', { name: 'Still going on' })).toBeChecked()
  const saved = await context.request.get(`/api/v1/proposals/${id}`)
  expect(saved.ok()).toBe(true)
  expect(await saved.json()).toMatchObject({
    state: 'draft',
    draft: {
      kind: 'issue',
      reviewDate: '2026-08-18',
      areaId: 'area_sales',
      validity: { start: '2026-08-04', end: null },
    },
  })
  await page
    .getByRole('button', { name: 'Send for review', exact: true })
    .filter({ visible: true })
    .click()
  // Submitting runs the matching and delivery checks on the service before it answers.
  await expect(page).toHaveURL(new RegExp(`/proposals/${id}$`), { timeout: 15_000 })
  await expect(page.locator('[data-slot="proposal-badges"]')).toContainText('Waiting for review')
  const submitted = await context.request.get(`/api/v1/proposals/${id}`)
  expect(await submitted.json()).toMatchObject({ state: 'submitted', draft: { kind: 'issue' } })
})

test('Maria scopes a draft to any market and to campaigns found among thousands', async ({
  page,
  context,
  baseURL,
}) => {
  const signIn = await context.request.post('/api/v1/auth/sign-in', {
    headers: { origin: baseURL!, 'x-heed-csrf': 'dev-sign-in' },
    data: { email: 'per_maria@example.test' },
  })
  expect(signIn.ok()).toBe(true)
  await page.goto('/library/new')
  await page
    .getByRole('textbox', { name: 'Summary', exact: true })
    .fill('Orders are booked in the currency of each market.')
  const scope = page.getByRole('combobox', { name: 'Where it applies', exact: true })
  // The service searches: nothing is listed until Maria types.
  await scope.click()
  await expect(scope).toHaveAttribute('aria-expanded', 'false')
  await scope.fill('orders')
  await expect(page.getByRole('option', { name: /^Orders/ }).first()).toBeVisible()
  await scope.press('Enter')
  await scope.fill('market')
  await expect(page.getByRole('group', { name: 'Market, 12 values' })).toBeVisible()
  await scope.press('Enter')
  await expect(page.getByRole('list', { name: 'Chosen' })).toContainText('Any market')
  // 2,400 campaigns: a count and a few, then a page at a time inside Campaign.
  await scope.fill('spring')
  await expect(page.getByRole('group', { name: 'Campaign, 240 matches' })).toBeVisible()
  await page.getByRole('option', { name: 'Search all 240 in Campaign' }).click()
  await expect(page.getByRole('listbox', { name: 'Values of Campaign' })).toContainText(
    '1 to 12 of 240 matches',
  )
  await scope.pressSequentially(' norway 2026 video')
  await expect(page.getByRole('option', { name: /^Norway Spring Sale 2026 Video/ })).toBeVisible()
  await scope.press('Enter')
  await waitForSaved(page)
  const id = new URL(page.url()).searchParams.get('draft')!
  const saved = await context.request.get(`/api/v1/proposals/${id}`)
  expect(await saved.json()).toMatchObject({
    draft: {
      scope: {
        metrics: ['metric:orders'],
        dimensions: ['dim:market'],
        dimensionValues: [
          {
            dimension: 'dim:campaign',
            value: 'val:campaign/norway_spring_sale_2026_video',
          },
        ],
      },
    },
    findings: expect.arrayContaining([
      expect.objectContaining({ code: 'broad_scope', severity: 'warning' }),
    ]),
  })
})

test('Maria says what is wrong with the current version, and the service keeps it for the reviewer', async ({
  page,
  context,
  baseURL,
}) => {
  const signIn = await context.request.post('/api/v1/auth/sign-in', {
    headers: { origin: baseURL!, 'x-heed-csrf': 'dev-sign-in' },
    data: { email: 'per_maria@example.test' },
  })
  expect(signIn.ok()).toBe(true)
  await page.goto('/library/itm_jyfuvl07/suggest')
  // What not to conclude starts empty: the item stores the default, which the box never shows.
  await expect(
    page.getByRole('textbox', { name: /What is wrong with the current version/ }),
  ).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('#context-notToConclude')).toHaveValue('')
  await page
    .getByRole('textbox', { name: /What is wrong with the current version/ })
    .fill('The source moved to the new wiki.')
  await waitForSaved(page)
  const id = new URL(page.url()).searchParams.get('draft')!
  const saved = await context.request.get(`/api/v1/proposals/${id}`)
  expect(await saved.json()).toMatchObject({
    action: 'change',
    state: 'draft',
    reason: 'The source moved to the new wiki.',
    draft: { notToConclude: 'cause not proven' },
  })
  await page
    .getByRole('button', { name: 'Send for review', exact: true })
    .filter({ visible: true })
    .click()
  await expect(page).toHaveURL(new RegExp(`/proposals/${id}$`), { timeout: 15_000 })
  const submitted = await context.request.get(`/api/v1/proposals/${id}`)
  expect(await submitted.json()).toMatchObject({
    state: 'submitted',
    reason: 'The source moved to the new wiki.',
  })
})

test('a suggested change keeps what the item says not to conclude until its author edits it', async ({
  page,
  context,
  baseURL,
}) => {
  const signIn = await context.request.post('/api/v1/auth/sign-in', {
    headers: { origin: baseURL!, 'x-heed-csrf': 'dev-sign-in' },
    data: { email: 'per_maria@example.test' },
  })
  expect(signIn.ok()).toBe(true)
  // The demo's Poland issue, whose contributor wrote their own words (db/seed, demoCaveats).
  const item = (await (await context.request.get('/api/v1/items/itm_k4p3nj1b')).json()) as {
    notToConclude: string
  }
  expect(item.notToConclude).toMatch(/^Low orders in Poland/)
  await page.goto('/library/itm_k4p3nj1b/suggest')
  const caveat = page.locator('#context-notToConclude')
  await expect(caveat).toHaveValue(item.notToConclude, { timeout: 15_000 })
  await page
    .getByRole('textbox', { name: /What is wrong with the current version/ })
    .fill('The provider says the data caught up on 9 October.')
  await waitForSaved(page)
  const id = new URL(page.url()).searchParams.get('draft')!
  const read = async (): Promise<unknown> =>
    (await context.request.get(`/api/v1/proposals/${id}`)).json()
  try {
    expect(await read()).toMatchObject({ draft: { notToConclude: item.notToConclude } })
    // Taken out, the draft stores the default: an empty box is optional.
    await caveat.fill('')
    await waitForSaved(page)
    expect(await read()).toMatchObject({ draft: { notToConclude: 'cause not proven' } })
    // Edited, it is the author's change.
    await caveat.fill('Low orders in Poland for these days do not mean customers left.')
    await waitForSaved(page)
    expect(await read()).toMatchObject({
      draft: { notToConclude: 'Low orders in Poland for these days do not mean customers left.' },
    })
  } finally {
    // The draft goes, so the other tests read Maria's proposals as the seed left them.
    await page.goto('/')
    const { revision } = (await read()) as { revision: number }
    const session = await context.request.get('/api/v1/auth/session')
    const { csrfToken } = (await session.json()) as { csrfToken: string }
    const discarded = await context.request.post(`/api/v1/proposals/${id}/discard`, {
      headers: {
        origin: baseURL!,
        'x-heed-csrf': csrfToken,
        'idempotency-key': crypto.randomUUID(),
      },
      data: { revision },
    })
    expect(discarded.ok(), await discarded.text()).toBe(true)
  }
})
