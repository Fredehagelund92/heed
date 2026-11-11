import { describe, expect, it } from 'vitest'
import type { FigureRead, FigureTry } from '@contract/figures'
import { figureTryOf, figureValue, figureViewOf } from '@/api/http-figures'

// Try a figure on the service, as Cube's page says it: what was read and for which days, the value
// as the tool writes it, and how fresh the data is; or the failure's code, never the tool's words.

const source = { id: 'cube', type: 'cube', tool: 'Cube', name: 'Cube' }
const known = (type: string): string | undefined => (type === 'cube' ? 'cube' : undefined)
const now = new Date(2026, 9, 23, 9, 30)
const figure: FigureTry = {
  state: 'figure',
  source,
  measure: { name: 'marketing.discount_cost', title: 'Discount cost' },
  value: 1234,
  format: { kind: 'currency', currency: 'EUR' },
  from: '2026-10-17',
  to: '2026-10-23',
  asOf: new Date(2026, 9, 23, 6, 0).toISOString(),
  took: 412,
}

describe('a figure tried on the service', () => {
  it('says the measure, its days, the value as the tool writes it and how fresh it is', () => {
    expect(figureTryOf(figure, known, now)).toEqual({
      kind: 'figure',
      source: 'cube',
      label: 'Discount cost, 17 to 23 Oct 2026',
      value: '€1,234',
      asOf: 'today at 06:00',
      took: 412,
    })
  })

  it('has no value when the tool had nothing for those days', () => {
    expect(figureTryOf({ ...figure, value: null }, known, now)).toMatchObject({
      label: 'Discount cost, 17 to 23 Oct 2026',
      value: null,
    })
  })

  it('keeps only the code of a failure', () => {
    expect(figureTryOf({ state: 'failed', source, failure: 'unauthorized' }, known, now)).toEqual({
      kind: 'failed',
      source: 'cube',
      failure: 'unauthorized',
    })
  })

  it('is nothing for a tool the app does not know', () => {
    expect(figureTryOf({ ...figure, source: { ...source, type: 'other' } }, known, now)).toBeNull()
  })
})

describe('no figure read on the service', () => {
  const asked = { metric: 'Revenue', markets: ['Norway'], dates: 'August 2026' }
  const none = (more: Partial<Extract<FigureRead, { state: 'none' }>>): FigureRead => ({
    state: 'none',
    reason: 'no_date',
    source,
    ...more,
  })

  it('names the dates of a view that has several, and asks which one figures use', () => {
    expect(
      figureViewOf(none({ dates: ['Invoice day', 'Order day', 'Ship day'] }), asked, known, now),
    ).toEqual({
      kind: 'none',
      why: 'Cube has 3 dates for revenue: Invoice day, Order day and Ship day. Which one should figures use? The data team names it in the model.',
      closest: [],
    })
  })

  it("says the tool doesn't let the token read a measure, rather than that it is down", () => {
    expect(
      figureViewOf(none({ reason: 'failed', failure: 'not_allowed' }), asked, known, now),
    ).toMatchObject({
      why: "Cube doesn't let the integration's token read revenue, so no figure is read for it.",
    })
  })

  it('says there is no date when the view has none', () => {
    expect(figureViewOf(none({}), asked, known, now)).toMatchObject({
      why: 'Cube has no date for revenue, so no figure is read for these days.',
    })
  })
})

describe('a snapshot read on the service', () => {
  it('reads as its value on the last day, compared with the last of the days before', () => {
    const read: FigureRead = {
      state: 'figure',
      source,
      value: 1200,
      format: { kind: 'number' },
      from: '2026-08-01',
      to: '2026-08-31',
      comparison: { value: 1000, from: '2026-07-01', to: '2026-07-31' },
      snapshot: true,
      asOf: new Date(2026, 9, 23, 6, 0).toISOString(),
      queryInWords: 'Units on hand for Norway as of 31 Aug 2026.',
      dataContact: null,
      against: null,
    }
    const asked = { metric: 'Units on hand', markets: ['Norway'], dates: 'August 2026' }
    expect(figureViewOf(read, asked, known, now)).toMatchObject({
      kind: 'line',
      figure: {
        label: 'Units on hand in Norway, as of 31 Aug 2026',
        value: '1,200',
        change: 'up 20% from 31 Jul 2026 (1,000)',
      },
    })
  })
})

describe('a value as the tool writes it', () => {
  it('writes a percent as the share the tool gives: 0.175 is 17.5%', () => {
    expect(figureValue(0.175, { kind: 'percent' })).toBe('17.5%')
    expect(figureValue(0.2, { kind: 'percent' })).toBe('20%')
  })

  it('writes money in its currency, and a number as a number', () => {
    expect(figureValue(43600, { kind: 'currency', currency: 'EUR' })).toBe('€43,600')
    expect(figureValue(1204.5, { kind: 'number' })).toBe('1,204.5')
  })
})
