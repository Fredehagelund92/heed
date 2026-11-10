import { describe, expect, it } from 'vitest'
import { extractScope } from '../../../src/domain/scope.ts'
import { planBundle, PLAN_TODAY } from '../../../src/server/modules/answer/plan-world.ts'

/*
  A word after "in" that names nothing, on the Larchwood names (the plan world): asked about only
  when it looks like a value (a typo of one, or one word that ends what it says), never when it
  is an ordinary word. The phrasings are those an independent check of PR 180 found read as an
  unknown value (2026-11-10), and the ones it found right. DEMO DATA ONLY.
*/

const read = (question: string) =>
  extractScope(question, planBundle.terms, PLAN_TODAY, { loose: true })
const asked = (question: string) => {
  const r = read(question)
  return r.status === 'need_more_detail' ? r.issues.map((i) => i.message ?? i.input) : []
}

describe('a value word after "in"', () => {
  it.each([
    'net revenue in local currency',
    'gross margin in percentage points',
    'gross margin in relative terms',
    'orders in absolute numbers',
    'orders in plain words',
    'discount cost in campaigns',
    'orders in heed',
    'orders in stores',
    'orders in black friday week',
    'orders in other markets',
    'orders in markets other than norway',
    'orders in online channel',
    'orders in total',
    'orders in practice',
    'net revenue in euros',
    'orders in short',
  ])('reads "%s" as main does: an ordinary word is no value', (question) => {
    expect(asked(question)).toEqual([])
  })

  it('reads the name of the tool a definition comes from as no value', () => {
    // The plan world's terms name no source member; on the service they do (cube:orders.orders).
    const terms = planBundle.terms.map((t) =>
      t.key === 'metric:orders' ? { ...t, definitionRefs: ['cube:orders.orders'] } : t,
    )
    expect(extractScope('orders in cube', terms, PLAN_TODAY, { loose: true }).status).toBe(
      'resolved',
    )
  })

  it('still reads "orders in online channel" as the Channel dimension', () => {
    expect(read('orders in online channel')).toMatchObject({
      status: 'resolved',
      scope: { metrics: ['metric:orders'], filters: { 'dim:channel': [] } },
    })
  })

  it.each([
    ['anything written about orders in jordan?', /named 'jordan'\.$/],
    ['orders in oslo', /named 'oslo'\.$/],
    ['orders in Norwy last month', /named 'Norwy'\. Did you mean Norway\?$/],
    // A typo of a value is the value's word alone, not the words after it.
    ['do orders in germnay lag 2 days or what', /named 'germnay'\. Did you mean Germany\?$/],
  ])('asks about "%s": a word that looks like a value', (question, message) => {
    const said = asked(question)
    expect(said).toHaveLength(1)
    expect(said[0]).toMatch(message)
  })
})
