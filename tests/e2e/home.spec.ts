import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { ASK_MATCH, askAndWait, chipEditor } from './ask-support'
import { proposalTitles } from './proposals-support'
import { openPage, settle, themes, widths } from './support'

/*
  Home (Home P): one page for every person. The title and, on the first visit only, one sentence;
  one plain search field whose list offers facts first, then "Ask the assistant" and "Try it"
  (the assistant's only way in on Home: the launcher in the corner is the shell's); three quick
  actions; one table with three text tabs; the empty states; the phone; axe in both
  appearances with the list open. The one part that is the person's own is Your drafts, only
  while they have a draft they have not submitted.
*/

const desktop = { ...widths[0], theme: 'light' as const }
const phone = { ...widths[2], theme: 'light' as const }

const field = (page: Page) =>
  page.getByRole('combobox', { name: 'Search the library, or ask a question' })
const welcome = (page: Page) => page.locator('[data-slot="home-welcome"]')

async function returning(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('cl.home.seen', 'true'))
}

async function scenario(page: Page, name: string) {
  await page.addInitScript((value) => window.localStorage.setItem('cl.mock-scenario', value), name)
}

const launcher = (page: Page) => page.getByRole('button', { name: 'Assistant', exact: true })
const assistant = (page: Page) =>
  page.getByRole((page.viewportSize()?.width ?? 1440) < 768 ? 'dialog' : 'region', {
    name: 'Assistant',
  })
const answer = (page: Page) => assistant(page).getByRole('article', { name: 'Answer' }).last()

/** The assistant shows one chat: the question asked, alone, and its whole answer. */
async function expectAsked(page: Page, question: string) {
  const questions = assistant(page).locator('[data-slot="ask-question"]')
  await expect(questions).toHaveCount(1, { timeout: 15_000 })
  await expect(questions).toContainText(question)
  await expect(answer(page)).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
  await expect(assistant(page).getByRole('article', { name: 'Answer' })).toHaveCount(1)
}

async function homeReady(page: Page) {
  await expect(page.locator('[data-slot="home-grid"]').first()).toBeVisible({ timeout: 15_000 })
}

test.describe('first visit and returning', () => {
  test('the first visit adds one sentence under the title, and the next visit does not', async ({
    page,
  }) => {
    await openPage(page, '/', desktop)
    await homeReady(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Home')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(welcome(page)).toHaveText(
      'Find what your colleagues already know about the numbers.',
    )
    await expect(page).toHaveTitle('Home - Heed')
    await page.reload()
    await homeReady(page)
    await expect(welcome(page)).toHaveCount(0)
  })

  test('a returning visit shows the field, three quick actions in a row and Recently changed', async ({
    page,
  }) => {
    await returning(page)
    await openPage(page, '/', desktop)
    await homeReady(page)
    await expect(welcome(page)).toHaveCount(0)
    await expect(field(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('[data-slot="quick-action"]')).toHaveText([
      /Try a question/,
      /Add a fact/,
      /Connect an AI app/,
    ])
    const tops = await page
      .locator('[data-slot="quick-action"]')
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top))
    expect(new Set(tops).size).toBe(1)
    const tabs = page.locator('[data-slot="home-table"]').getByRole('tab')
    await expect(tabs).toHaveText(['Recently changed', /^Known issues\d+$/, /^Topics\d+$/])
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
    const grid = page.getByRole('table', { name: 'Recently changed' })
    await expect(grid.getByRole('row')).toHaveCount(9)
    // Nothing on Home names an edition: a business person never sees one.
    await expect(page.locator('main')).not.toContainText(/edition|\d{4}-\d{2}-\d{2}\.\d+/i)
  })

  test('the same Home for an owner and an administrator: no role strip, no counts', async ({
    page,
  }) => {
    const texts: string[] = []
    for (const person of ['per_maria', 'per_jon', 'per_ravi']) {
      await page.addInitScript((value) => {
        window.localStorage.setItem('cl.mock-person', value)
        window.localStorage.setItem('cl.home.seen', 'true')
      }, person)
      await openPage(page, '/', desktop)
      await homeReady(page)
      // Your drafts is each person's own (Maria and Jon have one, Ravi none), not their role's.
      texts.push(
        await page.locator('[data-slot="page"]').evaluate((element: HTMLElement) => {
          const drafts = element.querySelector<HTMLElement>('[data-slot="home-drafts"]')
          if (drafts) drafts.hidden = true
          return element.innerText
        }),
      )
    }
    expect(texts[1]).toBe(texts[0])
    expect(texts[2]).toBe(texts[0])
    expect(texts[0]).not.toMatch(/Quality|Editions|Areas|To review/)
  })

  test('the tabs keep their place in the address', async ({ page }) => {
    await returning(page)
    await openPage(page, '/', desktop)
    await homeReady(page)
    await page.getByRole('tab', { name: /Known issues/ }).click()
    await expect(page).toHaveURL(/\?tab=issues$/)
    const issues = page.getByRole('table', { name: 'Known issues' })
    await expect(issues.getByRole('row').nth(1)).toContainText(/in \d+ days?|Today|Ongoing/)
    await page.getByRole('tab', { name: /Topics/ }).click()
    await expect(page).toHaveURL(/\?tab=topics$/)
    const topics = page.getByRole('table', { name: 'Topics' })
    await expect(topics.getByRole('rowheader').first()).toBeVisible()
    await topics.getByRole('link', { name: 'Orders' }).click()
    await expect(page).toHaveURL(/\/catalogue\/metric\/orders$/)
    await page.goBack()
    await expect(page.getByRole('tab', { name: /Topics/ })).toHaveAttribute('aria-selected', 'true')
  })

  test('a row opens its fact, and Connect an AI app goes to its page', async ({ page }) => {
    await returning(page)
    await openPage(page, '/', desktop)
    await homeReady(page)
    const first = page.getByRole('table', { name: 'Recently changed' }).getByRole('link').first()
    const title = await first.innerText()
    await first.click()
    await expect(page).toHaveURL(/\/library\/itm_/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
    await page.goBack()
    await page.getByRole('link', { name: /Connect an AI app/ }).click()
    await expect(page).toHaveURL(/\/settings\?section=connect$/)
  })
})

test.describe('your drafts', () => {
  const strip = (page: Page) => page.getByRole('region', { name: /Your drafts/ })
  const rows = (page: Page) =>
    page.getByRole('list', { name: 'Your drafts, not sent yet' }).getByRole('link')

  test('lists the draft she has not submitted, and a click opens it to finish and submit', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-10-08T09:41:00Z'))
    await returning(page)
    await openPage(page, '/', desktop)
    await homeReady(page)
    // Under the search field, above last week's numbers.
    const top = async (locator: ReturnType<Page['locator']>) => (await locator.boundingBox())!.y
    const drafts = await top(page.locator('[data-slot="home-drafts"]'))
    expect(await top(field(page))).toBeLessThan(drafts)
    expect(drafts).toBeLessThan(await top(page.locator('[data-slot="home-pulse"]')))
    await expect(strip(page).getByRole('heading', { level: 2 })).toHaveText(/Your drafts\s*1/)
    await expect(rows(page)).toHaveCount(1)
    const row = rows(page).first()
    await expect(row).toContainText(proposalTitles.draft)
    await expect(row.locator('[data-slot="domain-badge"]')).toHaveCount(1)
    await expect(row.locator('[data-slot="home-draft-mark"]')).toHaveText('Draft')
    await expect(row.locator('time')).toHaveText(/ago$|^Yesterday$|^Just now$/)
    await expect(row.locator('time')).toHaveAttribute('title', /^Last edited .* UTC$/)

    await row.click()
    await expect(page).toHaveURL(/\/library\/new\?draft=[a-f0-9-]+$/)
    await expect(page.getByRole('textbox', { name: 'Summary', exact: true })).toContainText(
      'Discount cost in Spain',
    )
    // She finishes it: the source it still lacks, then Send for review.
    await page
      .getByRole('textbox', { name: 'Link to the source', exact: true })
      .fill('https://discount.example/october-campaign')
    await page
      .getByRole('textbox', { name: 'A sentence copied from the source', exact: true })
      .fill('The welcome campaign runs once, in October.')
    await page.getByRole('textbox', { name: 'Date you read it', exact: true }).fill('5 Oct 2026')
    await page.getByRole('textbox', { name: 'Date you read it', exact: true }).press('Tab')
    await page
      .getByRole('button', { name: 'Send for review', exact: true })
      .filter({ visible: true })
      .click()
    await expect(page).toHaveURL(/\/proposals\/[a-f0-9-]+$/)
    await expect(page.locator('[data-slot="proposal-badges"]')).toContainText('Waiting for review')

    // Sent, it is no longer a draft: Home no longer lists it, and the strip is gone.
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Home' })
      .click()
    await homeReady(page)
    await expect(page.locator('[data-slot="home-drafts"]')).toHaveCount(0)
  })

  test('no strip at all for someone with no draft', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('cl.mock-person', 'per_ravi'))
    await returning(page)
    await openPage(page, '/', desktop)
    await homeReady(page)
    await expect(page.locator('[data-slot="home-pulse"]')).toBeVisible()
    await expect(page.locator('[data-slot="home-drafts"]')).toHaveCount(0)
    await expect(page.locator('[data-slot="sidebar-drafts"]')).toHaveCount(0)
  })

  test('a draft the assistant saves shows at once, and Home, Mine and the library agree', async ({
    page,
  }) => {
    await returning(page)
    await openPage(page, '/', desktop)
    await homeReady(page)
    await expect(rows(page)).toHaveCount(1)
    // The assistant saves a draft for Maria (the same service step its confirm card takes).
    await page.evaluate(() =>
      (
        window as unknown as {
          heedMock: { as: (id: string) => { createProposal: (input: unknown) => unknown } }
        }
      ).heedMock
        .as('per_maria')
        .createProposal({
          channel: 'assistant',
          draft: {
            kind: 'note',
            summaryMarkup: 'Units sold in Italy lags a day behind the source tool.',
            areaId: 'area_sales',
          },
        }),
    )
    await expect(rows(page)).toHaveCount(2)
    await expect(rows(page).first()).toContainText('Units sold in Italy lags a day')
    await expect(strip(page).getByRole('heading', { level: 2 })).toHaveText(/Your drafts\s*2/)
    const sidebar = page.locator('[data-slot="sidebar-drafts"]')
    await expect(sidebar).toHaveText(/Drafts\s*2/)

    await strip(page).getByRole('link', { name: 'All drafts' }).click()
    await expect(page).toHaveURL(/\/proposals\?view=mine&state=draft$/)
    await expect(sidebar).toHaveAttribute('aria-current', 'page')
    const table = page.getByRole('table', { name: 'Your proposals' })
    await expect(table.getByRole('rowheader')).toHaveText([/Draft, not sent\s*2/])

    // The library's View menu leads to the same list.
    // (Inside the app: a reload would start the mock world again.)
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'All facts' })
      .click()
    await page.getByRole('button', { name: /^View:/ }).click()
    await page.getByRole('menuitem', { name: /Drafts\s*2/ }).click()
    await expect(page).toHaveURL(/\/proposals\?view=mine&state=draft$/)
    await expect(table.getByRole('rowheader')).toHaveText([/Draft, not sent\s*2/])
  })

  test('the arrows move between the drafts', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('cl.mock-person', 'per_jon'))
    await returning(page)
    await openPage(page, '/', desktop)
    await homeReady(page)
    await rows(page).first().focus()
    await page.keyboard.press('ArrowDown')
    await expect(rows(page).first()).toBeFocused()
  })

  /*
    The geometry of the rows (contract 8.13): each part of the meta has one column for every row,
    so however long the title or the domain's name, the domain and the Draft mark start at the
    same place on every row, and the ages end together beside the title or start together under
    it. Nothing overlaps the title, and nothing passes the row's menu, at any width.
  */
  const seeded = [
    { summaryMarkup: 'Hold.', areaId: 'area_sandbox' },
    {
      summaryMarkup:
        'Italy churn counts the accounts merged in May twice over the whole quarter, and the definition table says nothing about it, so every report from that period overstates churn.',
      areaId: 'area_customer_value',
    },
    { summaryMarkup: 'Paid media spend for October is booked late.', areaId: 'area_paid_media' },
    { summaryMarkup: 'GMV is net of discounts.', areaId: 'area_sales' },
  ]
  const sizes = [
    { width: 1440, height: 900, place: 'beside' },
    { width: 1024, height: 768, place: 'beside' },
    { width: 768, height: 900, place: 'under' },
    { width: 390, height: 844, place: 'wrapping' },
  ] as const
  for (const { place, ...size } of sizes) {
    test(`the domain, the mark and the age line up from row to row, ${size.width}`, async ({
      page,
    }) => {
      await returning(page)
      await openPage(page, '/', { ...size, theme: 'light' })
      await homeReady(page)
      await expect(rows(page)).toHaveCount(1)
      await page.evaluate(
        (drafts) =>
          drafts.forEach((draft) =>
            (
              window as unknown as {
                heedMock: { as: (id: string) => { createProposal: (input: unknown) => unknown } }
              }
            ).heedMock
              .as('per_maria')
              .createProposal({ channel: 'assistant', draft: { kind: 'note', ...draft } }),
          ),
        seeded,
      )
      await expect(rows(page)).toHaveCount(5)
      const boxes = await page.evaluate(() =>
        [...document.querySelectorAll('[data-slot="home-draft"]')].map((row) => {
          const box = (selector: string) => {
            const { left, right, top, bottom } = row
              .querySelector(selector)!
              .getBoundingClientRect()
            return { left: Math.round(left), right: Math.round(right), top, bottom }
          }
          const menu = row.parentElement!.querySelector('button')!.getBoundingClientRect()
          return {
            title: box('[data-slot="home-draft-title"]'),
            parts: [box('[data-slot="domain-badge"]'), box('[data-slot="home-draft-mark"]')],
            age: box('time'),
            menu: Math.round(menu.left),
          }
        }),
      )
      const one = (values: number[]) => expect(new Set(values).size).toBe(1)
      if (place !== 'wrapping') {
        one(boxes.map((row) => row.parts[0]!.left))
        one(boxes.map((row) => row.parts[1]!.left))
        one(boxes.map((row) => (place === 'beside' ? row.age.right : row.age.left)))
      }
      if (place === 'under') one(boxes.map((row) => row.parts[0]!.left - row.title.left))
      for (const row of boxes) {
        for (const part of [...row.parts, row.age]) {
          const meets =
            part.left < row.title.right &&
            row.title.left < part.right &&
            part.top < row.title.bottom &&
            row.title.top < part.bottom
          expect(meets).toBe(false)
          expect(part.right).toBeLessThanOrEqual(row.menu)
        }
      }
    })
  }
})

test.describe('the pulse strip', () => {
  const tiles = (page: Page) => page.locator('[data-slot="pulse-tile"]')
  const tile = (page: Page, name: string) => tiles(page).filter({ hasText: name })
  const inState = (page: Page, state: string) =>
    page.locator(`[data-slot="pulse-tile"][data-state="${state}"]`)

  test('last week in four tiles side by side, each a number, a chart and its words', async ({
    page,
  }) => {
    await returning(page)
    await openPage(page, '/', desktop)
    await homeReady(page)
    await expect(page.getByRole('heading', { name: 'Last week' })).toBeVisible()
    // The fixture day is Wednesday 7 October 2026, so last week ran from 28 September.
    await expect(page.locator('[data-slot="home-pulse"]')).toContainText('28 Sept to 4 Oct')
    await expect(tiles(page)).toHaveCount(4)
    await expect(inState(page, 'ready')).toHaveCount(4)
    // 109 calls, 105 in shown topic weeks: the exact total would give a topic week of four away,
    // so the tile says how many at least, and the share answered is hidden with it.
    await expect(tile(page, 'Questions from AI apps')).toContainText('105+')
    await expect(tile(page, 'Questions from AI apps')).toContainText(
      'At least 105. A few more stay hidden.',
    )
    await expect(tile(page, 'Questions that found a fact')).toContainText('Hidden')
    await expect(tile(page, 'Questions that found a fact')).toContainText('We hide counts under 5')
    await expect(tile(page, 'Facts that are current')).toContainText(
      /[\d,]+ of [\d,]+ need checking/,
    )
    await expect(page.locator('[data-slot="pulse-chart"]')).toHaveCount(4)
    // The change on the week before: none where last week's count is hidden; a muted size for
    // the facts changed, which have no better way; the share current against a week ago.
    const mark = (name: string) => tile(page, name).locator('[data-slot="change-mark"]')
    await expect(mark('Questions from AI apps')).toHaveCount(0)
    await expect(mark('Questions that found a fact')).toHaveCount(0)
    await expect(mark('Facts added or changed')).toHaveAttribute('data-verdict', 'none')
    await expect(mark('Facts added or changed')).toContainText(/^[+−]\d|Same/)
    await expect(mark('Facts that are current')).toContainText(/(on the week before|a week ago)/)
    // Beside the label, on its line.
    const labelBox = await tile(page, 'Facts added or changed')
      .getByText('Facts added or changed', { exact: true })
      .boundingBox()
    const markBox = await mark('Facts added or changed').boundingBox()
    expect(
      Math.abs(markBox!.y + markBox!.height / 2 - (labelBox!.y + labelBox!.height / 2)),
    ).toBeLessThan(2)
    expect(markBox!.x).toBeGreaterThan(labelBox!.x + labelBox!.width)
    const boxes = await tiles(page).evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect()),
    )
    expect(new Set(boxes.map((box) => box.top)).size).toBe(1)
    expect(new Set(boxes.map((box) => box.height)).size).toBe(1)
    // Under the search field, above the quick actions.
    const pulseTop = boxes[0]!.top
    const quickTop = (await page.locator('[data-slot="quick-action"]').first().boundingBox())!.y
    const fieldBottom = await field(page).evaluate(
      (element) => element.getBoundingClientRect().bottom,
    )
    expect(pulseTop).toBeGreaterThan(fieldBottom)
    expect(quickTop).toBeGreaterThan(pulseTop)
  })

  test('nothing moves when the numbers arrive', async ({ page }) => {
    // Ravi has no draft: in this deliberately slow world Maria's would arrive with the numbers,
    // and Your drafts showing up is not a number arriving.
    await page.addInitScript(() => window.localStorage.setItem('cl.mock-person', 'per_ravi'))
    await returning(page)
    await scenario(page, 'slow')
    await openPage(page, '/', desktop)
    await expect(inState(page, 'pending')).toHaveCount(4)
    const strip = page.locator('[data-slot="home-pulse"]')
    const before = await strip.boundingBox()
    const quickBefore = await page.locator('[data-slot="quick-action"]').first().boundingBox()
    await expect(inState(page, 'ready')).toHaveCount(4, { timeout: 15_000 })
    const after = await strip.boundingBox()
    expect(after!.height).toBe(before!.height)
    expect((await page.locator('[data-slot="quick-action"]').first().boundingBox())!.y).toBe(
      quickBefore!.y,
    )
  })

  test('the strip has no view switch', async ({ page }) => {
    await returning(page)
    await openPage(page, '/', desktop)
    await homeReady(page)
    await expect(page.locator('[data-slot="home-pulse"]').getByRole('tab')).toHaveCount(0)
    await expect(tiles(page)).toHaveCount(4)
  })

  test('on a phone the change sits under its number, and every label keeps one line', async ({
    page,
  }) => {
    await returning(page)
    await openPage(page, '/', phone)
    await homeReady(page)
    const changed = tile(page, 'Facts added or changed')
    const number = await changed.locator('[data-slot="pulse-value"]').boundingBox()
    const mark = await changed.locator('[data-slot="change-mark"]').boundingBox()
    expect(mark!.y).toBeGreaterThanOrEqual(number!.y + number!.height - 1)
    expect(Math.abs(mark!.x - number!.x)).toBeLessThan(1)
    for (const name of [
      'Questions from AI apps',
      'Questions that found a fact',
      'Facts added or changed',
      'Facts that are current',
    ]) {
      const label = await tile(page, name).getByText(name, { exact: true }).boundingBox()
      expect(label!.height, name).toBeLessThanOrEqual(20)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  })

  test('an empty Heed says what its numbers will be', async ({ page }) => {
    await returning(page)
    await scenario(page, 'empty')
    await openPage(page, '/', desktop)
    await expect(page.getByText('No facts yet')).toBeVisible({ timeout: 15_000 })
    await expect(tile(page, 'Questions from AI apps')).toContainText('No AI app has asked yet')
    await expect(tile(page, 'Questions that found a fact')).toContainText(
      'Shows once an AI app asks',
    )
    await expect(tile(page, 'Facts added or changed')).toContainText('Nothing written down yet')
    await expect(tile(page, 'Facts that are current')).toContainText('No facts apply yet')
  })

  test('a failed load says so in each tile and offers to try again', async ({ page }) => {
    await returning(page)
    await scenario(page, 'error')
    await openPage(page, '/', desktop)
    await expect(inState(page, 'failed')).toHaveCount(4, { timeout: 15_000 })
    await expect(
      tile(page, 'Questions that found a fact').getByRole('button', { name: 'Try again' }),
    ).toBeVisible()
  })
})

test.describe('search suggestions', () => {
  test('typing lists facts first, then ask and try it, and Enter opens the first fact', async ({
    page,
  }) => {
    await returning(page)
    await openPage(page, '/', desktop)
    await homeReady(page)
    await field(page).click()
    await page.keyboard.type('orders poland')
    const list = page.getByRole('listbox', { name: 'Suggestions' })
    await expect(list).toBeVisible()
    await expect(field(page)).toHaveAttribute('aria-expanded', 'true')
    const options = list.getByRole('option')
    await expect(options.nth(0)).toHaveAttribute('data-suggestion', 'fact')
    await expect(options.nth(-2)).toHaveText(/Ask the assistant: “orders poland”/)
    await expect(options.nth(-1)).toHaveText(/Try a question: what do AI apps get for/)
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true')
    // The option is named "<title>, <domain>, <day>".
    const title = (await options.nth(0).getAttribute('aria-label'))!
      .split(', ')
      .slice(0, -2)
      .join(', ')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/library\/itm_/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
  })

  test('the arrows move, Escape closes and then clears, and Show all opens the library', async ({
    page,
  }) => {
    await returning(page)
    await openPage(page, '/', desktop)
    await homeReady(page)
    await field(page).click()
    await page.keyboard.type('orders poland')
    const options = page.getByRole('option')
    await page.keyboard.press('ArrowDown')
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await expect(options.last()).toHaveAttribute('aria-selected', 'true')
    // The page does not scroll under the list while the arrows move in it.
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await expect(field(page)).toHaveValue('orders poland')
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('listbox')).toBeVisible()
    await page.getByRole('option', { name: /Show all \d+ in the library/ }).click()
    await expect(page).toHaveURL(/\/library\?q=orders(\+|%20)poland$/)
  })

  for (const size of [desktop, phone])
    test(`Ask the assistant opens it on a new chat that asks the words, at ${size.width}`, async ({
      page,
    }) => {
      await returning(page)
      await openPage(page, '/', size)
      await homeReady(page)
      await field(page).fill('What does the Sales domain cover?')
      await page.getByRole('option', { name: /Ask the assistant/ }).click()
      await expect(assistant(page)).toBeVisible()
      await expect(page).toHaveURL(/\/$/)
      await expectAsked(page, 'What does the Sales domain cover?')
      // The words moved to the chat. On a phone the chat covers the page, the field with it.
      await expect(
        page.getByRole('combobox', {
          name: 'Search the library, or ask a question',
          includeHidden: true,
        }),
      ).toHaveValue('')
    })

  test('Ask the assistant starts a new chat over a finished one, from either tab', async ({
    page,
  }) => {
    await returning(page)
    await openPage(page, '/', desktop)
    await homeReady(page)
    await launcher(page).click()
    await askAndWait(page, ASK_MATCH)
    await assistant(page).getByRole('tab', { name: 'Try a question' }).click()
    await field(page).fill('What does the Sales domain cover?')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter')
    await expect(assistant(page).getByRole('tab', { name: 'Ask' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expectAsked(page, 'What does the Sales domain cover?')
  })

  test('Ask the assistant starts a new chat while an answer is still coming', async ({ page }) => {
    await returning(page)
    await scenario(page, 'slow')
    await openPage(page, '/', desktop)
    await homeReady(page)
    await launcher(page).click()
    await chipEditor(page)
    const box = assistant(page).getByRole('textbox', { name: 'Your question' })
    await box.fill(ASK_MATCH)
    await box.press('Enter')
    await expect(answer(page)).toHaveAttribute('data-state', 'working')
    // The next answer comes at the usual pace.
    await page.evaluate(() => window.localStorage.removeItem('cl.mock-scenario'))
    await field(page).fill('What does the Sales domain cover?')
    await page.getByRole('option', { name: /Ask the assistant/ }).click()
    await expectAsked(page, 'What does the Sales domain cover?')
  })

  test('clicking outside closes the list', async ({ page }) => {
    await returning(page)
    await openPage(page, '/', desktop)
    await homeReady(page)
    await field(page).fill('orders')
    await expect(page.getByRole('listbox')).toBeVisible()
    await page.getByRole('heading', { level: 1 }).click()
    await expect(page.getByRole('listbox')).toHaveCount(0)
  })
})

test.describe('empty states', () => {
  test('an empty library says so and offers to add the first fact', async ({ page }) => {
    await returning(page)
    await scenario(page, 'empty')
    await openPage(page, '/', desktop)
    await expect(page.getByText('No facts yet')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('tab', { name: /Known issues/ }).click()
    await expect(page.getByText('No known data issues')).toBeVisible()
    await expect(page.getByRole('tab', { name: /Known issues/ })).toHaveText('Known issues0')
  })

  test('a quiet library: nothing changed lately and no known data issues', async ({ page }) => {
    await returning(page)
    await scenario(page, 'quiet')
    await openPage(page, '/', desktop)
    await expect(page.getByText('Nothing changed lately')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('link', { name: 'Open the library' })).toBeVisible()
    await page.getByRole('tab', { name: /Known issues/ }).click()
    await expect(page.getByText('No known data issues')).toBeVisible()
    await page.getByRole('tab', { name: /Topics/ }).click()
    await expect(page.getByRole('table', { name: 'Topics' })).toBeVisible()
  })
})

test.describe('phone', () => {
  test('one column, one quick action a row, the optional columns gone, nothing sideways', async ({
    page,
  }) => {
    await returning(page)
    await openPage(page, '/', phone)
    await homeReady(page)
    const tiles = page.locator('[data-slot="quick-action"]')
    const boxes = await tiles.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().top),
    )
    expect(boxes).toHaveLength(3)
    expect(boxes[1]).toBeGreaterThan(boxes[0]!)
    expect(boxes[2]).toBeGreaterThan(boxes[1]!)
    const headers = page.getByRole('table', { name: 'Recently changed' }).getByRole('columnheader')
    await expect(headers.filter({ visible: true })).toHaveText(['Title', 'Updated'])
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
    // The pulse strip: one tile a row, the words on the left, the number and its chart right.
    const pulse = page.locator('[data-slot="pulse-tile"]')
    const pulseBoxes = await pulse.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect()),
    )
    expect(pulseBoxes).toHaveLength(4)
    for (const [index, box] of pulseBoxes.entries()) {
      expect(box.x).toBe(16)
      expect(box.width).toBe(390 - 32)
      if (index > 0) expect(box.top).toBeGreaterThan(pulseBoxes[index - 1]!.bottom)
    }
    await field(page).fill('orders poland')
    await expect(page.getByRole('listbox')).toBeVisible()
    const list = await page.getByRole('listbox').boundingBox()
    expect(list!.x).toBeGreaterThanOrEqual(16)
    expect(list!.x + list!.width).toBeLessThanOrEqual(390 - 16 + 1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  })
})

test.describe('the table', () => {
  test('a fact shows its domain as the badge every grid uses', async ({ page }) => {
    await returning(page)
    await openPage(page, '/', desktop)
    await homeReady(page)
    const row = page.getByRole('table', { name: 'Recently changed' }).getByRole('row').nth(1)
    await expect(row.locator('[data-slot="domain-badge"]')).toHaveCount(1)
    await page.getByRole('tab', { name: /Known issues/ }).click()
    const issue = page.getByRole('table', { name: 'Known issues' }).getByRole('row').nth(1)
    await expect(issue.locator('[data-slot="domain-badge"]')).toHaveCount(1)
  })

  test('on a phone the assistant launcher never covers a title', async ({ page }) => {
    await returning(page)
    await openPage(page, '/', phone)
    await homeReady(page)
    const launcher = await page.locator('[data-slot="assistant-launcher"]').boundingBox()
    expect(launcher).not.toBeNull()
    // Every line of every title ends left of the launcher, so no row scrolls a word under it.
    const rights = await page
      .getByRole('table', { name: 'Recently changed' })
      .getByRole('link')
      .evaluateAll((links) =>
        links.flatMap((link) => {
          const range = document.createRange()
          range.selectNodeContents(link)
          return [...range.getClientRects()].map((rect) => rect.right)
        }),
      )
    expect(rights.length).toBeGreaterThan(0)
    for (const right of rights) expect(right).toBeLessThan(launcher!.x)
  })
})

for (const theme of themes) {
  test(`axe on the pulse strip and on a phone, ${theme}`, async ({ page }) => {
    await returning(page)
    await openPage(page, '/', { ...phone, theme })
    await homeReady(page)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(results.violations.map((violation) => violation.id)).toEqual([])
  })

  test(`axe on Your drafts, ${theme}`, async ({ page }) => {
    await returning(page)
    await openPage(page, '/', { ...desktop, theme })
    await homeReady(page)
    await expect(page.locator('[data-slot="home-drafts"]')).toBeVisible()
    await page
      .getByRole('list', { name: 'Your drafts, not sent yet' })
      .getByRole('link')
      .first()
      .focus()
    const results = await new AxeBuilder({ page })
      .include('[data-slot="home-drafts"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(results.violations.map((violation) => violation.id)).toEqual([])
  })

  test(`axe with the suggestions open, ${theme}`, async ({ page }) => {
    await returning(page)
    await openPage(page, '/', { ...desktop, theme })
    await homeReady(page)
    await field(page).fill('orders poland')
    await expect(page.getByRole('listbox')).toBeVisible()
    await settle(page)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(results.violations.map((violation) => violation.id)).toEqual([])
  })

  for (const tab of ['issues', 'topics'] as const) {
    test(`axe on the ${tab} tab, ${theme}`, async ({ page }) => {
      await returning(page)
      await openPage(page, `/?tab=${tab}`, { ...phone, theme })
      await homeReady(page)
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(results.violations.map((violation) => violation.id)).toEqual([])
    })
  }
}
