import { describe, expect, it } from 'vitest'
import { createScenario } from '@/api/mock/scenario'

describe('the review flags that play a page load', () => {
  const at = (query: Record<string, string>) => {
    const scenario = createScenario()
    scenario.setAddress({ path: '/context', query })
    return scenario.showsLoads()
  }

  it('leave an ordinary visit alone', () => {
    expect(at({})).toBe(false)
    expect(at({ demo: 'week' })).toBe(false)
  })

  it('are the slow network and the faults', () => {
    expect(at({ slow: '1' })).toBe(true)
    expect(at({ state: 'loading' })).toBe(true)
    expect(at({ state: 'failed' })).toBe(true)
  })
})
