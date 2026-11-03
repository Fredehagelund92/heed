import { describe, expect, it } from 'vitest'
import { obsData } from '@/api/mock/data/observability'
import { changedSteps, replay } from '@/api/mock/replay'
import { createWorkspace } from '@/api/mock/workspace'
import { obsPage } from '@/api/mock/obs-page'
import { BUILT_IN, chipsFrom, chipsTo, passes, sentence, type Filters } from '@/lib/obs-views'
import { observability } from '@/api/mock/obs-engine'
import { afterAnswer, NEXT } from '@/model/replay'

// The answer panel's replay runs Ask's own lookup on a topic's scope, so it says what an agent
// gets now, step by step, with nothing recorded; and Questions' views and filters read the same way.

const { data } = observability(obsData('normal'))
const TOPICS = data.topics
const topic = (id: string) => TOPICS.find((t) => t.id === id)!
/** The week's topics as an admin's page reads them, every count disclosed. */
const page = obsPage(obsData('normal'), { range: 7 }, { admin: true, owns: [] })
const domains = createWorkspace().domainMap()

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
    expect(r.steps[1]!.text).toBe('0 context items apply to Orders in Spain in October 2026.')
    expect(r.steps[2]!.items?.every((i) => i.why)).toBe(true)
    expect(r.steps[5]!.text).toBe(NEXT.missing)
    expect(r.ms).toBe(27)
  })

  it('answers from checked context where there is some', () => {
    const r = replay(topic('orders-norway'))
    expect(r.answer.sources.length).toBeGreaterThan(0)
    expect(r.steps[1]!.items?.length).toBe(r.answer.sources.length)
  })

  it('never lets a draft or an archived item reach the agent', () => {
    for (const t of TOPICS) {
      const r = replay(t)
      const left = r.steps[2]!.items ?? []
      for (const i of left)
        if (/draft|archived/.test(i.why ?? '')) expect(r.answer.sources).not.toContain(i.id)
    }
  })

  it('runs on what agents got before the last publish too', () => {
    const units = topic('units-sold-all')
    expect(replay(units, 'before').answer.text).not.toBe(replay(units, 'now').answer.text)
    expect(changedSteps(topic('orders-spain'))).toEqual([])
  })

  it('says what happened after, never who and never a count under 5', () => {
    const spain = page.topics.find((t) => t.id === 'orders-spain')!
    expect(afterAnswer(spain)).toBe(
      'Nobody reported an answer about it. It found nothing 5 or more times, so it waits in the Inbox: draft ready.',
    )
    const revenue = page.topics.find((t) => t.id === 'net-revenue-norway')!
    expect(afterAnswer(revenue)).toBe('Someone reported an answer about it.')
  })
})

describe("Overview's views and filters", () => {
  const all = page.topics
  // A view counts what a reader can see: a month of a subject over several is in the views its
  // subject's counts say, so September of Orders in Norway is in Outdated with October.
  it('start with six views that count 16, 15, 4, 3, 5 and 1 exact topics', () => {
    expect(BUILT_IN.map((v) => all.filter(v.has).length)).toEqual([16, 15, 4, 3, 5, 1])
  })

  it('filter by answer, domain and gap', () => {
    const name = (t: (typeof all)[number]) => t.metric
    const by = (chips: Filters) => all.filter((t) => passes(t, chips, name)).map((t) => t.id)
    expect(by([{ key: 'answer', values: ['conflict'] }])).toEqual([
      'net-revenue-norway',
      'cpa-germany',
      'net-revenue-norway-sep',
    ])
    expect(by([{ key: 'gap', values: ['draft'] }])).toEqual(['orders-spain'])
    expect(by([{ key: 'domain', values: ['paid_media'] }])).toHaveLength(1)
    // Left out: every topic but those.
    expect(by([{ key: 'domain', not: true, values: ['paid_media'] }])).toHaveLength(all.length - 1)
  })

  it('read back as a sentence, and round-trip through the address', () => {
    const f: Filters = [
      { key: 'answer', values: ['missing', 'partial'] },
      { key: 'domain', values: ['sales'] },
    ]
    expect(sentence(f, domains)).toEqual(['Answer is any of Not found, Partial', 'Domain is Sales'])
    // As the address keeps them: a filter that is off has no key at all.
    const kept = Object.entries(chipsTo(f)).filter((e): e is [string, string] => !!e[1]!)
    expect(chipsFrom(new URLSearchParams(kept))).toEqual(f)
    expect(chipsFrom(new URLSearchParams('answer=found'))[0]!.values).toEqual([
      'grounded',
      'partial',
      'conflict',
      'stale',
    ])
  })
})
