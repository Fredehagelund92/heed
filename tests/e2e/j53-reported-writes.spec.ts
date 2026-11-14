import type { Page, Route } from '@playwright/test'
import { expect, go, mode, test, unfold } from './go.ts'

// J53, a write the screen reports says so only once the service has answered. Inviting keeps the
// dialog open with the addresses while it is sent, and when the service refuses, says why and
// keeps them for Invite again. A new access key stays on screen in a dialog until it is closed,
// not in a toast that leaves; a refused one keeps its name and says why. The mock cannot hold or
// refuse these writes, so those parts run on the service, with its requests held or failed in the
// browser.

const http = () => test.skip(mode !== 'http', 'it holds and fails real requests')

/** The writes to one path of the service, as the app sends them. */
const writesTo = (path: string) => (route: Route) =>
  route.request().method() !== 'GET' && new URL(route.request().url()).pathname.endsWith(path)

const toasts = (page: Page) => page.locator('[data-sonner-toast]')

async function startInvite(page: Page) {
  await go(page, '/settings/people')
  await page.getByRole('button', { name: 'Invite people' }).click()
  const dialog = page.getByRole('dialog', { name: 'Invite people' })
  await dialog.getByLabel('Email addresses').fill('nina@larchwood.example')
  return dialog
}

const invitedList = (page: Page) => page.getByRole('list', { name: 'Invited' })

test('an invite the service refuses keeps the dialog and the address, says why, and goes on the next try', async ({
  page,
}) => {
  http()
  const dialog = await startInvite(page)
  const isInvite = writesTo('/invites')
  await page.route('**/api/v1/**', (route) =>
    isInvite(route) ? route.abort('failed') : route.fallback(),
  )
  await dialog.getByRole('button', { name: 'Invite', exact: true }).click()

  await expect(dialog.getByRole('alert')).toHaveText(
    "Nobody was invited. The service didn't reply.",
  )
  await expect(dialog.getByLabel('Email addresses')).toHaveValue('nina@larchwood.example')
  await expect(toasts(page).filter({ hasText: 'Invited' })).toHaveCount(0)

  await page.unroute('**/api/v1/**')
  await dialog.getByRole('button', { name: 'Invite', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(toasts(page).filter({ hasText: 'Invited' })).toBeVisible()
  await expect(invitedList(page).getByText('nina@larchwood.example').first()).toBeVisible()
})

test('the invite dialog stays open with the address until the service has answered', async ({
  page,
}) => {
  http()
  const dialog = await startInvite(page)
  const isInvite = writesTo('/invites')
  let answer!: () => void
  const held = new Promise<void>((resolve) => (answer = resolve))
  await page.route('**/api/v1/**', async (route) => {
    if (!isInvite(route)) return route.fallback()
    const response = await route.fetch()
    await held
    await route.fulfill({ response })
  })
  await dialog.getByRole('button', { name: 'Invite', exact: true }).click()

  // Sent, not answered: nothing is said yet, and a second Invite would send it twice.
  await expect(dialog.getByRole('button', { name: 'Inviting…' })).toBeDisabled()
  await expect(dialog.getByLabel('Email addresses')).toHaveValue('nina@larchwood.example')
  await expect(toasts(page).filter({ hasText: 'Invited' })).toHaveCount(0)

  answer()
  await expect(dialog).toBeHidden()
  await expect(toasts(page).filter({ hasText: 'Invited' })).toBeVisible()
})

async function startKey(page: Page) {
  await go(page, '/settings/agents')
  await unfold(page, 'Tools and access keys')
  await page.getByRole('button', { name: 'Create an access key' }).click()
  const naming = page.getByRole('dialog', { name: 'Create an access key' })
  await naming.getByLabel('Name').fill('Weekly sales digest')
  return naming
}

test('a new access key stays on screen until it is closed', async ({ page }) => {
  await page.clock.install()
  const naming = await startKey(page)
  await naming.getByRole('button', { name: 'Create' }).click()

  const shown = page.getByRole('dialog', { name: 'Your new access key' })
  await expect(shown.getByText('Copy it now: it is shown once.')).toBeVisible()
  const key = shown.getByLabel('Access key')
  await expect(key).not.toHaveValue('')
  await expect(shown.getByRole('button', { name: 'Copy' })).toBeVisible()
  // A toast would have left by now; the key is still there to copy.
  await page.clock.runFor(10_000)
  await expect(key).toBeVisible()
  await expect(toasts(page)).toHaveCount(0)

  await shown.getByRole('button', { name: 'Done' }).click()
  await expect(shown).toBeHidden()
  await expect(
    page
      .getByRole('list', { name: 'Connected agents' })
      .getByRole('listitem')
      .filter({ hasText: 'Weekly sales digest' }),
  ).toHaveCount(1)
})

test('an access key the service refuses keeps its name and says why', async ({ page }) => {
  http()
  const naming = await startKey(page)
  const isKey = writesTo('/access-keys')
  await page.route('**/api/v1/**', (route) =>
    isKey(route) ? route.abort('failed') : route.fallback(),
  )
  await naming.getByRole('button', { name: 'Create' }).click()

  await expect(naming.getByRole('alert')).toHaveText(
    "No access key was created. The service didn't reply.",
  )
  await expect(naming.getByLabel('Name')).toHaveValue('Weekly sales digest')

  await page.unroute('**/api/v1/**')
  await naming.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('dialog', { name: 'Your new access key' })).toBeVisible()
})
