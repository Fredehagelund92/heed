import { beforeEach, describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { ApiError } from '@/api'
import { createMockApi } from '@/api/mock-api'
import { createMockWorkflow, type MockWorkflow } from '@/api/mock-workflow'
import { getFixtureItems, regression, versionDays } from '@/mocks/fixtures'
import { areas, FIXTURE_TODAY, people, roleGrants, vocabulary } from '@/mocks/reference-data'
import { mockTestQuestions } from '@/mocks/test-questions'

/*
  The Quality page's writes and its one-level-down reads in the mock, by the service's rules
  (src/server/modules/evals): writing, setting aside, importing and exporting test questions, the
  runs list with the weekly runs, a run's tries and their transcripts, and starting a run. Ravi is
  an administrator, Jon the owner of Sales and Sandbox, Maria a contributor.
*/

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
  })
})
const as = (personId: string) =>
  createMockApi({ personId: () => personId, workflow: () => Promise.resolve(workflow) })

const refusal = async (call: Promise<unknown>) => {
  const error = await call.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(ApiError)
  return (error as ApiError).kind
}

const question = (id: string, area = 'area_sales') => ({
  id,
  area,
  wordings: [
    { kind: 'natural' as const, text: 'Why did orders fall in the Netherlands last week?' },
    {
      kind: 'precise' as const,
      text: 'What explains orders in the Netherlands, 28 Sep to 4 Oct 2026?',
    },
  ],
  scope: {},
  expected: { must_deliver: [], must_not_deliver: [] },
  source: 'Sales analysts, October 2026',
})

describe('test questions in the mock', () => {
  it('lets an owner write one in their domain, and change it on the revision read', async () => {
    const saved = await as('per_jon').saveTestQuestion({
      id: 'orders-netherlands-week',
      question: question('orders-netherlands-week'),
    })
    expect(saved).toMatchObject({ revision: 1, setAsideReason: null, status: 'active' })
    expect(
      (await as('per_jon').listTestQuestions({ area: 'area_sales' })).map((q) => q.id),
    ).toContain('orders-netherlands-week')

    const changed = await as('per_jon').saveTestQuestion({
      id: 'orders-netherlands-week',
      revision: 1,
      question: { ...question('orders-netherlands-week'), risk: 'high' },
    })
    expect(changed).toMatchObject({ revision: 2, risk: 'high' })
    // Saving on the old revision again is a conflict, and a new one with a taken id too.
    expect(
      await refusal(
        as('per_jon').saveTestQuestion({
          id: 'orders-netherlands-week',
          revision: 1,
          question: question('orders-netherlands-week'),
        }),
      ),
    ).toBe('conflict')
    expect(
      await refusal(
        as('per_jon').saveTestQuestion({
          id: 'orders-netherlands-week',
          question: question('orders-netherlands-week'),
        }),
      ),
    ).toBe('conflict')
  })

  it('refuses a domain the person does not maintain, and a contributor', async () => {
    expect(
      await refusal(
        as('per_jon').saveTestQuestion({
          id: 'spend-question',
          question: question('spend-question', 'area_marketing'),
        }),
      ),
    ).toBe('forbidden')
    expect(
      await refusal(
        as('per_maria').saveTestQuestion({
          id: 'maria-question',
          question: question('maria-question'),
        }),
      ),
    ).toBe('forbidden')
    expect(await refusal(as('per_maria').exportTestQuestions())).toBe('forbidden')
  })

  it('sets a question aside with a reason and brings it back', async () => {
    const [first] = await as('per_jon').listTestQuestions({ area: 'area_sales' })
    const aside = await as('per_jon').setAsideTestQuestion({
      id: first!.id,
      revision: first!.revision,
      reason: 'The market closed',
    })
    expect(aside.setAsideReason).toBe('The market closed')
    const back = await as('per_jon').setAsideTestQuestion({
      id: first!.id,
      revision: first!.revision,
      reason: null,
    })
    expect(back.setAsideReason).toBeNull()
  })

  it('checks an import without saving, then saves it; a broken entry blocks the whole file', async () => {
    const content = stringify({ questions: [question('imported-one')] })
    const dry = await as('per_jon').importTestQuestions({ content, dryRun: true })
    expect(dry).toMatchObject({ applied: false, created: ['imported-one'], errors: [] })
    expect((await as('per_jon').listTestQuestions()).map((q) => q.id)).not.toContain('imported-one')
    const applied = await as('per_jon').importTestQuestions({ content, dryRun: false })
    expect(applied.applied).toBe(true)
    expect((await as('per_jon').listTestQuestions()).map((q) => q.id)).toContain('imported-one')

    // The same file again changes nothing.
    expect(await as('per_jon').importTestQuestions({ content, dryRun: true })).toMatchObject({
      unchanged: ['imported-one'],
      created: [],
    })

    const broken = await as('per_jon').importTestQuestions({
      content: stringify([question('fine-one'), { id: 'no-wordings', area: 'area_sales' }]),
      dryRun: false,
    })
    expect(broken.applied).toBe(false)
    expect(broken.errors).toHaveLength(1)
    expect(broken.errors[0]).toMatchObject({ index: 1, id: 'no-wordings' })
    expect(
      (await as('per_jon').importTestQuestions({ content: '{', dryRun: true })).errors[0]?.message,
    ).toBe("We couldn't read this file. Use YAML or JSON.")
  })

  it('exports the questions as YAML that imports back unchanged', async () => {
    const { content } = await as('per_jon').exportTestQuestions({ area: 'area_sales' })
    expect(content).toMatch(/^questions:/)
    const again = await as('per_jon').importTestQuestions({ content, dryRun: true })
    expect(again.errors).toEqual([])
    expect(again.created).toEqual([])
    expect(again.unchanged.length).toBe(
      mockTestQuestions.filter((q) => q.area === 'area_sales').length,
    )
  })
})

describe('runs in the mock', () => {
  it('lists the weekly runs with the proposals’ runs, newest first, only for maintainers', async () => {
    const runs = await as('per_jon').listEvalRuns({ area: 'area_sales', limit: 5 })
    expect(runs).toHaveLength(5)
    const created = runs.map((run) => run.createdAt)
    expect(created).toEqual([...created].sort().reverse())
    expect(runs.some((run) => run.kind === 'scheduled')).toBe(true)
    expect(await refusal(as('per_maria').listEvalRuns())).toBe('forbidden')
  })

  it('reads a weekly run with its tries, and a try’s transcript', async () => {
    const [weekly] = (await as('per_jon').listEvalRuns({ limit: 50 })).filter(
      (run) => run.kind === 'scheduled',
    )
    const detail = await as('per_jon').getEvalRun(weekly!.id)
    // The newest weekly run fails only the demo's regression (mocks/items.ts).
    expect(
      detail?.results.filter((result) => result.baseline !== 'pass').map((result) => result.id),
    ).toEqual([regression.question])
    expect(detail?.cells.length).toBeGreaterThan(0)
    const cell = detail!.cells[0]!
    const transcript = await as('per_jon').getEvalTranscript(cell.id)
    expect(transcript).toMatchObject({ cellId: cell.id, runId: weekly!.id, passed: true })
    expect(transcript?.messages.length).toBeGreaterThan(1)
    const failed = detail!.cells.find((c) => c.questionId === regression.question)!
    expect(failed.passed).toBe(false)
    expect(await as('per_jon').getEvalTranscript(failed.id)).toMatchObject({
      passed: false,
      scores: { checks: { delivered: false, caveat: false }, statuses: ['no_match'] },
      toolCalls: [{ tool: 'get_facts', status: 'no_match', items: [] }],
    })
    // Someone who does not maintain the domain reads neither.
    expect(await as('per_maria').getEvalTranscript(cell.id)).toBeNull()
    expect(await as('per_maria').getEvalRun(weekly!.id)).toBeNull()
  })

  it('estimates and starts a full run that finishes at once, and compares it with the week before', async () => {
    const estimate = await as('per_jon').estimateEvalRun({ id: 'area_sales' })
    expect(estimate).toMatchObject({ area: 'area_sales', needsApproval: false })
    expect(estimate.questions).toBe(mockTestQuestions.length)
    const run = await as('per_jon').startEvalRun({ id: 'area_sales' })
    expect(run).toMatchObject({ kind: 'full', state: 'finished', requestedBy: 'per_jon' })
    expect((await as('per_jon').listEvalRuns({ limit: 1 }))[0]?.id).toBe(run.id)
    const comparison = await as('per_jon').compareRuns({ id: run.id })
    expect(comparison.run.kind).toBe('full')
    expect(comparison.against?.id).toBeTruthy()
    // The live edition still withholds the regression's note, so the run fails it as the week
    // before did: nothing changed.
    expect(comparison).toMatchObject({ worse: [], unchanged: { fail: 1 } })
    expect(comparison.signTest).toEqual({ better: 0, worse: 0, pValue: null })
    // It has ended, so it cannot be cancelled; and it never waits for approval.
    expect(await refusal(as('per_jon').cancelEvalRun({ id: run.id }))).toBe('conflict')
    expect(await refusal(as('per_ravi').approveEvalRun({ id: run.id }))).toBe('conflict')
    expect(await refusal(as('per_jon').approveEvalRun({ id: run.id }))).toBe('forbidden')
    expect(await refusal(as('per_jon').startEvalRun({ id: 'area_marketing' }))).toBe('forbidden')
  })
})
