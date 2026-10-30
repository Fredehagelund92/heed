import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  clearsVerification,
  dimensionOfValue,
  gapOrigin,
  visibleCount,
} from '../../../src/domain/gaps.ts'
import { noteFindings } from '../../../src/domain/gap-reports.ts'

it('hides counts from one to just under the minimum, and shows zero and the rest', () => {
  expect([0, 1, 4, 5, 6].map((n) => visibleCount(n, 5))).toEqual([0, null, null, 5, 6])
  fc.assert(
    fc.property(fc.nat(1000), fc.integer({ min: 1, max: 100 }), (count, minimum) => {
      const shown = visibleCount(count, minimum)
      expect(shown === null).toBe(count > 0 && count < minimum)
    }),
  )
})

it('names the five ways a gap opens by case number', () => {
  expect([1, 2, 3, 4, 5].map(gapOrigin)).toEqual([
    'no_item_calls',
    'report_gap',
    'feedback',
    'source_change',
    'person',
  ])
  expect(() => gapOrigin(6)).toThrow(/Unknown gap case/)
  expect(() => gapOrigin(0)).toThrow(/Unknown gap case/)
})

it("names a value's dimension by its key", () => {
  expect(dimensionOfValue('val:market/norway')).toBe('dim:market')
})

it('refuses a note with personal data, a secret or the question, and names why', () => {
  expect(noteFindings('Norway closed on 4 August.')).toEqual([])
  expect(noteFindings('Mail ravi@example.test').map((finding) => finding.code)).toEqual([
    'email_address',
  ])
  // Words FR-117's check lets through, but an anonymous note must not hold.
  expect(noteFindings('the api key is in the vault').map((finding) => finding.code)).toEqual([
    'personal_data',
  ])
  expect(noteFindings('call 0045 1234 5678').map((finding) => finding.code)).toEqual([
    'personal_data',
  ])
  const question = 'Why did orders in Norway drop so sharply in the first week of August?'
  expect(noteFindings(`Asked: ${question}`, question).map((finding) => finding.field)).toEqual([
    'note',
  ])
  expect(noteFindings('Orders in Norway', question)).toEqual([])
})

describe('a gap leaving resolved (FR-610)', () => {
  it('clears verification whenever a gap leaves resolved, and only then', () => {
    expect(clearsVerification('resolved', 'open')).toBe(true)
    expect(clearsVerification('resolved', 'wont_fix')).toBe(true)
    expect(clearsVerification('resolved', 'proposal_made')).toBe(true)
    expect(clearsVerification('resolved', 'resolved')).toBe(false)
    expect(clearsVerification('open', 'resolved')).toBe(false)
    expect(clearsVerification('proposal_made', 'wont_fix')).toBe(false)
  })
})
