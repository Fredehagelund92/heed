import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { Area } from '@domain/item'
import type { Comparison, HistoryPoint } from '@/api'
import { DomainsVerdict, HealthGrid, VerdictLine } from '@/components/quality/domains-view'
import {
  ChangeMark,
  DomainStateMark,
  FixKindBadge,
  FlipsMark,
  VerdictBadge,
} from '@/components/quality/quality-marks'
import { ComparisonView } from '@/components/quality/run-body'
import TrendChart from '@/components/quality/trend-chart'
import { workbenchLinks } from '@/components/workbench/links'
import { changeOf, domainHealth, fixKindWords, verdictOf, type FixEntry } from '@/lib/quality'
import { mockTestQuestions } from '@/mocks/test-questions'
import { RouterFrame } from './router-frame'

/*
  The parts of the test results Health shows (Quality design, direction C; the Quality page they
  came from was retired in Workbench slice W8, and its states are Health's
  stories): the domain health grid, the verdict in every tone, the marks, a domain's trend and
  two runs compared, from invented numbers with more failures and drops than the mock has. Use
  the viewport menu for 1440, 1024 and 390 and the theme menu for light and dark.
*/

const meta = {
  title: 'Health/Quality parts',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

// ---- the parts, with invented failures and drops ----

const area = (id: string, name: string, label: Area['label']): Area => ({
  id,
  name,
  summary: '',
  description: '',
  ownerIds: [],
  label,
  revision: 1,
})
const point = (run: string, day: string, passed: number, retrieval: number): HistoryPoint => ({
  run,
  area: 'area',
  edition: '2026-10-05.1',
  finishedAt: `${day}T04:30:00.000Z`,
  questions: 74,
  passed,
  failed: 74 - passed,
  noAnswer: 0,
  setAside: 0,
  regressions: 0,
  rates: { pass: passed / 74, caveats: null, causeClaims: null, acceptable: null },
  heldOut: {
    questions: 0,
    answers: 0,
    caveats: { required: 0, present: 0 },
    causeClaims: 0,
    acceptable: 0,
    meetsTargets: false,
  },
  layers: null,
  failedChecks: null,
  retrieval: {
    id: run,
    asOf: day,
    questions: 74,
    passed: retrieval,
    failed: 74 - retrieval,
    rate: retrieval / 74,
  },
  costMicros: 3_420_000,
  estimatedCostMicros: 3_500_000,
  modelId: 'claude-sonnet-5-5',
  judgeModelId: 'claude-opus-5-5',
})
const pass = (edition: string, passed: number) => ({
  id: edition,
  edition,
  asOf: edition.slice(0, 10),
  trigger: 'edition' as const,
  createdAt: `${edition.slice(0, 10)}T08:00:00Z`,
  testSetDigest: 'd',
  questions: 74,
  passed,
  failed: 74 - passed,
  setAside: 0,
  failedChecks: { served: 0, delivered: 0, not_delivered: 0, status: 0 },
})
const compared = (better: number, worse: number, pValue: number | null) =>
  ({
    signTest: { better, worse, pValue },
  }) as Comparison
const steady = (passed: number, before: number) => [
  { ...point('r2', '2026-10-05', passed, 70), failed: 0 },
  { ...point('r1', '2026-09-28', before, 69), failed: 0 },
]
const coverage = (id: string, untested: number) => ({
  edition: 'e',
  areas: [
    {
      area: id,
      items: 40,
      untested,
      untestedRequired: 2,
      byKind: { event: 1, note: 0, guide: 0, example: 1, issue: 0 },
    },
  ],
})

const rows = [
  domainHealth({
    area: area('sales', 'Sales', 'teal'),
    questions: mockTestQuestions,
    history: steady(63, 59),
    retrieval: [pass('2026-10-05.1', 70), pass('2026-10-01.1', 69)],
    comparison: compared(5, 1, 0.22),
    untested: coverage('sales', 11),
    openGaps: 9,
    pastReview: 12,
  }),
  domainHealth({
    area: area('marketing', 'Marketing', 'pink'),
    questions: mockTestQuestions,
    history: [point('r2', '2026-10-05', 60, 68), point('r1', '2026-09-28', 62, 68)],
    retrieval: [pass('2026-10-05.1', 68), pass('2026-10-01.1', 66)],
    comparison: compared(1, 3, 0.63),
    untested: coverage('marketing', 7),
    openGaps: 12,
    pastReview: 21,
  }),
  domainHealth({
    area: area('customer', 'Customer value', 'indigo'),
    questions: mockTestQuestions,
    history: steady(45, 61),
    retrieval: [pass('2026-10-05.1', 63), pass('2026-10-01.1', 66)],
    comparison: compared(0, 16, 0.00003),
    untested: coverage('customer', 4),
    openGaps: 7,
    pastReview: 6,
  }),
  domainHealth({
    area: area('paid', 'Paid media', 'violet'),
    questions: [],
    history: [],
    retrieval: [],
    comparison: undefined,
    untested: coverage('paid', 30),
    openGaps: 0,
    pastReview: 3,
  }),
]

const frame = (children: ReactNode) => (
  <RouterFrame>
    <div className="@container flex max-w-overview flex-col gap-6 p-6">{children}</div>
  </RouterFrame>
)

/** The verdict and the grid with a failing domain, a drop that asks for a look, and one with no test questions yet. */
export const DomainHealthGrid: Story = {
  render: () =>
    frame(
      <>
        <DomainsVerdict health={{ state: 'ready', rows }} questions={mockTestQuestions} />
        <HealthGrid
          health={{ state: 'ready', rows }}
          workbench={{}}
          canWrite
          onWrite={() => undefined}
        />
      </>,
    ),
}

export const DomainHealthStates: Story = {
  render: () =>
    frame(
      <>
        <HealthGrid
          health={{ state: 'pending' }}
          workbench={{}}
          canWrite
          onWrite={() => undefined}
        />
        <HealthGrid
          health={{ state: 'failed', retry: () => undefined }}
          workbench={{}}
          canWrite
          onWrite={() => undefined}
        />
        <HealthGrid
          health={{ state: 'ready', rows: [] }}
          workbench={{}}
          canWrite={false}
          onWrite={() => undefined}
        />
      </>,
    ),
}

const tones = [
  verdictOf([]),
  verdictOf([{ ...rows[0]!, flips: null }]),
  verdictOf([{ ...rows[0]!, flips: { better: 0, worse: 0, pValue: null } }]),
  verdictOf([rows[0]!, rows[1]!]),
  verdictOf([{ ...rows[0]!, flips: { better: 12, worse: 1, pValue: 0.003 } }]),
  verdictOf([rows[2]!]),
]

/** Every tone of the verdict: none yet, one run, no change, unclear, better, worse. */
export const Verdicts: Story = {
  render: () =>
    frame(
      tones.map((verdict, index) => <VerdictLine key={index} verdict={verdict} summary={null} />),
    ),
}

/** The marks: changes (better, worse, none, better when down, not judged), states, flips, Fix next kinds and verdicts. */
export const Marks: Story = {
  render: () =>
    frame(
      <div className="flex flex-col gap-4 text-body">
        <div className="flex flex-wrap items-center gap-4">
          <ChangeMark change={changeOf(0.851, 0.797)} />
          <ChangeMark change={changeOf(0.607, 0.821)} />
          <ChangeMark change={changeOf(0.5, 0.5)} />
          <ChangeMark change={changeOf(0.02, 0.05)} better="down" />
          {/* Not judged: a volume, or a share of too few to tell. The arrow and size, muted. */}
          <ChangeMark change={changeOf(0.64, 0.81)} better="none" />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {rows.map((row) => (
            <DomainStateMark key={row.area.id} state={row.state} />
          ))}
          <DomainStateMark state={{ kind: 'no_run' }} />
        </div>
        <div className="flex flex-wrap items-start gap-6">
          <FlipsMark flips={{ better: 5, worse: 1 }} />
          <FlipsMark flips={{ better: 0, worse: 0 }} />
          <FlipsMark flips={null} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(fixKindWords) as FixEntry['kind'][]).map((kind) => (
            <FixKindBadge key={kind} kind={kind} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <VerdictBadge verdict="pass" />
          <VerdictBadge verdict="fail" />
          <VerdictBadge verdict="no_answer" />
          <VerdictBadge verdict={null} />
          <VerdictBadge verdict="fail" size="sm" />
        </div>
      </div>,
    ),
}

/** A domain's trend over twelve weekly runs, with a drop at the end. */
export const Trend: Story = {
  render: () => (
    <div className="flex max-w-dock flex-col gap-6 p-6">
      <TrendChart
        points={[0.8, 0.81, 0.82, 0.82, 0.84, 0.83, 0.85, 0.85, 0.86, 0.84, 0.82, 0.61].map(
          (answers, index) => ({
            label: `${index * 7 + 1} Aug`,
            answers,
            retrieval: Math.min(1, answers + 0.08),
          }),
        )}
      />
    </div>
  ),
}

const comparison: Comparison = {
  area: 'area_sales',
  run: { id: 'r2', kind: 'scheduled', edition: '2026-10-05.1', finishedAt: '2026-10-05T04:30:00Z' },
  against: {
    id: 'r1',
    kind: 'scheduled',
    edition: '2026-09-28.1',
    finishedAt: '2026-09-28T04:30:00Z',
  },
  questions: 9,
  better: [{ id: 'units-sold-source-lag', from: 'fail', to: 'pass', failedChecks: ['caveat'] }],
  worse: [
    {
      id: 'units-sold-norway-august',
      from: 'pass',
      to: 'fail',
      failedChecks: ['no_cause_claim', 'rubric_1'],
    },
    { id: 'held-out', from: 'pass', to: 'no_answer', failedChecks: [] },
  ],
  unchanged: { pass: 6, fail: 0, noAnswer: 0 },
  added: 1,
  removed: 0,
  signTest: { better: 1, worse: 2, pValue: 1 },
}

/** Two runs compared: one better, two worse (one held out), and the sign test in words. */
export const Comparison_: Story = {
  name: 'Comparison',
  render: () => (
    <RouterFrame>
      <div className="flex max-w-dock flex-col gap-6 p-6">
        <ComparisonView
          comparison={comparison}
          linkTo={workbenchLinks({})}
          questions={new Map(mockTestQuestions.map((q) => [q.id, q]))}
        />
      </div>
    </RouterFrame>
  ),
}
