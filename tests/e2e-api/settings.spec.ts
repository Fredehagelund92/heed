import { expect, test, type APIRequestContext, type BrowserContext } from '@playwright/test'

/*
  Settings on the real service (slice W11b): an administrator changes a limit with a reason and
  reads it back in the setting's history and in the history log; an administrator adds a
  domain's approvers in one step and finds the step in the history log; an auditor has the history log
  and nothing else an administrator runs; an owner reads only their own areas; the MCP traffic
  and the server's address load from the service. Whatever a test changes it puts back, so the
  other tests and the next run see the seed.
*/

const admin = 'administrator@example.test'
const key = 'retention.outbox_days'
type Setting = { key: string; version: number; value: unknown; reason: string | null }

async function signIn(context: BrowserContext, baseURL: string, email: string) {
  const response = await context.request.post('/api/v1/auth/sign-in', {
    headers: { origin: baseURL, 'x-heed-csrf': 'dev-sign-in' },
    data: { email },
  })
  expect(response.ok()).toBe(true)
}

const setting = async (request: APIRequestContext, name = key) =>
  ((await (await request.get('/api/v1/settings')).json()) as Setting[]).find((s) => s.key === name)!

async function save(
  request: APIRequestContext,
  baseURL: string,
  value: unknown,
  reason: string,
  name = key,
) {
  const current = await setting(request, name)
  if (current.value === value) return
  const session = await request.get('/api/v1/auth/session')
  const { csrfToken } = (await session.json()) as { csrfToken: string }
  const response = await request.put(`/api/v1/settings/${name}`, {
    headers: { origin: baseURL, 'x-heed-csrf': csrfToken },
    data: { version: current.version, value, reason },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

const putBack = (request: APIRequestContext, baseURL: string, value: unknown, name = key) =>
  save(request, baseURL, value, 'End to end: back as it was', name)

test('an administrator changes a limit with a reason and sees it in its history and the log', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, admin)
  const before = await setting(context.request)
  const next = (before.value as number) + 1
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/admin?section=limits')
    const row = page.locator(`[data-setting="${key}"]`)
    await expect(row).toContainText(`${String(before.value)} days`, { timeout: 15_000 })
    await row.getByRole('link', { name: 'Change events kept' }).click()
    const panel = page.locator('[data-slot="dock-panel"]')
    await panel.getByRole('textbox', { name: 'Days' }).fill(String(next))
    await panel.getByRole('textbox', { name: 'Why' }).fill('End to end: one day longer')
    await panel.getByRole('button', { name: 'Save new version' }).click()
    await expect(page.getByText('Change events kept saved')).toBeVisible({ timeout: 15_000 })
    await expect(row).toContainText(`${next} days`)
    expect(await setting(context.request)).toMatchObject({
      version: before.version + 1,
      value: next,
      reason: 'End to end: one day longer',
    })

    await panel.getByRole('tab', { name: 'History' }).click()
    const latest = panel.locator('[data-slot="setting-history"] li').first()
    await expect(latest).toContainText(`${next} days · now`)
    await expect(latest).toContainText(`Version ${before.version + 1}`)
    await expect(latest).toContainText('End to end: one day longer')
    // The service sends PostgreSQL's text form of the moment; the screen reads it as a date.
    await expect(latest).not.toContainText('Invalid')

    await page.keyboard.press('Escape')
    await page
      .getByRole('navigation', { name: 'Administration sections' })
      .getByRole('link', { name: 'History log' })
      .click()
    await page.getByRole('combobox', { name: 'Kind of change' }).selectOption({ label: 'Settings' })
    // The newest entry about this setting: other tests change other settings meanwhile.
    const entry = page.locator('[data-entry]').filter({ hasText: 'Change events kept' }).first()
    await expect(entry).toContainText('Setting changed', { timeout: 15_000 })
    await entry.getByRole('link').click()
    await expect(page.locator('[data-slot="audit-entry"]')).toContainText(key)
    await expect(page.locator('[data-slot="audit-entry"]')).toContainText(
      'End to end: one day longer',
    )
  } finally {
    await putBack(context.request, baseURL!, before.value)
  }
})

test('an administrator adds approvers to a domain in one step, and the history log keeps the step', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, admin)
  const people = (await (await context.request.get('/api/v1/people')).json()) as {
    id: string
    name: string
  }[]
  const added = ['Kofi Mensah', 'Ines Duarte'].map(
    (name) => people.find((person) => person.name === name)!.id,
  )
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/health?open=domain:area_paid_media&tab=team')
    const team = page.locator('[data-slot="domain-team"]')
    await team.getByRole('button', { name: 'Add approvers' }).click({ timeout: 15_000 })
    const give = page.getByRole('dialog', { name: 'Give a role' })
    for (const [text, name] of [
      ['Kofi', /Kofi Mensah/],
      ['Ines', /Ines Duarte/],
    ] as const) {
      await give.getByRole('combobox', { name: 'People' }).fill(text)
      await page.getByRole('option', { name }).click()
    }
    await give.getByRole('textbox', { name: 'Why' }).fill('End to end: two more approvers')
    await give.getByRole('button', { name: 'Give roles' }).click()
    await expect(page.getByText('2 roles given')).toBeVisible({ timeout: 15_000 })
    const approvers = team.getByRole('list', { name: 'High-risk approvers of Paid media' })
    await expect(approvers).toContainText('Kofi Mensah')
    await expect(approvers).toContainText('Ines Duarte')

    // Each change is its own entry; the step's batch id finds both, with the reason.
    await page.goto('/admin?section=audit&action=assignment')
    const entry = page.locator('[data-entry]').first()
    await expect(entry).toContainText('Domain role given', { timeout: 15_000 })
    await entry.getByRole('link').click()
    const panel = page.locator('[data-slot="audit-entry"]')
    await expect(panel).toContainText('End to end: two more approvers')
    await expect(panel).toContainText('Named in the app')
    await page.getByRole('link', { name: 'Same step' }).click()
    await expect(page.locator('[data-entry]')).toHaveCount(2, { timeout: 15_000 })
  } finally {
    const session = await context.request.get('/api/v1/auth/session')
    const { csrfToken } = (await session.json()) as { csrfToken: string }
    const response = await context.request.post('/api/v1/grants/apply', {
      headers: {
        origin: baseURL!,
        'x-heed-csrf': csrfToken,
        'idempotency-key': crypto.randomUUID(),
      },
      data: {
        changes: added.map((personId) => ({
          op: 'revoke',
          personId,
          areaId: 'area_paid_media',
          role: 'approver',
        })),
        reason: 'End to end: back as it was',
      },
    })
    expect(response.ok(), await response.text()).toBe(true)
  }
})

test('an administrator checks the chain of the history log', async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!, admin)
  await page.goto('/admin?section=audit')
  await page.getByRole('button', { name: 'Check the chain' }).click()
  await expect(page.locator('[data-slot="chain-result"]')).toContainText('Every entry checks out', {
    timeout: 15_000,
  })
})

test('an auditor has the history log, and nothing else an administrator runs', async ({
  page,
  context,
  playwright,
  baseURL,
}) => {
  // The seed writes no history log entry, so an administrator makes one: a setting the other
  // tests leave alone, one day longer and back.
  const other = 'retention.note_days'
  const administrator = await playwright.request.newContext({ baseURL })
  try {
    const response = await administrator.post('/api/v1/auth/sign-in', {
      headers: { origin: baseURL!, 'x-heed-csrf': 'dev-sign-in' },
      data: { email: admin },
    })
    expect(response.ok()).toBe(true)
    const before = await setting(administrator, other)
    try {
      await save(
        administrator,
        baseURL!,
        (before.value as number) + 1,
        'End to end: an entry for the auditor',
        other,
      )
    } finally {
      await putBack(administrator, baseURL!, before.value, other)
    }
  } finally {
    await administrator.dispose()
  }

  await signIn(context, baseURL!, 'auditor@example.test')
  await page.goto('/admin')
  // The history log is the auditor's one section of Administration.
  await expect(page.locator('[data-entry]').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('navigation', { name: 'Administration sections' })).toHaveCount(0)
  await page.goto('/admin?section=limits')
  await expect(page.getByText('Limits is for admins')).toBeVisible()
})

test('an administrator reads every domain; an owner is not offered Administration', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, admin)
  await page.goto('/admin?section=domains')
  const grid = page.getByRole('table', { name: 'Domains', exact: true })
  await expect(grid).toContainText('Sales', { timeout: 15_000 })
  await expect(grid).toContainText('Marketing')
  await expect(page.getByRole('button', { name: 'Create a domain' })).toBeVisible()
  await signIn(context, baseURL!, 'per_jon@example.test')
  await page.goto('/settings?section=areas')
  await expect(page).toHaveURL(/\/admin\?section=domains$/)
  await expect(page.getByText('Administration is for admins and auditors')).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByRole('table')).toHaveCount(0)
})

test('an administrator reads the MCP traffic and the address clients connect to', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, admin)
  await page.goto('/admin?section=gateway&tab=activity')
  await expect(
    page.locator('[data-slot="traffic"], [data-slot="traffic-message"]').first(),
  ).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/and keep \d+ days/)).toBeVisible()
  await page.goto('/admin?section=gateway')
  await expect(page.locator('[data-slot="server-address"]')).toContainText('/mcp', {
    timeout: 15_000,
  })
})

test('an administrator finds a person by name or email, gives a role from their sheet and removes it', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, admin)
  await page.setViewportSize({ width: 1440, height: 900 })
  // Found on the server, by part of the address; the administrator signed in a moment ago.
  await page.goto('/admin?section=people&q=administrator%40')
  const me = page.locator('[data-slot="settings-people"] [data-person]')
  await expect(me).toHaveCount(1, { timeout: 15_000 })
  await expect(me).toContainText('Demo Administrator')
  await expect(me).toContainText('Today')

  await page.getByRole('searchbox', { name: 'Find a person' }).fill('kofi')
  await expect(page).toHaveURL(/q=kofi/)
  const kofi = page.locator('[data-slot="settings-people"] [data-person]')
  await expect(kofi).toHaveCount(1)
  await expect(kofi).toContainText('per_kofi@example.test')
  await kofi.locator('[data-row-link]').click()
  const sheet = page.locator('[data-slot="person-sheet"]')
  const panel = page.locator('[data-slot="dock-panel"]')
  await expect(sheet).toBeVisible()
  try {
    await panel.getByRole('button', { name: 'Give a role' }).click()
    const give = page.getByRole('dialog', { name: 'Give a role' })
    await expect(give.getByRole('button', { name: 'Remove Kofi Mensah' })).toBeVisible()
    await give.getByRole('combobox', { name: 'Role' }).selectOption('auditor')
    await give.getByRole('button', { name: 'Give role' }).click()
    await expect(give).toBeHidden({ timeout: 15_000 })
    await expect(sheet.locator('[data-grant="auditor"]')).toContainText(
      'given by Demo Administrator',
    )
    await expect(sheet.locator('[data-slot="person-history"]')).toContainText('Given: auditor')
    await expect(kofi).toContainText('Auditor')
  } finally {
    const remove = page.getByRole('button', { name: 'Remove Kofi Mensah as auditor' })
    if (await remove.isVisible()) {
      await remove.click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Remove role' }).click()
    }
  }
  await expect(sheet.locator('[data-grant="auditor"]')).toHaveCount(0)
  await expect(sheet.locator('[data-slot="person-history"] li').first()).toContainText(
    'Removed: auditor',
  )

  // The role filter is the server's: owners, and nobody without a role among them.
  await page.goto('/admin?section=people&role=owner')
  await expect(page.locator('[data-person]').first()).toBeVisible({ timeout: 15_000 })
  for (const row of await page.locator('[data-slot="settings-people"] [data-person]').all())
    await expect(row).toContainText('Owner of')
})

/** A write as the person signed in on `request`, with the CSRF token and a retry key. */
async function write(request: APIRequestContext, baseURL: string, path: string, data: object) {
  const session = await request.get('/api/v1/auth/session')
  const { csrfToken } = (await session.json()) as { csrfToken: string }
  const response = await request.post(`/api/v1${path}`, {
    headers: { origin: baseURL, 'x-heed-csrf': csrfToken, 'idempotency-key': crypto.randomUUID() },
    data,
  })
  expect(response.ok(), await response.text()).toBe(true)
  return response.json() as Promise<Record<string, unknown>>
}

test('an administrator deletes a domain and everything under it in one step, then restores it', async ({
  page,
  context,
  baseURL,
}) => {
  const suffix = Math.random().toString(36).slice(2, 8)
  const id = `e2e_bakery_${suffix}`
  const name = `E2E bakery ${suffix}`
  await signIn(context, baseURL!, admin)
  const people = (await (await context.request.get('/api/v1/people')).json()) as {
    id: string
    name: string
  }[]
  const jon = people.find((person) => person.name === 'Jon Abara')!.id
  await write(context.request, baseURL!, '/areas', {
    id,
    name,
    label: 'stone',
    reviewDays: 5,
    chatChannel: null,
    ownerTeam: null,
    team: { ownerIds: [jon] },
  })
  // Maria proposes in it, and keeps a draft there.
  await signIn(context, baseURL!, 'per_maria@example.test')
  const draftOf = (title: string) => ({
    draft: {
      areaId: id,
      title,
      summary: 'Online sales to Norway stopped',
      scope: {
        metrics: ['metric:orders'],
        dimensions: [],
        dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
      },
      validity: { start: '2026-08-04', end: null },
      evidence: [
        { url: 'https://example.test/law', quote: 'Online sales stopped', date: '2026-08-04' },
      ],
    },
  })
  const open = await write(context.request, baseURL!, '/proposals', draftOf('Oven repaired'))
  await write(context.request, baseURL!, `/proposals/${open.id as string}/submit`, {
    revision: open.revision,
  })
  await write(context.request, baseURL!, '/proposals', draftOf('Started, never sent'))

  await signIn(context, baseURL!, admin)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/admin?section=domains')
  await page.getByRole('button', { name: `Delete ${name}` }).click({ timeout: 15_000 })
  const dialog = page.getByRole('alertdialog', { name: `Delete ${name}?` })
  const lines = dialog.getByRole('list', { name: `What deleting ${name} does` })
  await expect(lines.locator('[data-kind="openProposals"]')).toContainText('1 open proposal', {
    timeout: 15_000,
  })
  await expect(lines.locator('[data-kind="drafts"]')).toContainText('1 draft')
  await expect(lines.locator('[data-kind="team"]')).toContainText('1 team role')
  await lines
    .locator('[data-kind="drafts"]')
    .getByRole('button', { name: 'See the drafts' })
    .click()
  await expect(lines.getByRole('list', { name: '1 draft' })).toContainText('Started, never sent')
  // As AWS asks: the button stays disabled until the words are typed.
  const button = dialog.getByRole('button', { name: 'Delete domain' })
  await expect(button).toBeDisabled()
  const words = dialog.getByRole('textbox', { name: 'Type permanently delete to confirm' })
  await words.fill(name)
  await expect(button).toBeDisabled()
  await words.fill('permanently delete')
  await expect(button).toBeEnabled()
  await button.click()
  const done = page.getByRole('alertdialog')
  await expect(done.getByRole('heading', { name: `${name} deleted` })).toBeVisible({
    timeout: 15_000,
  })
  await expect(done).toContainText('1 proposal withdrawn.')
  await expect(done).toContainText('1 draft kept for its author.')
  await expect(done).toContainText('1 team role ended.')
  await done.getByRole('button', { name: 'Close' }).click()
  await expect(
    page.getByRole('table', { name: 'Domains', exact: true }).locator(`[data-row-id="${id}"]`),
  ).toHaveCount(0)
  const deleted = page.getByRole('table', { name: 'Deleted domains' })
  await expect(deleted).toContainText(name)
  await expect(deleted).toContainText('Restore')

  // Restore it: listed again, with its team.
  await deleted.getByRole('button', { name: `Restore ${name}` }).click()
  const restore = page.getByRole('alertdialog', { name: `Restore ${name}?` })
  await restore.getByRole('button', { name: 'Restore domain' }).click()
  await expect(page.getByRole('heading', { name: `${name} restored` })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('alertdialog').getByRole('button', { name: 'Close' }).click()
  await expect(
    page.getByRole('table', { name: 'Domains', exact: true }).locator(`[data-row-id="${id}"]`),
  ).toBeVisible()

  // Put back: the domain leaves the lists again, kept as history.
  const removal = (await (await context.request.get(`/api/v1/areas/${id}/removal`)).json()) as {
    revision: number
  }
  await write(context.request, baseURL!, `/areas/${id}/removal`, {
    revision: removal.revision,
    confirm: 'permanently delete',
    reason: 'End to end: back as it was',
  })
})
