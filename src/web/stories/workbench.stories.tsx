import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { RecordPane } from '@/components/page/record-pane'
import { RailSection } from '@/components/page/page-rail'
import { WorkbenchPanes, WorkbenchTemplate } from '@/components/page/workbench'
import { Skeleton } from '@/components/ui/skeleton'
import { TabsContent } from '@/components/ui/tabs'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WorkbenchListBody, WorkbenchListGroupHeading } from '@/components/page/workbench'
import { WorkRow } from '@/components/workbench/work-row'
import type { WorkRow as WorkRowData } from '@/lib/workbench'
import { RouterFrame } from './router-frame'
import { StoryApp } from './story-app'

/*
  Health (Workbench plan, slices W4 to W7; the Workbench until the navigation decision) on the
  mock: the scope strip, the work
  list with its views (Got worse, Gaps with a filter, Test questions) and a search that matches
  nothing, the domain overview with nothing open, the assistant's ratings on it and in a domain's
  record, the AI apps this week under them, a record open in the record pane with its actions, a
  domain in scope with the run it is compared with, a domain that has no test questions yet, a
  record that is not there, the refusal a contributor gets, the Runs view, a first run with
  nothing yet, and slow and failed loads (Quality's page states, which Health took over in W8),
  and what a domain is, with its owner describing it. The demo's regression as a
  question record in each tab, with a try's transcript, its two runs side by side in the compare
  focus (W7), also against a run judged by another judge, and a run's record; a gap's record, its
  history, the regression's gap with its linked test and its verification (V5), another
  domain's gap read only and a topic that spans domains; an item past its review
  date and the regression's note with its change. Then the record pane on its own:
  with its actions, loading, with a long title, and without actions; and the work list's rows on
  their own: each kind and status, the open row, a long title, a hidden count and a row that
  opens nothing. Use the viewport menu for
  1440, 1024 and 390 and the theme menu for light and dark.
*/

const meta = {
  title: 'Health/Health page',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const AsTheOwner: Story = {
  render: () => <StoryApp path="/health" person="per_jon" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(
      () => expect(canvas.getByRole('toolbar', { name: 'Domain and runs' })).toBeVisible(),
      { timeout: 10_000 },
    )
    await waitFor(() => expect(canvas.getByRole('table', { name: 'Domain health' })).toBeVisible())
    const list = canvas.getByRole('region', { name: 'Work list' })
    await waitFor(() =>
      expect(within(list).getAllByRole('heading', { level: 3 })[0]).toHaveTextContent('Got worse'),
    )
  },
}
export const WorkListGotWorse: Story = {
  render: () => <StoryApp path="/health?area=area_sales&view=worse" person="per_jon" />,
}
export const WorkListGapsFiltered: Story = {
  render: () => <StoryApp path="/health?view=gaps&status=open" person="per_jon" />,
}
export const WorkListTestQuestions: Story = {
  render: () => (
    <StoryApp
      path="/health?view=questions&open=question:net-revenue-month-to-date&tab=result"
      person="per_jon"
    />
  ),
}
/** On a phone: the list full width, its rows 56 high, its views and search 44. */
export const PhoneWorkList: Story = {
  render: () => <StoryApp path="/health?view=gaps" person="per_jon" />,
}
export const WorkListNothingMatches: Story = {
  render: () => <StoryApp path="/health?q=nothing%20like%20this" person="per_jon" />,
}
export const AsAnAdministrator: Story = {
  render: () => <StoryApp path="/health" person="per_ravi" />,
}
/**
 * The assistant's ratings (FR-712) under the overview's grid, on the same bordered grid: this
 * week for every domain, the answers about no one domain for an administrator, and counts below
 * the minimum hidden. The counts read left-aligned, clear of the assistant launcher.
 */
export const AssistantRatings: Story = {
  render: () => <StoryApp path="/health" person="per_ravi" />,
  play: async () => {
    const section = await screen.findByRole(
      'region',
      { name: 'Assistant ratings this week' },
      { timeout: 10_000 },
    )
    const table = await within(section).findByRole('table')
    await expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Domain', 'Good answer', 'Something was wrong'])
    await expect(within(table).getByText('About no one domain')).toBeVisible()
    await expect(within(table).getAllByText('Fewer than 5').length).toBeGreaterThan(0)
  },
}
/** One domain's ratings week by week in its record: good answers shown, few wrong ones hidden. */
export const DomainRatings: Story = {
  render: () => <StoryApp path="/health?open=domain:area_sales" person="per_jon" />,
  play: async () => {
    const section = await screen.findByRole(
      'region',
      { name: 'Assistant ratings, last 8 weeks' },
      { timeout: 10_000 },
    )
    const [, newest] = within(section).getAllByRole('row')
    await expect(within(newest!).getByText('6')).toBeVisible()
    await expect(within(newest!).getByText('Fewer than 5')).toBeVisible()
  },
}
/**
 * The AI apps this week (FR-410) under the ratings, on the overview of every domain: each family
 * from the fixed list, its tool calls and how many needed more detail, matched nothing, were
 * malformed or failed, with each count's share, and counts below the minimum hidden.
 */
export const AIApps: Story = {
  render: () => <StoryApp path="/health" person="per_jon" />,
  play: async () => {
    const section = await screen.findByRole(
      'region',
      { name: 'AI apps this week' },
      { timeout: 10_000 },
    )
    const table = await within(section).findByRole('table')
    await expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['AI app', 'Calls', 'Need detail', 'Found nothing', 'Unreadable', 'Errors'])
    await expect(within(table).getByText('Claude app')).toBeVisible()
    await expect(within(table).getAllByText('Fewer than 5').length).toBeGreaterThan(0)
  },
}
export const OneDomainInScope: Story = {
  render: () => <StoryApp path="/health?area=area_sales" person="per_ravi" />,
}
export const DomainWithoutQuestions: Story = {
  render: () => <StoryApp path="/health?area=area_marketing" person="per_ravi" />,
}
export const QuestionOpen: Story = {
  render: () => (
    <StoryApp path="/health?open=question:units-sold-source-lag&tab=result" person="per_jon" />
  ),
}
export const DomainOpen: Story = {
  render: () => <StoryApp path="/health?open=domain:area_sales&tab=runs" person="per_jon" />,
}
/** A domain's team for an administrator: Replace each seat in one step, add and remove approvers. */
export const DomainTeam: Story = {
  render: () => <StoryApp path="/health?open=domain:area_sales&tab=team" person="per_ravi" />,
}
/** A domain's team for its owner: who looks after it, changed by an administrator. */
export const DomainTeamAsTheOwner: Story = {
  render: () => <StoryApp path="/health?open=domain:area_sales&tab=team" person="per_jon" />,
}
const REGRESSION = '/health?open=question:net-revenue-month-to-date'
const WEEKLY_RUN = '00000000-0000-4000-b000-000000000090'
const FAILED_TRY = '00000000-0000-4000-b000-00000009001f'
/** Sales's weekly run of 31 Aug 2026, judged by the judge the mock replaced. */
const EARLIER_JUDGE_RUN = '00000000-0000-4000-b000-00000000008b'

/** The demo's regression: its checks, what Heed gave it on each edition, and why. */
export const RegressedQuestionEvidence: Story = {
  render: () => <StoryApp path={REGRESSION} person="per_jon" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByRole('list', { name: 'Checks' })).toBeVisible(), {
      timeout: 10_000,
    })
    await waitFor(() =>
      expect(canvas.getByRole('list', { name: 'Gaps on this topic' })).toBeVisible(),
    )
  },
}
export const RegressedQuestionTestResult: Story = {
  render: () => <StoryApp path={`${REGRESSION}&tab=result`} person="per_jon" />,
}
export const RegressedQuestionTranscript: Story = {
  render: () => <StoryApp path={`${REGRESSION}&tab=result&cell=${FAILED_TRY}`} person="per_jon" />,
}
export const RegressedQuestionHistory: Story = {
  render: () => <StoryApp path={`${REGRESSION}&tab=history`} person="per_jon" />,
}
/**
 * The compare focus (W7): the regression's two runs side by side over the list and the actions,
 * where only the edition differs.
 */
export const CompareFocus: Story = {
  render: () => <StoryApp path={`${REGRESSION}&mode=compare`} person="per_jon" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByText('Only the facts differ')).toBeVisible(), {
      timeout: 10_000,
    })
    await expect(canvas.getByRole('region', { name: 'Judge' })).toBeVisible()
  },
}
/**
 * Compared with a run from before the mock's judge was replaced: the focus names what else
 * changed, so the difference is not read as the edition's doing.
 */
export const CompareFocusNotOnlyTheEdition: Story = {
  render: () => (
    <StoryApp
      path={`${REGRESSION}&area=area_sales&against=${EARLIER_JUDGE_RUN}&mode=compare`}
      person="per_jon"
    />
  ),
}
export const RunOpen: Story = {
  render: () => <StoryApp path={`/health?open=run:${WEEKLY_RUN}&tab=changes`} person="per_jon" />,
}
const gap = (n: number) => `/health?open=gap:ca9a0000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** A gap as its record: what agents asked about, the weekly counts, details and notes. */
export const GapOpen: Story = {
  render: () => <StoryApp path={gap(1)} person="per_jon" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(
      () => expect(canvas.getByRole('heading', { name: 'Orders in Norway' })).toBeVisible(),
      { timeout: 10_000 },
    )
    await waitFor(() => expect(canvas.getByRole('list', { name: 'Notes' })).toBeVisible())
  },
}
/** A gap with a draft, its history: first seen, the draft it started, last seen. */
export const GapHistory: Story = {
  render: () => <StoryApp path={`${gap(2)}&tab=history`} person="per_jon" />,
}
/**
 * The regression's gap with its linked test (V5): the test fails in the newest weekly run, the
 * gap is open, and Checked by a test says what checks it; link or write a test in the actions.
 */
export const GapWithLinkedTest: Story = {
  render: () => (
    <StoryApp path="/health?open=gap:ca9a0000-0000-4000-8000-00000000000a" person="per_jon" />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByRole('list', { name: 'Linked tests' })).toBeVisible(), {
      timeout: 10_000,
    })
    await expect(canvas.getByRole('heading', { name: 'Checked by a test' })).toBeVisible()
  },
}
/** Another domain's gap reads the same, without the status changes and the notes. */
export const GapReadOnly: Story = {
  render: () => <StoryApp path={gap(7)} person="per_jon" />,
}
/** A topic that spans domains asks which domain reviews the draft. */
export const GapSpanningDomains: Story = {
  render: () => <StoryApp path={gap(5)} person="per_ravi" />,
}
/** An item past its review date: why it is listed, what changed, its details. */
export const ItemOpen: Story = {
  render: () => <StoryApp path="/health?open=item:itm_10pul61m" person="per_jon" />,
}
/** The demo regression's note, its end date the change between the runs' editions. */
export const ItemChanged: Story = {
  render: () => <StoryApp path="/health?area=area_sales&open=item:itm_q2upr28v" person="per_jon" />,
}
export const RecordNotThere: Story = {
  render: () => <StoryApp path="/health?open=question:no-such-question" person="per_jon" />,
}
export const AsAContributor: Story = { render: () => <StoryApp path="/health" /> }
/** The Runs view, newest first. */
export const WorkListRuns: Story = {
  render: () => <StoryApp path="/health?view=runs" person="per_ravi" />,
}
/** Before any test question or run: every view and the overview say what to do. */
export const FirstRun: Story = {
  render: () => <StoryApp path="/health" person="per_ravi" scenario="empty" />,
}
export const Loading: Story = {
  render: () => <StoryApp path="/health" person="per_ravi" scenario="slow" />,
}
export const LoadFailed: Story = {
  render: () => <StoryApp path="/health" person="per_ravi" scenario="error" />,
}

/** What a domain is, on its record: its summary and description, with Edit for its owner. */
export const DomainAbout: Story = {
  render: () => <StoryApp path="/health?open=domain:area_sales" person="per_jon" />,
}
/** Describing a domain: the summary line and the description, with Write and Preview. */
export const DescribeDomain: Story = {
  render: () => <StoryApp path="/health?open=domain:area_sales" person="per_jon" />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }, { timeout: 10_000 }))
    const dialog = await screen.findByRole('dialog', { name: 'Describe Sales' })
    const summary = within(dialog).getByRole<HTMLInputElement>('textbox', { name: /Summary/ })
    await expect(summary.value).toMatch(/^Revenue, the basket and payments/)
  },
}

const tabs = [
  { value: 'evidence', label: 'Checks' },
  { value: 'result', label: 'Test result' },
  { value: 'history', label: 'History' },
] as const

function Sample({
  title = 'Net revenue this month so far',
  actions = true,
}: {
  title?: string | null
  actions?: boolean
}) {
  const [tab, setTab] = useState<(typeof tabs)[number]['value']>('evidence')
  return (
    <TooltipProvider>
      <WorkbenchTemplate title="Record pane">
        <WorkbenchPanes>
          <RecordPane
            title={title}
            label="Loading the test question"
            meta="Test question · 1 of 9"
            badges={<Badge form="outline">Got worse</Badge>}
            tabs={tabs}
            tab={tab}
            onTabChange={setTab}
            tabsLabel="Test question sections"
            onPrevious={() => undefined}
            onNext={() => undefined}
            onClose={() => undefined}
            actions={
              actions
                ? ['Gap', 'Correction'].map((section) => (
                    <RailSection key={section} title={section}>
                      <Skeleton className="h-16 w-full" />
                    </RailSection>
                  ))
                : undefined
            }
          >
            {tabs.map((entry) => (
              <TabsContent key={entry.value} value={entry.value} className="text-body">
                {entry.label}: what the test question shows.
              </TabsContent>
            ))}
          </RecordPane>
        </WorkbenchPanes>
      </WorkbenchTemplate>
    </TooltipProvider>
  )
}

/** The record with its actions beside it; under a 1,100 pixel page they fold under it. */
export const RecordPaneWithActions: Story = {
  render: () => <Sample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('tab', { name: 'History' }))
    await expect(canvas.getByRole('tab', { name: 'History' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(canvas.getByRole('complementary', { name: 'Actions' })).toBeVisible()
  },
}
export const RecordPaneLoading: Story = { render: () => <Sample title={null} /> }
export const RecordPaneLongTitle: Story = {
  render: () => (
    <Sample title="Why did orders in the Netherlands fall last week compared with the same week a year before, and which markets drove it" />
  ),
}
export const RecordPaneWithoutActions: Story = { render: () => <Sample actions={false} /> }

const sampleRows: { group: string; rows: WorkRowData[] }[] = [
  {
    group: 'Got worse since 28 Sept 2026',
    rows: [
      {
        key: 'question:net-revenue-month-to-date',
        open: 'question:net-revenue-month-to-date',
        subject: 'question',
        group: 'worse',
        title: 'How is net revenue in Spain doing this month?',
        status: { label: 'Got worse', tone: 'danger', mark: 'worse' },
        reason: 'Failed: fact mentioned, expected facts given',
        area: 'area_sales',
        rank: 0,
      },
      {
        key: 'question:first-time-buyers',
        open: 'question:first-time-buyers',
        subject: 'question',
        group: 'worse',
        title:
          'How many first-time buyers did Norway have last week compared with the same week a year before, by market and channel?',
        status: { label: 'Got worse', tone: 'danger', mark: 'worse' },
        reason: 'Failed: asks a clarifying question',
        area: 'area_sales',
        rank: 1,
      },
    ],
  },
  {
    group: 'Open gaps',
    rows: [
      {
        key: 'gap:ca9a0000-0000-4000-8000-000000000003',
        open: 'gap:ca9a0000-0000-4000-8000-000000000003',
        subject: 'gap',
        group: 'gaps',
        title: 'Returns in the United Kingdom',
        status: { label: 'Open', tone: 'warning', mark: 'gap_open' },
        reason:
          'Oct 2026 · Unclear question · fewer than 5 calls found nothing · fewer than 5 reports',
        area: 'area_sales',
        rank: 2,
      },
      {
        key: 'gap:ca9a0000-0000-4000-8000-000000000007',
        open: 'gap:ca9a0000-0000-4000-8000-000000000007',
        subject: 'gap',
        group: 'gaps',
        title: 'Units sold in Spain',
        status: { label: 'Draft started', tone: 'info', mark: 'gap_proposal_made' },
        reason: 'Sep 2026 · Outdated · 8 calls found nothing · 6 reports',
        area: 'area_sales',
        rank: 3,
      },
    ],
  },
  {
    group: 'Check date passed',
    rows: [
      {
        key: 'item:itm_l639hm4u',
        open: 'item:itm_l639hm4u',
        subject: 'item',
        group: 'review',
        title: 'Checklist before you report a change in Retention rate',
        status: { label: 'Check date passed', tone: 'warning', mark: 'review' },
        reason: 'since 27 Aug 2026 · no test question covers it',
        area: 'area_sales',
        rank: 4,
      },
    ],
  },
  {
    group: 'Failing tests',
    rows: [
      {
        key: 'held-out:5',
        open: null,
        subject: 'question',
        group: 'failing',
        title: 'A hidden test question',
        status: { label: 'Test fails', tone: 'danger', mark: 'fail' },
        reason: 'Failed: fact mentioned',
        area: 'area_sales',
        rank: 5,
      },
    ],
  },
]

/** The rows of the work list on their own: each kind, the open row, a long title, hidden counts. */
export const WorkListRows: Story = {
  render: () => (
    <RouterFrame>
      <div className="w-workbench-list border-r">
        <WorkbenchListBody>
          {sampleRows.map((group) => (
            <section key={group.group}>
              <WorkbenchListGroupHeading>
                <span className="font-bold text-foreground">{group.group}</span>
                <span>{group.rows.length}</span>
              </WorkbenchListGroupHeading>
              <ul>
                {group.rows.map((row) => (
                  <WorkRow
                    key={row.key}
                    row={row}
                    areaName={row.rank === 4 ? 'Sales' : null}
                    search={row.open ? { open: row.open } : null}
                    open={row.rank === 0}
                    replace={false}
                  />
                ))}
              </ul>
            </section>
          ))}
        </WorkbenchListBody>
      </div>
    </RouterFrame>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getAllByRole('link')).toHaveLength(5))
    // The open row says so; a hidden test question opens nothing; no count from 1 to 4 shows.
    await expect(canvas.getByRole('link', { current: 'true' })).toHaveTextContent(
      'How is net revenue in Spain doing this month?',
    )
    await expect(canvas.getByText('A hidden test question').closest('a')).toBeNull()
    await expect(canvasElement.textContent).not.toMatch(/(^|[^\d.])[1-4] (calls?|reports?)\b/)
  },
}
