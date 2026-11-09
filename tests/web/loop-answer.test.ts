// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { LoopTurn } from '@contract/answer'
import { dimensionHue } from '@domain/ask-nouns'
import examples from '@/api/mock/data/loop-examples.json'

/*
  Ask's loop answers as the page draws them (direction C, FR-349, FR-718 to FR-720), in every state
  the service wrote on the demo week (src/web/api/mock/data/loop-examples.json, written by
  tests/web/integration/ask-loop-shapes.test.ts), and on a workspace of teams and sprints: the
  state and its fixed sentence, the words with their chips, the evidence in its fixed order, an
  overview's groups, and every chip a button that says what it is, whose card opens on a press.
*/

const world = vi.hoisted(() => ({
  me: { name: 'Jon Abara', role: 'Owner of Sales, admin', owns: ['area_sales'], admin: true },
}))
vi.mock('@/lib/workspace', () => ({
  useFacts: () => [],
  useFact: () => undefined,
  useMe: () => world.me,
  useDomains: () => ({
    area_sales: { id: 'area_sales', name: 'Sales', owners: ['Jon Abara'], covers: 'Orders.', text: '' },
  }),
  usePeople: () => [world.me],
}))
vi.mock('@/lib/definitions', () => ({ useDefinitions: () => [] }))
vi.mock('@/api/queries', () => ({ useWrite: () => vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/dock', () => ({ openDock: vi.fn(), useDock: () => null }))
vi.mock('@/lib/shown-answers', () => ({ answerKey: () => 'k', keepShown: () => {} }))
vi.mock('@/lib/router', async (original) => ({
  ...(await original<typeof import('@/lib/router')>()),
  useRoute: () => ({ path: '/ask', query: new URLSearchParams() }),
}))

const { LoopAnswerBody } = await import('@/components/heed/loop-answer')
const { loopAnswerOf } = await import('@/api/http-ask')
const { doneTurn } = await import('@/model/ask-turn')

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})
const names = { metric: (k: string) => k, value: (k: string) => k, metricKey: () => undefined, marketKey: () => undefined }
function render(turn: LoopTurn, question = 'A question?') {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const answer = loopAnswerOf(turn, question, names)
  act(() => root!.render(React.createElement(LoopAnswerBody, { turn: doneTurn(answer), latest: true })))
  return host
}
const example = (id: keyof typeof examples) => examples[id].turn as unknown as LoopTurn
const text = (el: Element) => el.textContent?.replace(/\s+/g, ' ').trim() ?? ''
const buttons = (el: Element, name: RegExp) =>
  [...el.querySelectorAll('[role="button"], button')].filter((b) =>
    name.test(b.getAttribute('aria-label') ?? b.textContent ?? ''),
  )

describe("Ask's loop answer, state by state", () => {
  it('Checked: no sentence beside the state, the words with chips, then what was used', () => {
    const el = render(example('loop-checked'))
    expect(text(el)).toContain('Checked')
    expect(text(el)).not.toContain('This is written down and checked.')
    expect(buttons(el, /^Orders, metric$/)).toHaveLength(1)
    expect(buttons(el, /, value$/).length).toBeGreaterThan(0)
    expect(text(el)).toContain('Used')
    expect(buttons(el, /^Source 1: /).length).toBeGreaterThan(0)
  })

  it('Not found: one sentence, the closest written counted by value with four rows, the owners, and Write context', () => {
    const el = render(example('loop-missing'))
    expect(text(el)).toContain('Nothing is written about this yet.')
    expect(text(el)).toContain('Written nearest about')
    const rows = el.querySelectorAll('li')
    expect(rows.length).toBe(4)
    const more = [...el.querySelectorAll('button')].find((b) => /^Show \d+ more$/.test(text(b)))
    expect(more).toBeDefined()
    act(() => more!.click())
    expect(el.querySelectorAll('li').length).toBe(example('loop-missing').closest!.items.length)
    expect(text(el)).toMatch(/owned by/)
    expect(text(el)).toMatch(/Write context for Orders in Poland/)
    expect(text(el)).toMatch(/^.*0 of 21 published context items you may read apply/)
  })

  it('Conflict: the two that disagree side by side, who decides, and Compare the two', () => {
    const el = render(example('loop-conflict'))
    expect(text(el)).toContain('Two items say different things.')
    expect(text(el)).toContain('These two disagree')
    expect(text(el)).toMatch(/Which one holds is for the owners of Sales and Paid media to decide/)
    expect([...el.querySelectorAll('button')].some((b) => text(b) === 'Compare the two')).toBe(true)
  })

  it('Outdated: the item row says it needs checking, once, and an admin can mark it still true', () => {
    const el = render(example('loop-stale'))
    expect(text(el)).toContain('Some of this may be old.')
    expect(text(el)).toContain('Needs checking')
    expect([...el.querySelectorAll('button')].some((b) => text(b) === 'Mark it still true')).toBe(true)
    // The day a read gave is drawn as a day, never as the model's digits.
    expect(el.querySelector('time')?.getAttribute('dateTime')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it("A list: the count bold with what it is out of, then the read's items as rows", () => {
    const el = render(example('loop-list'))
    const bold = [...el.querySelectorAll('.font-semibold.tabular-nums')].map(text)
    expect(bold.length).toBeGreaterThanOrEqual(2)
    expect(el.querySelectorAll('li').length).toBe(example('loop-list').body.find((b) => b.t === 'list')?.t === 'list' ? (example('loop-list').body.find((b) => b.t === 'list') as { rows: string[] }).rows.length : 0)
    expect(text(el)).toContain('From Heed')
  })

  it("A long answer: the model's short list as a list, each line with its citation", () => {
    const el = render(example('loop-long'))
    const lines = [...el.querySelectorAll('ul.list-disc > li')]
    expect(lines.length).toBeGreaterThanOrEqual(2)
    for (const line of lines) expect(buttons(line, /^Source \d+: /).length).toBe(1)
  })

  it('A question back: the question and its readings as choices, with no state', () => {
    const el = render(example('loop-question'))
    expect(text(el)).toContain('Which switch do you mean?')
    expect(text(el)).not.toMatch(/Checked|Not found|Partial/)
  })

  it('An overview: the total of its groups, each group a heading with its count, long ones folded', () => {
    const turn = example('loop-overview')
    const el = render(turn, 'what do i need to handle?')
    const o = turn.overview!
    expect(text(el)).toContain(`${o.total} cards wait on you in your Inbox`)
    const headings = [...el.querySelectorAll('h3')]
    expect(headings.map((h) => h.textContent)).toEqual(o.groups.map((g) => `${g.name}${g.count}`))
    const long = o.groups.find((g) => g.rows.length > 4)!
    const all = [...el.querySelectorAll('button')].find((b) => text(b) === `Show all ${long.count}`)
    expect(all).toBeDefined()
    act(() => all!.click())
    const section = [...el.querySelectorAll('section')].find((s) => s.getAttribute('aria-label') === long.name)!
    expect(section.querySelectorAll('li').length).toBe(long.rows.length)
    // A group a page shows filtered links there.
    expect([...el.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/context?due=1')).toBe(true)
  })

  it('An overview of the records: by status, what needs a check first', () => {
    const el = render(example('loop-overview-domain'))
    expect(el.querySelector('h3')?.textContent).toMatch(/^due for a check/)
  })
})

describe('the nouns of an answer on any workspace', () => {
  const invented: LoopTurn = {
    ...example('loop-checked'),
    subject: {
      names: ['Tickets closed', 'Billing'],
      about: ['metric:tickets_closed', 'value:team/billing'],
      period: 'any date',
      assumedToday: false,
      carried: false,
      uncovered: [],
    },
    sources: [],
    items: [],
    body: [
      {
        t: 'p',
        runs: [
          { t: 'noun', id: 'metric:tickets_closed' },
          { t: 'text', text: ' for ' },
          { t: 'noun', id: 'value:team/billing' },
          { t: 'text', text: ' and ' },
          { t: 'noun', id: 'value:sprint/s41' },
          { t: 'text', text: '; again ' },
          { t: 'noun', id: 'value:team/billing' },
          { t: 'text', text: '.' },
        ],
      },
    ],
    nouns: [
      { id: 'metric:tickets_closed', name: 'Tickets closed', of: null, type: null },
      { id: 'value:team/billing', name: 'Billing', of: { id: 'dimension:team', name: 'Team' }, type: 'string' },
      { id: 'value:sprint/s41', name: 'Sprint 41', of: { id: 'dimension:sprint', name: 'Sprint' }, type: 'time' },
      { id: 'dimension:team', name: 'Team', of: null, type: 'string' },
    ],
    closest: null,
    owners: [],
    conflict: [],
    state: 'grounded',
  }

  it("draws each value in its own dimension's hue and icon, a chip the first time only", () => {
    const el = render(invented, 'Tickets closed by billing?')
    const billing = buttons(el, /^Billing, value$/)
    expect(billing).toHaveLength(1)
    expect((billing[0] as HTMLElement).style.getPropertyValue('--chip-h')).toBe(
      String(dimensionHue('dimension:team')),
    )
    const sprint = buttons(el, /^Sprint 41, value$/)[0] as HTMLElement
    expect(sprint.style.getPropertyValue('--chip-h')).toBe(String(dimensionHue('dimension:sprint')))
    // A time dimension's value draws a calendar; any other a tag.
    expect(sprint.querySelector('svg')?.getAttribute('class')).toMatch(/calendar/)
    expect(billing[0]!.querySelector('svg')?.getAttribute('class')).toMatch(/tag/)
    expect(text(el)).toContain('; again Billing.')
    expect(text(el)).not.toMatch(/market/i)
  })

  it("opens a value's card on a press, which says what it is a value of", () => {
    const el = render(invented, 'Tickets closed by billing?')
    act(() => (buttons(el, /^Billing, value$/)[0] as HTMLElement).click())
    expect(document.body.textContent).toContain('A value of Team')
  })
})
