import { describe, expect, it } from 'vitest'
import { createMockApi } from '@/api/mock'

describe('records answers on the mock binding', () => {
  it('reads a number in a question as a number, not as a dimension value', async () => {
    const { api } = createMockApi()
    for (const question of ['list 2 metrics', 'what changed in the last 2 days']) {
      const answer = await api.ask({ question })
      expect(answer.records, question).toBeDefined()
      expect(answer.records?.refused, question).toBeFalsy()
    }
  })

  it('lists the conflicts as Context does, and the other words for them', async () => {
    const { api } = createMockApi()
    const conflicts = await api.conflicts({ whose: 'all' })
    for (const question of [
      'List me conflicts.',
      'any conflicts?',
      'conflicts in Context',
      'what is unresolved',
    ]) {
      const records = (await api.ask({ question })).records
      expect(records, question).toMatchObject({ refused: false, intent: 'conflicts' })
      if (records?.refused !== false) continue
      expect(records.total, question).toBe(conflicts.length)
      expect(
        records.rows.map((r) => (r.type === 'conflict' ? r.key : '')),
        question,
      ).toEqual(conflicts.slice(0, 5).map((c) => c.key))
    }
  })

  it('lists no values for a dimension its definition only counts', async () => {
    const { api } = createMockApi()
    const answer = await api.ask({ question: 'how many campaigns are there?' })
    expect(answer.records?.sentence).toMatch(/Campaign has no values/)
  })

  it('quotes no words for a metric the source does not describe', async () => {
    const { api } = createMockApi()
    const answer = await api.ask({ question: 'what is on-time shipping rate?' })
    expect(answer.definitions?.[0]).toMatchObject({ name: 'On-time shipping rate', words: null })
  })
})
