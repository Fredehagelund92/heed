import { devices } from '@playwright/test'
import { claimsToCheck, cardIn, expect, go, place, test } from './go.ts'

// J17, the review on a phone: the decision bar says the state in words and where you are, its
// actions are 44px, nothing you can press is under 44px, and the source and its preview are both
// in reach. A tap on a line of the text offers to comment on it there (J33).

test.use({ ...devices['iPhone 13'], browserName: 'chromium' })

test('the bar says the state and the place, with full-size actions', async ({ page }) => {
  await go(page, '/inbox/sug-agent/review')
  const publish = page.getByRole('button', { name: 'Publish anyway' }).last()
  await expect(publish).toBeVisible()
  await expect(page.getByText(`${claimsToCheck('sug-agent')} claims to check`).last()).toBeVisible()
  await expect(page.getByText(place('sug-agent')).last()).toBeVisible()
  expect((await publish.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.getByRole('button', { name: 'Next suggestion' }).click()
  await expect(page).toHaveURL(new RegExp(cardIn('sug-sofia-clash')))
})

test('the source and its preview are both in reach', async ({ page }) => {
  await go(page, '/inbox/sug-ines/review')
  await expect(page.getByRole('region', { name: 'The source' })).toBeVisible()
  await page.getByRole('button', { name: 'Show the preview' }).click()
  await expect(page.getByRole('region', { name: 'Preview' })).toBeVisible()
})

test('a tap on a line offers to comment on it', async ({ page }) => {
  await go(page, '/inbox/sug-ines/review')
  const text = page.getByRole('region', { name: 'Text' })
  await text.getByText('Units sold in Norway leaves out the').last().tap()
  const offer = text.getByRole('button', { name: 'Comment on line 1' })
  await expect(offer).toBeVisible()
  expect((await offer.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await offer.tap()
  await page.keyboard.type('On the phone')
  await text.getByRole('button', { name: 'Comment', exact: true }).tap()
  await expect(
    text.getByRole('region', { name: "Line 1: Jon Abara's thread, open" }),
  ).toContainText('On the phone')
})

test('no control is under 44px', async ({ page }) => {
  for (const route of [
    '/inbox/sug-lars-retire/review',
    '/inbox/sug-ines-long/review',
    '/inbox?card=sug-agent',
  ]) {
    await go(page, route)
    await page.waitForTimeout(400)
    type Target = {
      getAttribute(n: string): string | null
      textContent: string | null
      getBoundingClientRect(): { width: number; height: number }
    }
    const small = await page.locator('button, a[href], input').evaluateAll((els: Target[]) =>
      els
        .filter((e) => !e.textContent?.includes('Skip to the content'))
        .map((e) => ({ e, r: e.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44))
        .map(
          ({ e, r }) =>
            `${(e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`,
        ),
    )
    expect(small, route).toEqual([])
  }
})
