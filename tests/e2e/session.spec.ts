import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openPage, settle, themes, widths } from './support'

/*
  The session in the shell, on the mock API: the user menu says what the signed-in person is,
  Sign out ends the session, and a visit without a session lands on the signed-out page instead
  of an empty list. The same on the real service is in tests/e2e-api/session.spec.ts.
*/

async function signInAs(page: Page, person: string) {
  await page.addInitScript((id) => window.localStorage.setItem('cl.mock-person', id), person)
}

async function signedOutScenario(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('cl.mock-scenario', 'signed-out'))
}

const userMenu = (page: Page, name: string) =>
  page.locator('[data-slot="sidebar"]').getByRole('button', { name: new RegExp(name) })

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(' ')).join(' | ')})`,
  )
}

test.describe('the user menu says who is signed in', () => {
  test('a contributor', async ({ page }) => {
    await openPage(page, '/library', { ...widths[0], theme: 'light' })
    await expect(page.getByTestId('user-role')).toHaveText('Contributor')
  })

  test('an owner, with the areas they look after', async ({ page }) => {
    await signInAs(page, 'per_jon')
    await openPage(page, '/library', { ...widths[0], theme: 'light' })
    await expect(page.getByTestId('user-role')).toHaveText('Owner of Sales and Sandbox')
    await userMenu(page, 'Jon Abara').click()
    const menu = page.getByRole('menu')
    await expect(menu).toContainText('Jon Abara')
    await expect(menu).toContainText('Owner of Sales and Sandbox')
    await settle(page)
    expect(await axe(page)).toEqual([])
  })

  for (const [person, words] of [
    ['per_sofia', 'Owner of Sales'],
    ['per_lars', 'High-risk approver of Sales'],
    ['per_ravi', 'Admin'],
  ] as const) {
    test(`${words}`, async ({ page }) => {
      await signInAs(page, person)
      await openPage(page, '/', { ...widths[0], theme: 'light' })
      await expect(page.getByTestId('user-role')).toHaveText(words)
    })
  }

  test('only an administrator or an auditor sees Administration', async ({ page }) => {
    const sidebar = page.locator('[data-slot="sidebar"]')
    await signInAs(page, 'per_jon')
    await openPage(page, '/', { ...widths[0], theme: 'light' })
    await expect(page.getByTestId('user-role')).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Administration' })).toHaveCount(0)
    await signInAs(page, 'per_ravi')
    await page.reload()
    await expect(page.getByTestId('user-role')).toHaveText('Admin')
    await expect(sidebar.getByRole('link', { name: 'Administration' })).toBeVisible()
  })

  test('the role stays readable in the rail and on a phone', async ({ page }) => {
    await signInAs(page, 'per_jon')
    await openPage(page, '/', { ...widths[2], theme: 'light' })
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await expect(page.getByTestId('user-role')).toHaveText('Owner of Sales and Sandbox')
    await expect(page.getByTestId('user-role')).toBeVisible()
  })
})

test.describe('signed out', () => {
  test('a visit without a session opens the sign-in page, not an empty list', async ({ page }) => {
    await signedOutScenario(page)
    await openPage(page, '/library?kind=event', { ...widths[0], theme: 'light' })
    await expect(page).toHaveURL(/\/signed-out\?from=/)
    expect(new URL(page.url()).searchParams.get('from')).toBe('/library?kind=event')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in to Heed')
    await expect(page).toHaveTitle(/^Sign in/)
    // The page stands alone: no shell, nothing that needs a session.
    await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(0)
    await expect(page.locator('#library-count')).toHaveCount(0)
  })

  test('the picker names each demo person with their roles and domains, by keyboard too', async ({
    page,
  }) => {
    await signedOutScenario(page)
    await openPage(page, '/signed-out?from=%2Flibrary%3Fkind%3Devent', {
      ...widths[0],
      theme: 'light',
    })
    // The list starts from the first person under the first role: the administrator.
    const picker = page.getByRole('combobox', { name: 'Sign in as' })
    await expect(picker).toContainText('Ravi Kapoor')
    await expect(picker).toContainText('Admin')
    await expect(page.getByText('Demo', { exact: true })).toBeVisible()
    // Opening the list moves nothing on the page: the list lies over it.
    const card = page.locator('[data-slot="auth-card"]')
    const closed = await card.boundingBox()
    await page.evaluate(() => {
      const shifts: number[] = []
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          shifts.push((entry as unknown as { value: number }).value)
      }).observe({ type: 'layout-shift' })
      Object.assign(window, { shifts })
    })
    await picker.focus()
    await page.keyboard.press('ArrowDown')
    // Grouped by role, each person with the domains of that role beside them.
    const listbox = page.getByRole('listbox')
    await expect(listbox.getByRole('group')).toHaveText([
      /^Admins/,
      /^Owners/,
      /^High-risk approvers/,
      /^Auditors/,
      /^Contributors/,
    ])
    const jon = listbox.getByRole('group', { name: 'Owners' }).getByRole('option', {
      name: /Jon Abara/,
    })
    await expect(jon).toContainText('Sales')
    await expect(jon).toContainText('Sandbox')
    await settle(page)
    expect(await card.boundingBox()).toEqual(closed)
    expect(await page.evaluate(() => (window as unknown as { shifts: number[] }).shifts)).toEqual(
      [],
    )
    // Below the field, and short enough to show everyone without scrolling.
    const list = (await listbox.boundingBox())!
    expect(list.y).toBeGreaterThan((await picker.boundingBox())!.y)
    expect(await listbox.evaluate((element) => element.scrollHeight - element.clientHeight)).toBe(0)
    // Typing a name moves to that person; Enter chooses them.
    await page.keyboard.press('ArrowDown')
    await expect(jon).toHaveAttribute('data-highlighted')
    await page.keyboard.type('Ines')
    await expect(listbox.getByRole('option', { name: /Ines Duarte/ })).toHaveAttribute(
      'data-highlighted',
    )
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(picker).toContainText('Jon Abara')
    // The list closes and gives focus back to the picker; Tab reaches the one button and back.
    await expect(page.getByRole('listbox')).toBeHidden()
    await expect(picker).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Continue as Jon Abara' })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(picker).toBeFocused()
    // Enter on the closed picker signs in as the person chosen, as the button does.
    await page.keyboard.press('Enter')
    // Back where the person was, as the person chosen.
    await expect(page).toHaveURL(/\/library\?kind=event$/)
    await expect(page.getByTestId('user-role')).toHaveText('Owner of Sales and Sandbox')
  })

  for (const size of [
    { name: '1440 by 700', width: 1440, height: 700 },
    { name: '390 by 667', width: 390, height: 667 },
  ])
    test(`on a short window (${size.name}) the list stays inside it and scrolls`, async ({
      page,
    }) => {
      await signedOutScenario(page)
      await openPage(page, '/signed-out?from=%2Flibrary', { ...size, theme: 'light' })
      await page.getByRole('combobox', { name: 'Sign in as' }).click()
      const listbox = page.getByRole('listbox')
      await expect(listbox.getByRole('group', { name: 'Contributors' })).toBeAttached()
      await settle(page)
      const popup = (await page.locator('[data-slot="select-content"]').boundingBox())!
      // The list ends 12 short of the window, and the page is never taller than the window.
      expect(size.height - (popup.y + popup.height)).toBeGreaterThanOrEqual(11)
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(size.height)
      // The rest is a scroll away inside the list, and the last person can be reached.
      expect(
        await listbox.evaluate((element) => element.scrollHeight - element.clientHeight),
      ).toBeGreaterThan(0)
      const last = listbox.getByRole('group', { name: 'Contributors' }).getByRole('option').last()
      await last.scrollIntoViewIfNeeded()
      await expect(last).toBeInViewport()
    })

  test('Sign out opens the sign-in page; Continue signs in again and goes back', async ({
    page,
  }) => {
    await openPage(page, '/library', { ...widths[0], theme: 'light' })
    await userMenu(page, 'Maria Lindqvist').click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/signed-out\?from=%2Flibrary/)
    await expect(page.getByRole('heading', { name: 'Sign in to Heed' })).toBeVisible()
    await page.getByRole('button', { name: /^Continue as / }).click()
    await expect(page).toHaveURL(/\/library$/)
    await expect(page.locator('#library-count')).toHaveText('1,404 facts')
  })

  test('Switch demo person in the user menu opens the picker on the person signed in', async ({
    page,
  }) => {
    await openPage(page, '/library', { ...widths[0], theme: 'light' })
    // The last choice on this browser starts the picker: Sofia, as if she had signed in here.
    await page.evaluate(() =>
      window.localStorage.setItem('cl.sign-in.last', 'per_sofia@example.test'),
    )
    await userMenu(page, 'Maria Lindqvist').click()
    await page.getByRole('menuitem', { name: 'Switch demo person' }).click()
    await expect(page).toHaveURL(/\/signed-out\?from=%2Flibrary/)
    await expect(page.getByRole('combobox', { name: 'Sign in as' })).toContainText('Sofia Brandt')
    await page.getByRole('button', { name: 'Continue as Sofia Brandt' }).click()
    await expect(page).toHaveURL(/\/library$/)
    await expect(page.getByTestId('user-role')).toHaveText('Owner of Sales')
  })

  test('on a phone the user menu opens above the sidebar sheet, and signs out', async ({
    page,
  }) => {
    await openPage(page, '/library', { ...widths[2], theme: 'light' })
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await userMenu(page, 'Maria Lindqvist').click()
    const signOut = page.getByRole('menuitem', { name: 'Sign out' })
    await expect(signOut).toBeVisible()
    await settle(page)
    // Nothing covers the menu: the item is what a tap at its centre reaches.
    const box = (await signOut.boundingBox())!
    expect(
      await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.closest('[role="menuitem"]')?.textContent,
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      ),
    ).toBe('Sign out')
    await signOut.click()
    await expect(page).toHaveURL(/\/signed-out\?from=%2Flibrary/)
  })

  // The menu and the phone's sidebar sheet are chunks fetched after the first load. A press that
  // comes before its chunk is not lost: the menu or the sheet opens once the chunk arrives.
  test('a press before the user menu has loaded opens it once it has', async ({ page }) => {
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    await page.route(/\/assets\/user-menu-popup-[^/]+\.js$/, async (route) => {
      await held
      await route.continue()
    })
    await openPage(page, '/library', { ...widths[0], theme: 'light' })
    const button = userMenu(page, 'Maria Lindqvist')
    await button.click()
    await expect(page.getByRole('menu')).toHaveCount(0)
    release()
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible()
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(button).toBeFocused()
  })

  test('on a phone, the sidebar opened before its sheet has loaded opens once it has', async ({
    page,
  }) => {
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    await page.route(/\/assets\/sidebar-sheet-[^/]+\.js$/, async (route) => {
      await held
      await route.continue()
    })
    await openPage(page, '/library', { ...widths[2], theme: 'light' })
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await expect(page.getByRole('dialog', { name: 'Sidebar' })).toHaveCount(0)
    release()
    await expect(page.getByRole('dialog', { name: 'Sidebar' })).toBeVisible()
    await expect(userMenu(page, 'Maria Lindqvist')).toBeVisible()
  })

  test('only a path on this site is kept to go back to', async ({ page }) => {
    await openPage(page, '/signed-out?from=https://evil.example/x', {
      ...widths[0],
      theme: 'light',
    })
    await page.getByRole('button', { name: /^Continue as/ }).click()
    await expect(page).toHaveURL(/localhost:\d+\/$/)
  })

  for (const size of widths) {
    for (const theme of themes) {
      test(`the sign-in page passes axe at ${size.name}px, ${theme}`, async ({ page }) => {
        await signedOutScenario(page)
        await openPage(page, '/signed-out', { ...size, theme })
        await expect(page.getByRole('combobox', { name: 'Sign in as' })).toBeVisible()
        expect(await axe(page)).toEqual([])
        // The open picker too.
        await page.getByRole('combobox', { name: 'Sign in as' }).click()
        await expect(page.getByRole('option', { name: /Jon Abara/ })).toBeVisible()
        await settle(page)
        expect(await axe(page)).toEqual([])
        // Nothing scrolls sideways on a phone.
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        ).toBe(true)
      })
    }
  }
})
