import { describe, expect, it } from 'vitest'
import { checkDue, toServerValidity, whenLabel } from '@/model/validity'
import { facts, domains } from '@/api/mock/data/world'
import { itemKinds, validitySchema } from '@domain/item'
import { calendarDateSchema } from '@domain/validity'
import { createAreaSchema } from '@contract/areas'

// The fixtures store dates, as the real schema does; the words are derived. These are the labels
// that were typed by hand before, so the derivation says exactly what the screens said.

describe('the When people read', () => {
  it.each([
    [{}, 'Always'],
    [{ ongoing: true }, 'Still going on'],
    [{ from: '2026-08-04', ongoing: true }, 'From 4 Aug 2026, still going on'],
    [{ from: '2026-04-28' }, 'From 28 Apr 2026'],
    [{ until: '2026-01-19' }, 'Until 19 Jan 2026'],
    [{ from: '2026-05-12', until: '2026-05-19' }, '12 to 19 May 2026'],
    [{ from: '2026-03-24', until: '2026-05-09' }, '24 Mar to 9 May 2026'],
    [{ from: '2025-08-03', until: '2026-06-05' }, '3 Aug 2025 to 5 Jun 2026'],
    [{ from: '2026-08-04', until: '2026-08-04' }, '4 Aug 2026'],
  ])('%o reads %s', (valid, label) => expect(whenLabel(valid)).toBe(label))

  it('is derived for every context item, never typed by hand', () => {
    for (const f of facts) expect(f.when).toBe(whenLabel(f.valid))
  })

  it('says a check is due once its date has passed', () => {
    expect(checkDue('2026-10-02', '2026-10-23')).toBe(true)
    expect(checkDue('2027-01-20', '2026-10-23')).toBe(false)
  })
})

describe('the fixtures against the server contract', () => {
  it('give every item a kind, dates and a window the server would accept', () => {
    for (const f of facts) {
      expect(itemKinds, f.id).toContain(f.kind)
      const window = toServerValidity(f.valid)
      for (const date of [window.start, window.end].filter((d) => d !== undefined))
        expect(calendarDateSchema.safeParse(date).success, `${f.id} ${date}`).toBe(true)
      expect(
        validitySchema.safeParse({ start: '1970-01-01', end: null, ...window }).success,
        f.id,
      ).toBe(true)
    }
  })

  it('name each domain by an area id the server accepts', () => {
    for (const id of Object.keys(domains))
      expect(createAreaSchema.shape.id.safeParse(id).success, id).toBe(true)
  })
})
