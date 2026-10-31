import { describe, expect, it } from 'vitest'
import { pairOfAlert, pairOfTopic } from '@/model/conflicts'

// Which conflict pair a topic or an alert is about, when topics share a beginning.

const rows = [
  { key: 'a.b', topic: 'Orders in Norway' },
  { key: 'c.d', topic: 'Orders' },
  { key: 'e.f', topic: 'Orders in Norway and Sweden' },
]

describe('pairOfTopic', () => {
  it('takes the pair of that exact topic, not of one it begins', () => {
    expect(pairOfTopic(rows, 'Orders')?.key).toBe('c.d')
    expect(pairOfTopic(rows, 'orders in norway')?.key).toBe('a.b')
    expect(pairOfTopic(rows, 'Orders in')).toBeUndefined()
  })
})

describe('pairOfAlert', () => {
  it('reads the topic before the colon of the alert title', () => {
    expect(pairOfAlert(rows, 'Orders: conflict, 3 times')?.key).toBe('c.d')
    expect(pairOfAlert(rows, 'Orders in Norway: conflict, 3 times')?.key).toBe('a.b')
    expect(pairOfAlert(rows, 'Orders in Norway and Sweden: conflict, 5 times')?.key).toBe('e.f')
    expect(pairOfAlert(rows, 'Returns: conflict, 3 times')).toBeUndefined()
  })
})
