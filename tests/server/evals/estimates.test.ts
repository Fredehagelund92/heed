import { describe, expect, it } from 'vitest'
import { cellEstimateMicros } from '../../../src/server/modules/evals/plan.ts'
import { createModelPort, type ModelRole } from '../../../src/server/modules/models/index.ts'

/*
  The dry-run estimates against what round 6 spent (14 Oct 2026, the `model_calls` ledger of each
  run, prompt cache on). Before, the estimates assumed no prompt cache and ran 1.3 to 6.1 times
  the ledger, so the runner refused ceilings the runs would have fit. Each run here has its models,
  its cells and its ledger total; the estimate must cover it without running far above.
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

const evalRuns = [
  { label: 'Haiku eval, 15 questions', model: haiku, cells: 90, ledger: 140_967 },
  { label: 'Sonnet eval, 11 questions', model: sonnet, cells: 66, ledger: 1_228_645 },
  { label: 'Sonnet eval, the other 4', model: sonnet, cells: 24, ledger: 394_811 },
]
describe('dry-run estimates, calibrated on the round 6 ledger with the prompt cache on', () => {
  it.each(evalRuns)('$label: the eval estimate is close to what it spent', (run) => {
    const models = { answer: gateway('eval_answer', run.model), judge: gateway('judge', flashLite) }
    const estimate = run.cells * cellEstimateMicros(models)
    expect(estimate / run.ledger).toBeGreaterThan(0.95)
    expect(estimate / run.ledger).toBeLessThan(1.5)
  })

  it('prices a cell mostly as prompt cache reads and writes', () => {
    const answer = gateway('eval_answer', sonnet)
    const judge = gateway('judge', flashLite)
    // 9,000 tokens read at 0.10 and 4,000 written at 2.50 a million, 1,200 out at 10; the judge
    // 1,000 in at 0.10 and 600 out at 0.40. Round 6 measured 18,038 micros a Sonnet cell.
    expect(cellEstimateMicros({ answer, judge })).toBe(23_240)
  })
})
