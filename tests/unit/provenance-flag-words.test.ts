import { describe, expect, it } from 'vitest'
import { flagWords } from '@/lib/provenance'

describe('flagWords', () => {
  it('says the dates are uncertain, with no quoted words', () => {
    const { label, sentence } = flagWords({ code: 'uncertain_dates', field: 'validity', words: [] })
    expect(label).toBe('Dates uncertain')
    expect(sentence).toBe(
      'The dates were a best guess when this was drafted. Check them against the source.',
    )
  })

  it('names the words that raised the other flags', () => {
    const risk = flagWords({ code: 'may_be_high_risk', field: 'riskLevel', words: ['lawsuit'] })
    expect(risk.label).toBe('May be high risk')
    expect(risk.sentence).toContain('"lawsuit"')
    const orders = flagWords({
      code: 'instruction_like_text',
      field: 'summary',
      words: ['ignore previous'],
    })
    expect(orders.label).toBe('Reads like orders to an AI')
    expect(orders.sentence).toContain('"ignore previous"')
  })
})
