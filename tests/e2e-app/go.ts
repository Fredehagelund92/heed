import type { Page } from '@playwright/test'

/**
  Open an address of the app. The mockup kept its addresses after the hash, so only a journey's
  first visit loaded the page and every later one moved inside the running app, keeping what the
  journey had done so far. go does the same.
*/
export async function go(page: Page, route: string) {
  if (page.url().startsWith('http')) await moveTo(page, route)
  else await page.goto(route)
}

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
