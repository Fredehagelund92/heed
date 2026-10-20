import { describe, expect, it } from 'vitest'
import {
  tryEstimateMicros,
  type AssistantCase,
} from '../../../src/server/modules/assistant/index.ts'
import { typicalJudgeCall } from '../../../src/server/modules/evals/index.ts'
import { cellEstimateMicros } from '../../../src/server/modules/evals/plan.ts'
import {
  costMicros,
  createModelPort,
  type ModelRole,
} from '../../../src/server/modules/models/index.ts'

/*
  The dry-run estimates against what round 6 spent (14 Oct 2026, the `model_calls` ledger of each
  run, prompt cache on). Before, the estimates assumed no prompt cache and ran 1.3 to 6.1 times
  the ledger, so the runner refused ceilings the runs would have fit. Each run here has its models,
  its cells or turns, and its ledger total; the estimate must cover it without running far above.
  Since the voice review (section 7.5) the judge grades every turn, so a run now also pays a judge
  call for each turn round 6 left ungraded: the ledger is compared with that added.
*/

const port = createModelPort({
  mode: 'live',
  env: { VERCEL_AI_GATEWAY_API_KEY: 'vck-placeholder-not-a-key' },
})
const gateway = (role: ModelRole, model: string) =>
  port.choose(role, { provider: 'vercel-gateway', model })
const sonnet = 'anthropic/claude-sonnet-5.5'
const haiku = 'anthropic/claude-haiku-5.5'
const flashLite = 'google/gemini-2.5-flash-lite'

/** One case per turn: `graded` of them with a rubric, so the judge grades them. */
const cases = (turns: number, graded: number): AssistantCase[] =>
  Array.from({ length: turns }, (_, n) => ({
    id: `case-${n}`,
    say: () => 'Hello',
    expect: {},
    ...(n < graded ? { rubrics: ['Explains it'] } : {}),
  }))
/** The 14 repository cases: 14 turns, 4 graded. The 18 golden ones: 22 turns, 18 graded. */
const repository = cases(14, 4)
const golden = cases(22, 18)

const evalRuns = [
  { label: 'Haiku eval, 15 questions', model: haiku, cells: 90, ledger: 140_967 },
  { label: 'Sonnet eval, 11 questions', model: sonnet, cells: 66, ledger: 1_228_645 },
  { label: 'Sonnet eval, the other 4', model: sonnet, cells: 24, ledger: 394_811 },
]
const assistantRuns = [
  {
    label: 'Haiku repository x3',
    model: haiku,
    judge: flashLite,
    set: repository,
    tries: 3,
    ledger: 45_605,
  },
  {
    label: 'Haiku golden x3',
    model: haiku,
    judge: flashLite,
    set: golden,
    tries: 3,
    ledger: 71_021,
  },
  {
    label: 'Haiku repository x3, Sonnet judge',
    model: haiku,
    judge: sonnet,
    set: repository,
    tries: 3,
    ledger: 84_282,
  },
  {
    label: 'Haiku golden x3, Sonnet judge',
    model: haiku,
    judge: sonnet,
    set: golden,
    tries: 3,
    ledger: 230_344,
  },
  {
    label: 'Sonnet repository x1',
    model: sonnet,
    judge: haiku,
    set: repository,
    tries: 1,
    ledger: 180_675,
  },
  {
    label: 'Sonnet golden x1',
    model: sonnet,
    judge: haiku,
    set: golden,
    tries: 1,
    ledger: 231_207,
  },
]

describe('dry-run estimates, calibrated on the round 6 ledger with the prompt cache on', () => {
  it.each(evalRuns)('$label: the eval estimate is close to what it spent', (run) => {
    const models = { answer: gateway('eval_answer', run.model), judge: gateway('judge', flashLite) }
    const estimate = run.cells * cellEstimateMicros(models)
    expect(estimate / run.ledger).toBeGreaterThan(0.95)
    expect(estimate / run.ledger).toBeLessThan(1.5)
  })

  it.each(assistantRuns)('$label: the assistant estimate is close to what it spent', (run) => {
    const model = gateway('assistant', run.model)
    const judge = gateway('judge', run.judge)
    const estimate = run.set.reduce(
      (sum, c) => sum + run.tries * tryEstimateMicros(c, model, judge),
      0,
    )
    const ungraded = run.set.filter((c) => !c.rubrics?.length).length
    const spent = run.ledger + run.tries * ungraded * costMicros(judge.prices, typicalJudgeCall)
    expect(estimate / spent).toBeGreaterThan(1)
    // A Claude judge writes a short verdict where Flash-Lite reasons first: those runs stay highest.
    expect(estimate / spent).toBeLessThan(run.judge === flashLite ? 1.5 : 2.25)
  })

  it('prices a cell and a turn mostly as prompt cache reads and writes', () => {
    const answer = gateway('eval_answer', sonnet)
    const judge = gateway('judge', flashLite)
    // 9,000 tokens read at 0.10 and 4,000 written at 2.50 a million, 1,200 out at 10; the judge
    // 1,000 in at 0.10 and 600 out at 0.40. Round 6 measured 18,038 micros a Sonnet cell.
    expect(cellEstimateMicros({ answer, judge })).toBe(23_240)
    // 2,500 fresh at 2, 17,000 read at 0.10, 500 written at 2.50 and 1,200 out at 10. Round 6
    // measured 12,857 micros a Sonnet repository turn. The judge grades it for its voice: 340 more.
    expect(tryEstimateMicros(repository[13]!, gateway('assistant', sonnet), judge)).toBe(20_290)
  })
})
