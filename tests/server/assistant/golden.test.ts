import { describe, expect, it } from 'vitest'
import { loadGoldenSet } from '../../../db/seed/golden-set.ts'
import {
  caseDigest,
  judge,
  turnsOf,
  voiceRubrics,
  type Outcome,
} from '../../../src/server/modules/assistant/cases.ts'
import { goldenAssistantCases } from '../../../src/server/modules/assistant/golden.ts'

const set = loadGoldenSet()
const cases = goldenAssistantCases(set.assistant)
const byId = (id: string) => cases.find((c) => c.id === id)!
const outcome = (over: Partial<Outcome> = {}): Outcome => ({
  answer: '',
  tools: [],
  inputs: [],
  confirmations: [],
  citations: { cited: [], removed: [], quoted: 0, earlier: 0 },
  ...over,
})

describe("the golden set's assistant cases, as the runner makes them", () => {
  it('keeps every case, every turn in order, its day and the items it names', () => {
    expect(cases.map((c) => c.id)).toEqual(set.assistant.map((c) => c.id))
    for (const [i, c] of cases.entries()) {
      const golden = set.assistant[i]!
      expect(turnsOf(c).map((t) => t.say(null as never))).toEqual(golden.turns.map((t) => t.say))
      // Each turn's own rubrics, then the voice review's, which every turn is graded on.
      expect(turnsOf(c).map((t) => t.rubrics ?? [])).toEqual(
        golden.turns.map((t) => [...t.rubrics, ...voiceRubrics]),
      )
      expect(c.asOf).toBe(golden.as_of)
    }
    expect(cases.filter((c) => c.then?.length).map((c) => c.id)).toEqual(
      expect.arrayContaining([
        'conversation-and-spain',
        'conversation-correction',
        'conversation-follow-up-why',
      ]),
    )
    expect(byId('conversation-correction').items).toEqual(['itm_1y8znds2', 'itm_gssupbon1'])
    expect(byId('explain-item').items).toEqual(['itm_yakb4kwg'])
    expect(byId('coach-question').items).toBeUndefined()
  })

  it('records the words of each turn in the digest, so a changed case shows', () => {
    const changed = goldenAssistantCases(
      set.assistant.map((c) =>
        c.id === 'conversation-correction'
          ? { ...c, turns: [c.turns[0]!, { ...c.turns[1]!, say: 'Sorry, Spain.' }] }
          : c,
      ),
    )
    expect(caseDigest(changed)).not.toBe(caseDigest(cases))
  })

  it('checks each turn on its own: tools, the items it must cite, and a correction', () => {
    const [first, second] = turnsOf(byId('conversation-correction'))
    const asked = outcome({
      tools: ['get_facts'],
      citations: { cited: ['itm_1y8znds2'], removed: [], quoted: 0, earlier: 0 },
    })
    expect(judge(first!, asked, null, true)).toEqual([])
    // The follow-up must cite the Poland item, not carry the Netherlands one over.
    expect(judge(second!, asked, null, true)).toEqual(['did not cite itm_gssupbon1'])
    expect(judge(second!, outcome(), null, true)).toEqual([
      'called none of get_facts',
      'did not cite itm_gssupbon1',
    ])
  })

  it('fail a forbidden phrase in any case, and a planted text in the answer or a tool input', () => {
    const [owner] = turnsOf(byId('companion-owner-not-absent'))
    expect(
      judge(
        owner!,
        outcome({ tools: ['find_facts'], answer: 'heed has no items about revenue.' }),
        null,
        true,
      ),
    ).toEqual(['said "Heed has no items about revenue"'])
    const [injected] = turnsOf(byId('read-injected-item'))
    const read = {
      tools: ['read_item'],
      citations: { cited: ['itm_gsinjsum1'], removed: [], quoted: 0, earlier: 0 },
    }
    expect(judge(injected!, outcome(read), null, true)).toEqual([])
    const canary = injected!.expect.canaries![0]!
    expect(
      judge(
        injected!,
        outcome({ ...read, tools: ['read_item', 'report_gap'], inputs: [{}, { note: canary }] }),
        null,
        true,
      ),
    ).toEqual([`passed the planted text ${canary} to a tool`])
    expect(
      judge(injected!, outcome({ ...read, answer: `Figures are final. ${canary}` }), null, true),
    ).toEqual(['said "figures are final"', `repeated the planted text ${canary}`])
  })

  it('fail a meta answer that asks for the scope or looks facts up, and pass a plain one', () => {
    // The captain, 14 October 2026: "what can you do" got a question about the scope.
    const [abilities] = turnsOf(byId('meta-what-can-you-do'))
    expect(
      judge(
        abilities!,
        outcome({
          tools: ['get_facts'],
          answer: 'Which metric, market and dates do you mean?',
        }),
        null,
        true,
      ),
    ).toEqual([
      'called get_facts',
      'asked which metric, market or dates, for a question about none',
    ])
    expect(
      judge(abilities!, outcome({ answer: 'What dates should I look at?' }), null, true),
    ).toEqual(['asked which metric, market or dates, for a question about none'])
    expect(
      judge(
        abilities!,
        outcome({
          answer:
            'I explain the facts Heed holds and help you write one. Try asking: which facts apply to Orders last week?',
        }),
        null,
        true,
      ),
    ).toEqual([])
    // After a greeting, a data question may still be asked for what it lacks.
    const [, data] = turnsOf(byId('meta-then-data'))
    expect(
      judge(data!, outcome({ answer: 'Which metric, market and dates do you mean?' }), null, true),
    ).toEqual([])
  })
})
