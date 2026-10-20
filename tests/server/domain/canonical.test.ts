import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import fc from 'fast-check'
import {
  canonicalJson,
  contentDigest,
  editionDigest,
  sha256,
} from '../../../src/domain/canonical.ts'
import { itemVersionDigests } from '../../../src/domain/item-version.ts'
import { overlaps, dateWindowSchema, shiftDate } from '../../../src/domain/validity.ts'
import { version } from './fixtures.ts'

it('canonicalizes nested keys while retaining array order and Unicode', () => {
  expect(canonicalJson({ z: [3, 1], a: { ø: 'æ', a: -0 } })).toBe('{"a":{"a":0,"ø":"æ"},"z":[3,1]}')
  for (const value of [
    NaN,
    Infinity,
    undefined,
    1n,
    new Date('2026-01-01'),
    { x: undefined },
    Array.from({ length: 1 }, () => undefined),
    '\ud800',
  ])
    expect(() => canonicalJson(value)).toThrow()
  const cycle: unknown[] = []
  cycle.push(cycle)
  expect(() => canonicalJson(cycle)).toThrow()
})
it('round trips canonical JSON and digest over generated JSON values', async () => {
  await fc.assert(
    fc.asyncProperty(fc.jsonValue(), async (value) => {
      const encoded = canonicalJson(value)
      expect(canonicalJson(JSON.parse(encoded) as unknown)).toBe(encoded)
      expect(await contentDigest(value)).toBe(createHash('sha256').update(encoded).digest('hex'))
    }),
    { seed: 19, numRuns: 500 },
  )
})
it('matches SHA-256 known vectors and edition SQL preimages without a database', async () => {
  expect(await sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  expect(await sha256('abc')).toBe(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
  const content = {
    items: [{ id: 'itm_12345678', digest: 'a'.repeat(64) }],
    vocabulary: [{ key: 'metric:x', digest: 'b'.repeat(64) }],
    areas: [{ id: 'finance', state: 'live' as const }],
  }
  const preimage = `area:finance:live\nitem:itm_12345678:${'a'.repeat(64)}\nvocab:metric:x:${'b'.repeat(64)}`
  expect(await editionDigest(content)).toBe(createHash('sha256').update(preimage).digest('hex'))
  expect(() => editionDigest({ ...content, items: [...content.items, ...content.items] })).toThrow()
})
it('includes mentions in content digests and ignores review dates and marks only in core digests', async () => {
  const original = await itemVersionDigests(version())
  const review = await itemVersionDigests(version({ reviewDate: '2027-01-01' }))
  expect(review.content).not.toBe(original.content)
  expect(review.core).toBe(original.core)
  const changed = await itemVersionDigests(
    version({
      summaryMarkup: 'Online sales stopped in @[Norway](val:market/spain).',
      mentions: [{ field: 'summary', position: 0, target: 'val:market/spain', label: 'Norway' }],
    }),
  )
  expect(changed.core).not.toBe(original.core)
  expect(await itemVersionDigests(version({ body: undefined }))).toEqual(original)
})
it('validates half-open UTC date windows and symmetric overlap against day enumeration', () => {
  expect(dateWindowSchema.safeParse({ start: '2026-02-29', end: null }).success).toBe(false)
  expect(shiftDate('2024-02-28', 1)).toBe('2024-02-29')
  expect(
    overlaps({ start: '2026-01-01', end: '2026-01-02' }, { start: '2026-01-02', end: null }),
  ).toBe(false)
  fc.assert(
    fc.property(
      fc.tuple(fc.integer({ min: 0, max: 30 }), fc.integer({ min: 1, max: 30 })),
      fc.tuple(fc.integer({ min: 0, max: 30 }), fc.integer({ min: 1, max: 30 })),
      ([a, al], [b, bl]) => {
        const left = { start: shiftDate('2026-01-01', a), end: shiftDate('2026-01-01', a + al) }
        const right = { start: shiftDate('2026-01-01', b), end: shiftDate('2026-01-01', b + bl) }
        const expected = Array.from({ length: al }, (_, i) => a + i).some(
          (day) => day >= b && day < b + bl,
        )
        expect(overlaps(left, right)).toBe(expected)
        expect(overlaps(right, left)).toBe(expected)
      },
    ),
    { seed: 7, numRuns: 1000 },
  )
})

it('round trips governed versions with the same content and core digests', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.string({ maxLength: 100 }),
      fc.integer({ min: 1, max: 300 }),
      async (summary, reviewDays) => {
        const item = version({
          summary,
          summaryMarkup: undefined,
          mentions: [],
          reviewDate: shiftDate('2026-08-04', reviewDays),
        })
        const roundTrip = JSON.parse(JSON.stringify(item)) as typeof item
        expect(await itemVersionDigests(roundTrip)).toEqual(await itemVersionDigests(item))
      },
    ),
    { seed: 91, numRuns: 500 },
  )
})
