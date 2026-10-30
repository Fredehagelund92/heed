import { describe, expect, it } from 'vitest'
import { figureFor, figureTryFor } from '@/api/mock/data/figures'
import { figureConnections } from '@/api/mock/data/integrations'
import type { ConnectorId } from '@/model/integrations'

// A figure is read from the integration its metric's definition comes from, only when that
// integration has figures switched on; it never borrows the word for checked context.

const norway = {
  metric: 'Orders',
  markets: ['Norway'],
  dates: '1 to 31 Aug 2026',
  state: 'grounded',
}
const only =
  (...ids: ConnectorId[]) =>
  (id: ConnectorId) =>
    ids.includes(id)

describe('figures in an answer', () => {
  it('links into the source while figures are off', () => {
    expect(figureFor(norway, only())).toEqual({
      kind: 'link',
      source: 'cube',
      scope: 'Orders in Norway, 1 to 31 Aug 2026',
    })
  })

  it('shows one figure, with its comparison, once figures are on', () => {
    const v = figureFor(norway, only('cube'))
    expect(v?.kind).toBe('line')
    if (v?.kind !== 'line') return
    expect(v.figure.value).toBe('€43,600')
    expect(v.figure.change).toBe('down 89% from July (€412,600)')
    expect(v.asOf).toBe('today at 06:00')
  })

  it('reads no figure for a metric nobody defines, and says why', () => {
    const nps = {
      metric: 'Net promoter score',
      markets: ['Norway'],
      dates: '1 to 31 Aug 2026',
      state: 'missing',
    }
    expect(figureFor(nps, only())).toBeNull()
    const v = figureFor(nps, only('cube'))
    expect(v?.kind).toBe('none')
    if (v?.kind === 'none')
      expect(v.why).toBe(
        'No connected integration defines net promoter score, so no figure is read for it.',
      )
  })

  it("shows a figure that doesn't fit its context item beside it, without a verdict", () => {
    const v = figureFor(
      {
        metric: 'Discount cost',
        markets: ['Norway'],
        dates: '9 to 31 May 2026',
        state: 'grounded',
      },
      only('cube'),
    )
    expect(v?.kind).toBe('against')
    if (v?.kind === 'against') expect(v.figure.against?.contextId).toBe('itm_za26xpzv')
  })

  it('needs a period, and never answers a failed check', () => {
    expect(figureFor({ ...norway, dates: undefined }, only('cube'))).toBeNull()
    expect(figureFor({ ...norway, state: 'failed' }, only('cube'))).toBeNull()
  })

  it('never calls a figure checked', () => {
    for (const q of [
      norway,
      { metric: 'Orders', markets: ['Spain'], dates: '1 to 31 Oct 2026', state: 'missing' },
      {
        metric: 'Discount cost',
        markets: ['Norway'],
        dates: '9 to 31 May 2026',
        state: 'grounded',
      },
    ]) {
      const v = figureFor(q, only('cube'))
      if (v?.kind !== 'line' && v?.kind !== 'against') continue
      expect(
        `${v.figure.label} ${v.figure.value} ${v.figure.change} ${v.figure.words} ${v.figure.against?.figureSays ?? ''}`.toLowerCase(),
      ).not.toContain('checked')
    }
  })

  it('tries a figure with the connection as saved, and has nothing to try without a token', () => {
    expect(figureTryFor('cube', figureConnections.cube)).toEqual({
      kind: 'figure',
      source: 'cube',
      label: 'Conversion rate, 17 to 23 Oct 2026',
      value: null,
      asOf: 'today at 06:00',
      took: 412,
    })
    expect(figureTryFor('cube', { ...figureConnections.cube!, secretSet: false })).toEqual({
      kind: 'failed',
      source: 'cube',
      failure: 'not_set_up',
    })
  })
})
