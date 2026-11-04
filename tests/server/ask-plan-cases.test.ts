import { describe, expect, it } from 'vitest'
import {
  engineDigest,
  gatePasses,
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

describe('the planner cases, on the scripted planner', async () => {
  const got = await runPlanCases(planCases, scriptedPlan)

  it.each(planCases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
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

  it.each(stewardCases.map((c) => [`${c.class} ${c.id}`, c] as const))('%s', (_id, c) => {
    expect(planProblems(c, got.get(c.id)!)).toEqual([])
  })

  it('passes the release gate: the scripted plans prove the reads, not the model', async () => {
    const all = [...planCases, ...stewardCases]
    const run = await runPlanCases(all, scriptedPlan)
    const score = scoreRun(all, run)
    expect(score.problems).toEqual({})
    expect(gatePasses(score)).toBe(true)
  })

  it('leaves what get_context says as it was', () => {
    expect(engineDigest([...planCases, ...stewardCases])).toBe('be23418b7e7d7350')
  })
})

describe('with no planner, a limit or a slow provider, every case says what it cannot', async () => {
  for (const [name, planner] of [
    ['no model', null],
    ['a planner that gave up', async () => 'missed' as const],
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
