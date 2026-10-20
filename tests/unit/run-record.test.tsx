import type * as Router from '@tanstack/react-router'
import type { ComponentProps, ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { EvalRun, EvalRunDetail } from '@/api'
import { RunSummary } from '@/components/quality/run-body'
import { RunActions } from '@/components/workbench/action-panel'
import { areas } from '@/mocks/reference-data'

/*
  A run that stopped before every answer was made (output test plan, R6): the record says why
  and what is missing, the owner of its domain resumes it, and the judge against code signal
  shows where the two layers disagree (try-it-2, round 3).
*/

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof Router>()),
  Link: ({ to, children, ...props }: ComponentProps<'a'> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

function withQueries(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const run: EvalRun = {
  id: '00000000-0000-4000-9000-000000000001',
  kind: 'full',
  state: 'incomplete',
  areaId: 'area_commercial',
  proposalId: null,
  itemVersionId: null,
  edition: '2026-10-07.2',
  modelId: 'vercel-gateway/anthropic/claude-sonnet-5.5',
  judgeModelId: 'vercel-gateway/google/gemini-2.5-flash-lite',
  modelProvider: 'vercel-gateway',
  judgeProvider: 'vercel-gateway',
  modelFamily: 'anthropic/claude-sonnet',
  judgeFamily: 'google/gemini-flash-lite',
  judgeSameFamily: false,
  modelVendor: 'anthropic',
  judgeVendor: 'google',
  judgeSameVendor: false,
  trigger: null,
  toolSchemaDigest: 'd',
  testSetDigest: 'd',
  tries: 3,
  flipRepeats: 7,
  questions: 5,
  setAside: 0,
  estimatedCostMicros: 1_087_000,
  actualCostMicros: 412_000,
  costCeilingMicros: null,
  passRule: 'majority',
  requestedBy: null,
  approvedBy: null,
  failure:
    '6 of 30 answers not made (6 refused for the provider’s rate limit). They count as neither a pass nor a fail; resuming the run makes only those.',
  createdAt: '2026-10-13T10:00:00Z',
  startedAt: '2026-10-13T10:00:00Z',
  finishedAt: '2026-10-13T10:03:00Z',
}
const detail = (over: Partial<EvalRunDetail> = {}): EvalRunDetail => ({
  run,
  results: [],
  flips: [],
  levels: {},
  scorecard: null,
  links: null,
  replay: null,
  agreement: null,
  judging: { judged: 24, errors: 0 },
  stopped: { reason: 'infrastructure', failed: { throttled: 6 }, cells: 30, at: run.finishedAt! },
  cells: [],
  ...over,
})
const commercial = areas.find((area) => area.id === 'area_commercial')!

describe('a run that stopped before it finished', () => {
  it('says so as a warning, with what is missing, not as a failure', () => {
    render(withQueries(<RunSummary detail={detail()} />))
    expect(screen.getByText('The run stopped before it finished')).toBeVisible()
    expect(screen.getByText(/6 refused for the provider’s rate limit/)).toBeVisible()
    expect(screen.queryByText('The run failed')).toBeNull()
  })

  it('lets the owner of its domain resume it, and asks first', async () => {
    render(
      withQueries(
        <RunActions run={run} area={commercial} maintains isAdmin={false} onRun={vi.fn()} />,
      ),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Resume run' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Resume this run?' })
    expect(within(dialog).getByText(/makes only the answers it is missing/)).toBeVisible()
  })

  it('is resumed at the command line when it was approved there with a cost ceiling', () => {
    render(
      withQueries(
        <RunActions
          run={{ ...run, costCeilingMicros: 2_000_000 }}
          area={commercial}
          maintains
          isAdmin
          onRun={vi.fn()}
        />,
      ),
    )
    expect(screen.queryByRole('button', { name: 'Resume run' })).toBeNull()
  })
})

describe('the judge against the code checks', () => {
  const agreement = {
    questions: 5,
    judgePassedCodeFailed: ['cpa-spain-markets', 'net-revenue-month-to-date'],
    codePassedJudgeFailed: [],
    tries: { compared: 30, judgePassedCodeFailed: 11, codePassedJudgeFailed: 0 },
  }
  it('names how often the judge passed what the code failed', () => {
    render(
      withQueries(
        <RunSummary
          detail={detail({
            run: { ...run, state: 'finished', failure: null },
            stopped: null,
            agreement: { baseline: agreement, candidate: null },
          })}
        />,
      ),
    )
    expect(
      screen.getByText('The judge passed 2 the code checks failed (of 5 questions).'),
    ).toBeVisible()
  })
})
