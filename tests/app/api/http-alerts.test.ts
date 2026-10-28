import { describe, expect, it } from 'vitest'
import type { AlertRaise, AlertRuleRecord } from '@contract/alerts'
import { alertsOf, hrefOf, raisedWhen } from '@/api/http-alerts'
import { lastOf, rulesFor, thresholdOf } from '@/model/alerts'
import { RULES } from '@/api/mock/data/alerts'

// Alerts as the http binding reads them from the service: the sentences are the domain's, which
// the mock's rules say too, and what is on, muted and raised comes from the service.

const now = new Date(2026, 9, 23, 15, 0)
const raise = (patch: Partial<AlertRaise> = {}): AlertRaise => ({
  id: 'r1',
  rule: 'saved',
  areaIds: ['area_sales'],
  title: '2 saved questions need a look',
  subject: { card: 'look:area_sales' },
  raisedAt: new Date(2026, 9, 23, 9, 41).toISOString(),
  reached: ['Sofia Brandt', 'Jon Abara'],
  ...patch,
})
const record = (rule: AlertRuleRecord['rule'], patch: Partial<AlertRuleRecord> = {}) => ({
  rule,
  enabled: true,
  threshold: null,
  audience: RULES.find((r) => r.id === rule)!.audience,
  mutedFor: [],
  last: null,
  ...patch,
})
const all = RULES.map((r) => record(r.id))

describe('the rules from the service', () => {
  it('say the same sentences as the mock, with the threshold the service fires at', () => {
    const { rules } = alertsOf(
      { rules: all.map((r) => (r.rule === 'share' ? { ...r, threshold: 30 } : r)) },
      [],
      now,
    )
    for (const [i, r] of rules.entries()) {
      const mock = RULES[i]!
      expect(r).toMatchObject({
        id: mock.id,
        name: mock.name,
        when: mock.when,
        then: mock.then,
        audience: mock.audience,
        last: 'Never',
      })
      expect(r.isNew).toBe(mock.isNew)
      expect(r.threshold?.choices).toEqual(mock.threshold?.choices)
    }
    expect(rules.find((r) => r.id === 'share')!.threshold!.value).toBe('30%')
    expect(rules.find((r) => r.id === 'gap')!.threshold).toEqual(RULES[0]!.threshold)
  })

  it('carry what is off and what the person muted, and the last raise they may read', () => {
    const { rules, settings } = alertsOf(
      {
        rules: all.map((r) =>
          r.rule === 'spend'
            ? { ...r, enabled: false }
            : r.rule === 'due'
              ? { ...r, mutedFor: ['area_marketing'], last: raise({ rule: 'due' }) }
              : r,
        ),
      },
      [],
      now,
    )
    expect(settings).toEqual({ off: ['spend'], muted: { due: ['area_marketing'] }, thresholds: {} })
    const due = rules.find((r) => r.id === 'due')!
    // The service narrowed the last raise already: an owner sees it as it is.
    expect(lastOf(due, ['area_marketing'])).toEqual({
      last: 'Today, 09:41',
      href: '/inbox?card=look:area_sales',
    })
    expect(
      thresholdOf(
        rules.find((r) => r.id === 'fail')!,
        settings,
      ),
    ).toBe('5%')
    expect(rulesFor(rules, false)).toHaveLength(5)
  })
})

describe('what the rules raised', () => {
  it('reads as Raised lately: whom it reached, when, its domain and where it goes', () => {
    const { raised } = alertsOf({ rules: all }, [raise()], now)
    expect(raised).toEqual([
      {
        id: 'r1',
        rule: 'saved',
        title: '2 saved questions need a look',
        line: 'A card went to Jon Abara and Sofia Brandt.',
        when: 'Today, 09:41',
        domain: 'area_sales',
        href: '/inbox?card=look:area_sales',
      },
    ])
  })

  it('names the reminder, the Not found card and a raise not yet delivered in their own words', () => {
    const lines = alertsOf(
      { rules: all },
      [
        raise({ id: 'a', rule: 'due', reached: ['Tomas Eriksen'] }),
        raise({ id: 'b', rule: 'gap', reached: ['Jon Abara', 'Sofia Brandt', 'Ines Duarte'] }),
        raise({ id: 'c', rule: 'spend', areaIds: [], reached: [], subject: { page: 'usage' } }),
      ],
      now,
    ).raised
    expect(lines.map((r) => r.line)).toEqual([
      'A reminder went to Tomas Eriksen.',
      'A Not found card went to Ines Duarte, Jon Abara and Sofia Brandt.',
      'A card went to the admins.',
    ])
    expect(lines[2]!.domain).toBeUndefined()
  })

  it('goes to its card, or to the page it is about', () => {
    expect(hrefOf({ card: 'gap:g1' })).toBe('/inbox?card=gap:g1')
    expect(hrefOf({ topic: 't1' })).toBe('/observability/questions?dock=topic.t1')
    expect(hrefOf({ page: 'overview' })).toBe('/observability/overview')
    expect(hrefOf({ connector: 'cube' })).toBe('/settings/integrations/cube')
  })

  it('says when as the Alerts page writes it', () => {
    expect(raisedWhen(new Date(2026, 9, 22, 18, 2).toISOString(), now)).toBe('Yesterday, 18:02')
    expect(raisedWhen(new Date(2026, 9, 20, 8, 0).toISOString(), now)).toBe('Tue 20 Oct')
    expect(raisedWhen(new Date(2025, 9, 20, 8, 0).toISOString(), now)).toBe('Mon 20 Oct 2025')
  })
})
