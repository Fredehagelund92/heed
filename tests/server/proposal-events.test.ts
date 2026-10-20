import { expect, it } from 'vitest'
import { eventData } from '../../src/server/modules/proposals/events.ts'

/*
  Timeline rows are never rewritten, so one recorded before 0086 says steward. The service reads
  it in today's words, and leaves every other row as it is.
*/

it('reads a decision made as steward as an owner', () => {
  expect(eventData({ decisionId: 'd1', outcome: 'accept', capacity: 'steward' })).toEqual({
    decisionId: 'd1',
    outcome: 'accept',
    capacity: 'owner',
  })
})

it('reads a review edit of stewardId as an edit of ownerId', () => {
  const change = { before: 'p1', after: 'p2' }
  expect(eventData({ versionId: 'v2', changes: { stewardId: change, riskLevel: change } })).toEqual(
    { versionId: 'v2', changes: { riskLevel: change, ownerId: change } },
  )
})

it('leaves a row written after the rename as it is', () => {
  const data = { capacity: 'administrator', changes: { ownerId: { before: null, after: 'p1' } } }
  expect(eventData(data)).toEqual(data)
})
