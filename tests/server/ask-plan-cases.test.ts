import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parsePlan } from '../../src/domain/ask-plan.ts'
import {
  classCases,
  engineDigest,
  gateCases,
  gatePasses,
  heldIds,
  plannerDigest,
  recordedPlansFile,
  planCases,
  planProblems,
  runPlanCases,
  scoreRun,
  scriptedPlan,
  stewardCases,
} from '../../src/server/modules/answer/index.ts'

// The planner cases (FR-710, FR-719) on the scripted planner, in every build: each question is
// read as a person should get it, the rules keep every question they read, with no planner call,
// and with no planner every question gets the answer Ask gives with no model.

// The held-back cases run with the others, and fail only as a count: see held-back.ts.
const held = heldIds()
const open = <T extends { id: string }>(cases: readonly T[]) => cases.filter((c) => !held.has(c.id))

describe('the planner cases, on the scripted planner', async () => {
  const got = await runPlanCases(planCases, scriptedPlan)

  it.each(open(planCases).map((c) => [c.id, c] as const))('%s', (_id, c) => {
    expect(planProblems(c, got.get(c.id)!)).toEqual([])
  })

  it('asks the planner only for what the rules cannot read, and for follow-ups', () => {
    for (const c of planCases)
      expect(got.get(c.id)!.calls, c.id).toBe(c.expect.route === 'planner' ? 1 : 0)
  })

  it('covers the 42 questions the scout asked', () => {
    const scout = planCases.filter((c) => /^[A-HX]\d$/.test(c.id))
    expect(scout).toHaveLength(42)
  })
})

describe('with no planner (no model, a spending limit, a slow provider)', async () => {
  const planned = await runPlanCases(planCases, scriptedPlan)
  const plain = await runPlanCases(planCases, null)

  it.each(planCases.map((c) => [c.id, c] as const))('%s is answered as with no model', (id, c) => {
    const got = plain.get(id)!
    expect(got.calls).toBe(0)
    expect(['rules', 'records', 'nothing']).toContain(got.route)
    // What the rules read, they read the same with a planner.
    if (c.expect.route !== 'planner' && !c.after) {
      const routed = planned.get(id)!.routed
      expect(got.routed.kind).toBe(routed.kind)
      expect(got.titles).toEqual(planned.get(id)!.titles)
    }
  })

  it('leaves a question the rules cannot read unread, never Not found', () => {
    const got = plain.get('A1')!.routed
    expect(got.kind).toBe('rules')
    if (got.kind === 'rules') {
      expect(got.answer.status).toBe('need_more_detail')
      expect(got.answer.items).toEqual([])
    }
  })
})

describe('what Ask promises (FR-720), on the scripted planner', async () => {
  const got = await runPlanCases(stewardCases, scriptedPlan)

  it.each(open(stewardCases).map((c) => [`${c.class} ${c.id}`, c] as const))('%s', (_id, c) => {
    expect(planProblems(c, got.get(c.id)!)).toEqual([])
  })

  // A count, so a failure names no case. It may only fall: one failed when the world's counts moved
  // to the one disclosure source, and nobody read which, since these are never tuned on.
  it('held back: at most one of them fails, said only as a count', async () => {
    const all = [...planCases, ...stewardCases].filter((c) => held.has(c.id))
    const run = await runPlanCases(all, scriptedPlan)
    const failing = all.filter((c) => planProblems(c, run.get(c.id)!).length).length
    expect(failing).toBeLessThanOrEqual(1)
  })

  it('passes the release gate: the scripted plans prove the reads, not the model', async () => {
    const all = [...planCases, ...stewardCases]
    const run = await runPlanCases(all, scriptedPlan)
    const score = scoreRun(all, run)
    expect(Object.keys(score.problems).filter((id) => !held.has(id))).toEqual([])
    expect(gatePasses(score)).toBe(true)
  }, 30_000)

  it('leaves what get_context says as it was', () => {
    // Over the questions the digest was first taken on: a change to the engine changes it.
    const gate = new Set([...gateCases, ...classCases].map((c) => c.id))
    const before = [...planCases, ...stewardCases].filter((c) => !gate.has(c.id))
    expect(engineDigest(before)).toBe('07ab2f843145f752')
  })
})

describe('with no planner, a limit or a slow provider, every case says what it cannot', async () => {
  for (const [name, planner] of [
    ['no model', null],
    ['a planner that gave up', () => Promise.resolve('missed' as const)],
  ] as const) {
    const plain = await runPlanCases(stewardCases, planner)

    it.each(stewardCases.map((c) => [c.id, c] as const))(`${name}: %s`, (id, c) => {
      const got = plain.get(id)!
      // No count in place of what is missing, and no refused words, whoever read it.
      for (const p of c.expect.refuse ?? [])
        expect(got.rendered).not.toMatch(typeof p === 'string' ? new RegExp(p) : p)
      expect(got.rendered).not.toMatch(/Finance counts/)
    })
  }
})

// The last real run's plans: a prompt, a vocabulary format or a model that changed since fails here
// until someone records again, so a prompt change cannot land unmeasured.
describe.runIf(existsSync(recordedPlansFile))('the plans of the last real run', async () => {
  const recorded = JSON.parse(readFileSync(recordedPlansFile, 'utf8')) as {
    digest: string
    model: string
    plans: Record<string, string>
  }
  const all = [...planCases, ...stewardCases]
  const replayed = await runPlanCases(all, (input, check) => {
    const text = recorded.plans[input.prompt]
    if (text === undefined) return Promise.resolve(null)
    const checked = check(parsePlan(text))
    return Promise.resolve(checked.ok ? checked.plan : 'missed')
  })

  it('were recorded against these instructions, this vocabulary and this model', () => {
    expect(recorded.digest).toBe(plannerDigest(recorded.model))
  })

  it('still read every case as it should be', () => {
    expect(gatePasses(scoreRun(all, replayed))).toBe(true)
  })
})
