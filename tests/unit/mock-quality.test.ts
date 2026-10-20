import { describe, expect, it } from 'vitest'
import { createMockApi } from '@/api/mock-api'
import { demoGapIds } from '@/api/mock-demo-proposals'
import { createMockWorkflow } from '@/api/mock-workflow'
import { getFixtureItems, regression, versionDays } from '@/mocks/fixtures'
import { GAP_MINIMUM_COUNT, gapFixtures, gapTopics } from '@/mocks/gaps'
import { areas, FIXTURE_TODAY, people, roleGrants, vocabulary } from '@/mocks/reference-data'
import { demoAppDays } from '@/mocks/app-days'
import { demoRatings } from '@/mocks/ratings'
import { mockTestQuestions } from '@/mocks/test-questions'

// The demo world: Sales has test questions, so it has weekly runs; the other areas none.
// Every question passes every run, except the demo's regression (mocks/items.ts): the note it
// expects was ended on 30 September, so the weekly run of 5 October fails it.
const workflow = createMockWorkflow({
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
const as = (personId: string) =>
  createMockApi({ personId: () => personId, workflow: () => Promise.resolve(workflow) })
const commercial = mockTestQuestions.filter((q) => q.area === 'area_sales')

describe('the Quality page in the mock', () => {
  it('has a weekly run of each area with questions, newest first, the newest failing the regression', async () => {
    const history = await as('per_jon').getQualityHistory({ limit: 4 })
    expect(history).toHaveLength(4)
    expect(new Set(history.map((p) => p.area))).toEqual(new Set(['area_sales']))
    const days = history.map((p) => p.finishedAt)
    expect(days).toEqual([...days].sort().reverse())
    for (const point of history) {
      expect(new Date(point.finishedAt).getUTCDay()).toBe(1)
      expect(point.costMicros).toBeGreaterThan(0)
    }
    const [newest, ...before] = history
    expect(newest).toMatchObject({
      finishedAt: '2026-10-05T04:30:00.000Z',
      questions: commercial.length,
      passed: commercial.length - 1,
      failed: 1,
      regressions: 1,
      layers: {
        code: { passed: commercial.length - 1, failed: 1 },
        judge: { passed: commercial.length - 1, failed: 1 },
      },
      failedChecks: { caveat: 1, delivered: 1 },
      retrieval: { questions: commercial.length, passed: commercial.length - 1, failed: 1 },
    })
    for (const point of before)
      expect(point).toMatchObject({
        passed: commercial.length,
        regressions: 0,
        rates: { pass: 1 },
        retrieval: { questions: commercial.length, rate: 1 },
      })
  })

  it('compares the newest run with the week before: one question got worse, on its caveat', async () => {
    const [newest, before, older] = await as('per_jon').getQualityHistory({ limit: 3 })
    const comparison = await as('per_sofia').compareRuns({ id: newest!.run })
    expect(comparison).toMatchObject({
      area: 'area_sales',
      against: { id: before!.run, edition: before!.edition },
      questions: commercial.length,
      better: [],
      worse: [
        {
          id: regression.question,
          from: 'pass',
          to: 'fail',
          failedChecks: ['caveat', 'delivered'],
        },
      ],
      unchanged: { pass: commercial.length - 1, fail: 0 },
      // One change is too few for the sign test to rule out noise.
      signTest: { better: 0, worse: 1, pValue: 1 },
    })
    // Two runs before the change gave the same results.
    expect(await as('per_jon').compareRuns({ id: before!.run, against: older!.run })).toMatchObject(
      { worse: [], better: [], signTest: { pValue: null } },
    )
    await expect(as('per_maria').compareRuns({ id: newest!.run })).rejects.toMatchObject({
      kind: 'forbidden',
    })
  })

  it('ranks the regression first in Fix next, with the checks it fails', async () => {
    const next = await as('per_ravi').getFixNext({ limit: 50 })
    expect(next.entries[0]).toMatchObject({
      kind: 'regression',
      area: 'area_sales',
      subject: { type: 'question', id: regression.question },
      checks: ['caveat', 'delivered'],
      since: '2026-10-05T04:30:00.000Z',
      reasons: [
        'Passed in the baseline run and fails in the newest weekly run',
        'Fails the retrieval check on the live edition, without a model',
      ],
    })
    expect(next.entries.filter((e) => e.subject.type === 'question')).toHaveLength(1)
    // The open gap on the same scope is in the list too, further down.
    const all = await as('per_ravi').getFixNext({ limit: 200 })
    expect(all.entries.find((e) => e.subject.id === demoGapIds.regression)).toMatchObject({
      kind: 'gap',
      subject: { label: 'gap_d4c27e9b13' },
    })
  })

  it('reads why the question failed: nothing delivered, no caveat, and the judge’s reason', async () => {
    const [newest, before] = await as('per_jon').getQualityHistory({ limit: 2 })
    const tryOf = async (run: string) => {
      const detail = await as('per_jon').getEvalRun(run)
      const result = detail!.results.find((r) => r.id === regression.question)!
      const cells = detail!.cells.filter((c) => c.questionId === regression.question)
      return { result, cells, transcript: await as('per_jon').getEvalTranscript(cells[0]!.id) }
    }
    const now = await tryOf(newest!.run)
    expect(now.result).toMatchObject({
      baseline: 'fail',
      layers: { baseline: { code: 'fail', judge: 'fail', failedChecks: ['caveat', 'delivered'] } },
    })
    // Both wordings, three tries each, every one failing.
    expect(now.cells.map((c) => c.passed)).toEqual(Array(6).fill(false))
    expect(now.transcript).toMatchObject({
      passed: false,
      scores: {
        caveat: false,
        checks: { delivered: false, caveat: false, no_cause_claim: true },
        verdict: {
          caveat_present: false,
          reason:
            'The answer leaves out the expected caveat ("Net revenue excludes test accounts."). It claims no cause.',
        },
        delivered: [],
      },
      toolCalls: [{ tool: 'get_context', status: 'no_match', items: [] }],
    })
    const then = await tryOf(before!.run)
    expect(then.result).toMatchObject({ baseline: 'pass' })
    expect(then.transcript).toMatchObject({
      passed: true,
      scores: {
        verdict: { caveat_present: true },
        delivered: [regression.item],
      },
      toolCalls: [{ status: 'matched', items: [regression.item] }],
    })
    const answer = then.transcript!.messages.at(-1) as { content: { text: string }[] }
    expect(answer.content[0]!.text).toContain('Net revenue excludes test accounts.')
  })

  it('tells why from the editions: the note was ended between the two runs', async () => {
    const [newest, before] = await as('per_jon').getQualityHistory({ limit: 2 })
    const diff = await as('per_ravi').diffEdition({
      label: newest!.edition,
      against: before!.edition,
    })
    expect(diff.items).toContainEqual({ id: regression.item, from: 1, to: 2 })
    // Each edition serves what its version said: version 1 had no end date.
    const served = async (label: string) =>
      (await as('per_ravi').exportEdition(label)).items.find((i) => i.id === regression.item)
    expect(await served(before!.edition)).toMatchObject({
      version: 1,
      validity: { end: null },
      reviewDate: regression.reviewDateBefore,
    })
    expect(await served(newest!.edition)).toMatchObject({
      version: 2,
      validity: { end: regression.end },
      reviewDate: null,
    })
    expect((await as('per_jon').getItem(regression.item))?.validity).toEqual({
      start: '2025-11-09',
      end: regression.end,
    })
    const history = await as('per_jon').getItemHistory(regression.item)
    expect(history[0]).toMatchObject({ version: 2, event: 'accepted', date: regression.accepted })
    // The retrieval pass of the live edition fails the question too, without a model.
    const latest = await as('per_jon').getRetrievalLatest({ area: 'area_sales' })
    expect(latest.run?.results.find((r) => r.id === regression.question)).toMatchObject({
      passed: false,
      checks: { delivered: false },
      wordings: [{ missing: [regression.item] }, { missing: [regression.item] }],
    })
  })

  it('ranks items past review and untested items, from the library the mock serves', async () => {
    const untested = await as('per_ravi').getUntested()
    expect(untested.areas.map((row) => row.area)).toEqual(areas.map((area) => area.id))
    const next = await as('per_ravi').getFixNext({ limit: 50 })
    expect(next.entries.length).toBeGreaterThan(0)
    // After the regression, the demo library's many items past review come first.
    expect(next.entries[1]).toMatchObject({ kind: 'past_review', subject: { type: 'item' } })
    // Only the regression's note is named by a question.
    expect(untested.areas.map((row) => row.items - row.untested)).toEqual(
      areas.map((area) => (area.id === 'area_sales' ? 1 : 0)),
    )
    const scores = next.entries.map((e) => e.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    const upkeep = await as('per_jon').getUpkeep({ area: 'area_sales', weeks: 3 })
    expect(upkeep.rows.map((row) => row.week)).toEqual([...upkeep.rows.map((r) => r.week)].sort())
    expect((await as('per_jon').getFeedbackCounts({ weeks: 2 })).rows).toHaveLength(4)
  })
})

describe('the AI apps in the mock (FR-410)', () => {
  const world = createMockWorkflow({
    today: FIXTURE_TODAY,
    areas,
    people,
    vocabulary,
    items: getFixtureItems,
    approvers: roleGrants.approvers,
    administrators: roleGrants.administrators,
    appDays: demoAppDays(FIXTURE_TODAY),
  })
  const person = (personId: string) =>
    createMockApi({ personId: () => personId, workflow: () => Promise.resolve(world) })

  it('counts each family by the week, hiding counts below the minimum, for Health readers only', async () => {
    const counts = await person('per_jon').getAppFamilyCounts({ weeks: 2 })
    const cursor = counts.rows.filter((row) => row.family === 'cursor')
    expect(cursor.map(({ week: _week, ...row }) => row)).toEqual([
      { family: 'cursor', calls: 25, needMoreDetail: 5, noMatch: 6, invalidInput: 9, errors: 0 },
      {
        family: 'cursor',
        calls: 38,
        needMoreDetail: 6,
        noMatch: 7,
        invalidInput: 11,
        errors: null,
      },
    ])
    expect(counts.rows.find((row) => row.family === 'claude_ai')).toMatchObject({
      calls: null,
      noMatch: null,
    })
    expect(
      (await person('per_jon').getAppFamilyCounts()).rows.every(
        (row) => row.week === cursor[1]!.week,
      ),
    ).toBe(true)
    await expect(person('per_maria').getAppFamilyCounts()).rejects.toMatchObject({
      kind: 'forbidden',
    })
  })
})

describe("the assistant's ratings in the mock (FR-712)", () => {
  const rated = createMockWorkflow({
    today: FIXTURE_TODAY,
    areas,
    people,
    vocabulary,
    items: getFixtureItems,
    approvers: roleGrants.approvers,
    administrators: roleGrants.administrators,
    ratings: demoRatings(FIXTURE_TODAY),
  })
  const person = (personId: string) =>
    createMockApi({ personId: () => personId, workflow: () => Promise.resolve(rated) })

  const thisWeek = '2026-10-05'
  const lastWeek = '2026-09-28'

  it("shows an owner their domains' weeks, small counts hidden with the total", async () => {
    const counts = await person('per_jon').getRatingCounts({ weeks: 3 })
    expect(counts.minimumCount).toBe(5)
    expect(counts.rows.filter((row) => row.area === 'area_sales')).toEqual([
      { area: 'area_sales', week: '2026-09-21', helpful: null, wrong: null, total: null },
      { area: 'area_sales', week: lastWeek, helpful: 5, wrong: 0, total: 5 },
      { area: 'area_sales', week: thisWeek, helpful: 6, wrong: null, total: null },
    ])
    expect(new Set(counts.rows.map((row) => row.area))).toEqual(
      new Set(['area_sales', 'area_sandbox']),
    )
  })

  it('shows an administrator every domain and the answers about no one domain', async () => {
    const counts = await person('per_ravi').getRatingCounts({ weeks: 1 })
    expect(counts.rows.find((row) => row.area === 'area_paid_media')).toEqual({
      area: 'area_paid_media',
      week: thisWeek,
      helpful: null,
      wrong: 5,
      total: null,
    })
    expect(counts.rows.at(-1)).toEqual({
      area: null,
      week: thisWeek,
      helpful: null,
      wrong: 0,
      total: null,
    })
  })

  it('counts a rating once given, in the domain of its metrics, and refuses the counts to someone without a domain', async () => {
    // No metrics: about no one domain, this week.
    expect(await person('per_maria').rateAnswer({ verdict: 'wrong' })).toEqual({ counted: true })
    expect(
      (await person('per_ravi').getRatingCounts({ weeks: 1 })).rows.find(
        (row) => row.area === null,
      ),
    ).toEqual({ area: null, week: thisWeek, helpful: null, wrong: null, total: null })
    // Orders is Sales's by the domain rule: one more wrong answer there this week.
    await person('per_maria').rateAnswer({ verdict: 'wrong', metrics: ['metric:orders'] })
    await person('per_maria').rateAnswer({ verdict: 'wrong', metrics: ['metric:orders'] })
    await person('per_maria').rateAnswer({ verdict: 'wrong', metrics: ['metric:orders'] })
    await person('per_maria').rateAnswer({ verdict: 'wrong', metrics: ['metric:orders'] })
    expect(
      (await person('per_jon').getRatingCounts({ weeks: 1 })).rows.find(
        (row) => row.area === 'area_sales',
      ),
    ).toEqual({ area: 'area_sales', week: thisWeek, helpful: 6, wrong: 5, total: 11 })
    await expect(person('per_maria').getRatingCounts()).rejects.toMatchObject({
      kind: 'forbidden',
    })
    await expect(
      person('per_maria').rateAnswer({ verdict: 'wrong', question: 'Why?' } as never),
    ).rejects.toMatchObject({ kind: 'bad-request' })
  })
})
