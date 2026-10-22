import { useState, type ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, fn, screen, userEvent, within } from 'storybook/test'
import type { LibraryFreshness, ProposalRecord } from '@/api'
import { areasQuery, proposalListQuery } from '@/api/queries'
import { HomePulse } from '@/components/home/home-pulse'
import { YourDrafts as YourDraftsStrip } from '@/components/home/your-drafts'
import { agentPulse, factPulse, PULSE_WEEKS, type FactPulse } from '@/lib/home-pulse'
import { MINE } from '@/lib/my-drafts'
import { areas } from '@/mocks/reference-data'
import { RouterFrame } from './router-frame'
import { StoryApp } from './story-app'

/**
 * Home (Home P): one page for every person, in the real shell. The first visit and a returning
 * one, Your drafts and a person with none, the pulse strip (last week in Heed), its change marks
 * in a better, a worse, a quiet week and one of too few questions, its hidden counts and a half
 * that failed, the search
 * field's suggestions, the three tabs, the empty states and the phone. Use the viewport menu for
 * 1440, 1024 and 390 and the theme menu for dark.
 */
const meta = {
  title: 'Pages/Home',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const returning = { 'cl.home.seen': true }

/** The first visit: one sentence under the title says what Home is for. */
export const FirstVisit: Story = {
  render: () => <StoryApp path="/" preferences={{ 'cl.home.seen': false }} />,
  play: async () => {
    await expect(
      await screen.findByText(/Search what people at the company already know/),
    ).toBeVisible()
  },
}

/** A returning visit: the title, the field, the quick actions and Recently changed. */
export const Returning: Story = {
  render: () => <StoryApp path="/" preferences={returning} />,
  play: async () => {
    await expect(await screen.findByRole('table', { name: 'Recently changed' })).toBeVisible()
    await expect(screen.queryByText(/Search what people at the company/)).toBeNull()
  },
}

/**
 * Your drafts: the draft Maria started and has not submitted, under the search field. The row
 * opens its form, to finish it and submit it; All drafts opens Proposals > Mine on the drafts.
 */
export const YourDrafts: Story = {
  render: () => <StoryApp path="/" preferences={returning} />,
  play: async () => {
    const strip = await screen.findByRole('region', { name: /Your drafts/ })
    const list = within(strip).getByRole('list', { name: 'Your drafts, not sent yet' })
    const row = within(list).getByRole('link')
    await expect(row).toHaveTextContent('Discount cost in Spain')
    await expect(row.getAttribute('href')).toMatch(/^\/library\/new\?draft=/)
    await expect(within(strip).getByRole('link', { name: /All drafts/ })).toHaveAttribute(
      'href',
      '/proposals?view=mine&state=draft',
    )
  },
}

/**
 * Discarding a draft from Home: its row's menu (Continue editing, Discard draft with its key),
 * and the confirmation that names it and says Undo lasts a few seconds.
 */
export const DiscardDraft: Story = {
  render: YourDrafts.render,
  play: async () => {
    const strip = await screen.findByRole('region', { name: /Your drafts/ })
    await userEvent.click(within(strip).getByRole('button', { name: /^Actions for / }))
    await expect(await screen.findByRole('menuitem', { name: 'Continue editing' })).toBeVisible()
    await userEvent.click(screen.getByRole('menuitem', { name: /^Discard draft/ }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard this draft?' })
    await expect(dialog).toHaveTextContent('Discount cost in Spain')
  },
}

/** No drafts: Ravi has only a proposal waiting for review, so the strip is not drawn at all. */
export const NoDrafts: Story = {
  render: () => <StoryApp path="/" person="per_ravi" preferences={returning} />,
  play: async () => {
    await expect(await screen.findByRole('table', { name: 'Recently changed' })).toBeVisible()
    await expect(screen.queryByRole('region', { name: /Your drafts/ })).toBeNull()
  },
}

/** Your drafts on a phone: the domain, the Draft mark and the age move under the title. */
export const PhoneDrafts: Story = {
  render: YourDrafts.render,
  play: YourDrafts.play,
  globals: { viewport: { value: 'phone', isRotated: false } },
}

// Drafts of every length, for the row's columns: short and long titles, the longest domain name,
// one an agent drafted and ages from just now to weeks ago.
const minute = 60_000
const longDomain = { ...areas[2]!, id: 'area_audience', name: 'Audience & Engagement' }
const mixedDraft = (
  number: number,
  title: string,
  areaId: string,
  ago: number,
  extra: Partial<ProposalRecord> = {},
): ProposalRecord => {
  const at = new Date(Date.now() - ago).toISOString()
  return {
    subject: 'item',
    vocabularyVersionId: null,
    vocabulary: null,
    title: '',
    reason: null,
    id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
    number,
    action: 'create',
    state: 'draft',
    areaId,
    itemId: null,
    itemVersionId: null,
    proposerId: 'per_maria',
    channel: 'form',
    revision: 1,
    draft: { title, kind: 'note' },
    provenance: null,
    findings: [],
    claimedBy: null,
    dueAt: null,
    createdAt: at,
    updatedAt: at,
    ...extra,
  }
}
const mixedDrafts = [
  mixedDraft(1, 'Hold', longDomain.id, 0),
  mixedDraft(
    2,
    'Orders in Norway count each retried payment twice',
    'area_customer_value',
    25 * minute,
    {
      channel: 'mcp',
      provenance: { by: 'agent', fields: {}, flags: [] },
    },
  ),
  mixedDraft(
    3,
    'Paid media spend for October is booked a week late',
    'area_paid_media',
    5 * 60 * minute,
  ),
  mixedDraft(4, 'GMV is net of discounts', 'area_sales', 26 * 60 * minute),
  mixedDraft(
    5,
    'Italy churn counts the accounts merged in May twice over the whole quarter, and the definition table says nothing about it, so every report from that period overstates churn',
    longDomain.id,
    15 * 24 * 60 * minute,
  ),
]

/** Your drafts on its own, holding the mixed drafts, in a column as wide as `width`. */
function MixedDraftsFrame({ width }: { width: string }) {
  const [client] = useState(() => {
    const queries = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    queries.setQueryData(proposalListQuery(MINE).queryKey, {
      rows: mixedDrafts,
      total: mixedDrafts.length,
      limit: MINE.limit,
      offset: 0,
    })
    queries.setQueryData(areasQuery().queryKey, [...areas, longDomain])
    return queries
  })
  return (
    <QueryClientProvider client={client}>
      <RouterFrame>
        <div style={{ width }} className="max-w-full">
          <YourDraftsStrip />
        </div>
      </RouterFrame>
    </QueryClientProvider>
  )
}

/** Where one part of each row starts or ends, for every row of the list. */
const edgesOf = (list: HTMLElement, part: string, edge: 'left' | 'right') =>
  within(list)
    .getAllByRole('link')
    .map((row) => Math.round(row.querySelector(part)!.getBoundingClientRect()[edge]))

/**
 * Drafts of every length, in the wide column and the narrow one: each part of a row (the domain,
 * the Draft mark and the age) has its own column, so it starts at the same place on every row
 * however long the title, the domain name or the age; the age ends at the same place too. Wide,
 * the parts sit beside the title; narrow, under it; on a phone they wrap after it.
 */
export const MixedDrafts: Story = {
  render: () => (
    <div className="flex flex-col gap-8 p-4">
      <MixedDraftsFrame width="1072px" />
      <MixedDraftsFrame width="672px" />
    </div>
  ),
  play: async () => {
    const [wide, narrow] = await screen.findAllByRole('list', {
      name: 'Your drafts, not sent yet',
    })
    for (const list of [wide!, narrow!])
      for (const part of ['[data-slot="domain-badge"]', '[data-slot="home-draft-mark"]'])
        await expect(new Set(edgesOf(list, part, 'left')).size).toBe(1)
    // Beside the title the ages end together; under it they start together.
    await expect(new Set(edgesOf(wide!, 'time', 'right')).size).toBe(1)
    await expect(new Set(edgesOf(narrow!, 'time', 'left')).size).toBe(1)
  },
}

// The pulse strip alone, in states the demo does not reach: last week's agent counts under the
// privacy minimum, and the agent half failing while the facts load.
const weeksTo = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    new Date(Date.UTC(2026, 6, 20 + 7 * index)).toISOString().slice(0, 10),
  )
const demoFacts = (): FactPulse => ({
  ...factPulse([], '2026-10-15'),
  weeks: weeksTo(PULSE_WEEKS).map((week, index) => ({
    week,
    changed: [10, 8, 9, 3, 5, 10, 1, 5, 2, 1, 4, 6][index]!,
  })),
  changedDomains: 4,
  applyToday: 1091,
  current: 941,
  recheckDue: 88,
  sourceChanged: 51,
  sourceMissing: 11,
})
const strip = (children: ReactNode) => (
  <div className="@container flex w-full flex-col p-6">{children}</div>
)

/** Twelve full weeks of agent questions and the ones that found nothing, and the week under way. */
const agentWeeks = (calls: number[], nothing: number[]) => ({
  state: 'ready' as const,
  data: agentPulse({
    minimumCount: 5,
    weeks: weeksTo(PULSE_WEEKS + 1).map((week, index) => ({
      week,
      calls: [...calls, 12][index]!,
      noItemCalls: [...nothing, 1][index]!,
      shownCalls: [...calls, 12][index]!,
    })),
  }),
})
const rising = [188, 196, 204, 199, 221, 230, 226, 248, 255, 262, 276, 301]
/** The facts that are current a week before today (and today, which the index tells). */
const freshness = (current: number, applying = 1091): LibraryFreshness => ({
  today: '2026-10-15',
  days: [
    { day: '2026-10-08', applying, current },
    { day: '2026-10-15', applying: 1091, current: 941 },
  ],
})
const factsChanged = (changed: number[]): FactPulse => ({
  ...demoFacts(),
  weeks: demoFacts().weeks.map((week, index) => ({ ...week, changed: changed[index]! })),
})

/**
 * A better week: more questions found a fact (green, up) and more facts are current than a week
 * ago (green, up). The two volumes only say how much they moved, in muted words.
 */
export const PulseBetterWeek: Story = {
  render: () =>
    strip(
      <HomePulse
        agent={agentWeeks(rising, [22, 21, 22, 20, 21, 22, 19, 21, 22, 23, 22, 9])}
        facts={{
          state: 'ready',
          data: factsChanged([14, 9, 22, 17, 11, 19, 8, 24, 16, 13, 12, 21]),
        }}
        freshness={freshness(905)}
        lastWeek="2026-10-05"
      />,
    ),
  play: async () => {
    const marks = await screen.findAllByText(/on the week before|since a week ago/)
    await expect(marks.map((mark) => mark.textContent)).toEqual([
      'up 25 on the week before',
      'up 5 points on the week before, better',
      'up 9 on the week before',
      'up 3 points since a week ago, better',
    ])
  },
}

/**
 * A worse week: fewer questions found a fact (red, down) and fewer facts are current (red,
 * down); the arrow and the sign say so without the hue.
 */
export const PulseWorseWeek: Story = {
  render: () =>
    strip(
      <HomePulse
        agent={agentWeeks(
          [301, 288, 276, 262, 255, 248, 226, 230, 221, 199, 204, 168],
          [18, 19, 21, 20, 22, 21, 19, 21, 20, 22, 21, 31],
        )}
        facts={{
          state: 'ready',
          data: factsChanged([24, 16, 13, 21, 12, 14, 9, 22, 17, 11, 19, 3]),
        }}
        freshness={freshness(985)}
        lastWeek="2026-10-05"
      />,
    ),
  play: async () => {
    await expect(
      await screen.findByText('down 8 points on the week before, worse'),
    ).toBeInTheDocument()
    await expect(screen.getByText('down 4 points since a week ago, worse')).toBeInTheDocument()
  },
}

/** A quiet week: nothing moved past the noise floor, so every mark says Same, muted. */
export const PulseQuietWeek: Story = {
  render: () =>
    strip(
      <HomePulse
        agent={agentWeeks(
          [188, 196, 204, 199, 221, 230, 226, 248, 255, 262, 301, 301],
          [22, 21, 22, 20, 21, 22, 19, 21, 22, 23, 18, 19],
        )}
        facts={{
          state: 'ready',
          data: factsChanged([14, 9, 22, 17, 11, 19, 8, 24, 16, 13, 6, 6]),
        }}
        freshness={freshness(944)}
        lastWeek="2026-10-05"
      />,
    ),
  play: async () => {
    await expect(await screen.findAllByText('Same')).toHaveLength(4)
  },
}

/**
 * Too few questions to judge: the share moved, but fewer than 30 agent questions came last
 * week, so its mark keeps the arrow and the size without a verdict.
 */
export const PulseFewQuestions: Story = {
  render: () =>
    strip(
      <HomePulse
        agent={agentWeeks(
          [0, 0, 0, 0, 0, 6, 9, 12, 8, 14, 31, 22],
          [0, 0, 0, 0, 0, 0, 0, 5, 0, 5, 6, 8],
        )}
        facts={{ state: 'ready', data: demoFacts() }}
        freshness={freshness(941)}
        lastWeek="2026-10-05"
      />,
    ),
  play: async () => {
    await expect(
      await screen.findByText(
        'down 17 points on the week before, too few questions to call it better or worse',
      ),
    ).toBeInTheDocument()
  },
}

/**
 * Last week's exact total would give a small topic week away, so it is hidden: the tile says how
 * many at least, and the share answered is hidden too.
 */
export const PulseHiddenCounts: Story = {
  render: () =>
    strip(
      <HomePulse
        agent={{
          state: 'ready',
          data: agentPulse({
            minimumCount: 5,
            weeks: weeksTo(PULSE_WEEKS + 1).map((week, index) => ({
              week,
              calls: [0, 0, 6, 9, 12, 8, 7, 11, 14, 9, 6, null, 0][index]!,
              noItemCalls: [0, 0, 0, 0, 5, null, null, 6, 5, null, 0, null, 0][index]!,
              shownCalls: [0, 0, 6, 9, 12, 8, 7, 11, 14, 9, 6, 6, 0][index]!,
            })),
          }),
        }}
        facts={{ state: 'ready', data: demoFacts() }}
        freshness={null}
        lastWeek="2026-10-05"
      />,
    ),
  play: async () => {
    await expect(await screen.findByText('6+')).toBeVisible()
    await expect(screen.getByText('At least 6. A few more stay hidden.')).toBeVisible()
    await expect(screen.getAllByText('We hide counts under 5')).toHaveLength(1)
  },
}

/** The weekly totals did not load: their two tiles offer a retry, the facts still show. */
export const PulseHalfFailed: Story = {
  render: () =>
    strip(
      <HomePulse
        agent={{ state: 'failed', retry: fn() }}
        facts={{ state: 'ready', data: demoFacts() }}
        freshness={null}
        lastWeek="2026-10-05"
      />,
    ),
  play: async () => {
    await expect(await screen.findAllByText('Not loaded')).toHaveLength(2)
    await expect(screen.getByText('86%')).toBeVisible()
  },
}

/** Typing opens the suggestions: facts first, then Ask the assistant and Try it. */
export const Suggestions: Story = {
  render: () => <StoryApp path="/" preferences={returning} />,
  play: async () => {
    await screen.findByRole('table', { name: 'Recently changed' })
    const field = screen.getByRole('combobox', { name: 'Search the library, or ask a question' })
    await userEvent.type(field, 'orders poland')
    const list = await screen.findByRole('listbox', { name: 'Suggestions' })
    const options = within(list).getAllByRole('option')
    await expect(options[0]).toHaveAttribute('aria-selected', 'true')
    await expect(options.at(-2)).toHaveTextContent('Ask the assistant')
    await expect(options.at(-1)).toHaveTextContent('Try it')
  },
}

/**
 * A question: its own words are left out of the fact search, and Try it shows what it reads the
 * question as, so it opens on that scope.
 */
export const SuggestionsQuestion: Story = {
  render: () => <StoryApp path="/" preferences={returning} />,
  play: async () => {
    await screen.findByRole('table', { name: 'Recently changed' })
    const field = screen.getByRole('combobox', { name: 'Search the library, or ask a question' })
    await userEvent.type(field, 'why did orders drop in Poland in August')
    await expect(await screen.findByText(/^Read as Orders, Poland/)).toBeVisible()
  },
}

/** Words nothing matches: the list says so and still offers to ask. */
export const SuggestionsNoMatch: Story = {
  render: () => <StoryApp path="/" preferences={returning} />,
  play: async () => {
    await screen.findByRole('table', { name: 'Recently changed' })
    const field = screen.getByRole('combobox', { name: 'Search the library, or ask a question' })
    await userEvent.type(field, 'zzzzqqq')
    await expect(await screen.findByText(/No facts match/)).toBeVisible()
  },
}

export const KnownIssues: Story = {
  render: () => <StoryApp path="/?tab=issues" preferences={returning} />,
}

export const Topics: Story = {
  render: () => <StoryApp path="/?tab=topics" preferences={returning} />,
}

/** Nothing changed in the last 30 days. */
export const NothingChangedLately: Story = {
  render: () => <StoryApp path="/" scenario="quiet" preferences={returning} />,
  play: async () => {
    await expect(await screen.findByText('Nothing changed lately')).toBeVisible()
  },
}

/** A day with no known data issue. */
export const NoKnownIssues: Story = {
  render: () => <StoryApp path="/?tab=issues" scenario="quiet" preferences={returning} />,
  play: async () => {
    await expect(await screen.findByText('No known data issues')).toBeVisible()
  },
}

/** A library with no facts at all: the first one to add. */
export const EmptyLibrary: Story = {
  render: () => <StoryApp path="/" scenario="empty" preferences={returning} />,
  play: async () => {
    await expect(await screen.findByText('No facts yet')).toBeVisible()
    await expect(await screen.findByText('No agent has asked yet')).toBeVisible()
  },
}

export const Loading: Story = {
  render: () => <StoryApp path="/" scenario="slow" preferences={returning} />,
}

export const Error: Story = {
  render: () => <StoryApp path="/" scenario="error" preferences={returning} />,
  play: async () => {
    await expect(await screen.findByText("We couldn't load the facts")).toBeVisible()
  },
}

export const Phone: Story = {
  render: () => <StoryApp path="/" preferences={{ 'cl.home.seen': false }} />,
  globals: { viewport: { value: 'phone', isRotated: false } },
}

export const PhoneSuggestions: Story = {
  render: Suggestions.render,
  play: Suggestions.play,
  globals: { viewport: { value: 'phone', isRotated: false } },
}
