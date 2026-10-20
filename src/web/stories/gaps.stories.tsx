import type { Meta, StoryObj } from '@storybook/react-vite'
import { demoGapIds } from '@/api/mock-demo-proposals'
import { WeeksTable } from '@/components/gaps/gap-body'
import WeeklyChart from '@/components/gaps/weekly-chart'
import { gapWeeks } from '@/lib/gaps'
import { StoryApp } from './story-app'

/*
  The Gaps page on the mock (slice W9): the fixture gaps of src/web/mocks/gaps.ts as Maria (no
  role) and Lars (a high-risk approver) see them, the topic counts, a gap in the docked panel, and
  the states of the list (contract 9.5). An owner's, deputy's or administrator's Gaps address
  opens the Workbench's Gaps view (Workbench slice W8); their stories are there. Use the viewport menu for 1440, 1024 and 390 and the theme menu for
  light and dark.
*/

const meta = { title: 'Gaps/Gaps page', parameters: { layout: 'fullscreen' } } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** A gap open in the docked panel beside the list. */
const gapPanel = (id: string) => `/gaps?gap=${id}`

export const AsAReader: Story = { render: () => <StoryApp path="/gaps" /> }
/** A high-risk approver keeps the Gaps page: the Workbench is for those who look after a domain. */
export const AsAnApprover: Story = { render: () => <StoryApp path="/gaps" person="per_lars" /> }
export const TopicCounts: Story = { render: () => <StoryApp path="/gaps?view=topics" /> }
export const Filtered: Story = {
  render: () => <StoryApp path="/gaps?type=missing&area=area_sales" />,
}
export const NoResults: Story = { render: () => <StoryApp path="/gaps?q=nothing+like+this" /> }
export const Empty: Story = { render: () => <StoryApp path="/gaps" scenario="empty" /> }
export const Loading: Story = { render: () => <StoryApp path="/gaps" scenario="slow" /> }
export const LoadFailed: Story = { render: () => <StoryApp path="/gaps" scenario="error" /> }
export const GapAsAReader: Story = { render: () => <StoryApp path={gapPanel(demoGapIds.open)} /> }
export const GapWithADraft: Story = {
  render: () => <StoryApp path={gapPanel(demoGapIds.draftStarted)} />,
}
export const GapThatSpansDomains: Story = {
  render: () => <StoryApp path={gapPanel(demoGapIds.spansDomains)} />,
}

/** The weekly counts as the chart and as its table: shown, zero and hidden counts. */
const weeks = gapWeeks(
  {
    weeks: [
      { week: '2026-09-14', reports: 0, personReports: 0, noItemCalls: 6 },
      { week: '2026-09-21', reports: 2, personReports: 1, noItemCalls: 9 },
      { week: '2026-09-28', reports: null, personReports: null, noItemCalls: 14 },
      { week: '2026-10-05', reports: 12, personReports: 5, noItemCalls: null },
    ],
  },
  5,
)

export const WeeklyCounts: Story = {
  render: () => (
    <div className="flex max-w-dock flex-col gap-6 p-6">
      <WeeklyChart weeks={weeks} />
      <WeeksTable weeks={weeks} />
    </div>
  ),
}

export const WeeklyCountsMinimumUnknown: Story = {
  render: () => (
    <div className="flex max-w-dock flex-col gap-6 p-6">
      <WeeksTable
        weeks={gapWeeks(
          { weeks: [{ week: '2026-10-05', reports: 7, personReports: 0, noItemCalls: 0 }] },
          null,
        )}
      />
    </div>
  ),
}
