import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { contentLeft, openPage, themes, widths } from './support'

/* The Item page: title-first reading column, persistent facts, quiet actions and list navigation. */

const desktop = { ...widths[0], theme: 'light' as const }

const items = {
  /** A guide in Paid media, accepted, with mentions in its body. */
  guide: '/library/itm_jyfuvl07',
  /** An event in Marketing that has ended and whose source changed. */
  endedChanged: '/library/itm_4u2dvokn',
  /** A high-risk note in Sales whose source is missing. */
  sourceMissing: '/library/itm_gjdvl50x',
  /** An event in Marketing whose source changed (Tomas Eriksen is its owner). */
  sourceChanged: '/library/itm_6n54lyca',
  retired: '/library/itm_22ooyz66',
  issueOpen: '/library/itm_hp8rnz8i',
  issueEnding: '/library/itm_lnd2vv9k',
  issueStillGoing: '/library/itm_xw5lmhcy',
  issueResolved: '/library/itm_l7x3lqic',
}

async function signInAs(page: Page, personId: string) {
  await page.addInitScript((id) => window.localStorage.setItem('cl.mock-person', id), personId)
}

const header = (page: Page) => page.locator('[data-slot="item-header"]')
const note = (page: Page) => page.locator('[data-slot="state-note"]')
const actions = (page: Page) => page.locator('[data-slot="item-actions"]')

test.describe('the item page and Details column', () => {
  for (const size of widths) {
    test(`title, badges and note align with the tabs at ${size.name}px`, async ({ page }) => {
      await openPage(page, items.guide, { ...size, theme: 'light' })
      const shell = await contentLeft(page, '[data-layout="header"]')
      const title = await page.getByRole('heading', { level: 1 }).boundingBox()
      const badges = await page.locator('[data-slot="item-badges"]').boundingBox()
      const line = await page.locator('[data-slot="item-note"]').boundingBox()
      const tabs = await page.getByRole('tablist', { name: 'Fact sections' }).boundingBox()
      for (const box of [title, badges, line, tabs]) expect(box?.x).toBe(shell)
      expect(badges!.y).toBeGreaterThanOrEqual(title!.y + title!.height)
      expect(line!.y).toBeGreaterThanOrEqual(badges!.y + badges!.height)
      await expect(page.locator('[data-slot="item-text"]')).toHaveCSS('font-size', '15px')
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        size.width,
      )
      const details = await page.getByRole('complementary', { name: 'Fact details' }).boundingBox()
      const paper = await page.locator('[data-slot="paper"]').boundingBox()
      if (size.width === 1440) {
        expect(details!.width).toBe(288)
        expect(details!.x).toBeGreaterThan(paper!.x + paper!.width)
        expect(details!.y).toBe(title!.y)
      } else {
        expect(details!.y).toBeGreaterThanOrEqual(paper!.y + paper!.height)
      }
    })
  }

  for (const theme of themes) {
    for (const size of [widths[0], widths[2]]) {
      test(`Details divider at ${size.name}px in ${theme}`, async ({ page }) => {
        await openPage(page, items.issueResolved, { ...size, theme })
        const details = page.getByRole('complementary', { name: 'Fact details' })
        const edge = await details.evaluate((element) => {
          const style = getComputedStyle(element)
          const before = getComputedStyle(element, '::before')
          const content = element.parentElement!
          const probe = document.createElement('span')
          probe.style.borderColor = 'var(--border-subtle)'
          element.append(probe)
          const color = getComputedStyle(probe).borderLeftColor
          probe.remove()
          return {
            topWidth: style.borderTopWidth,
            topColor: style.borderTopColor,
            leftWidth: before.borderLeftWidth,
            leftColor: before.borderLeftColor,
            edgeTop: element.getBoundingClientRect().top + parseFloat(before.top),
            edgeHeight: parseFloat(before.height),
            contentTop: content.getBoundingClientRect().top,
            contentHeight: content.getBoundingClientRect().height,
            color,
          }
        })
        if (size.width === 1440) {
          expect(edge.leftWidth).toBe('1px')
          expect(edge.leftColor).toBe(edge.color)
          expect(edge.topWidth).toBe('0px')
          expect(edge.edgeTop).toBe(edge.contentTop)
          expect(edge.edgeHeight).toBe(edge.contentHeight)
        } else {
          expect(edge.topWidth).toBe('1px')
          expect(edge.topColor).toBe(edge.color)
          expect(edge.leftWidth).toBe('0px')
        }
        await expect(page.locator('[data-slot="item-note"]')).toHaveText(
          'Resolved · Applied 3 to 14 August 2026',
        )
      })
    }
  }

  test('a served item says who accepted it and when, with no edition label; a retired one does not', async ({
    page,
  }) => {
    await openPage(page, items.guide, desktop)
    const stamp = header(page).locator('[data-slot="review-stamp"]')
    await expect(stamp).toHaveAttribute('data-by', 'person')
    await expect(stamp).toContainText(/^Accepted \d{1,2} \w+ \d{4} by .+, owner of Paid media/)
    await expect(stamp).not.toContainText(/\d{4}-\d{2}-\d{2}\.\d+/)
    await expect(stamp).toContainText('Checks passed')
    // The stamp says "Accepted", so the note under the title does not say it twice.
    await expect(page.locator('[data-slot="item-note"]')).not.toContainText('Accepted')
    await openPage(page, items.retired, desktop)
    await expect(page.locator('[data-slot="item-note"]')).toContainText('Archived')
    await expect(header(page).locator('[data-slot="review-stamp"]')).toHaveCount(0)
  })

  test('facts stay on every tab without displaying raw ids', async ({ page }) => {
    await openPage(page, items.guide, desktop)
    for (const tab of ['Read', 'Source', 'History', 'Links']) {
      await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click()
      const details = page.getByRole('complementary', { name: 'Fact details' })
      for (const label of [
        'Status',
        'When it applies',
        'Check again by',
        'Source',
        'Cause',
        'Risk',
        'Who can see it',
        'Owner',
        'Written by',
        'Confirmed',
        'Version',
      ]) {
        await expect(
          details.getByRole('term').filter({ hasText: new RegExp(`^${label}$`) }),
        ).toBeVisible()
      }
      expect(await page.locator('main').innerText()).not.toMatch(/itm_[a-z0-9]+/)
      // Opened by its link alone, the item carries no list: no position (contract 9.11).
      await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toHaveText(
        /^Library\s*Guide$/,
      )
    }
    await page.getByRole('button', { name: 'More actions' }).click()
    await expect(page.getByRole('menuitem', { name: 'Copy fact ID' })).toHaveCount(0)
  })

  test('warning and lifecycle explanations remain available in Source', async ({ page }) => {
    await openPage(page, items.endedChanged, desktop)
    await expect(header(page)).toContainText('Source changed')
    await expect(note(page)).toHaveText(
      'Agents are told it may be out of date until Tomas Eriksen checks it.',
    )
    await page.getByRole('tab', { name: 'Source' }).click()
    await expect(page.getByRole('region', { name: 'What the details mean' })).toContainText(
      /It ended \d+ days ago/,
    )
    await openPage(page, items.sourceMissing, desktop)
    await expect(header(page)).toContainText('High risk')
    await expect(note(page)).toHaveText('Agents may not get it until Jon Abara checks it.')
  })

  test('archived facts explain their status without offering a change', async ({ page }) => {
    await openPage(page, `${items.retired}?tab=source`, desktop)
    await expect(page.getByRole('region', { name: 'What the details mean' })).toContainText(
      "It stays in the history, and agents don't get it.",
    )
    await expect(page.getByRole('link', { name: 'Suggest a change' })).toHaveCount(0)
  })

  test('issue periods and the overdue check keep their meaning', async ({ page }) => {
    await openPage(page, items.issueOpen, desktop)
    await expect(note(page)).toHaveCount(0)
    await expect(header(page)).toContainText('Active since 2 October 2026')
    await expect(header(page)).toContainText('Check again by 16 October 2026, in 9 days')
    await openPage(page, items.issueEnding, desktop)
    await expect(header(page)).toContainText('Active until 10 October 2026, in 3 days')
    await openPage(page, items.issueResolved, desktop)
    await expect(header(page)).toContainText('Resolved · Applied 3 to 14 August 2026')
    await expect(page.locator('[data-slot="kind-badge"]')).toHaveAttribute('data-tone', 'neutral')
    await signInAs(page, 'per_jon')
    await openPage(page, items.issueStillGoing, desktop)
    await expect(header(page)).toContainText('Check was due 29 September 2026')
    await expect(actions(page).getByRole('button', { name: 'Yes, still going on' })).toBeVisible()
    await expect(
      actions(page).getByRole('link', { name: 'It ended: set the end date' }),
    ).toBeVisible()
  })

  test('empty Links offers a centred explanation and a working next step', async ({ page }) => {
    await openPage(page, `${items.sourceMissing}?tab=links`, desktop)
    const empty = page.locator('[data-slot="empty"]')
    await expect(empty).toContainText('No connections yet')
    await expect(empty).toHaveCSS('text-align', 'center')
    await empty.getByRole('link', { name: 'Browse the library' }).click()
    await expect(page).toHaveURL(/\/library$/)
  })

  test('copy link is a direct action', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openPage(page, items.guide, desktop)
    await page.getByRole('button', { name: 'Copy link', exact: true }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(items.guide)
  })
})

test.describe('actions', () => {
  test('Suggest a change opens the change form for the item', async ({ page }) => {
    await openPage(page, items.guide, desktop)
    await page.getByRole('link', { name: 'Suggest a change' }).click()
    await expect(page).toHaveURL(/\/library\/itm_jyfuvl07\/suggest$/)
    await expect(page.getByRole('heading', { name: 'Suggest a change', level: 1 })).toBeVisible()
  })

  test('a contributor suggests archiving; the owner checks and archives', async ({ page }) => {
    await openPage(page, items.sourceChanged, desktop)
    await expect(page.getByRole('button', { name: 'Mark as checked' })).toHaveCount(0)
    await page.getByRole('button', { name: 'More actions' }).click()
    await expect(page.getByRole('menuitem', { name: /Suggest archiving/ })).toBeVisible()
    // Copy link is the button beside the menu, so the menu does not repeat it.
    await expect(page.getByRole('menuitem', { name: 'Copy link' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await signInAs(page, 'per_tomas')
    await page.reload()
    await expect(actions(page).getByRole('button', { name: 'Mark as checked' })).toBeVisible()
    await page.getByRole('button', { name: 'More actions' }).click()
    await expect(page.getByRole('menuitem', { name: /^Archive fact/ })).toBeVisible()
  })

  test('the owner of the area sees Mark as checked first in the action group', async ({ page }) => {
    await signInAs(page, 'per_jon')
    await openPage(page, items.sourceMissing, desktop)
    const first = actions(page).getByRole('button').first()
    await expect(first).toHaveAccessibleName('Mark as checked')
    // The one solid button of the page: a fill and no hairline, where the others are ghost actions.
    const looks = await actions(page)
      .getByRole('button')
      .evaluateAll((buttons) =>
        buttons.map((button) => {
          const style = getComputedStyle(button)
          return { fill: style.backgroundColor, line: style.borderTopColor }
        }),
      )
    const [solid, ...outlines] = looks
    expect(solid?.line).toBe('rgba(0, 0, 0, 0)')
    expect(solid?.fill).not.toBe('rgba(0, 0, 0, 0)')
    for (const outline of outlines) {
      expect(outline.line).toBe('rgba(0, 0, 0, 0)')
      expect(outline.fill).not.toBe(solid?.fill)
    }
  })

  test('someone who is not the owner of the area does not see Mark as checked', async ({
    page,
  }) => {
    await openPage(page, items.sourceMissing, desktop)
    await expect(note(page)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark as checked' })).toHaveCount(0)

    await signInAs(page, 'per_tomas')
    await page.reload()
    await expect(note(page)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark as checked' })).toHaveCount(0)
  })

  test('on a high-risk item the check says the approver confirms it first', async ({ page }) => {
    await signInAs(page, 'per_jon')
    await openPage(page, items.sourceMissing, desktop)
    const check = page.getByRole('button', { name: 'Mark as checked' })
    await check.focus()
    await page.keyboard.press('Enter')
    await expect(
      page
        .getByRole('alertdialog', { name: 'Checked, still correct?' })
        .getByText(/Because it's high risk, an approver confirms it first\./),
    ).toBeVisible()
  })
})

test.describe('tabs', () => {
  test('Read, Source, History and Links keep their place in the address', async ({ page }) => {
    await openPage(page, items.endedChanged, desktop)
    const tabs = page.getByRole('tablist', { name: 'Fact sections' })
    await expect(tabs.getByRole('tab')).toHaveText(['Read', 'Source', 'History1', 'Links1'])
    await expect(page.getByRole('heading', { name: 'What happened' })).toBeVisible()

    await tabs.getByRole('tab', { name: 'Source' }).click()
    await expect(page).toHaveURL(/tab=source/)
    await expect(page.getByRole('heading', { name: 'Where this comes from' })).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Fact details' })).toContainText(
      'Source changed',
    )
    await expect(page.getByRole('heading', { name: 'What the details mean' })).toBeVisible()

    // Arrow keys move between tabs; the header stays on every tab.
    await tabs.getByRole('tab', { name: 'Source' }).focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/tab=history/)
    await expect(page.getByRole('table', { name: 'Versions' })).toBeVisible()
    await expect(header(page)).toBeVisible()

    await page.reload()
    await expect(page.getByRole('tab', { name: /History/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await page.getByRole('tab', { name: 'Read' }).click()
    await expect(page).not.toHaveURL(/tab=/)
  })

  test('on a 320 phone the tabs scroll in their row, never the page, and show the open one', async ({
    page,
  }) => {
    await openPage(page, `${items.guide}?tab=links`, { width: 320, height: 700, theme: 'light' })
    const row = page.getByRole('tablist', { name: 'Fact sections' })
    const paper = await page.locator('[data-slot="paper"]').boundingBox()
    const box = await row.boundingBox()
    const [scroll, client, pageWidth] = await row.evaluate((node) => [
      node.scrollWidth,
      node.clientWidth,
      document.documentElement.scrollWidth,
    ])
    // Four tabs with counts are wider than the column: the row scrolls, the page does not.
    expect(scroll).toBeGreaterThan(client)
    expect(pageWidth).toBe(320)
    expect(box!.x + box!.width).toBeLessThanOrEqual(paper!.x + paper!.width)
    // The open tab is whole in view, its count too.
    const links = await page.getByRole('tab', { name: /Links/ }).boundingBox()
    expect(links!.x).toBeGreaterThanOrEqual(box!.x)
    expect(links!.x + links!.width).toBeLessThanOrEqual(box!.x + box!.width + 0.5)
  })

  test('next and previous keep the tab', async ({ page }) => {
    // With the list it came from in its address, the item has its previous and next.
    await openPage(page, `${items.guide}?tab=source&kind=guide`, desktop)
    await page.getByRole('button', { name: 'Next fact' }).click()
    await expect(page).not.toHaveURL(/itm_jyfuvl07/)
    await expect(page).toHaveURL(/tab=source/)
    await expect(page.getByRole('heading', { name: 'What the details mean' })).toBeVisible()
  })

  test('the text shows its mentions as chips, and Links lists them', async ({ page }) => {
    await openPage(page, items.guide, desktop)
    const text = page.locator('[data-slot="item-text"]')
    await expect(text.locator('[data-slot="mention-chip"]')).toHaveCount(3)
    await expect(text.locator('[data-slot="mention-chip"][data-target="area"]')).toHaveAttribute(
      'data-tone',
      'violet',
    )
    await page.getByRole('tab', { name: /Links/ }).click()
    const mentions = page.getByRole('list', { name: 'This fact mentions' })
    await expect(mentions.getByRole('listitem')).toHaveCount(3)
    await mentions.getByRole('link', { name: /What explains the movement/ }).click()
    await expect(page).toHaveURL(/\/library\/itm_gyueii40/)
  })
})

test.describe('the library and ended issues', () => {
  test('ended issues are hidden by default, one click shows them, a chip hides them', async ({
    page,
  }) => {
    await openPage(page, '/library?kind=issue', desktop)
    await expect(page.locator('[data-row-id]')).toHaveCount(4)
    // The note sits in the toolbar (the professional pass, rule 6), one ghost button.
    const line = page.locator('[data-slot="hidden-ended-issues"]')
    await expect(line).toHaveText(/3 ended issues hidden/)
    await line.click()
    await expect(page).toHaveURL(/ended=show/)
    await expect(page.locator('[data-row-id]')).toHaveCount(7)
    await expect(line).toHaveCount(0)
    // An ended issue turns calm: a muted kind icon and a muted title. An active one is amber.
    const ended = page.locator('[data-row-id="itm_l7x3lqic"]')
    await expect(ended.locator('[data-slot="kind-icon"]')).not.toHaveAttribute('data-active')
    await expect(ended.getByRole('img', { name: 'Ended', exact: true })).toBeVisible()
    const active = page.locator('[data-row-id="itm_hp8rnz8i"]')
    await expect(active.getByRole('img', { name: 'Active issue' })).toBeVisible()
    await expect(active.locator('[data-slot="kind-icon"]')).toHaveAttribute('data-active', 'true')

    await page.getByRole('button', { name: 'Remove filter Ended issues shown' }).click()
    await expect(page.locator('[data-row-id]')).toHaveCount(4)
  })

  test('the Filter menu has the Issue kind and the Ended issues switch', async ({ page }) => {
    await openPage(page, '/library', desktop)
    await page.getByRole('button', { name: 'Filter', exact: true }).click()
    await page.getByRole('tab', { name: 'Kind' }).click()
    await page.getByRole('checkbox', { name: 'Issue' }).click()
    await expect(page).toHaveURL(/kind=issue/)
    await page.getByRole('tab', { name: 'Ended issues' }).click()
    await page.getByRole('checkbox', { name: 'Show ended issues' }).click()
    await expect(page).toHaveURL(/ended=show/)
  })
})

test.describe('an item still in review', () => {
  test('its address says it is waiting for review and opens its proposal', async ({ page }) => {
    await openPage(page, '/library/itm_mock000084', { ...widths[0], theme: 'light' })
    await expect(page.getByText('This fact is waiting for review')).toBeVisible()
    await expect(page.getByText("This page doesn't exist")).toHaveCount(0)
    await page.getByRole('link', { name: 'Open proposal #12' }).click()
    await expect(page).toHaveURL(/\/proposals\/[^/?]+$/)
  })

  test('an item nothing names still finds no page', async ({ page }) => {
    await openPage(page, '/library/itm_zzzzzzzz00', { ...widths[0], theme: 'light' })
    await expect(page.getByText("This page doesn't exist")).toBeVisible()
  })
})

test.describe('what not to conclude on the item page', () => {
  for (const theme of themes)
    for (const size of [widths[0], widths[2]])
      test(`shows the contributor's own line to readers at ${size.name}px, ${theme}`, async ({
        page,
      }) => {
        // The demo's Poland issue, whose contributor wrote their own line (mocks/caveats.ts).
        await openPage(page, '/library/itm_k4p3nj1b', { ...size, theme })
        const section = page.getByRole('region', { name: 'What not to conclude' })
        await expect(section.locator('[data-slot="item-caveat"]')).toHaveText(
          /^Low orders in Poland for these days do not mean that customers ordered less\./,
        )
        await expect(section.getByText('Agents get this line with the fact.')).toBeVisible()
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
      })

  test('leaves the stored default out: the cause row already says it', async ({ page }) => {
    await openPage(page, items.guide, desktop)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('region', { name: 'What not to conclude' })).toHaveCount(0)
  })
})
