import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type BrowserContext } from '@playwright/test'
import pg from 'pg'

/*
  Release and editions on the real service (slice W6; Editions design slice S5): going back to an
  earlier edition shows the service's preview first, and is refused with the version named when one
  cannot be served again (a failed check written to the seeded database, as the integration test
  does); an administrator goes back and the history log keeps it; stopping delivery from the live
  card and switching it back on; while delivery is stopped for a domain, an owner sees the banner,
  which reads the stops every signed-in person may read.
  Like the library smoke test, it expects a freshly seeded database; it runs after the other
  tests (playwright.api.config.ts), because going back changes what the library serves.
*/

test.describe.configure({ mode: 'serial' })

const admin = 'administrator@example.test'
type Edition = { label: string; live: boolean; restores: string | null; reason: string }

async function signIn(context: BrowserContext, baseURL: string, email: string) {
  const response = await context.request.post('/api/v1/auth/sign-in', {
    headers: { origin: baseURL, 'x-heed-csrf': 'dev-sign-in' },
    data: { email },
  })
  expect(response.ok()).toBe(true)
}

/** A change as the browser makes it: the session's CSRF token and the page's origin. */
async function change(request: APIRequestContext, baseURL: string, path: string, data: object) {
  const session = await request.get('/api/v1/auth/session')
  const { csrfToken } = (await session.json()) as { csrfToken: string }
  const response = await request.post(`/api/v1${path}`, {
    headers: { origin: baseURL, 'x-heed-csrf': csrfToken },
    data,
  })
  expect(response.ok(), await response.text()).toBe(true)
  return response
}

/** The rollback preview, as the dialog reads it. */
type Preview = {
  live: Edition
  target: Edition
  comparison: {
    total: number
    items: { itemId: string; title: string; change: string; to: { versionId: string } | null }[]
  }
  blocked: { itemId: string; title: string | null; version: number; problem: string }[]
}

/**
 * The seeded database, as the seed reached it: a check result written here stands for a check
 * that failed after a version left service, as in tests/integration/edition-compare.test.ts.
 */
const seedDatabase = () =>
  new pg.Client({
    connectionString:
      process.env.DATABASE_URL_SEED ?? 'postgres://localhost:5432/context_layer_dev',
  })

test('going back is refused, naming the version, when one cannot be served again', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, admin)
  const editions = (await (
    await context.request.get('/api/v1/editions?limit=10')
  ).json()) as Edition[]
  // The newest earlier edition that serves an earlier version of an item the live one changed.
  let target: Edition | undefined
  let item: Preview['comparison']['items'][number] | undefined
  for (const edition of editions.filter((candidate) => !candidate.live)) {
    const preview = (await (
      await context.request.get(`/api/v1/editions/${edition.label}/rollback-preview`)
    ).json()) as Preview
    expect(preview.blocked).toEqual([])
    item = preview.comparison.items.find((change) => change.change === 'changed' && change.to)
    if (item) {
      target = edition
      break
    }
  }
  expect(target, 'an earlier edition that serves an earlier version').toBeDefined()
  const versionId = item!.to!.versionId
  const database = seedDatabase()
  await database.connect()
  try {
    await database.query(
      "insert into check_results(item_version_id,level,outcome) values($1,'format','failed')",
      [versionId],
    )
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/editions/${target!.label}`)
    await page.getByRole('button', { name: `Actions for edition ${target!.label}` }).click()
    await page.getByRole('menuitem', { name: 'Go back to this edition…' }).click()
    const dialog = page.getByRole('alertdialog', { name: /^Go back to how it was on / })
    await expect(dialog.getByRole('alert')).toContainText("You can't go back to this edition", {
      timeout: 15_000,
    })
    const blocked = dialog.getByRole('list', { name: "Versions that can't be shared again" })
    await expect(blocked).toContainText(item!.title)
    await expect(blocked).toContainText("A check this version needs hasn't passed.")
    await expect(dialog.getByRole('button', { name: 'Continue' })).toHaveCount(0)

    // The service refuses it too, whatever a page asks, and names the version.
    const session = await context.request.get('/api/v1/auth/session')
    const { csrfToken } = (await session.json()) as { csrfToken: string }
    const refused = await context.request.post(`/api/v1/editions/${target!.label}/rollback`, {
      headers: {
        origin: baseURL!,
        'x-heed-csrf': csrfToken,
        'idempotency-key': crypto.randomUUID(),
      },
      data: { note: 'End to end: refused' },
    })
    expect(refused.status(), await refused.text()).toBe(409)
    expect(
      ((await refused.json()) as { data: { blocked: Preview['blocked'] } }).data.blocked,
    ).toEqual([
      expect.objectContaining({ itemId: item!.itemId, problem: 'a required check has not passed' }),
    ])
    await dialog.getByRole('button', { name: 'Close' }).click()
    const [live] = (await (
      await context.request.get('/api/v1/editions?limit=1')
    ).json()) as Edition[]
    expect(live!.label).toBe(editions[0]!.label)
  } finally {
    // The check passes again, so the release tests after this one find the seed as it was.
    await database.query(
      "insert into check_results(item_version_id,level,outcome) values($1,'format','passed')",
      [versionId],
    )
    await database.end()
  }
})

test('an administrator goes back to an earlier edition: the effect first, and the history log keeps it', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, admin)
  const before = (await (await context.request.get('/api/v1/editions?limit=2')).json()) as Edition[]
  const [live, earlier] = before
  expect(live?.live).toBe(true)
  const preview = (await (
    await context.request.get(`/api/v1/editions/${earlier!.label}/rollback-preview`)
  ).json()) as Preview

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/editions?edition=${earlier!.label}`)
  const card = page.locator('[data-slot="live-edition"]')
  await expect(card).toContainText(live!.label, { timeout: 15_000 })
  const panel = page.getByRole('region', { name: `Edition ${earlier!.label}` })
  await panel.getByRole('button', { name: `Actions for edition ${earlier!.label}` }).click()
  await page.getByRole('menuitem', { name: 'Go back to this edition…' }).click()
  const dialog = page.getByRole('alertdialog', { name: /^Go back to how it was on / })
  // Step 1: the service's comparison of the live edition with this one, fact by fact.
  await expect(dialog).toContainText(/facts? changes? for AI apps:/, { timeout: 15_000 })
  const changes = dialog.getByRole('list', {
    name: `What changes for AI apps, from edition ${live!.label} back to ${earlier!.label}`,
  })
  await expect(changes.getByRole('listitem')).toHaveCount(preview.comparison.items.length)
  await dialog.getByRole('button', { name: 'Continue' }).click()
  // Step 2: the reason and the number typed to confirm.
  await dialog
    .getByRole('textbox', { name: 'Why are you going back?' })
    .fill('End to end: back one edition.')
  await dialog
    .getByRole('textbox', { name: `Type ${earlier!.label} to confirm` })
    .fill(earlier!.label)
  await dialog.getByRole('button', { name: 'Go back', exact: true }).click()

  // Done once the service answered: the new edition is live.
  const done = page.getByRole('alertdialog', { name: /^Went back to / })
  await expect(done).toBeVisible({ timeout: 15_000 })
  const [now] = (await (await context.request.get('/api/v1/editions?limit=1')).json()) as Edition[]
  await expect(done).toContainText(`saved as the new edition ${now!.label}`)
  await expect(done.locator('[data-slot="release-history"]')).toContainText(
    `Demo Administrator went back to ${earlier!.label}, as edition ${now!.label}, on`,
    { timeout: 15_000 },
  )
  await expect(done.locator('[data-slot="release-history"]')).toContainText(
    'Why: End to end: back one edition.',
  )
  expect(now).toMatchObject({ live: true, reason: 'rollback', restores: earlier!.label })
  expect(now!.label).not.toBe(live!.label)
  await done.getByRole('button', { name: 'Close' }).click()
  await expect(card).toContainText(now!.label)
  await expect(card).toContainText(`Went back to ${earlier!.label}`)
  await expect(card.locator('[data-slot="release-history"]')).toContainText(
    `went back to ${earlier!.label}`,
  )
})

test('an administrator stops delivery from the live card and switches it back on', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, admin)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/editions')
  const card = page.locator('[data-slot="live-edition"]')
  await card.getByRole('button', { name: 'More actions for this edition' }).click({
    timeout: 15_000,
  })
  await page.getByRole('menuitem', { name: 'Stop sharing…' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Stop sharing with AI apps?' })
  await dialog.getByRole('combobox', { name: 'Domain' }).click()
  await page.getByRole('option', { name: 'Sandbox' }).click()
  await expect(dialog).toContainText(/AI apps stop getting the (one fact|\d+ facts) in Sandbox\./, {
    timeout: 15_000,
  })
  await dialog.getByRole('button', { name: 'Continue' }).click()
  await dialog
    .getByRole('textbox', { name: 'Why are you stopping it?' })
    .fill('End to end: stop Sandbox.')
  await dialog.getByRole('textbox', { name: 'Type Sandbox to confirm' }).fill('Sandbox')
  await dialog.getByRole('button', { name: 'Stop sharing' }).click()
  const done = page.getByRole('alertdialog', { name: 'Stopped for Sandbox' })
  await expect(done.locator('[data-slot="release-history"]')).toContainText(
    'Demo Administrator stopped sharing Sandbox with AI apps on',
    { timeout: 15_000 },
  )
  await expect(done.locator('[data-slot="release-history"]')).toContainText(
    'Why: End to end: stop Sandbox.',
  )
  const stops = (await (await context.request.get('/api/v1/serving/stops')).json()) as {
    areaId: string | null
  }[]
  expect(stops.map((stop) => stop.areaId)).toEqual(['area_sandbox'])

  // Its undo: starting again, with a reason of its own.
  await done.getByRole('button', { name: 'Start again…' }).click()
  const resume = page.getByRole('alertdialog', { name: 'Start sharing Sandbox again?' })
  await resume.getByRole('textbox', { name: /Why/ }).fill('End to end: Sandbox is fine.')
  await resume.getByRole('button', { name: 'Start again' }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(card).toContainText('Shared with AI apps')
  await expect(card.locator('[data-slot="release-history"]')).toContainText(
    'Demo Administrator started sharing Sandbox with AI apps again on',
  )
  expect(await (await context.request.get('/api/v1/serving/stops')).json()).toEqual([])
})

test('an owner sees the banner while delivery is stopped for a domain', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, admin)
  const stop = { scope: 'area', areaId: 'area_sales', reason: 'End to end: wrong caveat' }
  await change(context.request, baseURL!, '/serving/stops', { ...stop, on: true })
  try {
    await signIn(context, baseURL!, 'per_jon@example.test')
    await page.goto('/library')
    const banner = page.getByRole('region', { name: 'Sharing stopped' })
    await expect(banner).toContainText('AI apps get no facts from Sales for now.', {
      timeout: 15_000,
    })
    await expect(banner).toContainText('Why: End to end: wrong caveat')
    // Only an administrator manages delivery.
    await expect(banner.getByRole('link', { name: 'Open Editions' })).toHaveCount(0)
  } finally {
    await signIn(context, baseURL!, admin)
    await change(context.request, baseURL!, '/serving/stops', {
      ...stop,
      on: false,
      reason: 'End to end: fixed',
    })
  }
  await signIn(context, baseURL!, 'per_jon@example.test')
  await page.reload()
  await expect(page.locator('#library-count')).toHaveText(/facts$/, { timeout: 15_000 })
  await expect(page.getByRole('region', { name: 'Sharing stopped' })).toHaveCount(0)
})

test('an owner describes their domain in Health, the service keeps it, and refuses another domain', async ({
  page,
  context,
  baseURL,
}) => {
  // Jon is the owner of Sales and Sandbox, not of Marketing.
  await signIn(context, baseURL!, 'per_jon@example.test')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/health?open=domain:area_sales')
  const about = page.getByRole('region', { name: 'About this domain' })
  await expect(about).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('tab', { name: 'Readiness' })).toHaveCount(0)
  await about.getByRole('button', { name: /^(Edit|Describe)$/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Describe Sales' })
  const summary = 'End to end: revenue and payments, by market.'
  await dialog.getByRole('textbox', { name: /Summary/ }).fill(summary)
  await dialog
    .getByRole('textbox', { name: /Description/ })
    .fill('Sales covers **net revenue** and payments.\n\n- Written by the end-to-end suite.')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })
  await expect(about).toContainText(summary)
  // The service keeps it: after a reload, and for everyone who lists the domains.
  await page.reload()
  await expect(page.getByRole('region', { name: 'About this domain' })).toContainText(summary, {
    timeout: 15_000,
  })
  const areas = (await (await context.request.get('/api/v1/areas')).json()) as {
    id: string
    summary: string
    revision: number
  }[]
  expect(areas.find((a) => a.id === 'area_sales')?.summary).toBe(summary)
  expect(JSON.stringify(areas)).not.toMatch(/"state"|not_started/)
  // Another domain is not his to describe, whatever the page asks.
  const session = (await (await context.request.get('/api/v1/auth/session')).json()) as {
    csrfToken: string
  }
  const marketing = areas.find((a) => a.id === 'area_marketing')!
  const refused = await context.request.put('/api/v1/areas/area_marketing/description', {
    headers: {
      origin: baseURL!,
      'x-heed-csrf': session.csrfToken,
      'idempotency-key': randomUUID(),
    },
    data: { revision: marketing.revision, summary: 'Not mine', description: '' },
  })
  expect(refused.status()).toBe(403)
  // The state endpoints are gone: every domain is served.
  expect((await context.request.get('/api/v1/areas/area_sales/start-checks')).status()).toBe(404)
})

test('an owner reads the editions and what changed, without the administrator’s actions', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, 'per_jon@example.test')
  await page.setViewportSize({ width: 1440, height: 900 })
  const refused: string[] = []
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/') && response.status() === 403)
      refused.push(new URL(response.url()).pathname)
  })
  await page.goto('/')
  const sidebar = page.getByRole('navigation', { name: 'Main navigation' })
  await sidebar.getByRole('link', { name: 'Editions' }).click({ timeout: 15_000 })
  const live = page.locator('[data-slot="live-edition"]')
  await expect(live).toContainText('What AI apps get today', { timeout: 15_000 })
  await expect(live.getByRole('button', { name: 'Export JSON' })).toBeVisible()
  // The history log's line is the administrators' and auditors', so it is not asked for.
  await expect(live.locator('[data-slot="release-history"]')).toHaveCount(0)
  await live.getByRole('button', { name: 'More actions for this edition' }).click()
  // The menu is open before its missing item is checked, so Escape closes it.
  await expect(page.getByRole('menu')).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /Stop sharing/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toBeHidden()
  await live.getByRole('link', { name: 'What changed' }).first().click()
  await expect(page).toHaveURL(/\/editions\/compare/)
  await expect(page.getByText('Editions are for owners and admins')).toHaveCount(0)
  // Everything the pages read, the service gives an owner.
  expect(refused).toEqual([])
})
