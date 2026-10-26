import { describe, expect, it } from 'vitest'
import { checkDue, toServerValidity, whenLabel } from '@/model/validity'
import { facts, domains, people, metrics } from '@/api/mock/data/world'
import { checkFlags, itemKinds, itemStatuses, validitySchema } from '@domain/item'
import { toServerStatus, toServerTermDomain } from '@/model/items'
import { toServerPermissions } from '@/model/people'
import { permissionsSchema } from '@contract/auth'
import { catalogueTermSchema } from '@contract/catalogue'
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
  it('give every item a kind, a status and dates the server accepts', () => {
    for (const f of facts) {
      expect(itemKinds, f.id).toContain(f.kind)
      const status = toServerStatus(f.status)
      if (status) {
        expect(itemStatuses, f.id).toContain(status.status)
        for (const flag of status.flags) expect(checkFlags, f.id).toContain(flag)
      }
      const window = toServerValidity(f.valid)
      expect(
        validitySchema.safeParse({ start: '1970-01-01', end: null, ...window }).success,
        f.id,
      ).toBe(true)
    }
  })

  it('give every person roles the server accepts, in areas that exist', () => {
    for (const p of people) {
      const held = permissionsSchema.safeParse(toServerPermissions(p))
      expect(held.success, p.name).toBe(true)
      for (const a of toServerPermissions(p).assignments)
        expect(Object.keys(domains), p.name).toContain(a.areaId)
    }
  })

  it('name each domain by an area id the server accepts', () => {
    for (const id of Object.keys(domains))
      expect(createAreaSchema.shape.id.safeParse(id).success, id).toBe(true)
  })

  it('give every metric a term domain the server accepts', () => {
    for (const m of metrics) {
      expect(
        catalogueTermSchema.shape.domain.safeParse(toServerTermDomain(m)).success,
        m.name,
      ).toBe(true)
      expect(catalogueTermSchema.shape.aliases.safeParse(m.otherNames ?? []).success, m.name).toBe(
        true,
      )
    }
  })
})
