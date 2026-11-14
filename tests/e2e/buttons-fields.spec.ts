import { expect, test, type Page } from '@playwright/test'

// Buttons and fields (design audit F02 and F15), measured where a person meets them, at 1440 wide
// on the mock build. A button is 28 px high, or 36 for the one decision a pane or page is for; its
// text is 14 px at weight 500, its corners 8 and its side padding 12; an icon button is a square of
// the same two heights. A field is 32 px high with corners 8, so it and the button beside it share a
// corner. And a screen has one solid blue button at most: the page's own question keeps it, the
// standing action in the header steps down to an outline. Like addresses and axe, it checks the
// mock build's pages (playwright.golden-http.config.ts leaves it out).

const places = [
  '/signin',
  '/inbox',
  '/inbox?card=sug-ines',
  '/inbox?card=check-returns',
  '/inbox?card=sug-sofia-clash',
  '/inbox/sug-ines/review',
  '/inbox/sug-sofia-clash/review',
  '/inbox/gap-spain/review',
  '/context',
  '/context/itm_norway_stop',
  '/context/itm_norway_stop/edit',
  '/context/conflicts/itm_gift_card_only.itm_gift_store_credit',
  '/definitions',
  '/definitions/Orders',
  '/definitions/Webshop/edit',
  '/ask',
  '/observability',
  '/observability/quality',
  '/help',
  '/settings/general',
  '/settings/people',
  '/settings/domains',
  '/settings/agents',
  '/settings/integrations',
  '/settings/integrations/cube',
  '/settings/integrations/cube/connect',
]

/** The screens that once showed two solid blue buttons: a conflict's item, and a list beside a quick view. */
const oneBlue = [
  '/context/itm_gift_store_credit',
  '/context?dock=context.itm_norway_stop',
  '/definitions?dock=def.Orders',
]

async function open(page: Page, place: string) {
  await page.goto(`${place}${place.includes('?') ? '&' : '?'}theme=light`)
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  // Two frames on: a page's content can fade in a frame after its header shows.
  await page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  )
}

/** Every button and field that is off the recipe, each said by its place, its words and what is wrong. */
function offRecipe(page: Page) {
  return page.evaluate(() => {
    const shown = (el: Element) => {
      const box = el.getBoundingClientRect()
      return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden'
    }
    const name = (el: Element) =>
      (el.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '')
        .trim()
        .slice(0, 28)
    const found: string[] = []
    const check = (el: Element, kind: string, want: Record<string, string[]>) => {
      const style = getComputedStyle(el)
      const have: Record<string, string> = {
        height: `${Math.round(el.getBoundingClientRect().height * 10) / 10}px`,
        'font-size': style.fontSize,
        'font-weight': style.fontWeight,
        'border-top-left-radius': style.borderTopLeftRadius,
        'padding-left': style.paddingLeft,
        'padding-right': style.paddingRight,
      }
      for (const [property, allowed] of Object.entries(want))
        if (!allowed.includes(have[property] ?? ''))
          found.push(
            `${kind} "${name(el)}": ${property} ${have[property]}, not ${allowed.join(' or ')}`,
          )
    }

    for (const button of document.querySelectorAll('[data-slot="button"]')) {
      // A link in a sentence takes the sentence's size; a button with no corners drawn is round.
      if (!shown(button) || button.getAttribute('data-variant') === 'link') continue
      const box = button.getBoundingClientRect()
      const round = parseFloat(getComputedStyle(button).borderTopLeftRadius) > 100
      const words = (button.textContent ?? '').trim().length > 0
      check(button, 'button', {
        height: ['28px', '36px'],
        ...(round ? {} : { 'border-top-left-radius': ['8px'] }),
        ...(words && box.width > box.height
          ? {
              'font-size': ['14px'],
              'font-weight': ['500'],
              'padding-left': ['12px'],
              'padding-right': ['12px'],
            }
          : {}),
      })
      if (!words && Math.round(box.width) !== Math.round(box.height))
        found.push(
          `icon button "${name(button)}": ${box.width} wide by ${box.height} high, not square`,
        )
    }
    for (const field of document.querySelectorAll('input[data-slot="input"]')) {
      // The title of a document is written on the page itself, with no border drawn.
      if (!shown(field) || getComputedStyle(field).borderTopWidth === '0px') continue
      check(field, 'field', {
        height: ['32px'],
        'border-top-left-radius': ['8px'],
        'font-size': ['14px'],
      })
    }
    return found
  })
}

test.describe('buttons and fields, 1440 wide', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  // One test visits every place, so it gets longer than a journey's half minute.
  test.setTimeout(120_000)

  test('every button and field is on the recipe', async ({ page }) => {
    const off: string[] = []
    for (const place of places) {
      await open(page, place)
      off.push(...(await offRecipe(page)).map((line) => `${place}: ${line}`))
    }
    expect(off).toEqual([])
  })

  test('a screen has one solid blue button at most', async ({ page }) => {
    const crowded: string[] = []
    for (const place of [...places, ...oneBlue]) {
      await open(page, place)
      const blue = await page.evaluate(() => {
        const probe = document.createElement('i')
        probe.style.backgroundColor = 'var(--primary)'
        document.body.append(probe)
        const primary = getComputedStyle(probe).backgroundColor
        probe.remove()
        return [...document.querySelectorAll('[data-slot="button"]')]
          .filter((el) => el.getBoundingClientRect().width > 0)
          .filter((el) => getComputedStyle(el).backgroundColor === primary)
          .map((el) => (el.textContent ?? '').trim())
      })
      if (blue.length > 1) crowded.push(`${place}: ${blue.join(', ')}`)
    }
    expect(crowded).toEqual([])
  })

  test('the page keeps blue for its own question and the header steps down', async ({ page }) => {
    const solid = (name: string) =>
      page
        .getByRole('button', { name, exact: true })
        .or(page.getByRole('link', { name, exact: true }))
        .first()
        .evaluate((el) => {
          const probe = document.createElement('i')
          probe.style.backgroundColor = 'var(--primary)'
          document.body.append(probe)
          const primary = getComputedStyle(probe).backgroundColor
          probe.remove()
          return getComputedStyle(el).backgroundColor === primary
        })

    // A context item that disagrees with another: Compare and decide answers the page's question.
    await open(page, '/context/itm_gift_store_credit')
    expect(await solid('Compare and decide')).toBe(true)
    expect(await solid('Edit')).toBe(false)

    // A definition beside its quick view: Write context is the quick view's, New term the page's standing action.
    await open(page, '/definitions?dock=def.Orders')
    expect(await solid('Write context')).toBe(true)
    expect(await solid('New term')).toBe(false)

    // With nothing beside them, the standing action is blue.
    await open(page, '/definitions')
    expect(await solid('New term')).toBe(true)
  })
})
