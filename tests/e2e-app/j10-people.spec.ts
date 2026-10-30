import { expect, go, signInAs, signOut, test, userMenu } from './go.ts'

// J10, people: an admin invites people as owners of a domain, and the domain sees them; the last
// owner of a domain can't leave until someone takes over; an owner who isn't an admin can add
// owners to their own domain and nothing else; ownership is the same on both pages. Picking a
// person on the sign-in page opens their Inbox, and sign-in is no place for someone signed in.
// A person's sheet says what they checked lately.

test('invited people show as pending, and as owners on their domain', async ({ page }) => {
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
  await expect(page.getByRole('button', { name: /Owners/ })).toContainText('nina@larchwood.example')
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
    days.push(dayOf((await line.textContent())!.match(/\d{1,2} [A-Z][a-z]{2} \d{4}$/)![0]))
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

test('a person picked on the sign-in page lands in their Inbox, and /signin leads back there', async ({
  page,
}) => {
  await go(page, '/inbox')
  await signOut(page)
  await page.getByRole('button', { name: /Ines Duarte/ }).click()
  await expect(page).toHaveURL(/\/inbox$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible()
  await expect(userMenu(page)).toContainText('Ines Duarte')
  await go(page, '/signin')
  await expect(page).toHaveURL(/\/inbox$/)
  await expect(userMenu(page)).toContainText('Ines Duarte')
})
