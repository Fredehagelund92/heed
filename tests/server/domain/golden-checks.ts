import { goldenLibrary } from '../../../db/seed/golden-fixtures.ts'
import { goldenQuestionSchema } from '../../../src/domain/golden-question.ts'
import {
  caseTypes,
  sharedPhrases,
  toQuestion,
  type CaseType,
  type GoldenSet,
} from '../../../src/domain/golden-set.ts'
import { vocabulary } from '../../../db/seed/fixtures/reference-data.ts'
import { expect } from 'vitest'

/*
  What the golden set must hold (output test plan, section 2), each check a function of the set.
  tests/server/domain/golden-set.test.ts runs them on the visible cases in every build, except
  those about the whole set; tests/server/held-out.test.ts runs every one of them on the whole
  set, with the sealed held-out cases (FR-525), where the key is given, and reports only which
  failed.
*/

const library = new Map(goldenLibrary().map((item) => [item.id, item]))
const domains = {
  area_commercial: 'C',
  area_marketing: 'M',
  area_sandbox: 'S',
  area_customer_value: 'P',
  area_paid_media: 'D',
} as const

/** The plan's table (output test plan, section 2): cases per type, spread C/M/S/P/D. */
const plan: Partial<Record<CaseType, string>> = {
  baseline: '2/2/2/0/0',
  stale: '1/1/1/1/0',
  superseded: '2/1/1/0/0',
  conflict: '1/1/1/0/1',
  ambiguous: '2/1/1/1/0',
  missing: '1/1/1/1/1',
  injection: '1/1/1/0/1',
  personal_data: '1/1/1/0/0',
  out_of_remit: '1/1/1/1/0',
  date: '2/1/1/1/0',
  alias: '1/1/1/0/0',
  two_items: '2/1/1/1/0',
}
const spread = (set: GoldenSet, type: CaseType) =>
  (['C', 'M', 'S', 'P', 'D'] as const)
    .map(
      (d) =>
        set.cases.filter((c) => c.type === type && domains[c.area as keyof typeof domains] === d)
          .length,
    )
    .join('/')
const coreOf = (set: GoldenSet) => set.cases.filter((c) => c.type in plan)

export const goldenSetChecks: Record<string, (set: GoldenSet) => void> = {
  'has the 52 cases of the plan, by type and domain': (set) => {
    const core = coreOf(set)
    expect(core).toHaveLength(52)
    for (const type of Object.keys(plan) as CaseType[])
      expect({ type, spread: spread(set, type) }).toEqual({ type, spread: plan[type] })
  },
  'holds out 16 of the 52, at least one of every type, and one definition and one conversation': (
    set,
  ) => {
    const core = coreOf(set)
    expect(core.filter((c) => c.split === 'held_out')).toHaveLength(16)
    for (const type of caseTypes)
      expect({
        type,
        heldOut: set.cases.some((c) => c.type === type && c.split === 'held_out'),
      }).toEqual({ type, heldOut: true })
  },
  'asks plain definition questions across the domains, including names that are no metric': (
    set,
  ) => {
    const definitions = set.cases.filter((c) => c.type === 'definition')
    expect(definitions.length).toBeGreaterThanOrEqual(8)
    expect(new Set(definitions.map((c) => c.area)).size).toBeGreaterThanOrEqual(4)
    expect(definitions.some((c) => c.definition?.term === null)).toBe(true)
    expect(definitions.some((c) => c.definition?.described === false)).toBe(true)
    expect(definitions.some((c) => c.answer.names_definition_source)).toBe(true)
    // A metric with a Cube definition and no Heed item for the scope, and one with both.
    expect(definitions.some((c) => c.delivery.status === 'no_match' && c.definition?.ref)).toBe(
      true,
    )
    expect(definitions.some((c) => c.delivery.must_deliver.length && c.definition?.ref)).toBe(true)
  },
  'has conversations with a follow-up, a correction and another market': (set) => {
    const conversations = set.cases.filter((c) => c.type === 'conversation')
    expect(conversations.length).toBeGreaterThanOrEqual(5)
    const turns = conversations.flatMap((c) => c.turns ?? []).map((t) => t.text)
    expect(turns).toContain('And for Spain?')
    expect(turns.some((t) => /^(Sorry|Actually)/.test(t))).toBe(true)
  },
  'names only items the golden library holds, accepted and for everyone': (set) => {
    const named = set.cases.flatMap((c) =>
      [c.delivery, ...(c.turns ?? []).map((t) => t.delivery)]
        .filter((d) => d !== undefined)
        .flatMap((d) => [...d.must_deliver, ...d.must_not_deliver, ...(d.unverified ?? [])])
        .concat(c.answer.must_cite, c.answer.must_not_cite),
    )
    const missing = named.filter((id) => library.get(id)?.status !== 'accepted')
    expect(missing).toEqual([])
  },
  'never lets a wording share a phrase with what the answer must say (no leakage)': (set) => {
    const names = [
      ...vocabulary.metrics.map((m) => m.name),
      ...vocabulary.dimensions[0]!.values.map((v) => v.name),
      'Net sales',
      'GMV',
      'Margin rate',
    ]
    const leaks = set.cases.flatMap((c) => {
      const asked = (texts: string[], ids: string[], caveat: string | undefined) => {
        const sources = ids
          .map((id) => library.get(id)!)
          .flatMap((item) => [item.title, item.summary])
          .concat(caveat ?? [])
        return texts
          .map((text) => ({ id: c.id, text, shared: sharedPhrases(text, sources, names) }))
          .filter((leak) => leak.shared.length)
      }
      return [
        ...asked(
          c.wordings.map((w) => w.text),
          [...c.delivery.must_deliver, ...c.answer.must_cite],
          c.answer.caveat,
        ),
        ...(c.turns ?? []).flatMap((t) =>
          asked([t.text], t.delivery?.must_deliver ?? [], t.answer?.caveat),
        ),
      ]
    })
    expect(leaks).toEqual([])
  },
  'is importable today: each case is a valid test question in the open format': (set) => {
    for (const c of set.cases)
      expect(goldenQuestionSchema.safeParse(toQuestion(c)).success).toBe(true)
  },
  'checks the agent contract: member names, concise replies and reading an absence': (set) => {
    const of = (type: CaseType) => set.cases.filter((c) => c.type === type)
    // An agent hands over what it queried in the data tool, as the data tool names it (CON-517):
    // one that Heed knows, and one it does not, which must come back with "did you mean".
    const handoff = of('handoff')
    expect(handoff.every((c) => c.scope?.metrics?.every((m) => /^[a-z_]+\.[a-z_]+$/.test(m)))).toBe(
      true,
    )
    expect(handoff.map((c) => c.delivery.status).sort()).toEqual(['matched', 'need_more_detail'])
    expect(handoff.some((c) => c.delivery.text?.some((t) => t.startsWith('Did you mean')))).toBe(
      true,
    )
    // A concise reply keeps the caveat within a few kB (FR-342).
    for (const c of of('concise')) {
      expect(c.response_format).toBe('concise')
      expect(c.delivery.size_max).toBeLessThanOrEqual(13_000)
    }
    expect(of('concise').some((c) => c.delivery.text?.length && c.delivery.size_max! <= 6000)).toBe(
      true,
    )
    // An unscoped call is no absence; a scoped no match is the one an absence may follow.
    const absence = of('absence')
    expect(absence.some((c) => c.delivery.status === 'need_more_detail')).toBe(true)
    expect(absence.some((c) => c.delivery.status === 'no_match')).toBe(true)
  },
  'asks a missing-context answer for a next step, not for one particular next step': (set) => {
    // Round 4 (try-it-2): "Offers to report the gap" failed an honest "no documented context"
    // that offered to narrow the search instead. Any reasonable next step passes; a false claim
    // still fails, by the same rubric and by the one that asks for the absence to be stated.
    const noContext = set.cases.flatMap((c) => [
      ...(c.behaviour === 'no_context' ? [c.rubrics] : []),
      ...(c.turns ?? []).filter((t) => t.behaviour === 'no_context').map((t) => t.rubrics),
    ])
    const nextSteps = noContext.flat().filter((r) => /\breport/i.test(r))
    expect(nextSteps.length).toBeGreaterThanOrEqual(2)
    for (const rubric of nextSteps) {
      expect(rubric).toMatch(/reporting the gap or narrowing the search/)
      expect(rubric).toMatch(/claims no context, cause or action the tools did not give/)
    }
  },
}

/** Checks about the whole set, which the visible cases alone cannot pass. */
export const wholeSetOnly = new Set([
  'has the 52 cases of the plan, by type and domain',
  'holds out 16 of the 52, at least one of every type, and one definition and one conversation',
  'checks the agent contract: member names, concise replies and reading an absence',
  'asks a missing-context answer for a next step, not for one particular next step',
])
