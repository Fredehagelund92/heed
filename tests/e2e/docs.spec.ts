import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openPage, settle, themes, widths } from './support'

/*
  The Docs area (docs/help) in docs mode (contract 8.11): the app's sidebar folds to its rail and
  the docs' own sidebar opens beside it, with Back, a search field and every page in a
  tree under its section; below 1024 wide a bar under the header opens the same tree as a
  drawer. The docs home and its reading path, a section's own address, a concept, a guide and
  the glossary in their templates, links between pages and to a heading, the Docs group of the
  palette and Docs and help in the user menu, at every width and in both appearances, with axe.
  The docs home and one page are in the shared routes too, so the layout, phone and shell tests
  cover them.
*/

const desktop = { ...widths[0], theme: 'light' as const }
const tablet = { ...widths[1], theme: 'light' as const }
const phone = { ...widths[2], theme: 'light' as const }
const appSidebar = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' })
const docsNav = (page: Page) => page.getByRole('navigation', { name: 'Docs', exact: true })
const tree = (page: Page) => page.getByRole('tree', { name: 'Docs pages' })
const trail = (page: Page) => page.getByRole('navigation', { name: 'Breadcrumb' })
const sidebarState = (page: Page) =>
  page.locator('[data-slot="sidebar"]').first().getAttribute('data-state')

// The sections of the tree, in order, and their pages' titles there.
const sections = [
  { name: 'Start here', pages: ['What is Heed', 'What is an MCP', 'A five-minute tour'] },
  { name: 'Concepts', pages: ['Editions and the stop switch', 'The assistant'] },
  {
    name: 'Guides',
    pages: [
      'Add your first fact',
      'Review a proposal',
      'Read Health',
      'Tell Heed about your business',
      'Add a connector',
    ],
  },
  { name: 'Connecting AI apps', pages: ['Add to your AI app'] },
  { name: 'Reference', pages: ['Glossary'] },
  { name: 'Questions', pages: ['Common questions'] },
] as const

const pages = [
  { name: 'docs home', path: '/docs' },
  { name: 'docs section', path: '/docs?section=guides' },
  { name: 'concept', path: '/docs/what-is-heed' },
  { name: 'guide', path: '/docs/add-your-first-context' },
  { name: 'tour', path: '/docs/tour' },
  { name: 'glossary', path: '/docs/glossary' },
  { name: 'common questions', path: '/docs/common-questions' },
  { name: 'page not found', path: '/docs/no-such-page' },
] as const

const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

for (const size of widths) {
  for (const theme of themes) {
    test.describe(`docs at ${size.name}px, ${theme}`, () => {
      for (const target of pages) {
        test(`${target.name} passes axe and stays within the width`, async ({ page }) => {
          await openPage(page, target.path, { ...size, theme })
          await settle(page)
          const results = await new AxeBuilder({ page }).withTags(wcag).analyze()
          expect(
            results.violations.map(
              (violation) =>
                `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`,
            ),
          ).toEqual([])
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          )
          expect(overflow, 'no sideways scroll of the page').toBeLessThanOrEqual(0)
        })
      }
    })
  }
}

test.describe('docs mode', () => {
  test('Docs folds the app sidebar to its rail and opens the docs sidebar; Back returns', async ({
    page,
  }) => {
    await openPage(page, '/library', desktop)
    expect(await sidebarState(page)).toBe('expanded')
    await expect(docsNav(page)).toHaveCount(0)
    await appSidebar(page).getByRole('link', { name: 'Docs', exact: true }).click()
    await expect(page).toHaveURL(/\/docs$/)
    await expect(page).toHaveTitle('Docs - Heed')
    await expect.poll(() => sidebarState(page)).toBe('collapsed')
    // Docs stays picked out in the rail; the docs' sidebar has the rest.
    await expect(appSidebar(page).getByRole('link', { name: 'Docs', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(docsNav(page)).toBeVisible()
    await expect(docsNav(page).getByRole('searchbox', { name: 'Search the docs' })).toBeVisible()
    await expect(tree(page).getByRole('treeitem', { expanded: true })).toHaveCount(sections.length)
    await expect(tree(page).locator('[data-slot="tree-row"]')).toHaveText(
      sections.map((section) => section.name),
    )
    await expect(tree(page).locator('a[role="treeitem"]')).toHaveText(
      sections.flatMap((section) => section.pages),
    )
    await expect(docsNav(page)).not.toContainText('checked')
    // The docs sidebar sits between the rail and the page, the full height of the window.
    await settle(page)
    const nav = await docsNav(page).boundingBox()
    const inset = await page.locator('[data-slot="sidebar-inset"]').boundingBox()
    expect(nav?.x).toBe(48)
    expect(nav?.height).toBe(900)
    expect((nav?.x ?? 0) + (nav?.width ?? 0)).toBe(inset?.x)

    await docsNav(page).getByRole('link', { name: 'Back' }).click()
    await expect(page).toHaveURL(/\/library$/)
    await expect(docsNav(page)).toHaveCount(0)
    await expect.poll(() => sidebarState(page)).toBe('expanded')
  })

  test('Back goes Home when the docs were opened first', async ({ page }) => {
    await openPage(page, '/docs/mcp', desktop)
    await docsNav(page).getByRole('link', { name: 'Back' }).click()
    await expect(page).toHaveURL(/\/$/)
  })

  test('the tree picks out the page open, and its sections open and close', async ({ page }) => {
    await openPage(page, '/docs/editions', desktop)
    const current = tree(page).locator('[aria-current="page"]')
    await expect(current).toHaveCount(1)
    await expect(current).toHaveText('Editions and the stop switch')
    const guides = tree(page).getByRole('treeitem', { name: 'Guides' })
    await guides.locator('[data-slot="tree-row"]').click()
    await expect(guides).toHaveAttribute('aria-expanded', 'false')
    await expect(tree(page).getByRole('treeitem', { name: 'Read Health' })).toHaveCount(0)
    await guides.locator('[data-slot="tree-row"]').click()
    await expect(guides).toHaveAttribute('aria-expanded', 'true')
    await tree(page).getByRole('treeitem', { name: 'Read Health' }).click()
    await expect(page).toHaveURL(/\/docs\/read-health$/)
    await expect(tree(page).locator('[aria-current="page"]')).toHaveText('Read Health')
    // A page opened in a closed section opens it.
    await tree(page)
      .getByRole('treeitem', { name: 'Reference' })
      .locator('[data-slot="tree-row"]')
      .click()
    await page.goto('/docs/glossary')
    await expect(tree(page).locator('[aria-current="page"]')).toHaveText('Glossary')
  })

  test('the tree is one tab stop, moved and opened with the arrow keys and Enter', async ({
    page,
  }) => {
    await openPage(page, '/docs/mcp', desktop)
    const mcp = tree(page).getByRole('treeitem', { name: 'What is an MCP' })
    await expect(tree(page).locator('[tabindex="0"]')).toHaveCount(1)
    await expect(mcp).toHaveAttribute('tabindex', '0')
    await docsNav(page).getByRole('searchbox', { name: 'Search the docs' }).focus()
    await page.keyboard.press('Tab')
    await expect(mcp).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(tree(page).getByRole('treeitem', { name: 'A five-minute tour' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    const concepts = tree(page).getByRole('treeitem', { name: 'Concepts' })
    await expect(concepts).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(concepts).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('ArrowDown')
    await expect(tree(page).getByRole('treeitem', { name: 'Guides' })).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter')
    await expect(concepts).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('ArrowRight')
    const editions = tree(page).getByRole('treeitem', { name: 'Editions and the stop switch' })
    await expect(editions).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(concepts).toBeFocused()
    await page.keyboard.press('End')
    await expect(tree(page).getByRole('treeitem', { name: 'Common questions' })).toBeFocused()
    await page.keyboard.press('Home')
    await expect(tree(page).getByRole('treeitem', { name: 'Start here' })).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/docs\/what-is-heed$/)
    // The arrows moved focus only: the page did not scroll, and Escape did not leave the page.
    await expect(tree(page).locator('[aria-current="page"]')).toHaveText('What is Heed')
  })

  test('the docs sidebar searches every page and opens a match', async ({ page }) => {
    await openPage(page, '/docs/mcp', desktop)
    const field = docsNav(page).getByRole('searchbox', { name: 'Search the docs' })
    await field.fill('qqqq')
    const results = docsNav(page).getByRole('region', { name: 'Search results' })
    await expect(results.getByRole('status')).toHaveText(/No page matches “qqqq”/)
    await expect(tree(page)).toHaveCount(0)
    // Escape empties the field and stays on the page.
    await page.keyboard.press('Escape')
    await expect(field).toHaveValue('')
    await expect(page).toHaveURL(/\/docs\/mcp$/)
    await expect(tree(page)).toBeVisible()
    await field.fill('stop switch')
    await results
      .getByRole('link', { name: /Editions and the stop switch/ })
      .first()
      .click()
    await expect(page).toHaveURL(/\/docs\/editions(#.*)?$/)
    await expect(field).toHaveValue('')
    await expect(tree(page).locator('[aria-current="page"]')).toHaveText(
      'Editions and the stop switch',
    )
  })

  test('at 1024 the docs sidebar stays, and On this page folds under the title', async ({
    page,
  }) => {
    await openPage(page, '/docs/mcp', tablet)
    await expect(docsNav(page)).toBeVisible()
    await expect(page.locator('[data-slot="docs-pages-bar"]')).toBeHidden()
    const outline = page.locator('[data-slot="doc-outline"]')
    await expect(outline).toBeVisible()
    await expect(outline).toContainText('7 sections')
    await outline.getByText('On this page').click()
    await outline.getByRole('link', { name: 'Which model does what' }).click()
    await expect(page).toHaveURL(/\/docs\/mcp#which-model-does-what$/)
    await expect(page.getByRole('heading', { name: 'Which model does what' })).toBeInViewport()
  })

  test('on a phone, Pages opens the tree as a drawer with Docs and Back', async ({ page }) => {
    await openPage(page, '/docs/mcp', phone)
    await expect(docsNav(page)).toBeHidden()
    const bar = page.locator('[data-slot="docs-pages-bar"]')
    await expect(bar).toContainText('Start here / What is an MCP')
    await bar.getByRole('button', { name: 'Pages' }).click()
    const drawer = page.getByRole('dialog', { name: 'Docs' })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('link', { name: 'Back' })).toBeVisible()
    // It opens at the page open.
    await expect(drawer.getByRole('treeitem', { name: 'What is an MCP' })).toBeFocused()
    await settle(page)
    const results = await new AxeBuilder({ page }).withTags(wcag).analyze()
    expect(results.violations.map((violation) => violation.id)).toEqual([])
    const box = await drawer.getByRole('treeitem', { name: 'Read Health' }).boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(44)
    await drawer.getByRole('treeitem', { name: 'Read Health' }).click()
    await expect(page).toHaveURL(/\/docs\/read-health$/)
    await expect(drawer).toBeHidden()
    await expect(bar).toContainText('Guides / Read Health')
    // Search opens the drawer at its field.
    await bar.getByRole('button', { name: 'Search the docs' }).click()
    await expect(drawer.getByRole('searchbox', { name: 'Search the docs' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    // The way back to the app.
    await bar.getByRole('button', { name: 'Pages' }).click()
    await drawer.getByRole('link', { name: 'Back' }).click()
    await expect(page).toHaveURL(/\/$/)
  })

  test('on a phone, the page keeps On this page under its title', async ({ page }) => {
    await openPage(page, '/docs/mcp', phone)
    const outline = page.locator('[data-slot="doc-outline"]')
    await outline.getByText('On this page').click()
    await expect(outline.getByRole('link', { name: 'Which model does what' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Edit this page on GitHub' })).toBeAttached()
  })
})

test.describe('the Docs area', () => {
  test('the home starts with a reading path, then the loop and the pages to look things up in', async ({
    page,
  }) => {
    await openPage(page, '/docs', desktop)
    const path = page.locator('[data-slot="docs-start-path"] > li')
    await expect(path).toHaveCount(3)
    await expect(path.getByRole('link')).toHaveText([
      'What is Heed',
      'What is an MCP, and how it all connects',
      'A five-minute tour: Norway, from gap to answer',
    ])
    await expect(page.getByRole('heading', { name: 'Start here, in this order' })).toBeVisible()
    await expect(page.getByText('13 min in all')).toBeVisible()
    await expect(page.getByRole('img', { name: /^The loop/ })).toBeVisible()
    const steps = page.locator('[data-slot="docs-loop-steps"] > li')
    await expect(steps).toHaveCount(5)
    await steps.nth(1).getByRole('link', { name: 'Review a proposal' }).click()
    await expect(page).toHaveURL(/\/docs\/review-a-proposal$/)
    // No cards and no kind badges on the home.
    await openPage(page, '/docs', desktop)
    await expect(page.locator('[data-slot="doc-card"], main [data-slot="badge"]')).toHaveCount(0)
    // Every page is linked from the home.
    for (const title of sections.flatMap((section) => section.pages))
      await expect(
        page
          .locator('main')
          .getByRole('link', { name: new RegExp(`^${title}`) })
          .first(),
      ).toBeVisible()
  })

  test('on a phone the home keeps the steps and leaves out the loop picture', async ({ page }) => {
    await openPage(page, '/docs', phone)
    await expect(page.getByRole('img', { name: /^The loop/ })).toBeHidden()
    await expect(page.locator('[data-slot="docs-loop-steps"] > li')).toHaveCount(5)
  })

  test("a section's own address lists its pages, with its crumb, in docs mode", async ({
    page,
  }) => {
    await openPage(page, '/docs/editions', desktop)
    await expect(trail(page)).toHaveText('DocsConcepts')
    await openPage(page, '/docs?section=concepts', desktop)
    await expect(page).toHaveTitle('Concepts - Docs - Heed')
    await expect(trail(page)).toHaveText('DocsConcepts')
    const region = page.getByRole('region', { name: 'Concepts' })
    await expect(region.getByRole('link')).toHaveText([
      'Editions and the stop switch',
      'The assistant',
    ])
    await expect(docsNav(page)).toBeVisible()
    await trail(page).getByRole('link', { name: 'Docs' }).click()
    await expect(page).toHaveURL(/\/docs$/)
  })

  test('no section shares its name with another place in the sidebar, palette or trail', async ({
    page,
  }) => {
    // The person's own Connect an AI app is where they connect; the docs explain it, by other names.
    await openPage(page, '/docs/connect-your-ai-app', desktop)
    await expect(trail(page)).toHaveText('DocsConnecting AI apps')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Add to your AI app')
    await page.locator('main').getByRole('link', { name: 'Connect an AI app', exact: true }).click()
    await expect(page).toHaveURL(/\/settings\?section=connect$/)
    await expect(trail(page)).toHaveText('SettingsConnect an AI app')
    await page.keyboard.press('Control+k')
    await page.getByRole('combobox', { name: 'Search facts, pages and actions' }).fill('connect')
    const dialog = page.getByRole('dialog', { name: 'Command palette' })
    // The page is the one place of that name; the guide is under its own. The glossary names the
    // place, as it names every place, and no docs page or section takes the name.
    const named = (group: string) =>
      dialog.getByRole('group', { name: group }).getByRole('option', { name: /^Connect an AI app/ })
    await expect(named('Go to')).toHaveCount(1)
    await expect(named('Docs')).toHaveCount(1)
    await expect(named('Docs')).toContainText('Glossary')
    await expect(dialog.getByRole('group', { name: 'Go to' })).toContainText('Connect an AI app')
    await expect(dialog.getByRole('group', { name: 'Docs' })).toContainText('Add to your AI app')
  })

  test('a concept opens with its meta line, its answer in one minute, its pictures and its outline', async ({
    page,
  }) => {
    await openPage(page, '/docs', desktop)
    await page
      .locator('main')
      .getByRole('link', { name: 'What is an MCP, and how it all connects' })
      .click()
    await expect(page).toHaveURL(/\/docs\/mcp$/)
    await expect(page).toHaveTitle('What is an MCP, and how it all connects - Docs - Heed')
    await expect(
      page.getByRole('heading', { name: 'What is an MCP, and how it all connects', level: 1 }),
    ).toBeVisible()
    await expect(page.locator('[data-slot="doc-meta"]')).toHaveText(
      'Concept·5 min read·For everyone',
    )
    // The trail ends with the page's section, and the tree picks out the page.
    await expect(trail(page)).toContainText('Start here')
    await expect(tree(page).locator('[aria-current="page"]')).toHaveText('What is an MCP')
    const minute = page.getByRole('region', { name: 'In one minute' })
    await expect(minute).toContainText('MCP stands for Model Context Protocol.')
    // Each picture is drawn inline with its alt text as its name.
    await expect(page.getByRole('img', { name: /^The plug: AI apps/ })).toBeVisible()
    await expect(page.getByRole('img', { name: /^One question, five steps/ })).toBeAttached()
    // On this page sits beside the page and opens a section at its heading.
    await expect(page.locator('[data-slot="doc-outline"]')).toBeHidden()
    const outline = page.getByRole('complementary', { name: 'About this page' })
    await outline.getByRole('link', { name: 'Which model does what' }).click()
    await expect(page).toHaveURL(/\/docs\/mcp#which-model-does-what$/)
    await expect(page.getByRole('heading', { name: 'Which model does what' })).toBeInViewport()
    await expect(outline.getByRole('link', { name: 'Which model does what' })).toHaveAttribute(
      'aria-current',
      'location',
    )
  })

  test('a link to another page opens it in the app, at the heading it names', async ({ page }) => {
    await openPage(page, '/docs/editions', desktop)
    await page.locator('main').getByRole('link', { name: 'Glossary', exact: true }).first().click()
    await expect(page).toHaveURL(/\/docs\/glossary#edition$/)
    await expect(page.getByRole('heading', { name: 'Edition', exact: true })).toBeInViewport()
    // The pager goes on in the docs' order.
    await openPage(page, '/docs/what-is-heed', desktop)
    await page.getByRole('navigation', { name: 'More pages' }).getByRole('link').click()
    await expect(page).toHaveURL(/\/docs\/mcp$/)
  })

  test('a guide shows its steps in the app words', async ({ page }) => {
    await openPage(page, '/docs/add-your-first-context', desktop)
    await expect(page.getByRole('heading', { name: 'Steps', level: 2 })).toBeVisible()
    const steps = page.locator('[data-slot="doc-body"] ol').first()
    await expect(steps.locator(':scope > li')).toHaveCount(11)
    await expect(steps.locator('strong', { hasText: 'Send for review' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'In one minute' })).toHaveCount(0)
  })

  test('an unknown page says so and leads to the docs home', async ({ page }) => {
    await openPage(page, '/docs/no-such-page', desktop)
    await expect(page.getByText('There is no page “no-such-page” in the docs')).toBeVisible()
    await page.getByRole('link', { name: 'Go to the docs home' }).click()
    await expect(page).toHaveURL(/\/docs$/)
  })

  test('the palette has a Docs group that opens a page or a glossary term in docs mode', async ({
    page,
  }) => {
    await openPage(page, '/', desktop)
    const dialog = page.getByRole('dialog', { name: 'Command palette' })
    await page.keyboard.press('Control+k')
    await page
      .getByRole('combobox', { name: 'Search facts, pages and actions' })
      .fill('what is an mcp')
    const docs = dialog.getByRole('group', { name: 'Docs' })
    await expect(docs.getByRole('option').first()).toContainText(
      'What is an MCP, and how it all connects',
    )
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/docs\/mcp$/)
    await expect(docsNav(page)).toBeVisible()

    await page.keyboard.press('Control+k')
    await page
      .getByRole('combobox', { name: 'Search facts, pages and actions' })
      .fill('re-check due')
    await dialog
      .getByRole('group', { name: 'Docs' })
      .getByRole('option', { name: /^Re-check due/ })
      .click()
    await expect(page).toHaveURL(/\/docs\/glossary#re-check-due$/)
    await expect(page.getByRole('heading', { name: 'Re-check due', exact: true })).toBeInViewport()
  })

  test('G then B opens docs mode, and so does Docs and help in the user menu', async ({ page }) => {
    await openPage(page, '/library', desktop)
    await page.keyboard.press('g')
    await page.keyboard.press('b')
    await expect(page).toHaveURL(/\/docs$/)
    await expect(docsNav(page)).toBeVisible()
    await openPage(page, '/', desktop)
    await appSidebar(page)
      .getByRole('button', { name: /Maria Lindqvist/ })
      .click()
    await page.getByRole('menuitem', { name: /Docs and help/ }).click()
    await expect(page).toHaveURL(/\/docs$/)
    await expect(docsNav(page)).toBeVisible()
  })

  test('Skip to content passes both sidebars', async ({ page }) => {
    await openPage(page, '/docs/mcp', desktop)
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Skip to content' })
    await expect(skip).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#main')).toBeFocused()
  })
})
