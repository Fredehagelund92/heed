import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// axe on every place of the app, at 390 and 1440 wide, in light and dark (docs/design/
// accessibility.md, "The gates"): WCAG 2.2 AA, and no finding of any weight. The overlays an
// address opens (the palette, the keys, Report a problem, Connect an agent) and a peek in the dock
// are checked too, and the Help menu once per width and theme.

const places = [
  '/signin',
  // An agent's consent page, with the demo's waiting sign-in (src/web/api/mock/data/agents.ts).
  '/connect/approve?request=demo-agent-sign-in-waiting-for-your-answer0',
  '/inbox',
  '/inbox?card=sug-ines',
  '/inbox?demo=setup',
  '/inbox/sug-ines/review',
  '/inbox/sug-sofia-clash/review',
  '/inbox/gap-spain/review',
  // The Source review's archive and formatting cases, and its Preview of the rich text.
  '/inbox/sug-lars-retire/review',
  '/inbox/sug-ines-format/review',
  '/inbox/sug-ines/review?view=preview',
  '/context',
  '/context?dock=context.itm_norway_stop',
  '/context/itm_norway_stop',
  '/context/itm_norway_stop/edit',
  '/context/itm_norway_stop/suggest',
  '/context/new',
  '/definitions',
  '/definitions?dock=def.Orders',
  '/definitions/Orders',
  '/definitions/Webshop/edit',
  '/definitions/new',
  '/ask',
  '/ask?example=grounded',
  '/ask?example=missing',
  // Marked text: the sentences that disagree, an item that disagrees, a failed read, a refused key.
  '/ask?example=conflict',
  '/context/itm_gift_store_credit',
  // The conflict view: the list, a pair's page, the dock, a pair across two domains, a near copy.
  '/context/conflicts?whose=all',
  '/context/conflicts/itm_gift_card_only.itm_gift_store_credit',
  '/context/conflicts?whose=all&dock=conflict.itm_gift_card_only.itm_gift_store_credit',
  '/context/conflicts/itm_spain_vat_in.itm_spain_vat_out',
  '/context/conflicts/itm_france_switch_12.itm_france_switch_21',
  '/settings/integrations?state=failed',
  '/settings/integrations?state=reauth',
  '/observability/summary',
  '/observability/overview',
  '/observability/questions',
  '/observability/questions?sort=name&dir=desc',
  '/observability/quality',
  '/observability/feedback',
  '/observability/usage',
  '/observability/alerts',
  '/settings/general',
  '/settings/people',
  '/settings/domains',
  '/settings/domains/sales',
  '/settings/domains/new',
  '/settings/agents',
  '/settings/integrations',
  '/settings/integrations/cube',
  '/settings/integrations/cube/connect',
  '/settings/advanced',
  '/help',
  '/nowhere',
  '/docs',
  '/docs/connect-an-agent',
  '/docs/publish-without-review',
  // Publishing without review switched on for the workspace (the review flag): the domain's row.
  '/settings/domains/sales?autopublish=on',
  '/inbox?open=palette',
  '/inbox?open=shortcuts',
  '/inbox?open=report',
  '/settings/agents?open=connect',
]

const widths = [
  { name: '390', width: 390, height: 844 },
  { name: '1440', width: 1440, height: 900 },
] as const
const themes = ['light', 'dark'] as const

const withTheme = (place: string, theme: string) =>
  `${place}${place.includes('?') ? '&' : '?'}theme=${theme}`

/**
  Wait until the fonts are in, nothing is loading and nothing moves, so axe reads the colours a person sees. Still
  means still for ten frames in a row: a page's content can fade in a frame or two after its
  header shows, and one still frame before that would let axe read the text half faded. An
  animation tied to scrolling (the editor toolbar's edge fade) runs as long as the page is open and
  only moves when someone scrolls, so it does not count.
*/
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    delete (window as Window & { stillFrames?: number }).stillFrames
  })
  // A load under 150ms shows a busy placeholder and no skeleton, so nothing moves while it waits:
  // wait for it to end, or axe could read the content as it starts to fade in.
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'))
  await page.waitForFunction(() => {
    const still = document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== 'running' || animation.timeline !== document.timeline,
      )
    const frames = window as Window & { stillFrames?: number }
    frames.stillFrames = still ? (frames.stillFrames ?? 0) + 1 : 0
    return frames.stillFrames >= 10
  })
}

/** Sign out in the user menu, in the sidebar's sheet on a phone. */
async function signOut(page: Page, width: number) {
  if (width < 768) await page.getByRole('button', { name: /menu/i }).first().click()
  await page
    .locator('[data-sidebar=sidebar] [data-sidebar=footer]')
    .last()
    .getByRole('button')
    .click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/signin$/)
}

async function violations(page: Page) {
  await settle(page)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return results.violations.map(
    (violation) =>
      `${violation.impact}: ${violation.id} (${violation.nodes.map((node) => node.target.join(' ')).join(', ')})`,
  )
}

for (const { name, width, height } of widths) {
  for (const theme of themes) {
    test.describe(`${name}, ${theme}`, () => {
      test.use({ viewport: { width, height }, colorScheme: theme })

      for (const place of places) {
        test(place, async ({ page }) => {
          await page.goto(withTheme(place === '/signin' ? '/inbox' : place, theme))
          // The demo starts signed in, and someone signed in goes from sign-in to the Inbox.
          if (place === '/signin') await signOut(page, width)
          await expect(page.locator('main, [role=main], h1').first()).toBeVisible()
          expect(await violations(page)).toEqual([])
        })
      }

      // Publishing without review (FR-421): the dialog that sets a policy, the policy on the domain
      // page, the workspace switch, and the policy with Turn off in the agent's Details.
      test('publishing without review: the dialog, the policy and its Details', async ({
        page,
      }) => {
        await page.goto(withTheme('/settings/domains/sales?autopublish=on', theme))
        await page.getByRole('button', { name: 'Let an agent publish without review' }).click()
        const dialog = page.getByRole('dialog')
        await expect(dialog.getByRole('checkbox', { name: 'Rule' })).toBeChecked()
        expect(await violations(page)).toEqual([])
        await dialog.getByRole('textbox', { name: 'Why' }).fill('Its rules were right for weeks')
        await dialog.getByRole('button', { name: 'Let it publish' }).click()
        await expect(
          page.getByRole('list', { name: 'Agents that publish without review in Sales' }),
        ).toBeVisible()
        expect(await violations(page)).toEqual([])
        await page.evaluate(() => {
          const link = Object.assign(document.createElement('a'), { href: '/settings/agents' })
          document.body.append(link)
          link.click()
          link.remove()
        })
        await page.getByRole('button', { name: 'Show or hide Publish without review' }).click()
        await page.getByRole('button', { name: 'Details of Claude Code for Kofi Mensah' }).click()
        await expect(
          page.getByRole('list', { name: 'Where Claude Code publishes without review' }),
        ).toBeVisible()
        expect(await violations(page)).toEqual([])
      })

      test('the Sort menu, open, sorted the other way', async ({ page }) => {
        await page.goto(withTheme('/context', theme))
        await page.getByRole('button', { name: /^Sort/ }).click()
        await page.getByRole('menuitemradio', { name: 'Oldest first' }).click()
        await expect(page.getByRole('menu')).toBeVisible()
        expect(await violations(page)).toEqual([])
      })

      test('an answer that looked nothing up, with the questions Ask can answer', async ({
        page,
      }) => {
        await page.goto(withTheme('/ask?n=axe-unread', theme))
        const box = page.getByRole('textbox', { name: 'Ask a question' })
        await box.click()
        await box.pressSequentially('tell me a joke')
        await box.press('Enter')
        await expect(page.getByRole('group', { name: 'Questions Ask can answer' })).toBeVisible()
        expect(await violations(page)).toEqual([])
      })

      // Records answers (FR-718): a list with links, a table of counts, and a refused question.
      for (const question of [
        'what is due for a check in Sales?',
        'how many context items does Sales have?',
        'what did Tomas Eriksen write this week?',
      ])
        test(`a records answer: ${question}`, async ({ page }) => {
          await page.goto(withTheme(`/ask?n=axe-records-${question.length}`, theme))
          const box = page.getByRole('textbox', { name: 'Ask a question' })
          await box.click()
          await box.pressSequentially(question)
          await box.press('Enter')
          await expect(
            page.getByRole('group', { name: /^(Ask next|Questions Ask can answer)$/ }),
          ).toBeVisible()
          expect(await violations(page)).toEqual([])
        })

      test('a review with an open and a resolved thread on its source, and a comment being written', async ({
        page,
      }) => {
        await page.goto(withTheme('/inbox/sug-ines/review', theme))
        const source = page.getByRole('region', { name: 'The source' })
        await source.locator('[data-source-place="after:1"]').focus()
        await page.keyboard.press('c')
        await expect(source.getByRole('textbox', { name: 'Comment on line 1' })).toBeFocused()
        await page.keyboard.type('Since when are there 340?')
        await page.keyboard.press('ControlOrMeta+Enter')
        await source.locator('[data-source-place="before:1"]').focus()
        await page.keyboard.press('c')
        await expect(
          source.getByRole('textbox', { name: 'Comment on removed line 1' }),
        ).toBeFocused()
        await page.keyboard.type('Was 312 ever right?')
        await page.keyboard.press('ControlOrMeta+Enter')
        await source
          .getByRole('region', { name: /^Removed line 1: / })
          .getByRole('button', { name: 'Resolve' })
          .click()
        await source.locator('[data-source-place="field:sources"]').focus()
        await page.keyboard.press('c')
        await expect(source.getByRole('textbox', { name: 'Comment on source' })).toBeFocused()
        await page.keyboard.type('Which page?')
        await expect(source.getByRole('textbox', { name: 'Comment on source' })).toBeVisible()
        // The pointer rests where Resolve was, which the fold moves under another button.
        await page.mouse.move(0, 0)
        expect(await violations(page)).toEqual([])
      })

      test('the Help menu, open', async ({ page }) => {
        await page.goto(withTheme('/inbox', theme))
        if (width < 768) await page.getByRole('button', { name: /menu/i }).first().click()
        await page
          .locator('[data-sidebar=sidebar]')
          .last()
          .getByRole('button', { name: 'Help' })
          .click()
        await expect(page.getByRole('menu')).toBeVisible()
        expect(await violations(page)).toEqual([])
      })
    })
  }
}
