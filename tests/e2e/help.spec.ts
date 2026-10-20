import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { openPage, settle, themes, widths } from './support'

/*
  Help in context (docs/help/README.md, "Help in context"): on each screen where people stall, a
  help link in the words of their question opens a card with the few lines of the help page that
  answer it and Read the whole page; on a phone the card is a sheet. Every link below is opened
  as the person who sees the screen, with axe on the open card in both appearances, and the
  whole page at the heading it names. That every link's page and heading exist is the docs check
  (tests/unit/docs.test.ts).
*/

const [desktop, , phone] = widths
const ADMIN = 'per_ravi'
const OWNER = 'per_jon'
const REVIEW = '/proposals/00000000-0000-4000-8000-00000000005a'

type Place = {
  screen: string
  path: string
  /** The help link, by its words. */
  link: string
  /** Words of the card: its title, and a phrase of the page. */
  title: string
  words: string
  /** Where Read the whole page goes. */
  page: string
  person?: string
  scenario?: string
}

const places: Place[] = [
  {
    screen: 'Home',
    path: '/',
    link: 'What is Heed',
    title: 'What is Heed',
    words: "Heed is where your company writes down what the numbers don't show.",
    page: '/docs/what-is-heed',
  },
  {
    screen: 'Connect your AI',
    path: '/settings?section=connect',
    link: 'What is MCP?',
    title: 'What is an MCP, and how it all connects',
    words: 'MCP stands for Model Context Protocol.',
    page: '/docs/mcp',
  },
  {
    screen: 'Connect your AI, what it can do',
    path: '/settings?section=connect',
    link: 'What is a tool?',
    title: 'Tool',
    words: 'One thing an AI app can ask over MCP',
    page: '/docs/glossary#tool',
  },
  {
    screen: 'Connect your AI, what to do next',
    path: '/settings?section=connect',
    link: 'Step by step',
    title: 'Steps',
    words: 'Claude Code',
    page: '/docs/connect-your-ai-app#steps',
  },
  {
    screen: 'Connect your AI with no app connected',
    path: '/settings?section=connect',
    scenario: 'empty',
    link: 'How connecting works',
    title: 'Add to your AI app',
    words: 'Claude Code',
    page: '/docs/connect-your-ai-app',
  },
  {
    screen: 'Add context',
    path: '/library/new',
    link: 'How to add a fact',
    title: 'Add your first fact',
    words: 'write one fact and send it to the owner of its domain',
    page: '/docs/add-your-first-context',
  },
  {
    screen: 'Proposals, Mine, with none',
    path: '/proposals?view=mine',
    scenario: 'empty',
    link: 'How to add a fact',
    title: 'Add your first fact',
    words: 'write one fact and send it to the owner of its domain',
    page: '/docs/add-your-first-context',
  },
  {
    screen: 'Proposals, To review, with none',
    path: '/proposals',
    person: OWNER,
    scenario: 'empty',
    link: 'How to review a proposal',
    title: 'Review a proposal',
    words: 'decide on one proposal',
    page: '/docs/review-a-proposal',
  },
  {
    screen: 'the review page, checks',
    path: REVIEW,
    person: OWNER,
    link: "What's a check?",
    title: 'Check',
    words: 'A test we run on a proposal',
    page: '/docs/glossary#check',
  },
  {
    screen: 'the review page, test questions affected',
    path: REVIEW,
    person: OWNER,
    link: "What's a test question?",
    title: 'Test question',
    words: 'A question with a known right answer',
    page: '/docs/glossary#test-question',
  },
  {
    screen: 'Health, the numbers',
    path: '/health',
    person: OWNER,
    link: 'About these numbers',
    title: 'What the numbers mean',
    words: 'how many test questions get the facts they should',
    page: '/docs/read-health#what-the-numbers-mean',
  },
  {
    screen: 'Health, no clear change',
    path: '/health',
    person: OWNER,
    link: 'What this means',
    title: 'When a run says "No clear change"',
    words: 'the difference is too small to trust yet',
    page: '/docs/read-health#when-a-run-says-no-clear-change',
  },
  {
    screen: 'Editions, the live edition',
    path: '/editions',
    person: OWNER,
    link: 'What live means',
    title: 'What live means',
    words: 'The live edition is the one AI apps read now.',
    page: '/docs/editions#what-live-means',
  },
  {
    screen: 'Gaps, hidden counts',
    path: '/gaps',
    link: 'Why?',
    title: 'Why are some counts hidden?',
    words: 'A count below 5 could tell people who asked',
    page: '/docs/common-questions#why-are-some-counts-hidden',
  },
  {
    screen: 'Gaps with none',
    path: '/gaps',
    scenario: 'empty',
    link: 'What is a gap?',
    title: 'Gap',
    words: 'A question that AI apps or people asked and no fact could answer',
    page: '/docs/glossary#gap',
  },
  {
    screen: 'Administration, Domains',
    path: '/admin?section=domains',
    person: ADMIN,
    link: 'What is a domain?',
    title: 'Domain',
    words: 'A part of the business with its own data and people',
    page: '/docs/glossary#domain',
  },
  {
    screen: 'Administration, MCP and gateway',
    path: '/admin?section=gateway',
    person: ADMIN,
    link: 'What is an MCP?',
    title: 'What is an MCP, and how it all connects',
    words: 'MCP stands for Model Context Protocol.',
    page: '/docs/mcp',
  },
]

async function prepare(page: Page, { person, scenario }: Pick<Place, 'person' | 'scenario'>) {
  await page.addInitScript(
    // Each place's own person and data, also when one page opens several places.
    ({ person, scenario }) => {
      if (person) window.localStorage.setItem('cl.mock-person', person)
      else window.localStorage.removeItem('cl.mock-person')
      if (scenario) window.localStorage.setItem('cl.mock-scenario', scenario)
      else window.localStorage.removeItem('cl.mock-scenario')
    },
    { person, scenario },
  )
}

const helpLink = (scope: Page | Locator, words: string) =>
  scope.locator('[data-slot="help-link"]').filter({ hasText: words }).first()
const card = (page: Page) => page.locator('[data-slot="help-card"]')

const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(wcag).analyze()
  expect(
    results.violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`,
    ),
  ).toEqual([])
}

for (const place of places) {
  test(`${place.screen}: "${place.link}" opens its help, then the whole page`, async ({ page }) => {
    await prepare(page, place)
    await openPage(page, place.path, { ...desktop, theme: 'light' })
    const link = helpLink(page, place.link)
    await expect(link).toBeVisible({ timeout: 15_000 })
    await link.click()
    await expect(card(page)).toBeVisible()
    await expect(card(page).getByRole('heading', { name: place.title, exact: true })).toBeVisible()
    await expect(card(page)).toContainText(place.words)
    await expect(card(page)).toContainText(/\d+ min/)
    // Escape closes it, and the focus goes back to the link.
    await page.keyboard.press('Escape')
    await expect(card(page)).toBeHidden()
    await expect(link).toBeFocused()
    await link.press('Enter')
    await card(page).getByRole('link', { name: 'Read the whole page' }).click()
    await expect(page).toHaveURL((url) => `${url.pathname}${url.hash}` === place.page)
    await expect(page.locator('[data-docs]')).toBeVisible()
  })
}

for (const theme of themes) {
  for (const size of [desktop, phone]) {
    test(`an open help card passes axe at ${size.name}px, ${theme}`, async ({ page }) => {
      const shown = ['Connect your AI', 'Health, the numbers', 'Gaps with none']
      for (const place of places.filter((entry) => shown.includes(entry.screen))) {
        await prepare(page, place)
        await openPage(page, place.path, { ...size, theme })
        await helpLink(page, place.link).click()
        await expect(card(page)).toContainText(place.words)
        await settle(page)
        await expectNoViolations(page)
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        )
        expect(overflow, 'no sideways scroll of the page').toBeLessThanOrEqual(0)
        await page.keyboard.press('Escape')
      }
    })
  }
}

test('on a phone the help is a sheet with Help in its bar and a way to close it', async ({
  page,
}) => {
  await openPage(page, '/settings?section=connect', { ...phone, theme: 'light' })
  await helpLink(page, 'What is MCP?').click()
  // The sheet is named by its title; its bar says Help.
  const sheet = page.getByRole('dialog', { name: 'What is an MCP, and how it all connects' })
  await expect(sheet.getByRole('heading', { name: 'Help' })).toBeVisible()
  await expect(sheet).toContainText('MCP stands for Model Context Protocol.')
  const box = await sheet.boundingBox()
  expect(box?.width).toBe(phone.width)
  await sheet.getByRole('button', { name: 'Close options' }).click()
  await expect(sheet).toBeHidden()
})

test('Home says "New to Heed?" until the person hides it', async ({ page }) => {
  await openPage(page, '/', { ...desktop, theme: 'light' })
  const line = page.locator('[data-slot="home-new-to-heed"]')
  await expect(line).toHaveText('New to Heed? What is Heed')
  await line.getByRole('button', { name: 'Hide New to Heed' }).click()
  await expect(line).toHaveCount(0)
  await page.reload()
  await expect(page.locator('[data-slot="page"]')).toBeVisible()
  await expect(line).toHaveCount(0)
})

test('the delivery banner says what stopping does', async ({ page }) => {
  await prepare(page, { person: ADMIN })
  await openPage(page, '/editions', { ...desktop, theme: 'light' })
  await page
    .locator('[data-slot="live-edition"]')
    .getByRole('button', { name: 'More actions for this edition' })
    .click()
  await page.getByRole('menuitem', { name: 'Stop sharing…' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Stop sharing with AI apps?' })
  await dialog.getByRole('button', { name: 'Continue' }).click()
  await dialog.getByRole('textbox', { name: 'Why are you stopping it?' }).fill('A wrong caveat.')
  await dialog
    .getByRole('textbox', { name: 'Type Customer value to confirm' })
    .fill('Customer value')
  await dialog.getByRole('button', { name: 'Stop sharing' }).click()
  const done = page.getByRole('alertdialog', { name: 'Stopped for Customer value' })
  await done.getByRole('button', { name: 'Close' }).click()
  const banner = page.getByRole('region', { name: 'Sharing stopped' })
  await helpLink(banner, 'What stopping does').click()
  await expect(card(page).getByRole('heading', { name: 'The stop switch' })).toBeVisible()
  await expect(card(page)).toContainText("AI apps don't get what was stopped.")
  await settle(page)
  await expectNoViolations(page)
})
