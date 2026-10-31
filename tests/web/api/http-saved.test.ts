import { describe, expect, it } from 'vitest'
import type { SavedQuestionRecord, SavedStatus } from '@contract/saved-questions'
import { savedCheckOf, savedQuestionOf } from '@/api/http-saved'

// Saved questions as the http binding reads them from the service: the words come from the
// domain's rules, so Quality says the same thing on both bindings.

const now = new Date('2026-10-23T12:00:00Z')
const item = (id: string, summary: string) => ({
  id,
  title: `Item ${id}`,
  summary,
  unverified: null,
})
const record = (patch: Partial<SavedQuestionRecord['result']> = {}): SavedQuestionRecord => ({
  id: 'q1',
  areaId: 'area_sales',
  question: 'Why did orders in Norway drop in August?',
  origin: 'ask',
  savedBy: { personId: 'p1', name: 'Jon Abara' },
  savedAt: '2026-09-01T09:00:00.000Z',
  expectItems: ['itm_a'],
  saved: { state: 'grounded', say: 'Checked.', items: [item('itm_a', 'Online sales stopped.')] },
  result: {
    result: 'same',
    reason: 'same',
    now: { state: 'grounded', say: 'Checked.', items: [item('itm_a', 'Online sales stopped.')] },
    checkedAt: '2026-10-23T09:41:00.000Z',
    trigger: 'publish',
    ...patch,
  },
})

describe('a saved question from the service', () => {
  it('reads as Quality shows it: its domain, saver, what it should get, why and when', () => {
    expect(savedQuestionOf(record(), now)).toEqual({
      id: 'q1',
      question: 'Why did orders in Norway drop in August?',
      domain: 'area_sales',
      savedBy: 'Jon Abara',
      expect: 'Checked, from Item itm_a.',
      result: 'same',
      why: 'Same items, same sentence.',
      when: expect.stringMatching(/^Today, \d{2}:\d{2}$/) as string,
      factId: 'itm_a',
    })
  })

  it('a result that moved has its before and now', () => {
    const q = savedQuestionOf(
      record({
        result: 'look',
        reason: 'worse',
        now: { state: 'missing', say: 'Not found. Nothing is written about this yet.', items: [] },
      }),
      now,
    )
    expect(q).toMatchObject({
      result: 'look',
      why: 'Used to answer from 1 item. Now it says nothing is written down.',
      factId: 'itm_a',
      diff: {
        saved: 'Online sales stopped.',
        now: 'Not found. Nothing is written about this yet.',
      },
    })
  })
})

describe('a saved question that now gets a Conflict', () => {
  it('names the two items, so its card leads to the comparison', () => {
    const q = savedQuestionOf(
      record({
        result: 'look',
        reason: 'worse',
        now: {
          state: 'conflict',
          say: 'Two items say different things.',
          items: [
            item('itm_a', 'Store credit counts.'),
            item('itm_b', 'Store credit is left out.'),
          ],
        },
      }),
      now,
    )
    expect(q.conflict).toEqual(['itm_a', 'itm_b'])
    expect(savedQuestionOf(record(), now).conflict).toBeUndefined()
  })
})

describe('where the check stands', () => {
  const weeks = Array.from({ length: 8 }, (_, n) => ({
    week: [
      '2026-08-31',
      '2026-09-07',
      '2026-09-14',
      '2026-09-21',
      '2026-09-28',
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
    ][n]!,
    same: n,
    total: 8,
  }))
  const run = {
    id: 'r1',
    trigger: 'manual' as const,
    areaId: null,
    checked: 5,
    total: 12,
    startedAt: '2026-10-23T11:59:00.000Z',
    endedAt: null,
  }

  it('running, failed part way, or idle, with the weeks named by their Monday', () => {
    const status: SavedStatus = { run: { ...run, state: 'running' }, checkedAt: null, weeks }
    expect(savedCheckOf(status, now)).toEqual({
      run: 'running',
      checked: 5,
      total: 12,
      checkedAt: null,
      trend: {
        labels: ['31 Aug', '7 Sep', '14 Sep', '21 Sep', '28 Sep', '5 Oct', '12 Oct', '19 Oct'],
        same: [0, 1, 2, 3, 4, 5, 6, 7],
        total: [8, 8, 8, 8, 8, 8, 8, 8],
      },
    })
    expect(
      savedCheckOf({ ...status, run: { ...run, state: 'failed', checked: 8 } }, now),
    ).toMatchObject({ run: 'failed', checked: 8, total: 12 })
    expect(
      savedCheckOf(
        { run: { ...run, state: 'done' }, checkedAt: '2026-10-23T09:41:00.000Z', weeks },
        now,
      ),
    ).toMatchObject({
      run: 'idle',
      checked: 0,
      total: 0,
      checkedAt: expect.stringMatching(/^Today/) as string,
    })
    expect(savedCheckOf({ run: null, checkedAt: null, weeks }, now).run).toBe('idle')
  })
})
