import { describe, expect, it } from 'vitest'
import { domainHue } from '@/lib/tones'

// Blue is for acting and for what is selected (design contract 2.1): no domain's dot is Heed blue,
// whose hue is 262 in oklch in both themes.
const apart = (h: number) => Math.min(Math.abs(h - 262), 360 - Math.abs(h - 262))

describe('a domain hue', () => {
  it('keeps clear of the accent, for the demo world and for any other domain', () => {
    const ids = ['sales', 'area_sales', 'marketing', 'customer_value', 'paid_media']
    for (let i = 0; i < 2000; i++) ids.push(`area_${i.toString(36)}`, `domain ${i}`)
    for (const id of ids) expect(apart(domainHue(id)!), id).toBeGreaterThanOrEqual(35)
  })

  it('is the same every time, and the sandbox has none', () => {
    expect(domainHue('area_finance')).toBe(domainHue('finance'))
    expect(domainHue('sandbox')).toBeNull()
  })
})
