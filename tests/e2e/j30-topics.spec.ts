import { expect, go, inMockUntil, onMockOnly, test } from './go.ts'

// J30: topics as the real key has them. A topic is an exact scope with its month; grouping only joins
// rows for reading; a month under 5 is never given away; a gap counts across a month edge; calls
// that could not be read are counted, never their words.

test('Questions groups by metric and market, opens to the months, and never gives a small month away', async ({
  page,
}) => {
  await go(page, '/observability/questions')
  await expect(page.getByRole('button', { name: /Group Metric and market/ })).toBeVisible()
  const orders = page
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: /^Orders in Norway/ }) })
  await expect(orders).toContainText('31')
  await expect(orders).toContainText('Sep, Oct 2026')
  await onMockOnly("record of an agent's fields and words disagreeing", () =>
    expect(orders).toContainText('Agent and words disagree'),
  )
  await orders.getByRole('button', { name: /^Orders in Norway/ }).click()
  await expect(page.getByRole('row').filter({ hasText: 'September 2026' }).first()).toContainText(
    '7',
  )
  // Net revenue in Norway: October 13, September 4. The total would give September away, so it reads 13+.
  const revenue = page
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: /^Net revenue in Norway/ }) })
  await expect(revenue).toContainText('13+')
  await revenue.getByRole('button', { name: /^Net revenue in Norway/ }).click()
  await expect(page.getByRole('row').filter({ hasText: 'September 2026' }).last()).toContainText(
    'Fewer than 5',
  )
  await expect(page.getByRole('row').filter({ hasText: 'Norway, no metric named' })).toContainText(
    'No metric named',
  )
  await expect(
    page.getByRole('row').filter({ hasText: 'Revenue in Norway' }).filter({ hasNotText: 'Net' }),
  ).toContainText('Metric group')
  await expect(page.getByRole('row').filter({ hasText: 'Could not be read' })).toContainText(
    '9 calls',
  )
})

test('Questions shows each exact scope, or a domain at a time, and filters by month', async ({
  page,
}) => {
  await go(page, '/observability/questions?group=none')
  await expect(page.getByRole('button', { name: 'Orders in Norway, September 2026' })).toBeVisible()
  await expect(
    page.getByRole('row').filter({ hasText: 'Orders in Germany, November 2026' }),
  ).toContainText('Fewer than 5')
  await go(page, '/observability/questions?group=domain')
  await expect(page.getByRole('button', { name: /^Sales/ })).toContainText('96 asked')
  await expect(page.getByRole('button', { name: /^No domain/ })).toBeVisible()
  await go(page, '/observability/questions?group=none&month=2026-09')
  await expect(page.getByText('Month is September 2026')).toBeVisible()
  await expect(page.getByRole('button', { name: /, September 2026$/ })).toHaveCount(2)
  await expect(page.getByRole('button', { name: /, October 2026$/ })).toHaveCount(0)
})

test('a gap counts across a month edge: Overview, Alerts and the Inbox', async ({ page }) => {
  await go(page, '/observability/overview')
  // Under Asked, not found: the list of what found nothing, not the top topics beside it.
  const germany = page
    .getByRole('listitem')
    .filter({ hasText: 'Orders in Germany' })
    .filter({ hasText: /times, not found/ })
  await expect(germany).toContainText('across Oct, Nov 2026, counted together')
  await expect(page.getByText(/Could not be read: 9 calls/)).toBeVisible()
  // The alert it raises, and its Not found card in the Inbox, come with P12b.
  await inMockUntil('P12b', 'alerts and the Not found card across a month edge', async () => {
    await go(page, '/observability/alerts')
    await expect(
      page.getByText('or more times in 7 days about the same thing, even across a month edge'),
    ).toBeVisible()
    await page
      .getByRole('link', { name: 'Orders in Germany: not found, 6 times across a month edge' })
      .click()
    await expect(page).toHaveURL(/card=gap-germany/)
    await expect(
      page.getByText('3 about 30 October and 3 about 1 November, counted together').first(),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Write context' }).click()
    await expect(page).toHaveURL(/context\/new\?.*metric=Orders.*market=Germany/)
  })
})
