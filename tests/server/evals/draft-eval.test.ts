import { describe, expect, it } from 'vitest'
import { evaluateSeed, reportLines, wilson } from '../../../scripts/draft-eval.ts'

/*
  The draft tool's derivation over the 1,500 seeded items, in every build (FR-121; the agent
  capture report, sections 6 and 7). The bars are on the held-out third and hold the
  deterministic parts where they are: a drop is a regression in the rules. The seed's area, risk,
  claim and audience are random, so those are measured but not held to a bar.
*/

const { tuned, heldOut } = evaluateSeed()

describe('the draft tool on the seeded library', () => {
  it('holds one third out, chosen by the item id', () => {
    expect(tuned.items + heldOut.items).toBe(1500)
    expect(heldOut.items).toBeGreaterThan(400)
    expect(heldOut.items).toBeLessThan(600)
  })
  it.each([
    ['tuned', tuned],
    ['held-out', heldOut],
  ] as const)(
    'never sets risk, claim or audience, a key outside the vocabulary or evidence without a link (%s)',
    (_half, result) => {
      expect(result.guarantees).toEqual({
        riskClaimOrAudienceSet: 0,
        keysOutsideVocabulary: 0,
        evidenceWithoutALink: 0,
      })
    },
  )
  it('keeps the held-out accuracy of the deterministic parts', () => {
    expect(heldOut.kind.accuracy.low).toBeGreaterThanOrEqual(0.95)
    expect(heldOut.validity.startRightWhenNamed.low).toBeGreaterThanOrEqual(0.88)
    expect(heldOut.scope.metricsFromText.precision.low).toBeGreaterThanOrEqual(0.75)
    expect(heldOut.scope.dimensionValues.precision.low).toBeGreaterThanOrEqual(0.9)
    expect(heldOut.scope.metricsWithWorkingScope.exactSet.low).toBeGreaterThanOrEqual(0.5)
    expect(heldOut.scope.metricsWithWorkingScope.recall.rate).toBeGreaterThan(
      heldOut.scope.metricsFromText.recall.rate,
    )
    expect(heldOut.questionsPerItem).toBeLessThanOrEqual(4)
  })
  it('reports every attribute as counts with an interval', () => {
    const lines = reportLines(heldOut)
    expect(lines.join('\n')).toMatch(/kind accuracy \d+\.\d% \(\d+\/\d+, 95% /)
    expect(lines.some((line) => line.startsWith('domain decided'))).toBe(true)
    expect(lines.some((line) => line.startsWith('high-risk items'))).toBe(true)
  })
})

describe('the Wilson interval', () => {
  it('matches known values and stays within 0 and 1', () => {
    const half = wilson(50, 100)
    expect(half.low).toBeCloseTo(0.4038, 3)
    expect(half.high).toBeCloseTo(0.5962, 3)
    expect(wilson(0, 10).low).toBe(0)
    expect(wilson(10, 10).high).toBeCloseTo(1, 12)
    expect(wilson(0, 0)).toMatchObject({ rate: 0, low: 0, high: 0 })
  })
})
