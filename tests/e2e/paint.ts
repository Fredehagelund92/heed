import type { Locator, Page } from '@playwright/test'
import type { Rgb } from '../lint/contrast.ts'

/*
  What the browser paints, read back from a pixel, so any colour syntax works (the tokens are
  oklch). The journeys that check contrast compare these with contrast().
*/

export type Painted = { rgb: Rgb; alpha: number }

/** What a locator paints: its text colour (or the placeholder's), its background and its opacity. */
export async function paint(target: Locator, pseudo?: '::placeholder') {
  return target.evaluate((el, which) => {
    const pixel = (value: string) => {
      const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
      ctx.fillStyle = value
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      return { rgb: [r!, g!, b!] as Rgb, alpha: a! / 255 }
    }
    const style = getComputedStyle(el, which ?? null)
    return {
      color: pixel(style.color),
      background: pixel(style.backgroundColor),
      opacity: getComputedStyle(el).opacity,
    }
  }, pseudo) as Promise<{ color: Painted; background: Painted; opacity: string }>
}

/** The page behind a control: the body's background, read the same way. */
export async function pageSurface(target: Page): Promise<Rgb> {
  const rgb = await target.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return [r, g, b]
  })
  return rgb as Rgb
}
