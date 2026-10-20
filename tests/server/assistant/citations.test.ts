import { describe, expect, it } from 'vitest'
import {
  checkSentence,
  createCitationFilter,
  Evidence,
  removedNotice,
} from '../../../src/server/modules/assistant/citations.ts'

function evidence() {
  const e = new Evidence()
  e.addResult({
    status: 'matched',
    items: [
      {
        id: 'itm_abc12345',
        title: 'Norway closure',
        evidence: [
          { quote: 'Online sales stopped by law on 4 August', url: 'https://example.test' },
        ],
        links: [{ rel: 'mentions', target: { kind: 'item', id: 'itm_linked001' } }],
      },
    ],
  })
  e.addPersonText('Please draft this: “The regulator closed every shop in Norway”.')
  return e
}

describe('the citation check', () => {
  it('keeps a sentence whose citations and quotations this turn supports', () => {
    expect(checkSentence('Online sales stopped [itm_abc12345]. ', evidence())).toEqual({
      text: 'Online sales stopped [itm_abc12345]. ',
      cited: ['itm_abc12345'],
      removed: null,
    })
    expect(
      checkSentence(
        'The source says "online sales stopped by law on 4   August" [itm_abc12345].',
        evidence(),
      ).removed,
    ).toBeNull()
    // A linked item's id was in a tool result too.
    expect(checkSentence('See [itm_linked001].', evidence()).cited).toEqual(['itm_linked001'])
    // The person's own words may be quoted back.
    expect(
      checkSentence('You wrote "The regulator closed every shop in Norway".', evidence()).removed,
    ).toBeNull()
  })

  it('removes a sentence citing an item no tool returned, even without brackets', () => {
    expect(checkSentence('Revenue doubled [itm_zzz99999].\n', evidence())).toEqual({
      text: removedNotice.unknown_item + '\n',
      cited: [],
      removed: { reason: 'unknown_item', ids: ['itm_zzz99999'] },
    })
    expect(
      checkSentence('As itm_zzz99999 shows, revenue doubled.', evidence()).removed?.ids,
    ).toEqual(['itm_zzz99999'])
    expect(checkSentence('Both [itm_abc12345, itm_zzz99999] agree.', evidence()).removed).toEqual({
      reason: 'unknown_item',
      ids: ['itm_zzz99999'],
    })
  })

  it('removes a quotation that no source holds, and leaves short quoted names alone', () => {
    expect(
      checkSentence(
        'It says “all online sales are banned for ten years” [itm_abc12345].',
        evidence(),
      ).removed,
    ).toEqual({ reason: 'unverified_quote', ids: ['itm_abc12345'] })
    expect(checkSentence('The metric "Orders" fell.', evidence()).removed).toBeNull()
  })

  it('lets text out a sentence at a time, checked, whatever the deltas', () => {
    const filter = createCitationFilter(evidence())
    const deltas = [
      'Online sa',
      'les stopped [itm_ab',
      'c12345]. Reven',
      'ue doubled [itm_zz',
      'z99999]. Ends',
    ]
    const out = deltas.map((d) => filter.push('t1', d))
    expect(out).toEqual([
      '',
      '',
      'Online sales stopped [itm_abc12345]. ',
      '',
      removedNotice.unknown_item + ' ',
    ])
    expect(filter.flush('t1')).toBe('Ends')
    expect(filter.report()).toEqual({
      cited: ['itm_abc12345'],
      removed: [{ reason: 'unknown_item', ids: ['itm_zzz99999'] }],
      quoted: 0,
      earlier: 0,
    })
    // Decimals and versions are not sentence ends; lines are.
    expect(filter.push('t2', 'Orders fell 3.5% in v2.1 of')).toBe('')
    expect(filter.push('t2', ' the data.\n- next')).toBe('Orders fell 3.5% in v2.1 of the data.\n')
    expect(filter.flush('t2')).toBe('- next')
  })
})

describe('evidence from earlier turns of the conversation', () => {
  it('supports a citation and a quotation read earlier, and the report counts them', () => {
    const e = evidence()
    e.addEarlierResult({
      item: { id: 'itm_earlier01', evidence: [{ quote: 'Orders were restated on 1 September' }] },
    })
    const filter = createCitationFilter(e)
    const text =
      'Orders were restated [itm_earlier01]. The note says "Orders were restated on 1 September". It closed [itm_abc12345]. '
    expect(filter.push('p', text)).toBe(text)
    expect(filter.report()).toEqual({
      cited: ['itm_abc12345', 'itm_earlier01'],
      removed: [],
      quoted: 1,
      earlier: 1,
    })
  })

  it('counts an item read again in this turn as read in this turn', () => {
    const e = new Evidence()
    e.addEarlierResult({ id: 'itm_abc12345' })
    expect(e.earlier('itm_abc12345')).toBe(true)
    e.addResult({ id: 'itm_abc12345' })
    expect(e.earlier('itm_abc12345')).toBe(false)
    e.addEarlierResult({ id: 'itm_abc12345' })
    expect(e.earlier('itm_abc12345')).toBe(false)
  })

  it('still removes an invented quotation and an item nobody read', () => {
    const e = evidence()
    e.addEarlierResult({ item: { id: 'itm_earlier01', summary: 'Orders were restated.' } })
    expect(
      checkSentence('It says "orders tripled after the restatement" [itm_earlier01]. ', e).removed,
    ).toEqual({ reason: 'unverified_quote', ids: ['itm_earlier01'] })
    expect(checkSentence('See [itm_madeup0001]. ', e).removed).toEqual({
      reason: 'unknown_item',
      ids: ['itm_madeup0001'],
    })
  })
})

describe('quotations across sentences and in other forms', () => {
  const fabricated = 'It says "Revenue is net of refunds. It excludes tax and shipping." Done.'

  it('removes a fabricated quotation that holds a sentence boundary', () => {
    const filter = createCitationFilter(evidence())
    const out = filter.push('p', fabricated) + filter.flush('p')
    expect(out).toContain(removedNotice.unverified_quote)
    expect(out).not.toContain('excludes tax')
    expect(filter.report().removed).toHaveLength(1)
  })

  it('holds a streamed quotation until it is closed, however the deltas fall', () => {
    const filter = createCitationFilter(evidence())
    let out = ''
    for (const piece of fabricated.match(/.{1,7}/gs)!) out += filter.push('p', piece)
    out += filter.flush('p')
    expect(out).toContain(removedNotice.unverified_quote)
    expect(out).not.toContain('excludes tax')
  })

  it('keeps a supported quotation that spans a line break', () => {
    const filter = createCitationFilter(evidence())
    const text = 'The source says "online sales stopped by\nlaw on 4 August". Next point.'
    expect(filter.push('p', text) + filter.flush('p')).toBe(text)
    // The report counts each quotation shown that matched a source word for word.
    expect(filter.report().quoted).toBe(1)
  })

  it('checks single-quoted quotations of 20 or more characters, not apostrophes', () => {
    expect(
      checkSentence("The text says 'revenue doubled in every region' here.", evidence()).removed,
    ).toEqual({ reason: 'unverified_quote', ids: [] })
    expect(
      checkSentence("The text says 'Online sales stopped by law on 4 August' here.", evidence())
        .removed,
    ).toBeNull()
    expect(
      checkSentence("It doesn't say that, and the users' data isn't shown.", evidence()).removed,
    ).toBeNull()
  })

  it('does not join short single-quoted terms into one quotation', () => {
    const text = "Use 'draft' and then 'publish' to finish. Next point."
    expect(checkSentence(text, evidence()).removed).toBeNull()
    const filter = createCitationFilter(evidence())
    expect(filter.push('p', text) + filter.flush('p')).toBe(text)
  })

  it('checks a single-quoted claim that holds a contraction, and removes it when unsupported', () => {
    const claim = "The policy says 'refunds aren't issued after thirty days of purchase'."
    expect(checkSentence(claim, evidence()).removed).toEqual({
      reason: 'unverified_quote',
      ids: [],
    })
    const filter = createCitationFilter(evidence())
    const out = filter.push('p', claim + ' Next.') + filter.flush('p')
    expect(out).toContain(removedNotice.unverified_quote)
    expect(out).not.toContain('refunds')
  })

  it('checks item ids in any letter case', () => {
    expect(checkSentence('See ITM_ZZZ99999.', evidence()).removed).toEqual({
      reason: 'unknown_item',
      ids: ['ITM_ZZZ99999'],
    })
  })
})
