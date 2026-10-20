import { beforeEach, describe, expect, it } from 'vitest'
import { createMockApi } from '@/api/mock-api'
import { createMockWorkflow, type MockWorkflow } from '@/api/mock-workflow'
import { getFixtureItems, versionDays } from '@/mocks/fixtures'
import { GAP_MINIMUM_COUNT, gapFixtures, gapTopics } from '@/mocks/gaps'
import { areas, FIXTURE_TODAY, people, roleGrants, vocabulary } from '@/mocks/reference-data'
import { mockTestQuestions } from '@/mocks/test-questions'

/*
  Verify by test in the mock (FR-610), as the service's verifyGapsByRun does it when a run
  finishes (src/server/modules/gaps/verify.ts): a full run of an area records the first pass of
  each linked test of its resolved gaps, and verifies a gap once every active test has passed on
  the resolving edition or a later one. The Workbench's gap record reads it (slice V5). Jon is the
  owner of Sales, Maria a contributor.
*/

const NORWAY = 'ca9a0000-0000-4000-8000-000000000001'
const SPAIN = 'ca9a0000-0000-4000-8000-00000000000a'

let workflow: MockWorkflow
beforeEach(() => {
  workflow = createMockWorkflow({
    today: FIXTURE_TODAY,
    areas,
    people,
    vocabulary,
    items: getFixtureItems,
    approvers: roleGrants.approvers,
    administrators: roleGrants.administrators,
    versionDays,
    testQuestions: mockTestQuestions,
    gaps: { topics: gapTopics, gaps: gapFixtures, minimum: GAP_MINIMUM_COUNT },
  })
})
const as = (personId: string) =>
  createMockApi({ personId: () => personId, workflow: () => Promise.resolve(workflow) })
const jon = () => as('per_jon')
/** The gap as Jon reads it; every gap here is one he manages. */
const gapOf = async (id: string) => (await jon().getGap(id))!

describe('verify by test in the mock', () => {
  it('verifies a resolved gap when a full run passes its linked test, and says so to readers', async () => {
    await jon().linkGapTest({ id: NORWAY, question: 'orders-united-kingdom-september' })
    // A run before the gap is resolved records nothing.
    await jon().startEvalRun({ id: 'area_sales' })
    expect(await gapOf(NORWAY)).toMatchObject({
      verifiedAt: null,
      tests: [expect.objectContaining({ passed: null })],
    })

    const resolved = await jon().setGapStatus({
      id: NORWAY,
      status: 'resolved',
      reason: 'The event item covers it.',
    })
    expect(resolved.resolvedEdition).toEqual(expect.any(String))
    const run = await jon().startEvalRun({ id: 'area_sales' })
    const verified = await gapOf(NORWAY)
    expect(verified.verifiedAt).toMatch(/T\d{2}:00:00Z$/)
    expect(verified.verifiedEdition).toBe(resolved.resolvedEdition)
    expect(
      verified.tests?.map((test) => [
        test.question,
        test.passed?.run,
        test.passed?.edition,
        test.latest?.run,
        test.latest?.verdict,
      ]),
    ).toEqual([
      ['orders-united-kingdom-september', run.id, resolved.resolvedEdition, run.id, 'pass'],
    ])
    expect(verified.history?.at(-1)).toMatchObject({
      action: 'gap.verified',
      details: { edition: resolved.resolvedEdition, run: run.id },
    })
    // A reader sees the fact, never which tests or the history.
    expect(await as('per_maria').getGap(NORWAY)).toMatchObject({
      verifiedAt: verified.verifiedAt,
      verifiedEdition: resolved.resolvedEdition,
      tests: null,
      history: null,
    })

    // The fact stays on another run; reopening clears it.
    await jon().startEvalRun({ id: 'area_sales' })
    expect((await gapOf(NORWAY)).verifiedAt).toBe(verified.verifiedAt)
    const reopened = await jon().setGapStatus({ id: NORWAY, status: 'open', reason: 'Back.' })
    expect(reopened).toMatchObject({ verifiedAt: null, resolvedEdition: null })
    expect(reopened.tests?.[0]?.passed).toBeNull()
    expect(reopened.history?.at(-1)?.action).toBe('gap.verification_cleared')
  })

  it('waits while a linked test fails, and needs every active test to pass', async () => {
    // The regression fails in every full run of the mock (its note ended on 30 September).
    await jon().linkGapTest({ id: SPAIN, question: 'net-revenue-month-to-date' })
    await jon().linkGapTest({ id: SPAIN, question: 'units-sold-source-lag' })
    await jon().setGapStatus({ id: SPAIN, status: 'resolved', reason: 'Fixed the note.' })
    await jon().startEvalRun({ id: 'area_sales' })
    const waiting = await gapOf(SPAIN)
    expect(waiting.verifiedAt).toBeNull()
    expect(
      waiting.tests?.map((test) => [test.question, test.passed !== null, test.latest?.verdict]),
    ).toEqual([
      ['net-revenue-month-to-date', false, 'fail'],
      ['units-sold-source-lag', true, 'pass'],
    ])

    // Without the failing test, the next run verifies it.
    await jon().unlinkGapTest({ id: SPAIN, question: 'net-revenue-month-to-date' })
    await jon().startEvalRun({ id: 'area_sales' })
    expect((await gapOf(SPAIN)).verifiedAt).not.toBeNull()
  })

  it("leaves another domain's gaps alone", async () => {
    await jon().linkGapTest({ id: NORWAY, question: 'orders-united-kingdom-september' })
    await jon().setGapStatus({ id: NORWAY, status: 'resolved', reason: 'Done.' })
    await jon()
      .startEvalRun({ id: 'area_sandbox' })
      .catch(() => undefined)
    expect((await gapOf(NORWAY)).verifiedAt).toBeNull()
  })
})
