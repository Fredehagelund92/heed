import { describe, expect, it } from 'vitest'
import type { FigureTry } from '@contract/figures'
import { figureTryOf } from '@/api/http-figures'
import type { ConnectorId } from '@/model/integrations'

// Try a figure on the service, as Cube's page says it: what was read and for which days, the value
// as the tool writes it, and how fresh the data is; or the failure's code, never the tool's words.

const source = { id: 'cube', type: 'cube', tool: 'Cube', name: 'Cube' }
const known = (type: string): ConnectorId | undefined => (type === 'cube' ? 'cube' : undefined)
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
