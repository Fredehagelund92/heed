import type { Page } from '@playwright/test'

/** Open an address of the app. */
export const go = (page: Page, route: string) => page.goto(route)

/** Move to another address inside the app, as a link on the page does, without loading it again. */
export const moveTo = (page: Page, route: string) =>
  page.evaluate((to) => {
    const link = Object.assign(document.createElement('a'), { href: to })
    document.body.append(link)
    link.click()
    link.remove()
  }, route)

/** Sign in as one of the demo's people. */
export async function signInAs(page: Page, name: string) {
  await go(page, '/signin')
  await page.getByRole('button', { name: new RegExp(name) }).click()
}
