import { describe, expect, it } from 'vitest'
import {
  alertCardRules,
  alertCardWords,
  alertRuleIds,
  alertRules,
  cardReaches,
  lookTitle,
  raisedLine,
  ruleOfCard,
  shareFires,
  spendReached,
  thresholdOfWords,
  thresholdWords,
  timesWords,
  twoDaysRunning,
} from '../../../src/domain/alerts.ts'

describe('the rules', () => {
  it('are eight sentences, a threshold inside exactly those that have one', () => {
    expect(alertRules.map((r) => r.id)).toEqual([...alertRuleIds])
    for (const r of alertRules) {
      expect(r.when.includes('{n}'), r.id).toBe(!!r.threshold)
      if (r.threshold) expect(r.threshold.choices, r.id).toContain(r.threshold.initial)
    }
  })

  it('say a threshold in the words of its sentence, and take back only one it offers', () => {
    expect(thresholdWords(20, 'percent')).toBe('20%')
    expect(thresholdWords(5, 'times')).toBe('5')
    expect(thresholdOfWords('share', '30%')).toBe(30)
    expect(thresholdOfWords('gap', '10')).toBe(10)
    expect(thresholdOfWords('gap', '7')).toBeNull()
    expect(thresholdOfWords('saved', '5')).toBeNull()
  })
})

describe('when a rule fires', () => {
  it('fires a share only above it, and only for a part at least the minimum (FR-614)', () => {
    expect(shareFires({ day: '2026-10-22', total: 20, part: 5 }, 20, 5)).toBe(true)
    expect(shareFires({ day: '2026-10-22', total: 25, part: 5 }, 20, 5)).toBe(false)
    // 4 of 10 is 40%, but 4 is a hidden count: a share would give it away.
    expect(shareFires({ day: '2026-10-22', total: 10, part: 4 }, 20, 5)).toBe(false)
  })

  it('needs two days running, one after the other, and names the later one', () => {
    const day = (d: string, part: number) => ({ day: d, total: 20, part })
    expect(twoDaysRunning([day('2026-10-21', 6), day('2026-10-22', 6)], 20, 5)).toBe('2026-10-22')
    expect(twoDaysRunning([day('2026-10-20', 6), day('2026-10-22', 6)], 20, 5)).toBeNull()
    expect(twoDaysRunning([day('2026-10-21', 6), day('2026-10-22', 2)], 20, 5)).toBeNull()
  })

  it('reaches a share of the spend cap, and never on a cap of nothing', () => {
    expect(spendReached(400, 500, 80)).toBe(true)
    expect(spendReached(399, 500, 80)).toBe(false)
    expect(spendReached(10, 0, 80)).toBe(false)
  })
})

describe('what a raise says', () => {
  it('hides a count from agents under the minimum (FR-614)', () => {
    expect(timesWords(9, 5)).toBe('9 times')
    expect(timesWords(3, 5)).toBe('fewer than 5 times')
    expect(timesWords(1, 1)).toBe('1 time')
  })

  it('says whom it reached, or the audience before it is delivered', () => {
    expect(raisedLine('saved', ['Sofia Brandt', 'Jon Abara'])).toBe(
      'A card went to Jon Abara and Sofia Brandt.',
    )
    expect(raisedLine('gap', ['Jon Abara'])).toBe('A Not found card went to Jon Abara.')
    expect(raisedLine('due', [])).toBe('A reminder went to the owners.')
    expect(raisedLine('fail', [])).toBe('A card went to the admins.')
    expect(lookTitle(1)).toBe('1 saved question needs a look')
    expect(lookTitle(2)).toBe('2 saved questions need a look')
  })
})

describe('which Inbox cards a rule keeps from someone', () => {
  const none = { off: [], muted: [] }
  it('gives the five rules with no other card one of their own, with its words and one action', () => {
    expect([...alertCardRules].sort()).toEqual(['disagree', 'fail', 'share', 'spend', 'sync'])
    for (const rule of alertCardRules) {
      expect(ruleOfCard({ group: 'alert', rule }), rule).toBe(rule)
      expect(alertCardWords[rule].open, rule).toMatch(/^Open /)
    }
    expect(
      cardReaches({ group: 'alert', rule: 'spend', areaId: '' }, { off: ['spend'], muted: [] }),
    ).toBe(false)
  })

  it('knows the cards of the three rules the Inbox draws, and no other', () => {
    expect(ruleOfCard({ group: 'gap' })).toBe('gap')
    expect(ruleOfCard({ group: 'look' })).toBe('saved')
    expect(ruleOfCard({ group: 'check', reason: 'date' })).toBe('due')
    expect(ruleOfCard({ group: 'check', reason: 'source' })).toBeNull()
    expect(ruleOfCard({ group: 'suggestion' })).toBeNull()
  })

  it('keeps a card from everyone while its rule is off, and from who muted it in its domain', () => {
    const gap = { group: 'gap', areaId: 'sales' }
    expect(cardReaches(gap, none)).toBe(true)
    expect(cardReaches(gap, { off: ['gap'], muted: [] })).toBe(false)
    expect(cardReaches(gap, { off: [], muted: [{ rule: 'gap', areaId: 'sales' }] })).toBe(false)
    expect(cardReaches(gap, { off: [], muted: [{ rule: 'gap', areaId: 'marketing' }] })).toBe(true)
    expect(cardReaches({ group: 'flag', areaId: 'sales' }, { off: ['gap'], muted: [] })).toBe(true)
  })
})
