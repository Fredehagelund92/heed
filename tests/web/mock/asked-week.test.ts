import { describe, expect, it } from 'vitest'
import { askQuestion } from '@/api/mock/data/ask'
import { askedThisWeek } from '@/api/mock/data/asked-week'
import { obsData } from '@/api/mock/data/observability'
import { ASKED_ROWS } from '@/model/ask'

const TOPICS = obsData('normal').topics
import { HIDE_UNDER, total } from '@/api/mock/obs-engine'

describe('asked this week', () => {
  const w = askedThisWeek()
  it('shows the most asked topics from the one count, and never one asked fewer than 5 times', () => {
    expect(ASKED_ROWS).toBe(4)
    expect(w.rows.length).toBeGreaterThan(ASKED_ROWS)
    expect(w.asked).toBe(TOPICS.reduce((n, t) => n + total(t.week), 0))
    for (const r of w.rows) expect(r.times).toBeGreaterThanOrEqual(HIDE_UNDER)
    expect(w.rows.map((r) => r.times)).toEqual(
      [...w.rows.map((r) => r.times)].sort((a, b) => b - a),
    )
  })
  it('gives each row the state its question gets when asked', () => {
    for (const r of w.rows) expect(askQuestion(r.question).state, r.title).toBe(r.state)
  })
  it("offers a Not found row's waiting draft or suggestion, never a blank page", () => {
    const spain = w.rows.find((r) => r.topic.id === 'orders-spain')!
    expect(spain.state).toBe('missing')
    expect(spain.next).toEqual({ label: 'Write it', href: '/context/new?gap=gap-spain' })
    for (const r of w.rows) if (r.next) expect(r.state).toBe('missing')
    expect(w.rows.find((r) => r.topic.id === 'orders-norway')!.next).toBeUndefined()
  })
})
