import { describe, expect, it } from 'vitest'
import { limitOf, readsBeyond } from '../../../src/domain/ask-plan.ts'
import { overlapping, readAudit, writtenTwice, type AuditItem } from '../../../src/domain/audit.ts'
import { recogniseRecords } from '../../../src/domain/records.ts'

const item = (id: string, over: Partial<AuditItem> = {}): AuditItem => ({
  id,
  kind: 'note',
  title: 'Net revenue in Spain includes VAT',
  areaId: 'sales',
  metrics: ['metric:net_revenue'],
  values: ['val:market/spain'],
  start: '2026-01-01',
  end: null,
  conflicts: [],
  ...over,
})

describe('what is written twice', () => {
  it('takes the same title, the same scope and the same start date, in any case and order', () => {
    const twin = item('b', { title: 'NET REVENUE in Spain includes VAT' })
    expect(writtenTwice([item('a'), twin]).map(([a, b]) => [a.id, b.id])).toEqual([['a', 'b']])
  })

  it.each([
    ['another title', { title: 'Net revenue in Spain excludes VAT' }],
    ['another start date', { start: '2026-01-02' }],
    ['another scope', { values: ['val:market/france'] }],
  ])('leaves out %s', (_what, over) => {
    expect(writtenTwice([item('a'), item('b', over)])).toEqual([])
  })
})

describe('what overlaps', () => {
  const other = { title: 'Net revenue in Spain excludes VAT' }

  it('takes one kind about the same metric and value on days that meet', () => {
    expect(overlapping([item('a'), item('b', other)])).toHaveLength(1)
  })

  it.each([
    ['a pair an owner marked', { ...other, conflicts: ['a'] }],
    ['another kind', { ...other, kind: 'issue' as const }],
    ['days that do not meet', { ...other, start: '2020-01-01', end: '2020-02-01' }],
    ['what is written twice', {}],
  ])('leaves out %s', (_what, over) => {
    expect(overlapping([item('a'), item('b', over)])).toEqual([])
  })

  it('leaves out events: an event happens once', () => {
    const events = [item('a', { kind: 'event' }), item('b', { ...other, kind: 'event' })]
    expect(overlapping(events)).toEqual([])
  })
})

describe('how an analysis reads with no model', () => {
  it.each([
    ['are there duplicates in the context', ['duplicates']],
    ['is anything written twice', ['duplicates']],
    ['do any items overlap', ['overlaps']],
    ['which metrics have no owner', ['no_domain']],
    ['which metrics have no domain', ['no_domain']],
    ['which metrics have no definition', ['no_words']],
    ['how complete is the domain', ['review']],
    ['give me a health check of', ['review']],
  ])('%s', (words, facets) => {
    expect(readAudit(words, false)?.read.facets).toEqual(facets)
  })

  it('leaves a question that names a metric or a market to the business', () => {
    expect(readAudit('is anything written twice', true)).toBeNull()
  })

  it('reads the person`s own Inbox, whatever else the words name', () => {
    expect(readAudit('what is waiting on me', true)).toMatchObject({ queue: true })
  })

  it('counts one kind of context over the metrics', () => {
    expect(readAudit('which metrics have no guide', false)?.read).toMatchObject({
      facets: ['no_context'],
      of: 'metric',
      kind: 'guide',
    })
  })
})

describe('a question about one person', () => {
  const reading = { spans: [], terms: [], domains: [], now: '2026-10-23T12:00:00.000Z' }

  // A scout's question that was refused as one person's work: "no" read as a person's name.
  it.each(['which metrics have no context written?', 'which ones have any owners checked?'])(
    'is not read in "%s"',
    (question) => {
      expect(recogniseRecords(question, reading)?.type).not.toBe('refused')
    },
  )

  it('is still refused', () => {
    expect(recogniseRecords('what did Maria write this week?', reading)?.type).toBe('refused')
  })
})

describe('a word of judgement', () => {
  const reading = { spans: [], terms: [], domains: [], now: '2026-10-23T12:00:00.000Z' }

  it('marks a rule`s read as the planner`s first, so a rule cannot answer something else', () => {
    expect(recogniseRecords('what would you change in the definitions?', reading)).toMatchObject({
      loose: true,
      judgement: true,
    })
  })

  it('leaves a plain read to the rules', () => {
    const found = recogniseRecords('what changed in the context this week?', reading)
    expect(found).toMatchObject({ type: 'records' })
    expect(found).not.toHaveProperty('judgement')
  })
})

describe('what reaches beyond what is written', () => {
  it('reads "going to" a place as where something goes, and "going to" a verb as what is next', () => {
    expect(limitOf('what is written about orders going to Norway?')).toBeNull()
    expect(limitOf('are orders going to Norway counted in Sales?')).toBeNull()
    expect(limitOf('are orders going to bounce back in Spain?')).toBe('forecast')
    expect(readsBeyond('what is written about orders going to Norway?')).toBe(false)
    expect(readsBeyond('are orders going to bounce back in Spain?')).toBe(true)
  })

  it.each([
    ['should we restart the Norway campaign?', 'advice'],
    ['will orders recover in Norway next quarter?', 'forecast'],
    ['is our return rate good compared to the industry?', 'outside'],
    ['how much did we lose from the Norway stop?', 'numbers'],
  ])('%s', (question, limit) => {
    expect(limitOf(question)).toBe(limit)
  })

  // Each asks what is written: "should" alone is no request for advice.
  it.each([
    'what should I rule out before explaining a jump in gross margin?',
    'what should I know about revenue?',
    'any campaigns I should know about?',
    'why did orders drop in Norway in August?',
  ])('leaves "%s" alone', (question) => {
    expect(readsBeyond(question)).toBe(false)
  })
})
