import { describe, expect, it } from 'vitest'
import { createAlerts, RAISED, RULES } from '@/api/mock/data/alerts'
import { cards } from '@/api/mock/data/inbox'
import { savedSeed } from '@/api/mock/data/saved-questions'
import { lastOf, rulesFor, thresholdOf } from '@/model/alerts'
import { savedCounts } from '@/model/saved-questions'

describe('alert rules', () => {
  it('has eight rules, four of them new, and owners see the four that reach owners plus the shared one', () => {
    expect(RULES).toHaveLength(8)
    expect(RULES.filter((r) => r.isNew)).toHaveLength(4)
    expect(rulesFor(RULES, true)).toHaveLength(8)
    expect(rulesFor(RULES, false).map((r) => r.id)).toEqual([
      'gap',
      'saved',
      'disagree',
      'sync',
      'due',
    ])
  })
  it('fires the saved-question rule after a publish, an archive, a restore, a sync, or a check date passing', () => {
    expect(RULES.find((r) => r.id === 'saved')!.when).toBe(
      'After a publish, an archive, a restore, a sync, or a check date passing',
    )
  })
  it('raises a card the Inbox has, counting what Quality counts', () => {
    const card = cards.find((c) => c.id === 'look-sales')!
    expect(card.look!.questions).toHaveLength(savedCounts(savedSeed).look)
    expect(card.title).toBe(`${savedCounts(savedSeed).look} saved questions need a look`)
    for (const r of RAISED.filter((x) => x.href.startsWith('/inbox?card=')))
      expect(cards.some((c) => r.href.endsWith(`=${c.id}`))).toBe(true)
  })
  it("shows an owner only their own domains' last raise", () => {
    const gap = RULES.find((r) => r.id === 'gap')!
    expect(lastOf(gap, null).last).toBe('Today, Orders in Germany')
    expect(lastOf(gap, ['marketing']).last).toBe('Never')
    expect(
      lastOf(
        RULES.find((r) => r.id === 'due')!,
        ['marketing'],
      ).last,
    ).toBe('Fri 18 Sep, 1 item')
  })
  it('keeps a changed threshold, and the setters can be taken back', () => {
    const gap = RULES.find((r) => r.id === 'gap')!
    const alerts = createAlerts()
    alerts.setThreshold('gap', '10')
    expect(thresholdOf(gap, alerts.read().settings)).toBe('10')
    alerts.setThreshold('gap', '5')
    alerts.setOn('spend', false)
    expect(alerts.read().settings.off).toEqual(['spend'])
    alerts.setOn('spend', true)
    alerts.setMuted('gap', ['marketing'], true)
    expect(alerts.read().settings.muted.gap).toEqual(['marketing'])
    alerts.setMuted('gap', ['marketing'], false)
    expect(thresholdOf(gap, alerts.read().settings)).toBe('5')
  })
})
