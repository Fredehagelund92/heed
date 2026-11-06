import { describe, expect, it } from 'vitest'
import { readsPlainly } from '../../../src/domain/plain-read.ts'
import { recogniseRecords, type RecordsRecognition } from '../../../src/domain/records.ts'
import { readQuestion } from '../../../src/domain/scope.ts'
import {
  askPlanCase,
  PLAN_NOW,
  PLAN_TODAY,
  planBundle,
  planAreas,
} from '../../../src/server/modules/answer/index.ts'

// The class behind the gate of 6 November 2026 (5.1 and 5.4): a rule answers only what is plainly a
// read, and the person boundary turns on who a question is about. Each is tested as a class, every
// kind of word across every read, so a new phrase cannot be fixed by adding it to a pattern.

const asked = async (question: string) => {
  let calls = 0
  const got = await askPlanCase(
    { question },
    () => {
      calls++
      return Promise.resolve('missed' as const)
    },
    [],
  )
  return { calls, got }
}

const subjects = [
  'net revenue',
  'orders in Spain',
  'churn rate',
  'the Sales domain',
  'the conflicts',
  'what is due for a check',
  'what changed in the context',
  'who owns Orders',
  'which metrics have no context',
  'the definitions',
]
const reachingBeyond = {
  forecast: [
    'will {s} change next quarter?',
    'is {s} going to get better?',
    'what is going to happen to {s}?',
    'do you expect {s} to move?',
  ],
  write: ['can you rewrite {s}?', 'draft {s} for me', 'please update {s}', 'could you fix {s}?'],
  judgement: [
    'is {s} safe to use?',
    'should we trust {s}?',
    'is {s} good enough?',
    'can the board rely on {s}?',
  ],
}

describe('a rule reads only what is plainly a read', () => {
  describe.each(Object.entries(reachingBeyond))('%s words', (_kind, templates) => {
    const questions = templates.flatMap((t) => subjects.map((s) => t.replace('{s}', s)))

    it.each(questions)('"%s" goes to the planner, so a limit or a cannot can apply', async (q) => {
      expect((await asked(q)).calls).toBe(1)
    })
  })

  it.each([
    'net revenue',
    'Orders in Norway',
    'what is net revenue?',
    "what's churn rate?",
    'what does net revenue mean?',
    'how is average order value calculated?',
    'define gross margin',
    "what's the difference between orders and net revenue?",
    'what do we know about returns?',
    'what is written about Orders in Norway?',
    'what should I know about revenue?',
    "what's going on with returns?",
    'why did orders drop in Norway in August?',
    'what explains the spike in returns?',
    'compare orders in Norway and Sweden',
    'do Norway orders include gift cards?',
    'is net revenue in Spain before or after VAT?',
    'what is written about orders going to Norway?',
  ])('"%s" stays with the rules', (question) => {
    const { spans } = readQuestion(question, planBundle.terms, PLAN_TODAY)
    expect(readsPlainly(question, spans)).toBe(true)
  })

  it('does not read a forecast plainly', () => {
    const question = 'are orders going to bounce back in Spain?'
    const { spans } = readQuestion(question, planBundle.terms, PLAN_TODAY)
    expect(readsPlainly(question, spans)).toBe(false)
  })

  it("never gives every domain's owners for something the rules cannot name", async () => {
    for (const question of ["who's responsible for on-time shipping?", 'who owns delivery?']) {
      expect((await asked(question)).calls).toBe(1)
      const alone = await askPlanCase({ question }, null, [])
      expect(alone.rendered).not.toContain('Every domain has an owner')
    }
  })

  it('says what it could not read when nothing can read it', async () => {
    const got = await askPlanCase({ question: 'are returns a big worry in Spain?' }, null, [])
    expect(got.routed.kind).toBe('rules')
    if (got.routed.kind === 'rules') expect(got.routed.limit?.reason).toBe('partly')
  })

  it('says only the limit when nothing was read under it', async () => {
    const got = await askPlanCase(
      { question: 'are orders going to bounce back in Spain?' },
      null,
      [],
    )
    expect(got.rendered).toContain('What happens next is not written down.')
    expect(got.rendered).not.toContain('Here is what is.')
  })
})

describe('the person boundary, both ways', () => {
  const people = ['Ines Duarte', 'Sofia Brandt', 'Jon Abara', 'Will Grant']
  const recognised = (question: string): RecordsRecognition | null => {
    const read = readQuestion(question, planBundle.terms, PLAN_TODAY)
    return recogniseRecords(question, {
      spans: read.spans,
      terms: planBundle.terms,
      domains: planAreas,
      now: PLAN_NOW,
      people,
    })
  }

  // A named or implied person's work: refused, never looked up.
  it.each([
    'show me everything Ines wrote',
    'everything ines wrote',
    'all Sofia published this month',
    'what did Sofia Brandt review this week?',
    'how many items has Ines checked?',
    'what has Jon Abara changed?',
    'is Ines behind on her checks?',
    "Jon's suggestions",
    'list what jon abara owns',
    'who is furthest behind on their reviews?',
    'who reviews the slowest?',
    'who wrote the most this month?',
  ])('refuses "%s"', (question) => {
    expect(recognised(question)?.type).toBe('refused')
  })

  // An indefinite word, or a question about ownership, names no one: never refused.
  it.each([
    'which KPIs has nobody written about?',
    'which metrics have no context written?',
    'what has nobody taken responsibility for?',
    'what has no one reviewed?',
    'is there anything nobody checked?',
    'what has someone changed this week?',
    'which items has anyone published?',
    'what was written last week?',
    'everything added this week',
    'all context changed today',
    'who owns Orders?',
    'who owns the most domains?',
    'will orders rise?',
  ])('never refuses "%s"', (question) => {
    expect(recognised(question)?.type).not.toBe('refused')
  })
})
