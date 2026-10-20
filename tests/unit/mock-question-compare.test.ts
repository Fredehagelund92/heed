import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '@/api'
import { createMockApi } from '@/api/mock-api'
import { scriptedTry } from '@/api/mock-runs'
import { createMockWorkflow, type MockWorkflow } from '@/api/mock-workflow'
import { getFixtureItems, versionDays } from '@/mocks/fixtures'
import { areas, FIXTURE_TODAY, people, roleGrants, vocabulary } from '@/mocks/reference-data'
import { regression } from '@/mocks/items'
import { mockTestQuestions } from '@/mocks/test-questions'

/*
  The Workbench's two reads of one test question in the mock (slice W3), by the service's rules
  (src/server/modules/quality/question.ts): the question across two runs of its area, try by try,
  with what was held constant and the items that changed between the editions, and its history.
  Ravi is an administrator, Jon the owner of Sales and Sandbox, Maria a contributor.
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

const question = mockTestQuestions.find((q) => q.area === 'area_sales')!

describe('one test question across two runs in the mock', () => {
  it('pairs each try of the newest weekly run with the week before, with the judge and the answer', async () => {
    const history = await as('per_jon').getQuestionHistory({ question: question.id })
    const [newest, before] = history.runs
    const comparison = await as('per_jon').compareQuestion({
      question: question.id,
      run: newest!.run,
    })
    expect(comparison).toMatchObject({
      question: question.id,
      area: 'area_sales',
      run: { run: { id: newest!.run, kind: 'scheduled' }, revision: question.revision },
      against: { run: { id: before!.run } },
      unknown: [],
    })
    expect(comparison.run.wordings).toHaveLength(question.wordings.length)
    for (const wording of comparison.run.wordings) {
      expect(wording.tries.map((t) => t.trial)).toEqual([1, 2, 3])
      for (const attempt of wording.tries) {
        expect(attempt.judgeReason).toBe(
          scriptedTry(question, question.expected.must_deliver).verdict.reason,
        )
        expect(attempt.answer).toBeTruthy()
        expect(attempt.delivered).toEqual(question.expected.must_deliver)
        // The cell opens the try's transcript.
        expect((await as('per_jon').getEvalTranscript(attempt.cell))?.cellId).toBe(attempt.cell)
      }
    }
    // The mock's runs share models, tools, prompt and revision: at most the edition differs.
    expect(comparison.heldConstant).toEqual(
      expect.arrayContaining(['revision', 'wordings', 'tries', 'answer_model', 'judge_model']),
    )
    expect(comparison.changed.filter((factor) => factor !== 'edition')).toEqual([])
    if (comparison.changed.includes('edition'))
      for (const item of comparison.items)
        expect(item.delivered.run || item.named.length).toBeTruthy()
    else expect(comparison.items).toEqual([])
  })

  it('lists the items a question names that changed between the two editions, from the edition diff', async () => {
    const runs = (await as('per_ravi').getQuestionHistory({ question: question.id, limit: 52 }))
      .runs
    const [newest, oldest] = [runs[0]!, runs.at(-1)!]
    const diff = await as('per_ravi').diffEdition({
      label: newest.edition,
      against: oldest.edition,
    })
    const changed = diff.items.find((item) => item.from !== null && item.to !== null)!
    // A question that names the changed item, and one item that stayed the same.
    const still = getFixtureItems().find(
      (item) => item.status === 'accepted' && !diff.items.some((d) => d.id === item.id),
    )!
    await as('per_jon').saveTestQuestion({
      id: 'names-a-changed-item',
      question: {
        ...question,
        id: 'names-a-changed-item',
        expected: { must_deliver: [changed.id], must_not_deliver: [still.id] },
      },
    })
    const comparison = await as('per_ravi').compareQuestion({
      question: 'names-a-changed-item',
      run: newest.run,
      against: oldest.run,
    })
    // A run's edition delivers the item only on days it is in force.
    const inForce = getFixtureItems().find((item) => item.id === changed.id)!.validity.start
    // The oldest run is from before the judge was replaced: not only the edition differs.
    expect(comparison.changed).toEqual(['edition', 'judge_model'])
    // Every version of a fixture item but the demo's regression holds the same content, as the
    // database seed stores them, so the editions engine reads the newer one as saved again, as the
    // service does.
    expect(comparison.items).toEqual([
      expect.objectContaining({
        itemId: changed.id,
        change: 'resaved',
        fields: [],
        named: ['must_deliver'],
        delivered: { run: true, against: inForce <= oldest.finishedAt.slice(0, 10) },
      }),
    ])
  })

  it("shows the demo's regression: the week it fails, try by try, against the week it passed", async () => {
    const [newest] = (await as('per_jon').getQuestionHistory({ question: regression.question }))
      .runs
    const comparison = await as('per_jon').compareQuestion({
      question: regression.question,
      run: newest!.run,
    })
    expect(comparison).toMatchObject({
      run: { run: { finishedAt: '2026-10-05T04:30:00.000Z' }, verdict: 'fail' },
      against: { verdict: 'pass' },
      changed: ['edition'],
    })
    const tries = (side: typeof comparison.run) => side.wordings.flatMap((w) => w.tries)
    expect(
      tries(comparison.run).every((t) => !t.passed && !t.delivered.includes(regression.item)),
    ).toBe(true)
    expect(
      tries(comparison.against!).every((t) => t.passed && t.delivered.includes(regression.item)),
    ).toBe(true)
    expect(comparison.items).toEqual([
      expect.objectContaining({
        itemId: regression.item,
        delivered: { run: false, against: true },
      }),
    ])
  })

  it('has no other side for the first weekly run, and refuses what the service refuses', async () => {
    // Every weekly run since the first edition: the mock does not cap the limit.
    const weekly = await as('per_jon').getQualityHistory({ area: 'area_sales', limit: 10_000 })
    const first = weekly.at(-1)!
    expect(
      await as('per_jon').compareQuestion({ question: question.id, run: first.run }),
    ).toMatchObject({ against: null, heldConstant: [], changed: [], unknown: [], items: [] })
    expect(await refusal(as('per_maria').getQuestionHistory({ question: question.id }))).toBe(
      'forbidden',
    )
    expect(
      await refusal(
        as('per_jon').compareQuestion({ question: 'no-such-question', run: first.run }),
      ),
    ).toBe('not-found')
    // A run of another area is not this question's.
    const other = await as('per_ravi').listEvalRuns({ area: 'area_sandbox', limit: 1 })
    if (other[0])
      expect(
        await refusal(as('per_ravi').compareQuestion({ question: question.id, run: other[0].id })),
      ).toBe('invalid')
  })
})

describe("one test question's history in the mock", () => {
  it('lists the weekly runs newest first, and a full run someone started', async () => {
    const started = await as('per_jon').startEvalRun({ id: 'area_sales' })
    const history = await as('per_jon').getQuestionHistory({ question: question.id, limit: 4 })
    expect(history.runs).toHaveLength(4)
    expect(history.runs[0]).toMatchObject({
      run: started.id,
      kind: 'full',
      state: 'tested',
      verdict: 'pass',
    })
    const finished = history.runs.map((run) => run.finishedAt)
    expect(finished).toEqual([...finished].sort().reverse())
    expect(history.retrieval.length).toBeGreaterThan(0)
    expect(history.retrieval.every((pass) => pass.passed)).toBe(true)
  })
})
