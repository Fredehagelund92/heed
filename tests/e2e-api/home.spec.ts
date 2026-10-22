import { expect, test, type BrowserContext } from '@playwright/test'

/*
  Home on the real service: the same page reads the library index and the catalogue through
  /api/v1, the search field suggests facts from the client index built over the service's rows,
  and Enter opens the first one.
*/

async function signIn(context: BrowserContext, baseURL: string, email: string) {
  const response = await context.request.post('/api/v1/auth/sign-in', {
    headers: { origin: baseURL, 'x-heed-csrf': 'dev-sign-in' },
    data: { email },
  })
  expect(response.ok()).toBe(true)
}

test('Home reads the service: the table, the topics and the search suggestions', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, 'per_maria@example.test')
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Home', { timeout: 15_000 })
  await expect(
    page.locator('[data-slot="home-grid"], [data-slot="home-grid-message"]').first(),
  ).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('main')).not.toContainText(/edition|\d{4}-\d{2}-\d{2}\.\d+/i)

  await page.getByRole('tab', { name: /Topics/ }).click()
  await expect(page.getByRole('table', { name: 'Topics' }).getByRole('rowheader')).not.toHaveCount(
    0,
  )

  const field = page.getByRole('combobox', { name: 'Search the library, or ask a question' })
  await field.fill('orders')
  const first = page.getByRole('option').first()
  await expect(first).toHaveAttribute('data-suggestion', 'fact')
  // The option is named "<title>, <domain>, <day>".
  const title = (await first.getAttribute('aria-label'))!.split(', ').slice(0, -2).join(', ')
  await field.press('Enter')
  await expect(page).toHaveURL(/\/library\/itm_/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
})

test('the weekly agent totals never give a hidden count away, are the same for everyone, and Home shows them', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, 'per_maria@example.test')
  const read = async (path: string) => {
    const response = await context.request.get(`/api/v1${path}`)
    expect(response.ok()).toBe(true)
    return (await response.json()) as unknown
  }
  type Weekly = {
    minimumCount: number
    weeks: { week: string; calls: number | null; noItemCalls: number | null; shownCalls: number }[]
  }
  const weekly = (await read('/topics/weekly?weeks=13')) as Weekly
  const minimum = weekly.minimumCount
  expect(minimum).toBeGreaterThan(0)
  expect(weekly.weeks).toHaveLength(13)
  // Consecutive Mondays, oldest first; only counts, and none under the minimum but zero.
  for (const [index, week] of weekly.weeks.entries()) {
    expect(Object.keys(week).sort()).toEqual(['calls', 'noItemCalls', 'shownCalls', 'week'])
    expect(new Date(`${week.week}T00:00:00Z`).getUTCDay()).toBe(1)
    if (index > 0)
      expect(Date.parse(week.week) - Date.parse(weekly.weeks[index - 1]!.week)).toBe(7 * 86_400_000)
    for (const count of [week.calls, week.noItemCalls])
      if (count !== null) expect(count === 0 || count >= minimum).toBe(true)
  }
  // The shown topic weeks add up to `shownCalls`, and no total gives a hidden one away: it adds
  // nothing to them, or at least the minimum.
  const topics = (await read('/topics/counts?weeks=13')) as {
    rows: { week: string; calls: number; noItemCalls: number | null }[]
  }
  for (const week of weekly.weeks) {
    const rows = topics.rows.filter((row) => row.week === week.week)
    expect(week.shownCalls).toBe(rows.reduce((sum, row) => sum + row.calls, 0))
    const shownNoItem = rows.reduce((sum, row) => sum + (row.noItemCalls ?? 0), 0)
    for (const added of [
      week.calls === null ? 0 : week.calls - week.shownCalls,
      week.noItemCalls === null ? 0 : week.noItemCalls - shownNoItem,
    ])
      expect(added === 0 || added >= minimum).toBe(true)
  }

  // An owner reads the same totals.
  await signIn(context, baseURL!, 'per_jon@example.test')
  expect(await read('/topics/weekly?weeks=13')).toEqual(weekly)

  await page.goto('/')
  const tile = page.locator('[data-slot="pulse-tile"]').filter({ hasText: 'Questions from agents' })
  await expect(tile).toHaveAttribute('data-state', 'ready', { timeout: 15_000 })
  const last = weekly.weeks.at(-2)!
  await expect(tile).toContainText(
    last.calls !== null
      ? last.calls.toLocaleString('en')
      : last.shownCalls > 0
        ? `${last.shownCalls.toLocaleString('en')}+`
        : `<${minimum}`,
  )
})
