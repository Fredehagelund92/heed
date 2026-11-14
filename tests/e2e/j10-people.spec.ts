import type { Page } from '@playwright/test'
import { expect, go, mode, signInAs, signOut, test, userMenu } from './go.ts'

// J10, people: an admin invites people as owners of a domain, and the domain lists them as invited,
// not as its owners; an invite's sheet offers what an invite can do (a new link, Revoke) and reads
// its role and domains as text; the last owner of a domain can't leave until someone takes over,
// an invited owner beside them or not, and a removal says "Removed" only once the service has
// answered; an owner who isn't an admin can add owners to their own domain and nothing else, and
// takes back an invite they sent; ownership is the same on both pages. Picking a person on the
// sign-in page opens their Inbox, and sign-in is no place for someone signed in. A person's sheet
// says what they checked lately.

/** Invites one address as an owner of one domain, from the dialog already open. */
async function inviteIn(page: Page, email: string, domain: string) {
  const dialog = page.getByRole('dialog', { name: 'Invite people' })
  await dialog.getByLabel('Email addresses').fill(email)
  // Opened from a domain's page, the dialog has that domain chosen already.
  const choice = dialog.getByRole('button', { name: domain, exact: true })
  if ((await choice.getAttribute('aria-pressed')) !== 'true') await choice.click()
  await dialog.getByRole('button', { name: 'Invite', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

test('invited people show as pending, and as invited on their domain', async ({ page }) => {
  await go(page, '/settings/people')
  await page.getByRole('button', { name: 'Invite people' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Email addresses').fill('nina@larchwood.example, omar@larchwood.example')
  await dialog.getByRole('button', { name: 'Marketing' }).click()
  await dialog.getByRole('button', { name: 'Invite 2 people' }).click()
  await expect(
    page.getByRole('list', { name: 'Invited' }).getByText('nina@larchwood.example').first(),
  ).toBeVisible()
  await go(page, '/settings/domains/marketing')
  await expect(page.getByRole('button', { name: /Owners/ })).not.toContainText('nina@')
  await expect(page.getByRole('group', { name: 'Invited' })).toContainText('nina@larchwood.example')
})

test("an invite's sheet offers a new link and Revoke, and reads its role and domains", async ({
  page,
}) => {
  await go(page, '/settings/people')
  await page.getByRole('button', { name: 'Invite people' }).click()
  await inviteIn(page, 'nina@larchwood.example', 'Marketing')
  await page
    .getByRole('list', { name: 'Invited' })
    .getByRole('button', { name: /nina@larchwood\.example/ })
    .click()
  const sheet = page.getByRole('dialog', { name: 'nina@larchwood.example' })
  // The service never changes an invite's role or domains: no switch here pretends to.
  await expect(sheet.getByRole('radiogroup', { name: 'Role' })).toHaveCount(0)
  await expect(sheet.getByRole('switch')).toHaveCount(0)
  await expect(sheet).toContainText('Invited as a Member')
  await expect(sheet.getByRole('group', { name: 'Owns once they sign in' })).toHaveText('Marketing')
  await expect(sheet.getByRole('button', { name: 'Make a new link' })).toBeEnabled()
  await expect(sheet.getByRole('button', { name: 'Revoke the invite' })).toBeEnabled()
})

test('an invited owner is not an owner on the domain page, so its only owner stays', async ({
  page,
}) => {
  await go(page, '/settings/people')
  await page.getByRole('button', { name: 'Invite people' }).click()
  await inviteIn(page, 'omar@larchwood.example', 'Paid media')
  await go(page, '/settings/domains/paid_media')
  const owners = page.getByRole('button', { name: /^Owners/ })
  await expect(owners).toContainText('Priya Nair')
  await expect(owners).not.toContainText('omar@')
  await expect(page.getByRole('group', { name: 'Invited' })).toContainText('omar@larchwood.example')
  // Taking Priya off would leave Paid media with no owner who has signed in: refused here.
  await owners.click()
  await page.getByRole('option', { name: /Priya Nair/ }).click()
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('region', { name: /^Notifications/ }).getByText('A domain needs an owner'),
  ).toBeVisible()
  await expect(owners).toContainText('Priya Nair')
})

/** A day's label as a day to sort by: "3 Oct 2026" is 2026-10-03. */
const dayOf = (label: string) => {
  const [d = '', m = '', y = ''] = label.split(' ')
  const month = 'JanFebMarAprMayJunJulAugSepOctNovDec'.indexOf(m) / 3 + 1
  return `${y}-${String(month).padStart(2, '0')}-${d.padStart(2, '0')}`
}

test("a person's sheet says what they checked lately, newest first", async ({ page }) => {
  await go(page, '/settings/people')
  await page
    .getByRole('list', { name: 'People' })
    .getByRole('button', { name: /Sofia Brandt/ })
    .click()
  const lines = page.getByRole('dialog').getByRole('list', { name: 'Lately' }).getByRole('listitem')
  await expect(lines).toHaveCount(3)
  const days: string[] = []
  for (const line of await lines.all()) {
    await expect(line).toContainText(/^Checked .+\d{1,2} [A-Z][a-z]{2} \d{4}$/)
    const date = (await line.locator(':scope > :last-child').textContent())!
    days.push(dayOf(date.match(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/)![0]))
  }
  expect(days).toEqual([...days].sort().reverse())
})

test('the only owner of a domain hands over before leaving', async ({ page }) => {
  await go(page, '/settings/people')
  await page
    .getByRole('list', { name: 'People' })
    .getByRole('button', { name: /Priya Nair/ })
    .click()
  await page.getByRole('button', { name: 'Remove from the workspace' }).click()
  await expect(page.getByRole('dialog', { name: 'Hand over first' })).toContainText(
    'only owner of Paid media',
  )
})

test('an invited owner does not stand in for the only owner who has signed in', async ({
  page,
}) => {
  await go(page, '/settings/people')
  await page.getByRole('button', { name: 'Invite people' }).click()
  const invite = page.getByRole('dialog')
  await invite.getByLabel('Email addresses').fill('omar@larchwood.example')
  await invite.getByRole('button', { name: 'Paid media' }).click()
  await invite.getByRole('button', { name: 'Invite', exact: true }).click()
  await expect(
    page.getByRole('list', { name: 'Invited' }).getByText('omar@larchwood.example').first(),
  ).toBeVisible()
  await page
    .getByRole('list', { name: 'People' })
    .getByRole('button', { name: /Priya Nair/ })
    .click()
  await page.getByRole('button', { name: 'Remove from the workspace' }).click()
  await expect(page.getByRole('dialog', { name: 'Hand over first' })).toContainText(
    'only owner of Paid media',
  )
})

/**
 * Every toast the page shows from now on, title and text, read in the page as each one mounts, so
 * none that comes and goes between two looks is missed.
 */
async function watchToasts(page: Page) {
  await page.evaluate(() => {
    const seen = new WeakSet<Element>()
    const shown: string[] = ((window as unknown as { shown: string[] }).shown = [])
    new MutationObserver(() => {
      for (const toast of document.querySelectorAll('[data-sonner-toast]'))
        if (!seen.has(toast) && toast.textContent) {
          seen.add(toast)
          shown.push(toast.textContent)
        }
    }).observe(document.body, { childList: true, subtree: true, characterData: true })
  })
  return () => page.evaluate(() => (window as unknown as { shown: string[] }).shown)
}

test('a removal says "Removed" only once the service has answered', async ({ page }) => {
  test.skip(mode === 'mock', 'The mock answers at once, so there is no wait to watch.')
  // The first removal is held, then fails as the service does when busy; the next goes through.
  let release = () => {}
  const released = new Promise<void>((resolve) => (release = resolve))
  let tries = 0
  await page.route(/\/api\/v1\/members\/[^/]+\/remove$/, async (route) => {
    if (route.request().method() !== 'POST' || tries++) return route.fallback()
    await released
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      json: { code: 'SERVICE_UNAVAILABLE', status: 503, message: 'The service is busy.' },
    })
  })
  await go(page, '/settings/people')
  const people = page.getByRole('list', { name: 'People' })
  const remove = async () => {
    await people.getByRole('button', { name: /Maria Lindqvist/ }).click()
    await page.getByRole('button', { name: 'Remove from the workspace' }).click()
    await page
      .getByRole('dialog', { name: 'Remove Maria Lindqvist?' })
      .getByRole('button', { name: 'Remove' })
      .click()
  }
  const toasts = page.getByRole('region', { name: /^Notifications/ }).getByRole('listitem')
  const shown = await watchToasts(page)
  await remove()
  await expect.poll(() => tries).toBe(1)
  release()
  // What the page said about her, from the click until the service's answer and after it.
  await expect.poll(shown).toContainEqual(expect.stringContaining('Maria Lindqvist'))
  expect(await shown()).toEqual([expect.stringMatching(/^Couldn't remove Maria Lindqvist/)])
  await expect(toasts.filter({ hasText: "Couldn't remove Maria Lindqvist" })).toBeVisible()
  await expect(people.getByRole('button', { name: /Maria Lindqvist/ })).toBeVisible()
  await remove()
  await expect(toasts.filter({ hasText: /^RemovedMaria Lindqvist/ })).toBeVisible()
  await expect(people.getByRole('button', { name: /Maria Lindqvist/ })).toHaveCount(0)
})

test('an owner who sent an invite makes it a new link, or takes it back', async ({ page }) => {
  await signInAs(page, 'Tomas Eriksen')
  await go(page, '/settings/domains/marketing')
  await page.getByRole('button', { name: /^Owners/ }).click()
  await page.getByRole('button', { name: 'Invite someone as an owner' }).click()
  await inviteIn(page, 'lena@larchwood.example', 'Marketing')
  await go(page, '/settings/people')
  await page
    .getByRole('list', { name: 'Invited' })
    .getByRole('button', { name: /lena@larchwood\.example/ })
    .click()
  const sheet = page.getByRole('dialog', { name: 'lena@larchwood.example' })
  await expect(sheet.getByRole('button', { name: 'Make a new link' })).toBeEnabled()
  await sheet.getByRole('button', { name: 'Revoke the invite' }).click()
  await page
    .getByRole('dialog', { name: 'Revoke the invite to lena@larchwood.example?' })
    .getByRole('button', { name: 'Revoke' })
    .click()
  await expect(
    page.getByRole('region', { name: /^Notifications/ }).getByText('Invite revoked'),
  ).toBeVisible()
  await expect(page.getByRole('list', { name: 'Invited' }).getByText('lena@')).toHaveCount(0)
})

test("an owner who isn't an admin adds owners to their own domain only", async ({ page }) => {
  await signInAs(page, 'Tomas Eriksen')
  await go(page, '/settings/people')
  await expect(page.getByRole('button', { name: 'Invite people' })).toBeDisabled()
  await go(page, '/settings/domains/sales')
  await expect(page.getByRole('button', { name: /Owners/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await go(page, '/settings/domains/marketing')
  await expect(page.getByRole('button', { name: /Owners/ })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  )
})

test('ownership is the same on the domain page and in People', async ({ page }) => {
  await go(page, '/settings/domains/sales')
  await page.getByRole('button', { name: /Owners/ }).click()
  await page.getByRole('option', { name: /Ines Duarte/ }).click()
  await page.keyboard.press('Escape')
  await go(page, '/settings/people')
  await expect(
    page.getByRole('list', { name: 'People' }).getByRole('button', { name: /Ines Duarte/ }),
  ).toContainText('Sales')
})

test("Settings leads back to the app, not to the workspace's name", async ({ page }) => {
  await go(page, '/settings/people')
  const back = page.getByRole('link', { name: 'Back to app' })
  await expect(back).toBeVisible()
  await back.click()
  await expect(page).toHaveURL(/\/inbox/)
})

test('a person picked on the sign-in page lands where the app opens for them, and /signin leads back there', async ({
  page,
}) => {
  await go(page, '/inbox')
  await signOut(page)
  // Ines's one suggestion waits on Jon, so nothing needs Ines: the app opens on Ask.
  await page.getByRole('button', { name: /Ines Duarte/ }).click()
  await expect(page).toHaveURL(/\/ask$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Ask' })).toBeVisible()
  await expect(userMenu(page)).toContainText('Ines Duarte')
  await go(page, '/signin')
  await expect(page).toHaveURL(/\/ask$/)
  await expect(userMenu(page)).toContainText('Ines Duarte')
})
