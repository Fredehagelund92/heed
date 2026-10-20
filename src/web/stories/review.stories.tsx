import { useState, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import type { AttachedTest, EvalRunDetail, Gate, ProposalTest, Review } from '@/api'
import { queryKeys } from '@/api/queries'
import { createQueryClient } from '@/api/query-client'
import { demoAgentIds, demoReviewIds } from '@/api/mock-demo-proposals'
import { AttachedTests } from '@/components/proposal/attached-tests'
import { GateResult } from '@/components/proposal/gate-result'
import { LevelDetails, hasLevelDetails } from '@/components/review/check-details'
import { DecisionBar } from '@/components/review/decision-bar'
import { FieldDiff, TextDiff } from '@/components/review/field-diff'
import { TermDiff } from '@/components/review/term-diff'
import { ApprovalsCard, ImpactDelta, MentionChanges } from '@/components/review/review-parts'
import { OwnerEditCard } from '@/components/review/owner-edit'
import {
  highGate,
  mixedGate,
  normalGate,
  formatFailedGate,
} from '@/design-preview/proposal-samples'
import { decisionBar } from '@/lib/review'
import { useMentionTargets } from '@/lib/use-mention-targets'
import { targetsByKey } from '@/lib/mention-targets'
import { areas, people } from '@/mocks/reference-data'
import { mockTestQuestions } from '@/mocks/test-questions'
import { PageRail } from '@/components/page/page-rail'
import { RouterFrame } from './router-frame'
import { StoryApp } from './story-app'

/*
  The review queue and the review screen (slice W5 of the front end plan): the queue and a
  proposal in every state of the decision bar on the mock, as Jon, the owner of Sales and
  Sandbox; then the parts on their own: every field diff row, the decision bar in six states,
  the checks with their details in four outcomes, the mentions and the warning, the approvals,
  the test questions affected, the attached tests and the review settings. Use the viewport menu for 1440, 1024 and
  390 and the theme menu for light and dark.
*/

const meta = { title: 'Pages/Review', parameters: { layout: 'fullscreen' } } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const jon = (path: string) => <StoryApp path={path} person="per_jon" />
const reviewOf = (key: keyof typeof demoReviewIds, query = '') =>
  jon(`/proposals/${demoReviewIds[key]}${query}`)

export const ToReview: Story = { render: () => jon('/proposals') }
export const ToReviewHighRisk: Story = { render: () => jon('/proposals?risk=high') }
export const ToReviewAsApprover: Story = {
  render: () => <StoryApp path="/proposals" person="per_lars" />,
}
export const NothingToReview: Story = {
  render: () => <StoryApp path="/proposals?view=review" person="per_tomas" />,
}
/**
 * Jon proposed one in his own domain: as its owner he decides it, so its checkbox works like any
 * other and no line above the queue says someone else must (FR-206, FR-223).
 */
export const ToReviewWithOwnProposal: Story = {
  render: () => jon('/proposals'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const own = await canvas.findByRole(
      'checkbox',
      {
        name: 'Select Net revenue for September 2026 includes a one-off correction for August discounts.',
      },
      { timeout: 5000 },
    )
    await expect(own).not.toHaveAttribute('aria-disabled', 'true')
    await expect(canvas.queryByText(/You can't decide/)).toBeNull()
  },
}
/**
 * Ravi, the administrator, proposed every term that waits: an administrator decides their own, so
 * To review lists them, ready to accept, never "Nothing for you to review".
 */
export const ToReviewAllOwn: Story = {
  render: () => <StoryApp path="/proposals" person="per_ravi" scenario="own-proposals" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('table', { name: 'Proposals to review' }, { timeout: 5000 }),
    ).toBeVisible()
    await expect(canvas.queryByText('Nothing for you to review')).toBeNull()
    await expect(canvas.queryByText(/You can't decide/)).toBeNull()
  },
}
/** Ravi's own proposals in Mine: each that waits has a checkbox he may tick, and no line above. */
export const MineAllOwn: Story = {
  render: () => <StoryApp path="/proposals?view=mine" person="per_ravi" scenario="own-proposals" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('table', { name: 'Your proposals' }, { timeout: 5000 }),
    ).toBeVisible()
    await expect(canvas.queryByText(/You can't decide/)).toBeNull()
    for (const box of canvas.getAllByRole('checkbox'))
      await expect(box).not.toHaveAttribute('aria-disabled', 'true')
  },
}
/**
 * Ravi proposes the model's members as terms and opens Mine: scrolled, the rows run under the
 * page's toolbar and column header, which stay over them and their checkboxes (contract 6.10).
 */
export const MineAllOwnScrolled: Story = {
  render: () => (
    <StoryApp
      path="/admin?section=sources&source=cube&terms=true"
      person="per_ravi"
      scenario="no-terms"
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.selectOptions(
      await canvas.findByRole(
        'combobox',
        { name: 'Put every metric without a domain in' },
        { timeout: 5000 },
      ),
      'area_sales',
    )
    await userEvent.click(canvas.getByRole('button', { name: /^Propose \d+ terms?$/ }))
    await canvas.findAllByText(/proposed/i, undefined, { timeout: 5000 })
    const [proposals] = canvas.getAllByRole('link', { name: 'Proposals' })
    if (!proposals) throw new Error('No Proposals link')
    await userEvent.click(proposals)
    await userEvent.click(await canvas.findByRole('button', { name: 'Show yours' }))
    await canvas.findByRole('table', { name: 'Your proposals' }, { timeout: 5000 })
    const view = canvasElement.ownerDocument.defaultView ?? window
    const bar = canvasElement.querySelector('[data-slot="page"] > .sticky')
    const box = canvas.getAllByRole('checkbox')[2]
    if (!(bar instanceof HTMLElement) || !box) throw new Error('No sticky block or row checkbox')
    // The third row's checkbox to the middle of the toolbar.
    const middle = (rect: DOMRect) => rect.top + rect.height / 2
    view.scrollBy(0, middle(box.getBoundingClientRect()) - middle(bar.getBoundingClientRect()))
    const under = box.getBoundingClientRect()
    const barBox = bar.getBoundingClientRect()
    await expect(middle(under)).toBeGreaterThan(barBox.top)
    await expect(middle(under)).toBeLessThan(barBox.bottom)
    const hit = view.document.elementFromPoint(under.left + under.width / 2, middle(under))
    await expect(bar.contains(hit)).toBe(true)
  },
}
/** Kofi's change, with what he says is wrong with the current version above the diff. */
export const Ready: Story = {
  render: () => reviewOf('ready'),
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText(
        /on what is wrong with the current version/,
        undefined,
        {
          timeout: 5000,
        },
      ),
    ).toBeVisible()
  },
}
export const ReadyAsText: Story = { render: () => reviewOf('ready', '?compare=text') }
/**
 * A proposal an AI app drafted for Priya, as Tomas reviews it: under the people, the folded trail
 * of how it came to be opens to each step in the past tense (contract 9.8).
 */
export const DraftedWithAnAiApp: Story = {
  render: () => <StoryApp path={`/proposals/${demoAgentIds.review}`} person="per_tomas" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trail = await canvas.findByRole(
      'button',
      { name: /^How it was drafted: Drafted with an AI app/ },
      { timeout: 10_000 },
    )
    await userEvent.click(trail)
    await expect(canvas.getByRole('list', { name: 'How it was drafted' })).toHaveTextContent(
      /Priya submitted it/,
    )
  },
}
export const WaitingForTheApprover: Story = { render: () => reviewOf('approverNext') }
export const AsTheApprover: Story = {
  render: () => <StoryApp path={`/proposals/${demoReviewIds.approverNext}`} person="per_lars" />,
}
export const ClaimedByAnother: Story = { render: () => reviewOf('claimed') }
export const YouWroteIt: Story = { render: () => reviewOf('proposer') }
export const CheckFailed: Story = { render: () => reviewOf('checks') }
export const Overdue: Story = { render: () => reviewOf('overdue') }
export const Retirement: Story = { render: () => reviewOf('retire') }
/** A resubmission (heed-ux B2): the request and the reply on top, what changed since by default. */
export const Resubmitted: Story = {
  render: () => reviewOf('resubmitted'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole(
        'heading',
        { name: 'What changed since your request' },
        { timeout: 5000 },
      ),
    ).toBeVisible()
  },
}
/** The same resubmission with the whole proposal chosen. */
export const ResubmittedWhole: Story = {
  render: () => reviewOf('resubmitted'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Whole proposal' }, { timeout: 5000 }),
    )
    await expect(canvas.getByRole('heading', { name: /^What changed$/ })).toBeVisible()
  },
}

/** The Accept dialog of a high-risk change: it says the publish waits for the approver. */
export const AcceptDialog: Story = {
  render: () => reviewOf('ready'),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole('button', { name: 'Accept' }, { timeout: 5000 }))
    await expect(await body.findByRole('alertdialog')).toHaveTextContent(/high-risk/)
  },
}

// ---- the parts ----

const nameOf = (id: string) => people.find((person) => person.id === id)?.name ?? null

/** One part on its own, with the query client its lookups read from and a router for its links. */
function Parts({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient)
  return (
    <QueryClientProvider client={client}>
      <RouterFrame>
        <div className="@container flex max-w-reading flex-col gap-6 p-6">{children}</div>
      </RouterFrame>
    </QueryClientProvider>
  )
}

function WithTargets({
  children,
}: {
  children: (targets: ReturnType<typeof targetsByKey>) => ReactNode
}) {
  const { targets } = useMentionTargets()
  return <>{children(targetsByKey(targets))}</>
}

/** Every row type of the field diff: words, chips, dates on one scale, quotes, risk and the rest. */
const everyRow: Review['diff'] = [
  {
    field: 'summary',
    before:
      'Regulator paused advertising in the United States on 15 June 2026. Numbers are comparable again from the end date.',
    after:
      'Regulator paused advertising in @[United States](val:market/united_states) on 15 June 2026 and lifted the pause on 3 September 2026. Numbers are comparable again from the end date.',
  },
  { field: 'kind', before: 'note', after: 'event' },
  {
    field: 'scope',
    before: {
      metrics: ['metric:marketing_spend'],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/united_states' }],
    },
    after: {
      metrics: ['metric:marketing_spend', 'metric:return_on_ad_spend'],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/united_states' }],
    },
  },
  {
    field: 'validity',
    before: { start: '2026-06-15', end: null },
    after: { start: '2026-06-15', end: '2026-09-03' },
  },
  { field: 'reviewDate', before: '2027-02-26', after: null },
  {
    field: 'evidence',
    before: [
      {
        url: 'https://example.com/notice',
        quote: 'Compare against a market that was not affected.',
        date: '2026-06-27',
      },
    ],
    after: [
      {
        url: 'https://example.com/notice',
        quote: 'Compare against a market that was not affected.',
        date: '2026-06-27',
      },
      {
        url: 'https://regulator.example/lifted',
        quote: 'The pause ends on 3 September 2026.',
        date: '2026-09-04',
      },
    ],
  },
  { field: 'areaId', before: 'area_sandbox', after: 'area_sales' },
  { field: 'ownerId', before: 'per_jon', after: 'per_sofia' },
  { field: 'claimLevel', before: 'fact_only', after: 'effect_stated' },
  { field: 'claimAuthority', before: null, after: 'The United States consumer regulator' },
  { field: 'claimQuote', before: null, after: 'All price promotions are paused.' },
  { field: 'riskLevel', before: 'normal', after: 'high' },
  {
    field: 'notToConclude',
    before: 'cause not proven',
    after: 'Lower spend in this period does not mean the campaigns failed.',
  },
]

export const FieldDiffRows: Story = {
  render: () => (
    <Parts>
      <WithTargets>
        {(targets) => (
          <FieldDiff
            diff={everyRow}
            lookups={{ targets, areas, nameOf }}
            issue={false}
            liveVersion={1}
            change
          />
        )}
      </WithTargets>
    </Parts>
  ),
}

/** An Issue that gets its end date: it becomes history (sheet E2, 3). */
export const IssueEndDate: Story = {
  render: () => (
    <Parts>
      <WithTargets>
        {(targets) => (
          <FieldDiff
            diff={[
              {
                field: 'validity',
                before: { start: '2026-09-25', end: null },
                after: { start: '2026-09-25', end: '2026-10-07' },
              },
            ]}
            lookups={{ targets, areas, nameOf }}
            issue
            liveVersion={1}
            change
          />
        )}
      </WithTargets>
    </Parts>
  ),
}

/** Since the request for changes: the version asked on against the resubmitted one. */
export const SinceTheRequest: Story = {
  render: () => (
    <Parts>
      <WithTargets>
        {(targets) => (
          <FieldDiff
            diff={everyRow.slice(0, 3)}
            lookups={{ targets, areas, nameOf }}
            issue={false}
            liveVersion={null}
            change
            columns={{ before: 'At the request', after: 'Sent again' }}
          />
        )}
      </WithTargets>
    </Parts>
  ),
}

/** A new item: one column, the fields as written. */
export const NewItemFields: Story = {
  render: () => (
    <Parts>
      <WithTargets>
        {(targets) => (
          <FieldDiff
            diff={everyRow.map((entry) => ({ ...entry, before: null }))}
            lookups={{ targets, areas, nameOf }}
            issue={false}
            liveVersion={null}
            change={false}
          />
        )}
      </WithTargets>
    </Parts>
  ),
}

const netRevenue = {
  key: 'metric:net_revenue',
  kind: 'metric' as const,
  parentKey: null,
  name: 'Net revenue',
  aliases: ['Revenue'],
  areaId: null,
  definitionRefs: ['cube:revenue.net_revenue'],
}

/** A term against the term in service: only what changed, before and after (FR-125). */
export const TermChange: Story = {
  render: () => (
    <Parts>
      <WithTargets>
        {(targets) => (
          <TermDiff
            term={{
              before: netRevenue,
              after: {
                ...netRevenue,
                name: 'Net sales',
                aliases: [
                  'Net revenue',
                  'Revenue after returns',
                  'Net sales after returns, discounts and fees',
                ],
                areaId: 'area_sales',
              },
            }}
            areas={areas}
            targets={targets}
          />
        )}
      </WithTargets>
    </Parts>
  ),
}

/** A new term: one column with the fields it sets, never an empty row. */
export const TermNew: Story = {
  render: () => (
    <Parts>
      <WithTargets>
        {(targets) => (
          <TermDiff
            term={{
              before: null,
              after: {
                key: 'val:market/newland',
                kind: 'dimension_value',
                parentKey: 'dim:market',
                name: 'Newland',
                aliases: [],
                areaId: null,
                definitionRefs: [],
              },
            }}
            areas={areas}
            targets={targets}
          />
        )}
      </WithTargets>
    </Parts>
  ),
}

/** A term proposed again as it is: nothing changed, and which fields stayed. */
export const TermUnchanged: Story = {
  render: () => (
    <Parts>
      <WithTargets>
        {(targets) => (
          <TermDiff
            term={{ before: netRevenue, after: netRevenue }}
            areas={areas}
            targets={targets}
          />
        )}
      </WithTargets>
    </Parts>
  ),
}

export const TextMode: Story = {
  render: () => (
    <Parts>
      <WithTargets>
        {(targets) => (
          <TextDiff diff={everyRow} targets={targets} current={{ summary: '', body: '' }} />
        )}
      </WithTargets>
    </Parts>
  ),
}

// The decision bar in six states (frame C3).
const sales = areas.find((area) => area.id === 'area_sales')!
const passed = (gate: Pick<Gate, 'required' | 'levels'>, approvals: Gate['approvals']): Gate => ({
  ...gate,
  approvals,
  problem: null,
  attached: [],
})
const proposal: Review['proposal'] = {
  id: 'p',
  number: 228,
  subject: 'item',
  action: 'change',
  state: 'in_review',
  areaId: 'area_sales',
  itemId: 'itm_kwiriumn',
  itemVersionId: 'v',
  vocabularyVersionId: null,
  termKey: null,
  title: 'Regulator paused advertising in the United States on 15 June 2026',
  riskLevel: 'high',
  proposerId: 'per_kofi',
  channel: 'form',
  revision: 4,
  reason: null,
  claimedBy: 'per_jon',
  dueAt: null,
  submittedAt: null,
  closedAt: null,
  createdAt: '2026-10-06T09:00:00.000Z',
}
const accepted: Review['decisions'] = [
  {
    id: 'd',
    decidedBy: 'per_jon',
    capacity: 'owner',
    outcome: 'accept',
    reason: 'Checked',
    decidedAt: '2026-10-07T09:41:00.000Z',
  },
]
const jonOf = { roles: [], assignments: [{ areaId: 'area_sales', role: 'owner' as const }] }
const larsOf = {
  roles: [],
  assignments: [{ areaId: 'area_sales', role: 'approver' as const }],
}
const barStates = [
  {
    title: '1 Ready',
    review: {
      proposal,
      gate: passed(highGate, { owner: false, approver: false }),
      decisions: [],
    },
    viewer: 'per_jon',
    permissions: jonOf,
  },
  {
    title: '2 A required check is not done',
    review: {
      proposal,
      gate: passed(mixedGate, { owner: false, approver: false }),
      decisions: [],
    },
    viewer: 'per_jon',
    permissions: jonOf,
  },
  {
    title: '3 Your own proposal, which you decide as owner',
    review: {
      proposal: { ...proposal, proposerId: 'per_jon', claimedBy: null },
      gate: passed(highGate, { owner: false, approver: false }),
      decisions: [],
    },
    viewer: 'per_jon',
    permissions: jonOf,
  },
  {
    title: '4 Someone else claimed it',
    review: {
      proposal: { ...proposal, claimedBy: 'per_sofia' },
      gate: passed(highGate, { owner: false, approver: false }),
      decisions: [],
    },
    viewer: 'per_jon',
    permissions: jonOf,
  },
  {
    title: '5 You accepted; the approver is next',
    review: {
      proposal,
      gate: passed(highGate, { owner: true, approver: false }),
      decisions: accepted,
    },
    viewer: 'per_jon',
    permissions: jonOf,
  },
  {
    title: '6 You are the approver',
    review: {
      proposal,
      gate: passed(highGate, { owner: true, approver: false }),
      decisions: accepted,
    },
    viewer: 'per_lars',
    permissions: larsOf,
  },
]

export const DecisionBarStates: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6">
      {barStates.map((state) => (
        <section
          key={state.title}
          aria-label={state.title}
          className="@container flex flex-col gap-2"
        >
          <h2 className="text-dense font-bold">{state.title}</h2>
          <div className="relative rounded-lg border">
            <DecisionBar
              bar={decisionBar(state.review, {
                viewerId: state.viewer,
                permissions: state.permissions,
                area: sales,
                nameOf,
              })}
              onOpen={() => undefined}
            />
          </div>
        </section>
      ))}
    </div>
  ),
}

const termName = (key: string) => key.replace(/^[a-z]+:/, '').replace(/^[a-z_]+\//, '')
const detailed = (gate: Pick<Gate, 'required' | 'levels'>, risk: 'normal' | 'high') => (
  <GateResult
    gate={gate}
    risk={risk}
    numbered
    renderDetails={(level) => {
      const result = gate.levels.find((candidate) => candidate.level === level)
      return result && hasLevelDetails(result) ? (
        <LevelDetails result={result} lookups={{ termName, questionText: () => null }} />
      ) : null
    }}
  />
)

/** The checks in four outcomes with their details: passed, a mix, a failed format, high risk. */
export const ChecksWithDetails: Story = {
  render: () => (
    <div className="grid items-start gap-4 p-6 @3xl:grid-cols-2 @6xl:grid-cols-4">
      {detailed(normalGate, 'normal')}
      {detailed(mixedGate, 'high')}
      {detailed(formatFailedGate, 'normal')}
      {detailed(highGate, 'high')}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [details] = await canvas.findAllByRole('button', {
      name: /Details of Finds the right questions/,
    })
    await userEvent.click(details!)
    await expect(await canvas.findByRole('list', { name: 'Test questions' })).toBeVisible()
  },
}

export const MentionsAndAudienceWarning: Story = {
  render: () => (
    <Parts>
      <WithTargets>
        {(targets) => (
          <>
            <MentionChanges
              mentions={{
                added: [
                  {
                    field: 'summary',
                    position: 0,
                    target: 'val:market/united_states',
                    label: 'United States',
                  },
                  {
                    field: 'summary',
                    position: 1,
                    target: 'metric:marketing_spend',
                    label: 'Marketing spend',
                  },
                ],
                removed: [
                  {
                    field: 'body',
                    position: 0,
                    target: 'item:itm_missing01',
                    label: 'An old note',
                  },
                ],
              }}
              warnings={[
                {
                  target: 'val:market/united_states',
                  label: 'Spain pricing note',
                  message: 'Fewer people can see it',
                },
              ]}
              targets={targets}
            />
            <MentionChanges mentions={{ added: [], removed: [] }} warnings={[]} targets={targets} />
          </>
        )}
      </WithTargets>
    </Parts>
  ),
}

const run: EvalRunDetail = {
  run: {
    id: 'r',
    kind: 'full',
    state: 'finished',
    areaId: 'area_sales',
    proposalId: 'p',
    itemVersionId: 'v',
    edition: '2026-10-07.2',
    modelId: 'm',
    judgeModelId: null,
    modelProvider: null,
    judgeProvider: null,
    modelFamily: null,
    judgeFamily: null,
    judgeSameFamily: null,
    modelVendor: null,
    judgeVendor: null,
    judgeSameVendor: null,
    trigger: null,
    toolSchemaDigest: 'd',
    testSetDigest: 'd',
    tries: 3,
    flipRepeats: 2,
    questions: 31,
    setAside: 0,
    estimatedCostMicros: 420_000,
    actualCostMicros: 420_000,
    costCeilingMicros: null,
    passRule: 'majority',
    requestedBy: null,
    approvedBy: null,
    failure: null,
    createdAt: '2026-10-07T09:00:00Z',
    startedAt: null,
    finishedAt: null,
  },
  results: [
    {
      id: 'a',
      impact: true,
      baseline: 'fail',
      candidate: 'pass',
      flip: 'fail_to_pass',
      layers: null,
    },
    { id: 'b', impact: true, baseline: 'pass', candidate: 'pass', flip: null, layers: null },
    { id: 'c', impact: true, baseline: 'pass', candidate: 'pass', flip: null, layers: null },
  ],
  flips: [{ id: 'a', flip: 'fail_to_pass' }],
  levels: {},
  scorecard: null,
  links: null,
  replay: null,
  agreement: null,
  judging: { judged: 0, errors: 0 },
  stopped: null,
  cells: [],
}
const wording: Record<string, string> = {
  a: 'Which markets changed after the pause?',
  b: 'Marketing spend in the United States, June',
  c: 'Return on ad spend in the United States',
}

export const ApprovalsAndImpact: Story = {
  render: () => (
    <div className="flex p-6">
      <PageRail placement="beside">
        <ApprovalsCard
          gate={{ approvals: { owner: false, approver: false } }}
          decisions={[]}
          reviewerId="per_jon"
          viewerId="per_jon"
          nameOf={nameOf}
          risk="high"
        />
        <ApprovalsCard
          gate={{ approvals: { owner: true, approver: false } }}
          decisions={accepted}
          reviewerId="per_jon"
          viewerId="per_lars"
          nameOf={nameOf}
          risk="high"
        />
        <ImpactDelta
          run={run}
          loading={false}
          message={null}
          questionText={(id) => wording[id] ?? null}
        />
        <ImpactDelta
          run={null}
          loading={false}
          message="The answer tests are running against the live edition."
          questionText={() => null}
        />
        <OwnerEditCard
          fields={{
            riskLevel: 'high',
            reviewDate: null,
            claimLevel: 'effect_stated',
            claimAuthority: 'The regulator',
            claimQuote: 'Paused.',
            areaId: 'area_sales',
            ownerId: 'per_jon',
          }}
          areas={areas}
          nameOf={nameOf}
          ends
          block={null}
          onChange={() => undefined}
        />
        <OwnerEditCard
          fields={{
            riskLevel: 'normal',
            reviewDate: '2027-01-05',
            claimLevel: 'fact_only',
            claimAuthority: '',
            claimQuote: '',
            areaId: 'area_sales',
            ownerId: 'per_jon',
          }}
          areas={areas}
          nameOf={nameOf}
          ends={false}
          block={{
            title: 'You wrote this proposal',
            reason: 'Another owner changes these while it waits for review.',
          }}
          onChange={() => undefined}
        />
      </PageRail>
    </div>
  ),
}

// The tests attached to a proposal (FR-524, Workbench plan V6): a draft before it is submitted,
// with Detach for its author; results that pass, fail and wait; low risk; a set-aside question.
const attachedHour = '2026-10-12T09:00:00.000Z'
const attachedOf = (question: string, active = true): ProposalTest => ({
  question,
  active,
  attachedHour,
})
const attachedCases: {
  id: string
  state: Review['proposal']['state']
  risk: 'low' | 'normal' | null
  tests: ProposalTest[]
  results?: AttachedTest[]
}[] = [
  {
    id: '00000000-0000-4000-8000-0000000000a1',
    state: 'draft',
    risk: null,
    tests: [attachedOf('net-revenue-month-to-date')],
  },
  {
    id: '00000000-0000-4000-8000-0000000000a2',
    state: 'in_review',
    risk: 'normal',
    tests: [
      attachedOf('net-revenue-month-to-date'),
      attachedOf('orders-united-kingdom-september'),
      attachedOf('cpa-united-kingdom-campaign'),
    ],
    results: [
      {
        ...attachedOf('net-revenue-month-to-date'),
        retrieval: { baseline: false, candidate: true },
        answer: { run: 'run-1', baseline: 'fail', candidate: 'pass' },
      },
      {
        ...attachedOf('orders-united-kingdom-september'),
        retrieval: { baseline: false, candidate: false },
        answer: { run: 'run-1', baseline: 'fail', candidate: 'fail' },
      },
      { ...attachedOf('cpa-united-kingdom-campaign'), retrieval: null, answer: null },
    ],
  },
  {
    id: '00000000-0000-4000-8000-0000000000a3',
    state: 'in_review',
    risk: 'low',
    tests: [attachedOf('units-sold-source-lag'), attachedOf('returns-weekend', false)],
    results: [
      {
        ...attachedOf('units-sold-source-lag'),
        retrieval: { baseline: true, candidate: true },
        answer: null,
      },
    ],
  },
]

function AttachedParts() {
  const [client] = useState(() => {
    const seeded = createQueryClient()
    seeded.setQueryData(
      queryKeys.testQuestions({ area: 'area_sales' }),
      structuredClone(mockTestQuestions),
    )
    for (const { id, tests } of attachedCases)
      seeded.setQueryData(queryKeys.proposalTests(id), tests)
    return seeded
  })
  return (
    <QueryClientProvider client={client}>
      <div className="flex p-6">
        <PageRail placement="beside">
          {attachedCases.map(({ id, state, risk, results }) => (
            <AttachedTests
              key={id}
              proposal={{ id, state, areaId: 'area_sales', proposerId: 'per_maria' }}
              results={results}
              risk={risk}
            />
          ))}
        </PageRail>
      </div>
    </QueryClientProvider>
  )
}

export const AttachedTestsStates: Story = {
  render: () => <AttachedParts />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const lists = await canvas.findAllByRole('list', { name: 'Attached tests' })
    await expect(lists).toHaveLength(3)
    await expect(
      canvas.getAllByText(/We report them, and they never block a decision\./),
    ).toHaveLength(3)
    await expect(canvas.getByText('Passes with this change.')).toBeVisible()
  },
}
