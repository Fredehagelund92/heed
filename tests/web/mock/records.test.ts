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
