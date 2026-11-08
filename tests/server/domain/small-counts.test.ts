import { describe, expect, it } from 'vitest'
import { askedCell, askedTotals, listedTopics, visibleTotal } from '../../../src/domain/gaps.ts'
import {
  readerDomains,
  readerSubjects,
  zeroCounts,
  type ViewScope,
} from '../../../src/domain/observability.ts'
import { answerRecords, type RecordsAsk } from '../../../src/domain/records.ts'
import { recordsText } from '../../../src/server/modules/answer/plan-cases.ts'
import { askPlanCase, PLAN_NOW, planBundle } from '../../../src/server/modules/answer/index.ts'
import { planRecords } from '../../../src/server/modules/answer/plan-world.ts'

// One rule for a count a person may see (FR-614, FR-620), wherever Ask states one: every display
// rule the app has, each held on Ask's own answers. A count under the minimum is hidden, a floor
// shows where a page shows one, and no count is shown that gives a hidden one away by subtraction.

const topic = (subject: string, calls: number, nothing: number, month = '2026-10') => ({
  id: `${subject} ${month}`,
  domain: 'area_a' as string | null,
  subject,
  month,
  counts: { ...zeroCounts(), grounded: calls - nothing, missing: nothing },
})

const DAY = '2026-10-22'
const dayOf = (topics: readonly ReturnType<typeof topic>[]) =>
  topics.map((t) => ({ day: DAY, domain: t.domain, counts: t.counts }))

/** What a reader has of these topics. */
const asReader = (
  topics: ReturnType<typeof topic>[],
  reader: ViewScope = { admin: true, areas: [] },
  owners: Record<string, ViewScope[]> = {},
) => readerSubjects({ topics, days: dayOf(topics), dates: [DAY], minimum: 5, reader, owners })

describe('the one source of what agents asked', () => {
  it('hides a count from one to under the minimum, and never lists it', () => {
    const [small] = asReader([topic('small', 3, 0), topic('big', 40, 0)])
    expect(small).toMatchObject({ count: null, atLeast: 0 })
    expect(listedTopics([small!], 5)).toEqual([])
  })

  it('keeps zero and what the view shows, and never reads a hidden count as zero', () => {
    const subjects = asReader([topic('a', 20, 0), topic('b', 21, 7), topic('c', 22, 2)])
    const found = (key: string) => subjects.find((s) => s.key === key)!
    expect(found('a').nothing).toBe(0)
    expect(found('c').nothing).toBeNull()
  })

  it('gives a person their own page, and any other topic its owners’ strictest view', () => {
    const topics = [
      topic('sales', 14, 0),
      { ...topic('small', 8, 0), domain: 'area_b' },
      { ...topic('other', 40, 0), domain: 'area_b' },
    ]
    const owner: ViewScope = { admin: false, areas: ['area_a'] }
    const broad: ViewScope = { admin: false, areas: ['area_a', 'area_b'] }
    const owners = { area_a: [owner], area_b: [broad] }
    const page = asReader(topics, owner, owners)
    const nobody = asReader(topics, { admin: false, areas: [] }, owners)
    const of = (rows: typeof page, key: string) => rows.find((s) => s.key === key)!
    expect(of(nobody, 'sales')).toEqual(of(page, 'sales'))
    expect(of(nobody, 'other').count ?? of(nobody, 'other').atLeast).toBeLessThanOrEqual(40)
  })

  it('takes the strictest of several owners: a floor over an exact count, hidden over both', () => {
    const topics = [topic('a', 14, 0), topic('b', 6, 0), { ...topic('c', 30, 0), domain: 'area_b' }]
    const narrow: ViewScope = { admin: false, areas: ['area_a'] }
    const broad: ViewScope = { admin: false, areas: ['area_a', 'area_b'] }
    const views = (scope: ViewScope) => asReader(topics, scope)
    const strict = asReader(topics, { admin: false, areas: [] }, { area_a: [narrow, broad] })
    for (const s of strict) {
      if (s.domain !== 'area_a') continue
      for (const scope of [narrow, broad]) {
        const own = views(scope).find((v) => v.key === s.key)!
        expect(s.count ?? s.atLeast).toBeLessThanOrEqual(own.count ?? own.atLeast)
      }
    }
  })

  it('reads a topic no one owns as the administrators see it', () => {
    const topics = [{ ...topic('a', 30, 0), domain: null }, topic('b', 30, 0)]
    const [nobody] = asReader(topics, { admin: false, areas: [] }, {})
    const [admin] = asReader(topics)
    expect(nobody).toEqual(admin)
  })

  it('shows no count at all in a view that reads under the minimum', () => {
    const only = [topic('a', 4, 0)]
    expect(asReader(only)[0]).toMatchObject({ count: null, atLeast: 0, nothing: null })
  })

  it('leaves a month out of a subject when a view hides it', () => {
    const subjects = asReader([topic('a', 20, 0), topic('a', 3, 0, '2026-09'), topic('b', 40, 0)])
    expect(subjects.find((s) => s.key === 'a')).toMatchObject({ months: ['2026-10'] })
  })

  it('says a floor and "Fewer than" as a page does', () => {
    expect(askedCell({ count: null, atLeast: 0 }, 5)).toBe('Fewer than 5')
    expect(askedCell({ count: null, atLeast: 13 }, 5)).toBe('13+')
    expect(askedCell({ count: 1200, atLeast: 1200 }, 5)).toBe('1,200')
  })

  it('leaves the total of a week as it was: only over shown parts', () => {
    expect(visibleTotal(14, 12, 5)).toBeNull()
    expect(visibleTotal(17, 12, 5)).toBe(17)
  })
})

describe('what agents asked, as Ask states it, fed raw', () => {
  // As the rows reach Ask: a row with no shown count of the minimum is not listed.
  const world = {
    ...planRecords,
    asked: {
      minimum: 5,
      rows: [
        {
          title: 'Small',
          count: null,
          atLeast: 0,
          nothing: null,
          state: 'missing' as const,
          gap: null,
          metrics: ['metric:returns'],
        },
        {
          title: 'Left over',
          count: null,
          atLeast: 9,
          nothing: 9,
          state: 'missing' as const,
          gap: null,
          metrics: ['metric:orders'],
        },
      ],
    },
  }
  const ask = (facets: NonNullable<RecordsAsk['audit']>['facets']): RecordsAsk => ({
    intent: 'audit',
    domain: null,
    kind: null,
    metric: null,
    period: null,
    noOwner: false,
    audit: { facets, of: null, kind: null, value: null },
  })
  const said = (a: RecordsAsk) => recordsText(answerRecords(a, world, PLAN_NOW)).join('\n')

  it.each([
    ['what was asked most', ['asked_most'] as const],
    ['what found nothing', ['asked_nothing'] as const],
    ['both at once', ['asked_most', 'asked_nothing'] as const],
    ['what is asked and not covered', ['asked_most', 'no_context'] as const],
  ])('%s', (_name, facets) => {
    const text = said(ask([...facets]))
    expect(text).not.toMatch(/\bSmall\b/)
    expect(text).not.toMatch(/\b12\b/)
    expect(text).not.toMatch(/9 of 12/)
  })

  it('does not count a topic it hides in a denominator', () => {
    expect(said(ask(['asked_nothing']))).toContain('1 of 1 topic')
  })

  it('never reads a hidden count of what found nothing as none', () => {
    const hidden = {
      ...world,
      asked: {
        minimum: 5,
        rows: [{ ...world.asked.rows[1]!, title: 'Hidden', nothing: null }],
      },
    }
    const text = recordsText(answerRecords(ask(['asked_nothing']), hidden, PLAN_NOW)).join('\n')
    expect(text).not.toMatch(/found something for every topic/)
    expect(text).toMatch(/the count is hidden for 1 of 1 topic/)
  })
})

describe('an item for another group, to a person', () => {
  it('is neither named nor counted, in any line of the answer', async () => {
    const { routed } = await askPlanCase({ question: 'why did orders drop in Norway?' }, null, [])
    if (routed.kind !== 'rules') throw new Error('read by the rules')
    expect(routed.answer.forAnotherGroup).toBe(0)
    expect(routed.answer.say).not.toMatch(/another group|isn't shared/)
    expect(JSON.stringify(routed.answer.steps)).not.toMatch(/another group/)
    expect(routed.answer.steps.find((s) => s.step === 'left_out')).toMatchObject({
      forAnotherGroup: 0,
    })
  })

  it('is still told to an agent: get_context does not change', async () => {
    const { answer } = await import('../../../src/domain/answer.ts')
    const said = answer(
      planBundle,
      { question: 'why did orders drop in Norway?' },
      {
        today: '2026-10-23',
      },
    )
    expect(said.forAnotherGroup).toBe(1)
    expect(said.say).toMatch(/for another group/)
  })
})

describe('the total asked and the topics left out, beside the domain totals', () => {
  const inD = (domain: string, subject: string, calls: number) => ({
    ...topic(subject, calls, 0),
    domain,
  })
  const topics = [inD('d1', 'big', 20), inD('d1', 'x', 3), inD('d1', 'y', 3), inD('d2', 'z', 3)]
  const owners = { d1: [{ admin: false, areas: ['d1'] }], d2: [{ admin: false, areas: ['d2'] }] }
  const views = (reader: ViewScope) => ({
    topics,
    days: dayOf(topics),
    dates: [DAY],
    minimum: 5,
    reader,
    owners,
  })
  const totalsFor = (reader: ViewScope) => {
    const v = views(reader)
    const subjects = readerSubjects(v)
    const listed = subjects.filter((s) => (s.count ?? s.atLeast) >= 5)
    const domains = readerDomains(v)
    return {
      domains,
      ...askedTotals(
        listed.map((s) => ({ domain: s.domain, size: s.count ?? s.atLeast })),
        subjects.filter((s) => !listed.includes(s)).reduce((n, s) => n + s.calls, 0),
        subjects.reduce((n, s) => n + s.calls, 0),
        domains,
        5,
      ),
    }
  }

  it('gives a reader with no page the totals of the domains whose owners show one', () => {
    expect(readerDomains(views({ admin: false, areas: [] }))).toEqual({ d1: 26 })
  })

  it('gives an owner their own domain total', () => {
    expect(readerDomains(views({ admin: false, areas: ['d1'] }))).toEqual({ d1: 26 })
  })

  it('leaves out a total and a hidden count that a domain total would work a 3 out of', () => {
    for (const reader of [
      { admin: false, areas: [] },
      { admin: false, areas: ['d1'] },
    ] as ViewScope[]) {
      expect(totalsFor(reader)).toMatchObject({ asked: null, hidden: null })
    }
  })

  it('keeps them when what is left is zero or at least the minimum', () => {
    expect(askedTotals([{ domain: 'd1', size: 20 }], 6, 26, { d1: 26 }, 5)).toEqual({
      asked: 26,
      hidden: 6,
    })
    expect(askedTotals([{ domain: 'd1', size: 20 }], 12, 32, { d1: 26 }, 5)).toEqual({
      asked: 32,
      hidden: 12,
    })
  })

  it('does not name a topic that a view the reader is held to does not show at all', () => {
    const quiet = [inD('d1', 'few', 2)]
    const [s] = readerSubjects({
      topics: quiet,
      days: dayOf(quiet),
      dates: [DAY],
      minimum: 5,
      reader: { admin: false, areas: ['d1'] },
      owners,
    })
    expect(s).toMatchObject({ seen: false, count: null, atLeast: 0 })
  })
})

describe('what agents found nothing for, in a domain', () => {
  it('reads only the rows of the domain the question names', () => {
    const row = (title: string, area: string) => ({
      title,
      area,
      count: 12,
      atLeast: 12,
      nothing: 9,
      state: 'missing' as const,
      gap: null,
    })
    const found = answerRecords(
      {
        intent: 'asked_nothing',
        domain: 'marketing',
        kind: null,
        metric: null,
        period: null,
        noOwner: false,
      },
      {
        items: [],
        areas: [
          { id: 'sales', name: 'Sales', ownerIds: [] },
          { id: 'marketing', name: 'Marketing', ownerIds: [] },
        ],
        people: {},
        terms: [],
        asked: { minimum: 5, rows: [row('Orders', 'sales')] },
        conflicts: null,
      },
      '2026-10-22T00:00:00Z',
    )
    expect(found.rows).toEqual([])
  })
})
