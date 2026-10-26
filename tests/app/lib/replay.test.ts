import { describe, expect, it } from 'vitest'
import { TOPICS, topicsOf } from '@/data/observability'
import { BUILT_IN, filtersFrom, filtersTo, passes, sentence } from '@/lib/obs-views'
import { afterAnswer, changedSteps, NEXT, replay } from '@/lib/replay'

// The answer panel's replay runs Ask's own lookup on a topic's scope, so it says what an agent
// gets now, step by step, with nothing recorded; and Questions' views and filters read the same way.

const topic = (id: string) => TOPICS.find((t) => t.id === id)!

describe('a replay', () => {
  it('finds nothing for Orders in Spain, and says what was left out and why', () => {
    const r = replay(topic('orders-spain'))
    expect(r.answer.state).toBe('missing')
    expect(r.steps.map((s) => s.key)).toEqual([
      'scope',
      'looked',
      'left',
      'checked',
      'said',
      'next',
    ])
    expect(r.steps[1].text).toBe('0 context items apply to Orders in Spain in October 2026.')
    expect(r.steps[2].items?.every((i) => i.why)).toBe(true)
    expect(r.steps[5].text).toBe(NEXT.missing)
    expect(r.ms).toBe(27)
  })

  it('answers from checked context where there is some', () => {
    const r = replay(topic('orders-norway'))
    expect(r.answer.sources.length).toBeGreaterThan(0)
    expect(r.steps[1].items?.length).toBe(r.answer.sources.length)
  })

  it('never lets a draft or an archived item reach the agent', () => {
    for (const t of TOPICS) {
      const r = replay(t)
      const left = r.steps[2].items ?? []
      for (const i of left)
        if (/draft|archived/.test(i.why ?? '')) expect(r.answer.sources).not.toContain(i.id)
    }
  })

  it('runs on what agents got before the last publish too', () => {
    const units = topic('units-sold-all')
    expect(replay(units, 'before').answer.text).not.toBe(replay(units, 'now').answer.text)
    expect(changedSteps(topic('orders-spain'))).toEqual([])
  })

  it('counts what agents did after, never who', () => {
    expect(afterAnswer(topic('orders-spain'))).toBe(
      '2 agents sent a report about it. 0 followed a link. 1 asked again with other dates.',
    )
  })
})

describe("Questions' views and filters", () => {
  const all = topicsOf({ range: 7 })
  it('start with five views that count 16, 4, 3, 4 and 1 exact topics', () => {
    expect(BUILT_IN.map((v) => all.filter(v.has).length)).toEqual([16, 4, 3, 4, 1])
  })

  it('filter by answer, domain and gap', () => {
    expect(all.filter((t) => passes(t, { answer: ['conflict'] })).map((t) => t.id)).toEqual([
      'net-revenue-norway',
      'cpa-germany',
      'net-revenue-norway-sep',
    ])
    expect(all.filter((t) => passes(t, { gap: ['draft'] })).map((t) => t.id)).toEqual([
      'orders-spain',
    ])
    expect(all.filter((t) => passes(t, { domain: 'paid_media' }))).toHaveLength(1)
  })

  it('read back as a sentence, and round-trip through the address', () => {
    const f = { answer: ['missing' as const, 'partial' as const], domain: 'sales' as const }
    expect(sentence(f)).toEqual(['Answer is any of Not found, Partial', 'Domain is Sales'])
    // As the address keeps them: a filter that is off has no key at all.
    const kept = Object.entries(filtersTo(f)).filter((e): e is [string, string] => !!e[1])
    expect(filtersFrom(new URLSearchParams(kept))).toEqual({
      ...f,
      agent: undefined,
      gap: undefined,
      month: undefined,
    })
    expect(filtersFrom(new URLSearchParams('answer=found')).answer).toEqual([
      'grounded',
      'partial',
      'conflict',
      'stale',
    ])
  })
})
