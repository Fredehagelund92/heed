import { render, screen, within } from '@testing-library/react'
import { refusals } from '../../src/contract/refusals.ts'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { api, type LibraryFreshness, type WeeklyCalls } from '@/api'
import { mockLibraryFreshness } from '@/api/mock-api'
import { HomePulse } from '@/components/home/home-pulse'
import {
  agentPulse,
  answeredShare,
  callsText,
  countTrend,
  currentWeekBefore,
  factPulse,
  lastWeekOf,
  needALook,
  percentText,
  PULSE_WEEKS,
  PULSE_WEEKS_READ,
  shareTrend,
  TREND_MIN_POINTS,
  TREND_MIN_QUESTIONS,
  weekRangeText,
  type AgentPulse,
  type FactPulse,
} from '@/lib/home-pulse'
import { buildRows, type LibraryRow } from '@/lib/library'
import { visibleTotal } from '@domain/gaps'
import { areas, people, vocabulary } from '@/mocks/reference-data'

let rows: LibraryRow[]
let today: string

// Building the mock's 1,500 facts can pass the default ten seconds on a busy machine.
beforeAll(async () => {
  const library = await api.listLibrary()
  today = library.today
  rows = buildRows(library, { areas, people, vocabulary })
}, 30_000)

const zeros = (count: number): number[] => Array.from({ length: count }, () => 0)

/** Weekly totals for the weeks of 2026-07-20 to 2026-10-12, the last one under way. */
function weekly(
  calls: (number | null)[],
  noItemCalls: (number | null)[],
  shownCalls: number[] = [],
): WeeklyCalls {
  return {
    minimumCount: 5,
    weeks: calls.map((count, index) => {
      const day = new Date(Date.UTC(2026, 6, 20 + 7 * index))
      return {
        week: day.toISOString().slice(0, 10),
        calls: count,
        noItemCalls: noItemCalls[index]!,
        shownCalls: shownCalls[index] ?? count ?? 0,
      }
    }),
  }
}

describe("the pulse strip's numbers", () => {
  it('reads twelve full weeks of agent calls, leaving out the week under way', () => {
    const data = weekly(
      [0, 0, 0, 0, 0, 0, 0, 26, 34, 47, 105, 129, 12],
      [0, 0, 0, 0, 0, 0, 0, 0, 11, 14, 28, 42, 0],
    )
    const pulse = agentPulse(data)
    expect(pulse.weeks).toHaveLength(PULSE_WEEKS)
    expect(pulse.weeks.at(-1)).toEqual({
      week: '2026-10-05',
      calls: 129,
      noItemCalls: 42,
      shownCalls: 129,
      answered: 87 / 129,
    })
    expect(pulse.weeks[0]!.week).toBe('2026-07-20')
    expect(pulse.weeks[0]!.answered).toBeNull()
    expect(pulse.none).toBe(false)
    expect(pulse.minimum).toBe(5)
    expect(PULSE_WEEKS_READ).toBe(PULSE_WEEKS + 1)
  })

  it('tells no share when a count is hidden or nobody asked', () => {
    expect(answeredShare(129, 42)).toBe(87 / 129)
    expect(answeredShare(20, 0)).toBe(1)
    expect(answeredShare(null, 0)).toBeNull()
    expect(answeredShare(20, null)).toBeNull()
    expect(answeredShare(0, 0)).toBeNull()
    expect(agentPulse(weekly(zeros(13), zeros(13))).none).toBe(true)
    // The week under way does not count, and a hidden week is not "none": something was asked.
    expect(agentPulse(weekly([...zeros(12), 3], zeros(13))).none).toBe(true)
    expect(agentPulse(weekly([...zeros(11), null, 0], zeros(13))).none).toBe(false)
  })

  it('counts facts per week by their last change, and last week’s domains', () => {
    const base = rows.find((row) => row.displayStatus === 'accepted')!
    const at = (updatedAt: string, areaId = base.areaId) => ({ ...base, updatedAt, areaId })
    const pulse = factPulse(
      [
        at('2026-10-05T09:00:00Z', 'area_commercial'),
        at('2026-10-11T23:59:00Z', 'area_marketing'),
        at('2026-10-08T10:00:00Z', 'area_commercial'),
        at('2026-10-12T00:00:00Z'), // this week: not shown
        at('2026-09-28T00:00:00Z'),
        at('2026-07-20T12:00:00Z'), // the first week shown
        at('2026-07-19T12:00:00Z'), // before it
      ],
      '2026-10-15',
    )
    expect(pulse.weeks).toHaveLength(PULSE_WEEKS)
    expect(pulse.weeks[0]).toEqual({ week: '2026-07-20', changed: 1 })
    expect(pulse.weeks.at(-2)).toEqual({ week: '2026-09-28', changed: 1 })
    expect(pulse.weeks.at(-1)).toEqual({ week: '2026-10-05', changed: 3 })
    expect(pulse.changedDomains).toBe(2)
  })

  it('splits the facts that apply today by state, leaving out ended ones, and they add up', () => {
    const pulse = factPulse(rows, today)
    expect(pulse.applyToday).toBe(
      pulse.current + pulse.recheckDue + pulse.sourceChanged + pulse.sourceMissing,
    )
    const retired = rows.filter((row) => row.displayStatus === 'retired').length
    const ended = rows.filter((row) => row.displayStatus === 'expired').length
    expect(pulse.applyToday).toBeLessThanOrEqual(rows.length - retired - ended)
    expect(pulse.recheckDue).toBe(rows.filter((row) => row.displayStatus === 'stale').length)
    expect(needALook(pulse)).toBe(pulse.recheckDue + pulse.sourceChanged + pulse.sourceMissing)
    expect(pulse.current).toBeGreaterThan(0)
    const none = factPulse([], today)
    expect(none.applyToday).toBe(0)
    expect(none.weeks.every((week) => week.changed === 0)).toBe(true)
  })

  it('writes percents that never round to all or nothing', () => {
    expect(percentText(87 / 129)).toBe('67%')
    expect(percentText(1)).toBe('100%')
    expect(percentText(999 / 1000)).toBe('99%')
    expect(percentText(1 / 1000)).toBe('1%')
    expect(percentText(0)).toBe('0%')
  })

  it('marks a count’s change on the week before as a size, never better or worse', () => {
    expect(countTrend(129, 105)).toEqual({
      direction: 'up',
      verdict: 'none',
      text: '+24',
      spoken: 'up 24 on the week before',
    })
    expect(countTrend(100, 1105)).toMatchObject({ direction: 'down', text: '−1,005' })
    expect(countTrend(5, 5)).toEqual({
      direction: 'flat',
      verdict: 'none',
      text: 'Same',
      spoken: 'same as the week before',
    })
    expect(countTrend(129, null)).toBeNull()
    expect(countTrend(null, 105)).toBeNull()
  })

  it('judges a share better when it rises past the noise floor, worse when it falls', () => {
    expect([TREND_MIN_POINTS, TREND_MIN_QUESTIONS]).toEqual([1, 30])
    const enough = { now: 301, before: 276 }
    expect(shareTrend(0.97, 0.92, { questions: enough })).toEqual({
      direction: 'up',
      verdict: 'better',
      text: '+5 pts',
      spoken: 'up 5 points on the week before, better',
    })
    expect(shareTrend(0.82, 0.9, { questions: enough })).toEqual({
      direction: 'down',
      verdict: 'worse',
      text: '−8 pts',
      spoken: 'down 8 points on the week before, worse',
    })
    // One whole point is a change; it is said in the singular.
    expect(shareTrend(0.866, 0.855)).toMatchObject({ verdict: 'better', text: '+1 pt' })
    expect(shareTrend(0.866, 0.855)!.spoken).toBe('up 1 point on the week before, better')
    // Under a point is the same, even where the whole percents shown differ by one.
    expect(shareTrend(0.86, 0.854)).toEqual({
      direction: 'flat',
      verdict: 'none',
      text: 'Same',
      spoken: 'same as the week before',
    })
    expect(shareTrend(0.5, 0.5)!.direction).toBe('flat')
    expect(shareTrend(null, 0.5)).toBeNull()
    expect(shareTrend(0.5, null)).toBeNull()
  })

  it('gives a share of fewer than 30 questions in either week a size but no verdict', () => {
    for (const questions of [
      { now: 29, before: 300 },
      { now: 300, before: 29 },
      { now: 300, before: null },
    ])
      expect(shareTrend(0.64, 0.81, { questions })).toEqual({
        direction: 'down',
        verdict: 'none',
        text: '−17 pts',
        spoken: 'down 17 points on the week before, too few questions to call it better or worse',
      })
    expect(shareTrend(0.64, 0.81, { questions: { now: 30, before: 30 } })!.verdict).toBe('worse')
    // The share current is today's against a week ago, and says so.
    expect(shareTrend(0.86, 0.83, { base: 'week ago' })!.spoken).toBe(
      'up 3 points since a week ago, better',
    )
    expect(shareTrend(0.86, 0.86, { base: 'week ago' })!.spoken).toBe('same as a week ago')
  })

  it('reads the share current a week ago from the freshness counts', () => {
    const counts = (days: LibraryFreshness['days']): LibraryFreshness => ({
      today: '2026-10-15',
      days,
    })
    expect(
      currentWeekBefore(
        counts([
          { day: '2026-10-08', applying: 1000, current: 830 },
          { day: '2026-10-15', applying: 1091, current: 941 },
        ]),
      ),
    ).toBe(0.83)
    expect(
      currentWeekBefore(
        counts([
          { day: '2026-10-08', applying: 0, current: 0 },
          { day: '2026-10-15', applying: 3, current: 3 },
        ]),
      ),
    ).toBeNull()
    expect(currentWeekBefore(counts([{ day: '2026-10-15', applying: 3, current: 3 }]))).toBeNull()
  })

  it('counts the mock library’s freshness today as the index does, and a week at a time back', async () => {
    const counts = await api.getLibraryFreshness({ weeks: 3 })
    const pulse = factPulse(rows, today)
    expect(counts.today).toBe(today)
    expect(counts.days.map((entry) => entry.day)).toEqual([
      '2026-09-23',
      '2026-09-30',
      '2026-10-07',
    ])
    expect(counts.days.at(-1)).toEqual({
      day: today,
      applying: pulse.applyToday,
      current: pulse.current,
    })
    for (const entry of counts.days) expect(entry.current).toBeLessThanOrEqual(entry.applying)
    expect((await api.getLibraryFreshness()).days).toHaveLength(8)
    expect(() => mockLibraryFreshness([], today, { weeks: 53 })).toThrow(refusals.badRequest)
    expect(() => mockLibraryFreshness([], today, { weeks: 0 })).toThrow(refusals.badRequest)
  })

  it('names last week by its days, Monday to Sunday', () => {
    expect(lastWeekOf('2026-10-15')).toBe('2026-10-05')
    expect(lastWeekOf('2026-10-12')).toBe('2026-10-05')
    expect(lastWeekOf('2026-10-11')).toBe('2026-09-28')
    expect(weekRangeText('2026-10-05')).toBe('5 to 11 Oct')
    expect(weekRangeText('2026-09-28')).toBe('28 Sept to 4 Oct')
    expect(weekRangeText('2026-12-28')).toBe('28 Dec to 3 Jan')
  })
})

const ready = <T,>(data: T) => ({ state: 'ready' as const, data })

function facts(over: Partial<FactPulse> = {}): FactPulse {
  return {
    weeks: Array.from({ length: PULSE_WEEKS }, (_, index) => ({
      week: new Date(Date.UTC(2026, 6, 20 + 7 * index)).toISOString().slice(0, 10),
      changed: [10, 8, 9, 3, 5, 10, 1, 5, 2, 1, 4, 6][index]!,
    })),
    changedDomains: 4,
    applyToday: 1091,
    current: 941,
    recheckDue: 88,
    sourceChanged: 51,
    sourceMissing: 11,
    ...over,
  }
}

const demo = (): AgentPulse =>
  agentPulse(
    weekly(
      [0, 0, 0, 0, 0, 0, 0, 26, 34, 47, 105, 129, 12],
      [0, 0, 0, 0, 0, 0, 0, 0, 11, 14, 28, 42, 0],
    ),
  )

/** A week before today 83% of the facts were current (today the index says 941 of 1,091). */
const weekAgo: LibraryFreshness = {
  today: '2026-10-15',
  days: [
    { day: '2026-10-08', applying: 1000, current: 830 },
    { day: '2026-10-15', applying: 1091, current: 941 },
  ],
}

const mark = (name: string) => tile(name).querySelector<HTMLElement>('[data-slot="change-mark"]')

const tile = (name: string) =>
  screen
    .getAllByRole('listitem')
    .find((item) => within(item).queryByText(name, { exact: true }) !== null)!

describe('the pulse strip', () => {
  it('shows the four numbers of last week, each with its chart and words', () => {
    render(
      <HomePulse
        agent={ready(demo())}
        facts={ready(facts())}
        freshness={weekAgo}
        lastWeek="2026-10-05"
      />,
    )
    expect(screen.getByRole('heading', { name: 'Last week' })).toBeVisible()
    expect(screen.getByText('5 to 11 Oct')).toBeVisible()
    expect(tile('Questions from AI apps')).toHaveTextContent('129')
    expect(tile('Questions from AI apps')).toHaveTextContent('12 weeks shown')
    expect(tile('Questions that found a fact')).toHaveTextContent('67%')
    expect(tile('Questions that found a fact')).toHaveTextContent('87 of 129 · 42 found nothing')
    expect(tile('Facts added or changed')).toHaveTextContent('6')
    expect(tile('Facts added or changed')).toHaveTextContent('In 4 domains · 12 weeks shown')
    expect(tile('Facts that are current')).toHaveTextContent('86%')
    expect(tile('Facts that are current')).toHaveTextContent('150 of 1,091 need checking')
    const charts = screen.getAllByRole('img')
    expect(charts).toHaveLength(4)
    expect(charts[0]).toHaveAccessibleName(
      'Questions from AI apps per week, the last 12 weeks: 0, 0, 0, 0, 0, 0, 0, 26, 34, 47, 105, 129. Up 24 on the week before',
    )
    expect(charts[3]).toHaveAccessibleName(
      '1,091 facts that apply today: 941 current, 88 check due, 51 source changed, 11 source missing. Up 3 points since a week ago, better',
    )
    expect(charts[1]).toHaveAccessibleName(
      expect.stringMatching(/\. Down 6 points on the week before, worse$/),
    )
  })

  it('marks each change on the week before: green or red where judged, muted for volumes', () => {
    render(
      <HomePulse
        agent={ready(demo())}
        facts={ready(facts())}
        freshness={weekAgo}
        lastWeek="2026-10-05"
      />,
    )
    const marks = [
      'Questions from AI apps',
      'Questions that found a fact',
      'Facts added or changed',
    ]
      .concat('Facts that are current')
      .map((name) => mark(name)!)
    expect(marks.map((element) => element.dataset.verdict)).toEqual([
      'none',
      'worse',
      'none',
      'better',
    ])
    expect(marks.map((element) => element.dataset.direction)).toEqual(['up', 'down', 'up', 'up'])
    // 87 of 129 found a fact against 77 of 105 the week before: 67% from 73%, both weeks over 30.
    expect(marks.map((element) => within(element).getByText(/[−+]/).textContent)).toEqual([
      '+24',
      '−6 pts',
      '+2',
      '+3 pts',
    ])
    // Colour is never the only sign: an arrow, a sign and the words, which a hover shows too.
    expect(marks[1]).toHaveClass('text-status-danger-fg')
    expect(marks[3]).toHaveClass('text-status-success-fg')
    expect(marks[0]).toHaveClass('text-muted-foreground')
    expect(marks[2]).toHaveClass('text-muted-foreground')
    expect(marks[1]!.querySelector('svg')).not.toBeNull()
    expect(
      within(tile('Questions that found a fact')).getByText(
        'down 6 points on the week before, worse',
      ),
    ).toHaveClass('sr-only')
    expect(marks[3]!.querySelector('[title]')).toHaveAttribute(
      'title',
      'Up 3 points since a week ago, better',
    )
  })

  it('shows no change mark where the week before is not known', () => {
    const hidden = agentPulse(weekly([...zeros(10), 51, null, 0], [...zeros(10), 20, null, 0]))
    render(
      <HomePulse
        agent={ready(hidden)}
        facts={ready(facts())}
        freshness={null}
        lastWeek="2026-10-05"
      />,
    )
    expect(mark('Questions from AI apps')).toBeNull()
    expect(mark('Questions that found a fact')).toBeNull()
    expect(mark('Facts that are current')).toBeNull()
    expect(mark('Facts added or changed')!.dataset.direction).toBe('up')
  })

  it('hides a total that would give a hidden count away by subtraction', () => {
    // 109 calls, 105 of them in shown topic weeks: the total would reveal a topic week of 4.
    expect(visibleTotal(109, 105, 5)).toBeNull()
    expect(visibleTotal(138, 129, 5)).toBe(138)
    expect(visibleTotal(26, 26, 5)).toBe(26)
    expect(visibleTotal(0, 0, 5)).toBe(0)
    expect(visibleTotal(4, 0, 5)).toBeNull()
    expect(visibleTotal(9, 0, 5)).toBe(9)
    expect(callsText({ calls: 109, shownCalls: 109 }, 5)).toBe('109')
    expect(callsText({ calls: null, shownCalls: 105 }, 5)).toBe('At least 105')
    expect(callsText({ calls: null, shownCalls: 0 }, 5)).toBe('Fewer than 5')
  })

  it('says how many at least when the exact total is hidden', () => {
    const floor = agentPulse(
      weekly([...zeros(10), 51, null, 0], [...zeros(10), 20, null, 0], [...zeros(10), 47, 105, 0]),
    )
    render(
      <HomePulse
        agent={ready(floor)}
        facts={ready(facts())}
        freshness={weekAgo}
        lastWeek="2026-10-05"
      />,
    )
    expect(tile('Questions from AI apps')).toHaveTextContent('105+')
    expect(tile('Questions from AI apps')).toHaveTextContent(
      'At least 105. A few more stay hidden.',
    )
    expect(tile('Questions that found a fact')).toHaveTextContent('Hidden')
    expect(screen.getAllByRole('img')[0]!.getAttribute('aria-label')).toMatch(/51, at least 105/)
  })

  it('keeps a hidden count hidden and says why', () => {
    const hidden = agentPulse(weekly([...zeros(11), null, 0], [...zeros(11), null, 0]))
    render(
      <HomePulse
        agent={ready(hidden)}
        facts={ready(facts())}
        freshness={weekAgo}
        lastWeek="2026-10-05"
      />,
    )
    expect(tile('Questions from AI apps')).toHaveTextContent('<5')
    expect(tile('Questions from AI apps')).toHaveTextContent('We hide counts under 5')
    expect(tile('Questions that found a fact')).toHaveTextContent('Hidden')
    expect(screen.getAllByRole('img')[0]!.getAttribute('aria-label')).toMatch(/fewer than 5/)
  })

  it('says what an empty Heed means: no AI app questions and no facts yet', () => {
    render(
      <HomePulse
        agent={ready(agentPulse(weekly(zeros(13), zeros(13))))}
        facts={ready(factPulse([], '2026-10-15'))}
        freshness={weekAgo}
        lastWeek="2026-10-05"
      />,
    )
    expect(tile('Questions from AI apps')).toHaveTextContent('No AI app has asked yet')
    expect(tile('Questions that found a fact')).toHaveTextContent('No questions')
    expect(tile('Questions that found a fact')).toHaveTextContent('Shows once an AI app asks')
    expect(tile('Facts added or changed')).toHaveTextContent('Nothing written down yet')
    expect(tile('Facts that are current')).toHaveTextContent('None yet')
    expect(tile('Facts that are current')).toHaveTextContent('No facts apply yet')
  })

  it('holds each tile while it loads, and offers a retry for the half that failed', async () => {
    const retry = vi.fn()
    const { rerender } = render(
      <HomePulse
        agent={{ state: 'pending' }}
        facts={{ state: 'pending' }}
        freshness={weekAgo}
        lastWeek={null}
      />,
    )
    const tiles = screen.getAllByRole('listitem')
    expect(tiles.map((item) => item.dataset.state)).toEqual([
      'pending',
      'pending',
      'pending',
      'pending',
    ])
    rerender(
      <HomePulse
        agent={{ state: 'failed', retry }}
        facts={ready(facts())}
        freshness={weekAgo}
        lastWeek="2026-10-05"
      />,
    )
    expect(tile('Questions from AI apps')).toHaveTextContent('Not loaded')
    expect(tile('Facts that are current')).toHaveTextContent('86%')
    await userEvent.click(within(tile('Questions that found a fact')).getByRole('button'))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('has no view switch, only the four tiles', () => {
    render(
      <HomePulse
        agent={ready(demo())}
        facts={ready(facts())}
        freshness={weekAgo}
        lastWeek="2026-10-05"
      />,
    )
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })
})
