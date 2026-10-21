import { goldenLibrary } from '../../../db/seed/golden-fixtures.ts'
import { goldenQuestionSchema } from '../../../src/domain/golden-question.ts'
import {
  caseTypes,
  sharedPhrases,
  toQuestion,
  type CaseType,
  type GoldenSet,
} from '../../../src/domain/golden-set.ts'
import { assistantCases } from '../../../src/server/modules/assistant/cases.ts'
import { assistantToolNames } from '../../../src/server/modules/assistant/tools.ts'
import { vocabulary } from '../../../src/web/mocks/reference-data.ts'
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
  'keeps the runner cases and adds the plan eight, definitions and conversations': (set) => {
    const existing = set.assistant.filter((c) => c.origin === 'existing').map((c) => c.id)
    expect(existing.sort()).toEqual(assistantCases.map((c) => c.id).sort())
    const added = set.assistant.filter((c) => c.origin === 'new')
    expect(
      added.filter(
        (c) =>
          !['definition', 'conversation', 'companion', 'meta', 'industry', 'pilot'].includes(
            c.type,
          ),
      ).length,
    ).toBe(8)
    expect(added.filter((c) => c.type === 'definition').length).toBeGreaterThanOrEqual(3)
    expect(added.filter((c) => c.turns.length > 1).length).toBeGreaterThanOrEqual(3)
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
  "replays the companion's failed turns: who, when, a verdict, no false absence, no ids": (set) => {
    const companion = set.assistant.filter((c) => c.type === 'companion')
    expect(companion.length).toBeGreaterThanOrEqual(5)
    const expects = companion.flatMap((c) => c.turns.map((t) => t.expect))
    expect(expects.filter((e) => e.asks_no_identity).length).toBeGreaterThanOrEqual(3)
    expect(
      expects.some((e) => e.forbidden_phrases.includes('Heed has no items about revenue')),
    ).toBe(true)
    expect(expects.some((e) => e.confirmation_or_question === 'create_draft')).toBe(true)
    expect(expects.some((e) => e.tools_any?.includes('find_facts'))).toBe(true)
  },
  'asks what depends on the business, visible, and never cites the background': (set) => {
    // The captain, 15 October 2026: the assistant should not start from level zero on what the
    // business is. These run with and without About our business, so anyone may compare.
    const industry = set.assistant.filter((c) => c.type === 'industry')
    expect(industry.every((c) => c.split === 'development')).toBe(true)
    const said = industry.map((c) => c.turns[0]!.say).join(' ')
    for (const word of [/\bfirst-time buyer\b/, /\bcommission\b/, /\bselling country\b/])
      expect(said).toMatch(word)
    for (const turn of industry.flatMap((c) => c.turns)) {
      expect(turn.rubrics.length).toBeGreaterThan(0)
      expect(turn.expect.cites ?? []).toEqual([])
      expect(turn.expect.forbidden_phrases).toContain('according to About our business')
    }
  },
  "replays the pilot's empty domain: another spelling, what Cube has, a correction": (set) => {
    // The captain, 15 October 2026: asked for a domain's metrics by its right spelling, in a domain
    // stored with a typo and no terms yet, the assistant listed other domains' terms, never said
    // Cube had the domain's members waiting, argued with his correction and repeated itself.
    const pilot = set.assistant.filter((c) => c.type === 'pilot')
    expect(pilot.every((c) => c.split === 'development')).toBe(true)
    const said = pilot.flatMap((c) => c.turns.map((t) => t.say)).join(' ')
    // The stored name, "and" for "&", and a typo of the name.
    for (const spelling of [/Stores & Suppliers/, /stores and suppliers/i, /Stors/])
      expect(said).toMatch(spelling)
    // The repeat-question case: the same question corrected, then said again.
    expect(pilot.some((c) => c.turns.length === 3)).toBe(true)
    for (const turn of pilot.flatMap((c) => c.turns)) {
      expect(turn.rubrics.length).toBeGreaterThan(0)
      expect(turn.expect.forbidden_phrases).toEqual(
        expect.arrayContaining(['invented', 'I did understand']),
      )
    }
  },
  'answers messages about the assistant itself at once, never with a scope question': (set) => {
    // The captain, 14 October 2026: "what can you do" was answered with "Which metric, market
    // and dates do you mean?". Visible cases, so anyone may tune against them.
    const meta = set.assistant.filter((c) => c.type === 'meta')
    expect(meta.every((c) => c.split === 'development')).toBe(true)
    const first = meta.map((c) => c.turns[0]!)
    expect(first.length).toBeGreaterThanOrEqual(10)
    for (const said of [
      'what can you do',
      'hi',
      'help',
      'how does this work?',
      'who are you?',
      'thanks!',
      'tell me a joke',
      'what can I ask you?',
    ])
      expect(first.map((t) => t.say)).toContain(said)
    for (const turn of first) {
      expect(turn.expect.asks_no_scope).toBe(true)
      expect(turn.expect.tools_none).toEqual(
        expect.arrayContaining(['get_facts', 'improve_question', 'create_draft']),
      )
    }
    // A data question after a greeting is still asked for what it lacks.
    expect(meta.some((c) => c.turns.length > 1 && !c.turns[1]!.expect.asks_no_scope)).toBe(true)
  },
  'answers a follow-up on its own reply from the conversation, and starts a change with what the facts cannot show':
    (set) => {
      // The captain, 20 October 2026: "what you mean?" ran a new lookup on the carried scope,
      // assumed a date and listed eight facts. Visible cases, so anyone may tune against them.
      const followUps = set.assistant.filter((c) => c.id.startsWith('companion-follow-up-'))
      expect(followUps.every((c) => c.type === 'companion' && c.split === 'development')).toBe(true)
      const said = followUps.flatMap((c) => c.turns.map((t) => t.say))
      for (const words of ['what you mean?', 'say it simpler', 'shorter', 'why?', 'thanks!'])
        expect(said).toContain(words)
      for (const c of followUps) {
        // The first turn asks something; each turn after it is about the reply before it.
        const [, ...after] = c.turns
        const asked = after.filter((t) => t.expect.tools_none)
        expect(asked.length).toBeGreaterThan(0)
        for (const turn of asked) {
          expect(turn.expect.asks_no_scope).toBe(true)
          expect(turn.expect.tools_none).toEqual(
            expect.arrayContaining(['get_facts', 'find_facts', 'explain_item', 'create_draft']),
          )
        }
      }
      // A question after one is a question again, and a change starts with what the facts cannot show.
      expect(followUps.some((c) => c.turns.at(-1)!.expect.tools_any?.includes('get_facts'))).toBe(
        true,
      )
      const change = set.assistant.find((c) => c.id === 'companion-change-first-sentence')!
      expect(change.turns[0]!.rubrics.join(' ')).toMatch(
        /first sentence says plainly that the facts cannot show/,
      )
      expect(change.turns[0]!.expect.forbidden_phrases).toContain('caused by')
    },
  'names only tools the assistant has': (set) => {
    const named = set.assistant.flatMap((c) =>
      c.turns.flatMap((t) => [
        ...(t.expect.tools_any ?? []),
        ...(t.expect.tools_none ?? []),
        ...(t.expect.confirmation ? [t.expect.confirmation] : []),
        ...(t.expect.confirmation_or_question ? [t.expect.confirmation_or_question] : []),
      ]),
    )
    expect(named.filter((tool) => !(assistantToolNames as string[]).includes(tool))).toEqual([])
  },
}

/** Checks about the whole set, which the visible cases alone cannot pass. */
export const wholeSetOnly = new Set([
  'has the 52 cases of the plan, by type and domain',
  'holds out 16 of the 52, at least one of every type, and one definition and one conversation',
  'keeps the runner cases and adds the plan eight, definitions and conversations',
  'checks the agent contract: member names, concise replies and reading an absence',
  'asks a missing-context answer for a next step, not for one particular next step',
  "replays the companion's failed turns: who, when, a verdict, no false absence, no ids",
])
