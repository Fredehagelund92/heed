import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CountUp } from '@/components/heed/count-up'
import { BUILT_IN, narrowed } from '@/lib/obs-views'
import { obsHref, obsSectionOf } from '@/lib/obs'
import { observability, type ObsData, type Topic } from '@/model/observability'

// Overview, the one view over Observability's topics: its built-in views, what narrows it, what a
// narrowed selection of topics adds up to (only from counts a reader may see), its addresses, and
// the number that counts to its new value.

const counts = (c: Partial<Topic['counts']> = {}): Topic['counts'] => ({
  grounded: 0,
  partial: 0,
  conflict: 0,
  stale: 0,
  missing: 0,
  ...c,
})

const topic = (id: string, over: Partial<Topic> = {}): Topic => ({
  id,
  metric: 'Orders',
  where: id,
  domain: 'sales',
  month: '2026-10',
  subject: id,
  total: 10,
  atLeast: 10,
  counts: counts({ grounded: 10 }),
  in: { notFound: false, reported: false, answers: ['grounded'] },
  ...over,
})

const data = (topics: Topic[], over: Partial<ObsData> = {}): ObsData => ({
  state: 'normal',
  range: 7,
  last: Date.UTC(2026, 9, 22),
  numbers: { asked: 0, counts: counts(), before: { asked: 0, missing: 0, grounded: 0 } },
  bars: [],
  topics,
  subjects: [],
  domains: [],
  notFound: { subjects: [], topics: [] },
  couldNotRead: 0,
  markets: [],
  publishes: [],
  agents: [],
  feedback: null,
  usage: null,
  ...over,
})

describe('the built-in views', () => {
  const look = BUILT_IN.find((v) => v.id === 'look')!
  it('come in the order a reader looks: All topics, then what needs a look', () => {
    expect(BUILT_IN.map((v) => v.name)).toEqual([
      'All topics',
      'Needs a look',
      'Not found',
      'Conflict',
      'Outdated',
      'Reported',
    ])
  })
  it('put a topic in Needs a look for anything but a checked answer, or a report', () => {
    expect(look.has(topic('a'))).toBe(false)
    expect(look.has(topic('b', { in: { notFound: true, reported: false, answers: [] } }))).toBe(
      true,
    )
    expect(
      look.has(
        topic('c', { in: { notFound: false, reported: false, answers: ['grounded', 'partial'] } }),
      ),
    ).toBe(true)
    expect(
      look.has(topic('d', { in: { notFound: false, reported: true, answers: ['grounded'] } })),
    ).toBe(true)
  })
})

describe('what narrows the topics', () => {
  it('is a view, a filter of the topics or a search, never the domain or the agent', () => {
    expect(narrowed([], 'all')).toBe(false)
    // The domain and the kind of agent the service reads narrow the read, not the topics.
    expect(
      narrowed(
        [
          { key: 'domain', values: ['sales'] },
          { key: 'agent', values: ['Cursor'] },
        ],
        'all',
      ),
    ).toBe(false)
    expect(narrowed([], 'look')).toBe(true)
    expect(narrowed([{ key: 'answer', values: ['missing'] }], 'all')).toBe(true)
    expect(narrowed([{ key: 'gap', values: ['draft'] }], 'all')).toBe(true)
    expect(narrowed([{ key: 'month', values: ['2026-09'] }], 'all')).toBe(true)
    expect(narrowed([{ key: 'topic', values: ['norway'] }], 'all')).toBe(true)
    // Two domains, or one left out, narrow the topics alone.
    expect(narrowed([{ key: 'domain', values: ['sales', 'finance'] }], 'all')).toBe(true)
    expect(narrowed([{ key: 'domain', not: true, values: ['sales'] }], 'all')).toBe(true)
  })
})

describe('a narrowed selection of topics', () => {
  it('adds up what every topic shows, exactly', () => {
    const t = [
      topic('a', { total: 12, counts: counts({ grounded: 9, missing: 3 }) }),
      topic('b', { total: 8, counts: counts({ grounded: 8 }) }),
    ]
    const sel = observability(data(t)).selection(t)
    expect(sel.asked).toEqual({ visible: 20, shown: 20 })
    expect(sel.checked).toEqual({ visible: 17, shown: 17 })
    expect(sel.nothing).toEqual({ visible: 3, shown: 3 })
  })

  it('reads "+" where a part is hidden, and never works the hidden part out', () => {
    const t = [
      topic('a', { total: 12, counts: counts({ grounded: 9, missing: null }) }),
      topic('b', { total: null, atLeast: 6, counts: counts({ grounded: 6, partial: null }) }),
    ]
    const sel = observability(data(t)).selection(t)
    // The total of b is hidden, so the sum is at least 12 + 6.
    expect(sel.asked).toEqual({ visible: null, shown: 18 })
    expect(sel.checked).toEqual({ visible: 15, shown: 15 })
    // a's "found nothing" is hidden: the sum shows nothing of it, not 12 - 9.
    expect(sel.nothing).toEqual({ visible: null, shown: 0 })
  })

  it("takes a subject's own counts when all of its months are in it", () => {
    const sep = topic('sep', {
      subject: 'orders-norway',
      month: '2026-09',
      total: null,
      atLeast: 0,
      counts: counts({ grounded: null, missing: null }),
    })
    const oct = topic('oct', {
      subject: 'orders-norway',
      total: 24,
      counts: counts({ grounded: 20, missing: null }),
    })
    const subjects = [
      {
        key: 'orders-norway',
        domain: 'sales',
        topics: ['sep', 'oct'],
        total: 31,
        atLeast: 31,
        counts: counts({ grounded: 26, missing: 5 }),
      },
    ]
    const obs = observability(data([sep, oct], { subjects }))
    expect(obs.selection([sep, oct]).checked).toEqual({ visible: 26, shown: 26 })
    expect(obs.selection([sep, oct]).nothing).toEqual({ visible: 5, shown: 5 })
    // One month alone has only its own counts.
    expect(obs.selection([oct]).nothing).toEqual({ visible: null, shown: 0 })
  })
})

describe("Overview's addresses", () => {
  it('is Observability itself, and Questions opens it', () => {
    expect(obsHref('overview')).toBe('/observability')
    expect(obsHref('quality')).toBe('/observability/quality')
    expect(obsSectionOf(undefined)).toBe('overview')
    expect(obsSectionOf('questions')).toBe('overview')
    expect(obsSectionOf('usage')).toBe('usage')
    expect(obsSectionOf('summary')).toBe('overview')
  })
})

describe('a number that counts to its new value', () => {
  const html = (n: number, suffix?: string) =>
    renderToStaticMarkup(React.createElement(CountUp, { value: n, suffix }))

  it('gives a reader the number itself, never the digits on their way', () => {
    const out = html(1293)
    expect(out).toContain('<span class="sr-only">1,293</span>')
    expect(out).toMatch(/aria-hidden="true"/)
    expect(out).toContain('--count:1293')
  })

  it('draws a place per digit, and a thousands mark that takes no room under 1,000', () => {
    const out = html(1293)
    expect(out.match(/count-digit/g)).toHaveLength(4)
    // The thousands place and its mark show only from 1,000 on.
    expect(out).toContain('--from:1000')
    expect(html(7).match(/count-digit/g)).toHaveLength(1)
  })

  it('keeps what follows the number: a share, or a sum with a hidden part', () => {
    expect(html(66, '%')).toContain('<span class="sr-only">66%</span>')
    expect(html(83, '+')).toContain('<span class="sr-only">83+</span>')
  })
})
