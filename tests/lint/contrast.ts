/*
  The colour maths of the token test (tests/lint/web-tokens.test.ts):
  a CSS colour as the 8 bit sRGB a browser paints, and the WCAG 2.x contrast ratio, rounded down
  to one decimal so a number is never overstated (design contract Draft 1, appendix B).
*/

export type Rgb = [number, number, number]

export function oklchToOklab(value: string): [number, number, number] {
  const match = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value)
  if (!match) throw new Error(`Not an opaque oklch() value: ${value}`)
  const [l, c, h] = [Number(match[1]) / (match[2] ? 100 : 1), Number(match[3]), Number(match[4])]
  const rad = (h * Math.PI) / 180
  return [l, c * Math.cos(rad), c * Math.sin(rad)]
}

export function oklabToRgb([l, a, b]: [number, number, number]): Rgb {
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
  return linear.map((channel) => {
    const clamped = Math.min(1, Math.max(0, channel))
    const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055
    return Math.round(encoded * 255)
  }) as Rgb
}

/** An opaque colour written as `#rgb`, `#rrggbb` or `oklch(l c h)`, as 8 bit sRGB. */
export function toRgb(value: string): Rgb {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1]
  if (!hex) return oklabToRgb(oklchToOklab(value))
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex
  return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16)) as Rgb
}

export function luminance([r, g, b]: Rgb): number {
  const linear = (channel: number) => {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

export function contrast(one: Rgb, two: Rgb): number {
  const high = Math.max(luminance(one), luminance(two))
  const low = Math.min(luminance(one), luminance(two))
  return Math.floor(((high + 0.05) / (low + 0.05)) * 10) / 10
}

/** 8 bit sRGB as OKLab, the inverse of oklabToRgb. */
export function rgbToOklab(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as Rgb
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** `one` at `alpha` laid over `two`, composited as a browser paints it: in 8 bit sRGB. */
export function over(one: Rgb, alpha: number, two: Rgb): Rgb {
  return [0, 1, 2].map((i) => Math.round(one[i]! * alpha + two[i]! * (1 - alpha))) as Rgb
}
