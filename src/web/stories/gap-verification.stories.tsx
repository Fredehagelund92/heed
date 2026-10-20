import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { EvalRunDetail, GapDetail, GapTest, TestQuestion } from '@/api'
import { evalRunQuery } from '@/api/queries'
import type { LinkTo } from '@/components/quality/panel-parts'
import { GapVerification, LinkedTests } from '@/components/workbench/gap-tests'
import { areas } from '@/mocks/reference-data'
import { mockTestQuestions } from '@/mocks/test-questions'
import { RouterFrame } from './router-frame'

/*
  A gap's verification by test in the Workbench (Workbench plan, slice V5; FR-610), on its own:
  Resolved and Verified by test as two separate facts in the action panel's width, in each state
  (open with a linked test, resolved and waiting for a passing run with Run the domain now,
  resolved without a test, resolved before Heed recorded the edition, verified with a later
  failure beside it, the same for a reader who does not manage the gap, and closed as won't fix);
  and the record's list of linked tests with their newest result, a held-out and a set-aside one,
  one not run yet and a long title. Use the viewport menu for 1440, 1024 and 390 and the theme
  menu for light and dark. The whole record is in Health/Health page.
*/

const meta = {
  title: 'Health/Gap verification',
  parameters: { layout: 'padded' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const RUN = '00000000-0000-4000-b000-0000000000a0'
const LATER_RUN = '00000000-0000-4000-b000-0000000000a1'
const questions = new Map<string, TestQuestion>(mockTestQuestions.map((q) => [q.id, q]))
// The parts link to records; here the links go nowhere.
const linkTo: LinkTo = () => ({ to: '/' })

function Frame({ width, children }: { width: 'rail' | 'record'; children: ReactNode }) {
  const [client] = useState(() => {
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queries.setQueryData(evalRunQuery(RUN).queryKey, {
      run: { id: RUN, kind: 'scheduled' },
    } as EvalRunDetail)
    return queries
  })
  return (
    <QueryClientProvider client={client}>
      <RouterFrame>
        <div className={width === 'rail' ? 'w-workbench-actions max-w-full' : 'max-w-overview'}>
          {children}
        </div>
      </RouterFrame>
    </QueryClientProvider>
  )
}

const test = (question: string, patch: Partial<GapTest> = {}): GapTest => ({
  question,
  split: 'development',
  active: true,
  linkedHour: '2026-10-06T09:00:00Z',
  evidenceRun: null,
  passed: null,
  latest: {
    run: RUN,
    kind: 'scheduled',
    edition: '2026-10-12.1',
    finishedAt: '2026-10-12T06:00:00Z',
    verdict: 'pass',
  },
  ...patch,
})
const passed = { run: RUN, edition: '2026-10-12.1', revision: 1, hour: '2026-10-12T06:00:00Z' }

const gap: GapDetail = {
  id: 'ca9a0000-0000-4000-8000-000000000001',
  ref: 'gap_7c41d0e2a9',
  topic: {
    areaId: 'area_sales',
    areaIds: ['area_sales'],
    metrics: ['metric:orders'],
    dimensions: [],
    dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
    month: '2026-10-01',
  },
  type: 'missing',
  status: 'open',
  severity: 3,
  openedBy: 'no_item_calls',
  firstSeen: '2026-09-14',
  lastSeen: '2026-10-06',
  statusSince: '2026-09-14T09:00:00Z',
  reports: 0,
  personReports: 0,
  noItemCalls: 40,
  weeks: [],
  proposals: [],
  canManage: true,
  notes: [],
  resolvedEdition: null,
  verifiedAt: null,
  verifiedEdition: null,
  tests: [test('orders-united-kingdom-september')],
  history: [],
}
const resolved: GapDetail = {
  ...gap,
  status: 'resolved',
  statusSince: '2026-10-12T08:00:00Z',
  resolvedEdition: '2026-10-12.1',
}
const area = areas.find((entry) => entry.id === 'area_sales')

function Facts({ of, maintains = true }: { of: GapDetail; maintains?: boolean }) {
  return (
    <Frame width="rail">
      <GapVerification
        gap={of}
        area={area}
        maintains={maintains}
        questions={questions}
        linkTo={linkTo}
        onRun={() => undefined}
      />
    </Frame>
  )
}

/** Open, with a linked test: verified once it is resolved and the test passes. */
export const NotResolved: Story = { render: () => <Facts of={gap} /> }
/** Resolved, one of two tests passed: Run the domain now. */
export const WaitingForARun: Story = {
  render: () => (
    <Facts
      of={{
        ...resolved,
        tests: [test('orders-united-kingdom-september', { passed }), test('units-sold-source-lag')],
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/1 of 2 linked tests have passed\./)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Run Sales now' })).toBeVisible()
  },
}
export const ResolvedWithoutTests: Story = {
  render: () => <Facts of={{ ...resolved, tests: [] }} />,
}
export const ResolvedBeforeTheEditionWasKept: Story = {
  render: () => <Facts of={{ ...resolved, resolvedEdition: null }} />,
}
/** Verified on its edition by the weekly run; its test fails since, beside the fact. */
export const VerifiedThenFailing: Story = {
  render: () => (
    <Facts
      of={{
        ...resolved,
        verifiedAt: '2026-10-12T06:00:00Z',
        verifiedEdition: '2026-10-12.1',
        tests: [
          test('orders-united-kingdom-september', {
            passed,
            latest: {
              run: LATER_RUN,
              kind: 'scheduled',
              edition: '2026-10-19.1',
              finishedAt: '2026-10-19T06:00:00Z',
              verdict: 'fail',
            },
          }),
        ],
        history: [
          {
            action: 'gap.verified',
            hour: '2026-10-12T06:00:00Z',
            details: { edition: '2026-10-12.1', run: RUN },
          },
        ],
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('link', { name: 'the weekly run of 12 Oct 2026' })).toBeVisible()
    await expect(canvas.getByText(/Fails since 19 Oct 2026/)).toBeVisible()
  },
}
/** A reader who does not manage the gap: where it stands, never how many tests. */
export const AsAReader: Story = {
  render: () => (
    <Facts of={{ ...resolved, canManage: false, tests: null, history: null }} maintains={false} />
  ),
}
export const WontFix: Story = {
  render: () => <Facts of={{ ...gap, status: 'wont_fix', tests: [] }} />,
}

/** The record's linked tests: passed, failing, held out, set aside, not run yet, a long title. */
export const LinkedTestsList: Story = {
  render: () => (
    <Frame width="record">
      <LinkedTests
        gap={{
          ...resolved,
          tests: [
            test('orders-united-kingdom-september', { passed }),
            test('net-revenue-month-to-date', {
              latest: {
                run: LATER_RUN,
                kind: 'full',
                edition: '2026-10-12.1',
                finishedAt: '2026-10-12T10:00:00Z',
                verdict: 'fail',
              },
            }),
            test('orders-poland-provider', { split: 'held_out' }),
            test('units-sold-source-lag', { active: false }),
            test('a-new-question-about-orders-in-norway-and-spain-over-many-months', {
              latest: null,
            }),
          ],
        }}
        questions={questions}
        linkTo={linkTo}
      />
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('listitem')).toHaveLength(5)
    await expect(canvas.getAllByRole('button', { name: /^Unlink / })).toHaveLength(5)
  },
}
/** No test linked yet: what to do. */
export const NoLinkedTest: Story = {
  render: () => (
    <Frame width="record">
      <LinkedTests gap={{ ...gap, tests: [] }} questions={questions} linkTo={linkTo} />
    </Frame>
  ),
}
/** For anyone who does not manage the gap. */
export const LinkedTestsForAReader: Story = {
  render: () => (
    <Frame width="record">
      <LinkedTests
        gap={{ ...gap, canManage: false, tests: null }}
        questions={questions}
        linkTo={linkTo}
      />
    </Frame>
  ),
}
