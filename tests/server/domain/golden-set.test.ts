import { describe, expect, it } from 'vitest'
import { canaries, goldenFixtureItems, goldenLibrary } from '../../../db/seed/golden-fixtures.ts'
import { loadGoldenSet } from '../../../db/seed/golden-set.ts'
import {
  deliveryChecks,
  deliverySchema,
  goldenCaseSchema,
  sharedPhrases,
} from '../../../src/domain/golden-set.ts'
import { generateItems } from '../../../src/web/mocks/items.ts'
import { goldenSetChecks, wholeSetOnly } from './golden-checks.ts'

const set = loadGoldenSet()

describe('the golden set (output test plan, section 2)', () => {
  // The checks of the whole set run in tests/server/held-out.test.ts, with the held-out cases.
  for (const [name, check] of Object.entries(goldenSetChecks))
    if (!wholeSetOnly.has(name)) it(name, () => check(set))

  it('keeps every held-out case out of the visible file: they are sealed (FR-525)', () => {
    expect(set.cases.filter((c) => c.split === 'held_out')).toEqual([])
    expect(set.assistant.filter((c) => c.split === 'held_out')).toEqual([])
  })

  it('refuses a wording a comma cut in two: a text and a stray key', () => {
    expect(
      goldenCaseSchema.safeParse({
        ...set.cases[0],
        wordings: [
          { kind: 'natural', text: 'How is the metric net revenue defined', 'and where?': null },
          set.cases[0]!.wordings[1],
        ],
      }).success,
    ).toBe(false)
  })
})

describe('the golden fixtures', () => {
  it('come after the generated library, which keeps every id', () => {
    const generated = generateItems()
    expect(goldenLibrary().slice(0, generated.length)).toEqual(generated)
    expect(goldenFixtureItems.every((item) => !generated.some((g) => g.id === item.id))).toBe(true)
  })

  it('carry each canary in exactly one fixture and nowhere in the generated library', () => {
    const text = (items: typeof goldenFixtureItems) => items.map((item) => JSON.stringify(item))
    for (const canary of Object.values(canaries)) {
      expect(text(goldenFixtureItems).filter((t) => t.includes(canary))).toHaveLength(
        canary === canaries.link ? 2 : 1,
      )
      expect(text(generateItems()).some((t) => t.includes(canary))).toBe(false)
    }
  })
})

describe('the L1 checks of one reply', () => {
  const expected = deliverySchema.parse({
    status: 'matched',
    must_deliver: ['itm_aaaaaaaa'],
    must_not_deliver: ['itm_bbbbbbbb'],
    versions: { itm_aaaaaaaa: 2 },
    unverified: ['itm_aaaaaaaa'],
    text: ['test accounts'],
    source_refs: ['cube:revenue.net_revenue'],
    size_max: 500,
  })
  const item = {
    id: 'itm_aaaaaaaa',
    version: 2,
    freshness: 'unverified',
    links: [{ target: { source_ref: 'cube:revenue.net_revenue' } }],
  }
  it('passes a reply that gives what the case expects', () => {
    const reply = {
      say: 'Heed has 1 item for Net revenue, Norway, 1-7 Oct 2026.',
      status: 'matched',
      context: [item],
      check_report: { cut: false },
    }
    const checks = deliveryChecks(expected, reply, 'excludes test accounts')
    expect(Object.values(checks).every(Boolean)).toBe(true)
    // The concise reply flags an item that may be out of date in its own words.
    const concise = {
      ...reply,
      context: [{ id: 'itm_aaaaaaaa', version: 2, may_be_out_of_date: true, links: item.links }],
    }
    expect(
      Object.values(deliveryChecks(expected, concise, 'excludes test accounts')).every(Boolean),
    ).toBe(true)
    expect(Object.keys(checks).sort()).toEqual(
      [
        'cut',
        'delivered',
        'not_delivered',
        'rank',
        'say',
        'served',
        'size',
        'source_refs',
        'status',
        'text',
        'unverified',
        'version',
      ].sort(),
    )
  })
  it('fails each check on its own', () => {
    const filler = Array.from({ length: 5 }, (_, i) => ({ id: `itm_filler0${i}` }))
    const reply = {
      status: 'no_match',
      context: [...filler, { id: 'itm_aaaaaaaa', version: 1 }, { id: 'itm_bbbbbbbb' }],
      check_report: { cut: true },
    }
    expect(deliveryChecks(expected, reply, 'x'.repeat(501))).toEqual({
      served: true,
      delivered: true,
      not_delivered: false,
      cut: false,
      say: false,
      status: false,
      rank: false,
      version: false,
      unverified: false,
      text: false,
      size: false,
      source_refs: false,
    })
  })
})

describe('the leakage lint', () => {
  it('finds a shared phrase, but not the scope names a question must say', () => {
    const sources = ['Orders excludes test accounts']
    expect(
      sharedPhrases('Do orders in the United Kingdom include test accounts?', sources),
    ).toEqual(['test accounts'])
    expect(
      sharedPhrases('How did orders in the United Kingdom do last week?', sources, ['Orders']),
    ).toEqual([])
  })
})
