import { describe, expect, it } from 'vitest'
import { readsFooter, recordsFooter } from '../../../src/domain/answer-footer.ts'
import type { Answer } from '../../../src/domain/answer.ts'
import {
  answerRecords,
  readRecordsPeriod,
  type RecordsAsk,
  type RecordsItem,
} from '../../../src/domain/records.ts'
import { PLAN_NOW, planBundle } from '../../../src/server/modules/answer/index.ts'
import { planRecords } from '../../../src/server/modules/answer/plan-world.ts'

// One footer for every answer: what a count is out of, what the read could not see, and what may be
// out of date, each said by code whatever the read's own template remembered.

const ask = (over: Partial<RecordsAsk>): RecordsAsk => ({
  intent: 'conflicts',
  domain: null,
  kind: null,
  metric: null,
  period: null,
  noOwner: false,
  ...over,
})
const item = (title: string, reason: Answer['items'][number]['unverifiedReason']) =>
  ({ title, unverifiedReason: reason }) as Answer['items'][number]
const read = (
  items: Answer['items'],
  uncovered = { metrics: [] as string[], values: [] as string[] },
) => ({ items, uncovered }) as Pick<Answer, 'items' | 'uncovered'>

describe('the footer of an answer from what is written', () => {
  it('says what may be out of date, whatever the state', () => {
    expect(readsFooter(planBundle, read([item('Returns', 'past_review_date')]))?.stale).toBe(
      'Returns: its check date has passed.',
    )
  })

  it('names how many more items are out of date past the first three', () => {
    const items = ['a', 'b', 'c', 'd'].map((t) => item(t, 'source_missing'))
    expect(readsFooter(planBundle, read(items))?.stale).toMatch(/, and 1 more\.$/)
  })

  it('says what a search left out, and what nothing is written about', () => {
    const footer = readsFooter(
      planBundle,
      read([item('Orders', null)], { metrics: ['metric:returns'], values: [] }),
      3,
    )
    expect(footer).toMatchObject({
      denominator: 'Read the 1 that fit best of 4 context items.',
      notSeen: 'Nothing is written about Returns here.',
    })
  })

  it('is left out when it has nothing to say', () => {
    expect(readsFooter(planBundle, read([item('Orders', null)]))).toBeNull()
  })
})

describe('the footer of a records answer', () => {
  const footerOf = (a: RecordsAsk) => answerRecords(a, planRecords, PLAN_NOW).footer!

  it('measures a read that counts rows with nothing to measure them against', () => {
    expect(footerOf(ask({ domain: 'area_marketing' })).denominator).toMatch(
      /^Out of \d+ live context items? in Marketing\.$/,
    )
  })

  it('keeps the line a template wrote', () => {
    expect(footerOf(ask({})).notSeen).toBe(
      'Not seen: two items that disagree when no owner marked them.',
    )
  })

  it('says drafts are not seen on a read of the context list', () => {
    expect(footerOf(ask({ intent: 'count' })).notSeen).toMatch(/drafts and suggestions/)
  })

  it('says the days what agents asked was counted over, and a domain’s whole', () => {
    const world = {
      ...planRecords,
      asked: { ...planRecords.asked!, domains: { area_sales: 79 } },
    }
    const found = answerRecords(ask({ intent: 'asked_nothing' }), world, PLAN_NOW)
    expect(found.footer?.denominator).toMatch(/^This week here is 16 to 22 Oct 2026/)
    const inSales = ask({
      intent: 'audit',
      domain: 'area_sales',
      audit: { facets: ['asked_nothing'], of: null, kind: null, value: null },
    })
    expect(
      recordsFooter(answerRecords(inSales, world, PLAN_NOW), inSales, world).denominator,
    ).toMatch(/Agents asked about Sales 79 times in all this week\./)
  })
})

describe('what a count of changes is out of', () => {
  const at = (day: string) => `${day}T09:00:00.000Z`
  const stored = (id: string, over: Partial<RecordsItem> = {}): RecordsItem => ({
    id,
    kind: 'note',
    areaId: 'area_sales',
    title: id,
    status: 'live',
    reviewDate: '2027-01-01',
    checkFlag: null,
    publishedAt: at('2026-01-02'),
    changedAt: at('2026-01-02'),
    checkedAt: at('2026-01-02'),
    archivedAt: null,
    owners: [],
    ...over,
  })
  const denominator = (type: 'created' | 'changed', items: RecordsItem[]) => {
    const period = readRecordsPeriod('last 30 days', PLAN_NOW)!
    const world = { ...planRecords, items }
    const asked = ask({ intent: type, period })
    return answerRecords(asked, world, PLAN_NOW).footer?.denominator
  }

  it('counts the archived items a change was made to', () => {
    const archived = Array.from({ length: 3 }, (_, i) =>
      stored(`a${i}`, { status: 'archived', archivedAt: at('2026-10-20') }),
    )
    expect(denominator('changed', [...archived, stored('live')])).toBe('Out of 4 context items.')
  })

  it('counts only live items when no archived item was among those created', () => {
    const items = [stored('a', { publishedAt: at('2026-10-20') }), stored('b'), stored('c')]
    const old = stored('gone', { status: 'archived', archivedAt: at('2026-02-01') })
    expect(denominator('created', [...items, old])).toBe('Out of 3 live context items.')
  })
})
