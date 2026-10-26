import { describe, expect, it } from 'vitest'
import { careLine, readiness, readTime, reviewFor, reviews } from '@/data/review'

// The Ready line never says more than was checked: claims are compared only with a copied sentence,
// so an edit's new numbers, dates and sentences say that nothing compared them.

const r = (id: string) => reviewFor(id)!

describe('the Ready line', () => {
  it('never claims an edit is complete', () => {
    for (const x of reviews) expect(readiness(x).text, x.id).not.toMatch(/\bcomplete\b/i)
  })

  it("says a new number or date isn't checked only when no source came with it", () => {
    const dates = readiness(r('sug-ines-dates'))
    expect(dates.ok).toBe(false)
    expect(dates.title).toBe('Ready, not checked against a source')
    expect(dates.text).toContain('26 May 2026')
    // 340 and 1 Oct come with a new source page: no caveat, but open the page.
    const ines = readiness(r('sug-ines'))
    expect(ines.ok).toBe(true)
    expect(ines.text).toContain('new source page')
    // A rewording with no new numbers or dates is plainly ready.
    expect(readiness(r('sug-ines-long'))).toMatchObject({ ok: true, title: 'Ready' })
  })

  it("keeps what still needs a look out of Publish the ones you've read", () => {
    for (const id of [
      'sug-ines',
      'sug-ines-link',
      'sug-ines-dates',
      'sug-agent',
      'sug-lars-retire',
    ])
      expect(readiness(r(id)).bulk, id).toBe(false)
    for (const id of ['sug-ines-format', 'sug-ines-order', 'sug-ines-long', 'drive-bundles'])
      expect(readiness(r(id)).bulk, id).toBe(true)
  })

  it('is plainly ready where the words are the same', () => {
    for (const id of ['sug-ines-format', 'sug-ines-order', 'sug-ines-link'])
      expect(readiness(r(id)).ok, id).toBe(true)
  })

  it('counts the claims to check the same way everywhere', () => {
    expect(careLine(r('sug-agent'))).toBe('2 claims to check')
    expect(readiness(r('sug-agent')).title).toBe('Ready, with 2 claims to check')
    expect(careLine(r('sug-sofia-clash'))).toBe('Overlaps live context')
    expect(careLine(r('sug-ines'))).toBeUndefined()
  })

  it('shows a withdrawn retirement as withdrawn, not ready to archive', () => {
    const retire = readiness(r('sug-lars-retire'))
    expect(retire.ok).toBe(false)
    expect(retire.title).toBe('Withdrawn by Lars Dahl')
  })

  it('asks a longer change to stay on screen longer before it counts as read', () => {
    const date = readTime(r('sug-ines-dates'))
    const rewrite = readTime(r('sug-ines-long'))
    expect(date).toBe(1500)
    expect(rewrite).toBeGreaterThan(date * 2)
    expect(rewrite).toBeLessThanOrEqual(8000)
  })
})
