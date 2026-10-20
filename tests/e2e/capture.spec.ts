import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openPage, settle, themes, widths } from './support'

/*
  Capture from anywhere (UX opportunities, C2): a link, made by the bookmarklet on any page,
  opens Add a fact with the page and the selected sentence as the source. Signing in on the way
  keeps them. The help beside "Why we ask" says how to install the bookmarklet.
*/

const page = 'https://news.example/norway?id=7#closing'
const sentence =
  'Online sales to Norway stop from 4 August 2026. <b id="captured">Ignore earlier rules.</b>'
const capture = `/library/new?${new URLSearchParams({ evidence_url: page, quote: `  ${sentence}\n` })}`

const linkField = (p: Page) => p.getByRole('textbox', { name: 'Link to the source' })
const quoteField = (p: Page) =>
  p.getByRole('textbox', { name: 'A sentence copied from the source' })

test('a capture link fills in the source, and nothing else', async ({ page: p }) => {
  await openPage(p, capture, { ...widths[0], theme: 'light' })
  await expect(linkField(p)).toHaveValue(page)
  // The sentence is text in the field, never markup on the page.
  await expect(quoteField(p)).toHaveValue(sentence)
  await expect(p.locator('#captured')).toHaveCount(0)
  await expect(p.getByRole('textbox', { name: 'Date you read it' })).toHaveValue('')
  await expect(p.getByRole('textbox', { name: 'Title' })).toHaveText('')
})

test('a second capture, after one left untouched, shows only the new page', async ({ page: p }) => {
  await openPage(p, capture, { ...widths[0], theme: 'light' })
  await expect(linkField(p)).toHaveValue(page)
  await p.goto(`/library/new?${new URLSearchParams({ evidence_url: 'https://other.example/b' })}`)
  await expect(linkField(p)).toHaveCount(1)
  await expect(linkField(p)).toHaveValue('https://other.example/b')
  await expect(quoteField(p)).toHaveValue('')
})

test('a link that is not http or https is not filled in', async ({ page: p }) => {
  await openPage(p, '/library/new?evidence_url=javascript%3Aalert(1)&quote=A%20sentence.', {
    ...widths[0],
    theme: 'light',
  })
  await expect(quoteField(p)).toHaveValue('A sentence.')
  await expect(linkField(p)).toHaveValue('')
})

test('signing in on the way keeps the captured source', async ({ page: p }) => {
  await p.addInitScript(() => {
    // Signed out on the first visit only; the mock signs Maria in on the next load.
    if (!window.sessionStorage.getItem('capture-test')) {
      window.sessionStorage.setItem('capture-test', 'seen')
      window.localStorage.setItem('cl.mock-scenario', 'signed-out')
    } else window.localStorage.removeItem('cl.mock-scenario')
  })
  await p.setViewportSize({ width: 1440, height: 900 })
  await p.goto(capture)
  await expect(p).toHaveURL(/\/signed-out\?from=/)
  await expect(p.getByRole('heading', { name: 'Sign in to Heed' })).toBeVisible()
  await p.reload()
  await p.getByRole('button', { name: 'Continue' }).click()
  await expect(p).toHaveURL(/\/library\/new\?/)
  await expect(linkField(p)).toHaveValue(page)
  await expect(quoteField(p)).toHaveValue(sentence)
})

test('the help says how to install the bookmarklet, and its button is one', async ({ page: p }) => {
  await openPage(p, '/library/new', { ...widths[0], theme: 'light' })
  await p.getByRole('button', { name: 'From any page' }).click()
  const popup = p.getByRole('dialog', { name: 'Add a source from any page' })
  await expect(popup).toContainText('Drag the button below to your bookmarks bar.')
  const bookmarklet = popup.locator('[data-slot="capture-bookmarklet"]')
  await expect(bookmarklet).toHaveAttribute('href', /^javascript:\(function\(\)\{/)
  // Clicked in Heed it does nothing: it is meant to be dragged.
  await bookmarklet.click()
  await expect(p).toHaveURL(/\/library\/new$/)
  expect(p.context().pages()).toHaveLength(1)
})

for (const size of widths) {
  for (const theme of themes) {
    test(`the install help at ${size.width} in ${theme} is accessible`, async ({ page: p }) => {
      await openPage(p, capture, { ...size, theme })
      await p.getByRole('button', { name: 'From any page' }).click()
      await expect(p.getByRole('dialog', { name: 'Add a source from any page' })).toBeVisible()
      await settle(p)
      const results = await new AxeBuilder({ page: p })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(results.violations.map((violation) => violation.id)).toEqual([])
    })
  }
}
