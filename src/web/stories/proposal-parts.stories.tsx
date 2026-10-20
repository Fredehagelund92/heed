import { useState, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '@/api/query-client'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { proposalStates } from '@domain/proposal-state'
import { PageRail } from '@/components/page/page-rail'
import { AgentPreview } from '@/components/proposal/agent-preview'
import { EditionLabel } from '@/components/proposal/edition-label'
import { CheckOutcomes, GateResult } from '@/components/proposal/gate-result'
import { OverlapList } from '@/components/proposal/overlap-list'
import { PersonChip, personRoles } from '@/components/proposal/person-chip'
import {
  DraftProvenanceNotice,
  ExternalSources,
  ProvenanceFlagBadge,
  ProvenanceMark,
} from '@/components/proposal/provenance-mark'
import { fieldMarks, type FieldMark, type Provenance } from '@domain/provenance'
import { FileTextIcon } from '@/components/icons'
import { FieldRow, FieldTable } from '@/components/item/field-table'
import { Owner, ProposalStatusBadge } from '@/components/item/item-marks'
import { DraftedMark, ProvenanceSummary } from '@/components/proposal/attribution'
import { countMarks } from '@/lib/provenance'
import { Discussion } from '@/components/proposal/discussion'
import { Timeline, TimelineEvent, TimelineSkeleton } from '@/components/proposal/timeline'
import { OtherEvents, StatusTimeline } from '@/design-preview/proposal-parts'
import {
  checkFailedReply,
  conflictReply,
  domains,
  formatFailedGate,
  fullOverlap,
  highGate,
  LIVE_EDITION,
  longTitleOverlap,
  matchedReply,
  mixedGate,
  noMatchReply,
  noOverlap,
  normalGate,
  statusOverlap,
  unreadableGate,
} from '@/design-preview/proposal-samples'
import { QueryFrame, RouterFrame } from './router-frame'
import { StoryApp } from './story-app'

/**
 * The parts the proposal and review screens share (slice W1b of the front end plan): the
 * proposal states on the badge family, the checks, the timeline, what an agent will see, the
 * overlaps, the edition label and the person chips. Every state of each, in both themes (theme
 * menu) and at 1440, 1024 and 390 (viewport menu).
 */
const meta = {
  title: 'Proposal parts',
  parameters: { layout: 'padded' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const about = ['Units sold', 'Norway', '4 Aug 2026']
const domainOf = () => domains.sales

/** The parts as they sit in a page's rail: flat sections beside a hairline. */
/** A rail column, with the queries a served fact's review stamp reads (the mock's). */
function Column({ children }: { children: ReactNode }) {
  return (
    <QueryFrame>
      <PageRail placement="beside">{children}</PageRail>
    </QueryFrame>
  )
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid items-start gap-4 @3xl:grid-cols-2 @6xl:grid-cols-3">{children}</div>
}

/** Soft while the proposal waits for someone, bare for a draft or a closed proposal. */
export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {(['md', 'sm'] as const).map((size) => (
        <div key={size} className="flex flex-wrap items-center gap-3">
          {proposalStates.map((state) => (
            <ProposalStatusBadge key={state} state={state} size={size} />
          ))}
        </div>
      ))}
    </div>
  ),
}

/** Normal risk, every level passed: the checks in the status page's rail. */
export const Checks: Story = {
  render: () => (
    <Column>
      <GateResult gate={normalGate} risk="normal" />
    </Column>
  ),
}

/** Every outcome, numbered as on the review screen, and the other cases the card meets. */
export const CheckOutcomesAll: Story = {
  name: 'Checks in every outcome',
  render: () => (
    <div className="@container">
      <Grid>
        <GateResult gate={highGate} risk="high" numbered />
        <GateResult gate={mixedGate} risk="high" numbered />
        <GateResult gate={formatFailedGate} risk="low" />
        <GateResult gate={unreadableGate} />
      </Grid>
    </div>
  ),
}

/** One row on a phone: it opens to the full list. */
export const ChecksFolded: Story = {
  render: () => (
    <Column>
      <GateResult gate={normalGate} risk="normal" variant="folded" />
      <GateResult gate={mixedGate} risk="high" variant="folded" />
    </Column>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: /Checks: 4 of 4 passed/ })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(trigger)
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText('All 7 test questions find it when they should')).toBeVisible()
  },
}

/** The outcomes on one line, as a "Checks ran" event shows them. */
export const OutcomesInline: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <CheckOutcomes gate={normalGate} />
      <CheckOutcomes gate={mixedGate} />
      <CheckOutcomes gate={formatFailedGate} />
    </div>
  ),
}

/** The status page's activity, newest first. */
export const Activity: Story = {
  render: () => (
    <div className="max-w-reading">
      <StatusTimeline />
    </div>
  ),
}

/** The endings and the hand-overs. */
export const ActivityEndings: Story = {
  render: () => (
    <div className="max-w-reading">
      <OtherEvents />
    </div>
  ),
}

/** A long comment with a long unbroken word, and the loading skeleton. */
export const ActivityLongTextAndLoading: Story = {
  render: () => (
    <div className="flex max-w-reading flex-col gap-8">
      <Timeline>
        <TimelineEvent
          kind="commented"
          actor="Maria Lindqvist-Abernathy-Kowalczyk"
          action="replied"
          at="2026-10-08T09:30:00Z"
          body={`${"The customs notice is in Norway's own language and covers every retailer that ships into the market. ".repeat(6)}\n\nhttps://www.customs.example/notices/2026-08/retailers-must-stop-online-sales-to-norway-from-4-august-2026`}
        />
        <TimelineEvent
          kind="started"
          actor="You"
          action="started this draft"
          at="2026-10-07T16:20:00Z"
        />
      </Timeline>
      <TimelineSkeleton />
    </div>
  ),
}

const discussionNames: Record<string, string> = {
  per_maria: 'Maria Lindqvist',
  per_jon: 'Jon Abara',
  per_lars: 'Lars Dahl',
}
const discussionEvents = [
  {
    id: 'c1',
    at: '2026-10-06T09:12:00Z',
    actorId: 'per_jon',
    kind: 'commented',
    data: {
      text: 'Please name **the regulator** and link the notice. The `market` scope looks right.',
      decisionId: 'd1',
    },
  },
  {
    id: 'c2',
    at: '2026-10-06T09:30:00Z',
    actorId: 'per_maria',
    kind: 'commented',
    data: {
      text: 'Done:\n\n- added [the notice](https://regulator.example/notices/2026-08)\n- named the regulator in the summary',
    },
  },
  {
    id: 'c3',
    at: '2026-10-06T10:02:00Z',
    actorId: 'per_lars',
    kind: 'commented',
    data: { text: '_Approver here:_ fine by me once the evidence is in.' },
  },
]
const discussionArea = { ownerIds: ['per_jon', 'per_sofia'] }

/** The composer sends through the API, so the discussion needs a query client of its own. */
function DiscussionFrame({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient)
  return (
    <QueryClientProvider client={client}>
      <RouterFrame>{children}</RouterFrame>
    </QueryClientProvider>
  )
}
const discussionComposer = {
  proposal: { id: 'p1', revision: 4 },
  title: 'Reply to Jon',
  notice: 'Jon is notified in the app.',
  action: 'Send reply',
}

/** A proposal's discussion (FR-222): the proposer and the reviewers, oldest first. */
export const DiscussionThread: Story = {
  render: () => (
    <DiscussionFrame>
      <div className="max-w-reading">
        <Discussion
          events={discussionEvents}
          pending={false}
          proposerId="per_maria"
          area={discussionArea}
          nameOf={(id) => discussionNames[id] ?? null}
          viewerId="per_maria"
          audience="Only you, the reviewers of Sales and administrators read this, also after the decision."
          composer={discussionComposer}
        />
      </div>
    </DiscussionFrame>
  ),
}

/** No comment yet, closed to comments, loading, and a long comment with an unbroken word. */
export const DiscussionStates: Story = {
  render: () => (
    <DiscussionFrame>
      <div className="flex max-w-reading flex-col gap-12">
        <Discussion
          events={[]}
          pending={false}
          proposerId="per_maria"
          area={discussionArea}
          nameOf={(id) => discussionNames[id] ?? null}
          viewerId="per_jon"
          audience="Only Maria, the reviewers of Sales and administrators read this, also after the decision."
          composer={{ ...discussionComposer, title: 'Comment for Maria', action: 'Send comment' }}
        />
        <Discussion
          events={[]}
          pending={false}
          proposerId="per_maria"
          area={discussionArea}
          nameOf={(id) => discussionNames[id] ?? null}
          viewerId="per_jon"
          audience="Only Maria, the reviewers of Sales and administrators read this, also after the decision."
          composer={null}
        />
        <Discussion
          events={undefined}
          pending
          proposerId="per_maria"
          area={discussionArea}
          nameOf={(id) => discussionNames[id] ?? null}
          viewerId="per_jon"
          audience="Only Maria, the reviewers of Sales and administrators read this."
          composer={null}
        />
        <Discussion
          events={[
            {
              id: 'long',
              at: '2026-10-06T09:12:00Z',
              actorId: 'per_jon',
              kind: 'commented',
              data: {
                text: `${"The customs notice is in Norway's own language and covers every retailer that ships into the market. ".repeat(5)}\n\nhttps://www.customs.example/notices/2026-08/retailers-must-stop-online-sales-to-norway-from-4-august-2026`,
              },
            },
          ]}
          pending={false}
          proposerId="per_maria"
          area={discussionArea}
          nameOf={(id) => discussionNames[id] ?? null}
          viewerId="per_maria"
          audience="Only you, the reviewers of Sales and administrators read this."
          composer={null}
        />
      </div>
    </DiscussionFrame>
  ),
}

export const AgentPreviewMatched: Story = {
  name: 'What an agent will see: matched',
  render: () => (
    <Column>
      <AgentPreview
        state="ready"
        result={matchedReply}
        about={about}
        domainOf={domainOf}
        draftItemId="itm_prp231draft"
      />
    </Column>
  ),
}

/** Two items in conflict, one not verified, one a partial match, and more than fit. */
export const AgentPreviewConflict: Story = {
  name: 'What an agent will see: conflict',
  render: () => (
    <Column>
      <AgentPreview
        state="ready"
        result={conflictReply}
        about={about}
        domainOf={domainOf}
        draftItemId="itm_prp231draft"
      />
    </Column>
  ),
}

/** Nothing applies, waiting for the draft, loading, the checks failed. */
export const AgentPreviewOtherStates: Story = {
  name: 'What an agent will see: other states',
  render: () => (
    <div className="@container">
      <Grid>
        <AgentPreview state="ready" result={noMatchReply} about={['Units sold', 'Spain']} />
        <AgentPreview state="waiting" />
        <AgentPreview state="loading" about={about} />
        <AgentPreview state="ready" result={checkFailedReply} />
      </Grid>
    </div>
  ),
}

export const Overlaps: Story = {
  render: () => (
    <RouterFrame>
      <div className="@container">
        <Grid>
          <OverlapList overlap={statusOverlap} />
          <OverlapList overlap={fullOverlap} title="Already in the library" />
          <OverlapList overlap={noOverlap} title="Already in the library" />
          <OverlapList overlap={longTitleOverlap} />
          <OverlapList overlap={undefined} loading />
        </Grid>
      </div>
    </RouterFrame>
  ),
}

/** Copy puts the edition number on the clipboard and says Copied. */
export const EditionLabels: Story = {
  render: () => (
    <div className="flex flex-col gap-3 text-dense">
      <span className="inline-flex items-center gap-2">
        Live edition <EditionLabel label={LIVE_EDITION} />
      </span>
      <span className="inline-flex items-center gap-2">
        Version <EditionLabel label="itm_gsw2q4i1 v2" what="version" />
      </span>
      <span className="inline-flex items-center gap-2">
        Without a button <EditionLabel label={LIVE_EDITION} copy={false} />
      </span>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const copied: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          copied.push(text)
          return Promise.resolve()
        },
      },
    })
    await userEvent.click(canvas.getByRole('button', { name: `Copy edition ${LIVE_EDITION}` }))
    await expect(await canvas.findByText('Copied')).toBeVisible()
    await expect(copied).toEqual([LIVE_EDITION])
  },
}

/** Each part a person plays, as someone else and as the viewer, and a long name. */
export const PersonChips: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {personRoles.map((role) => (
          <PersonChip key={role} role={role} name="Jon Abara" />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {personRoles.map((role) => (
          <PersonChip key={role} role={role} name="Jon Abara" you />
        ))}
        <PersonChip role="claimed" name="Jon Abara" you form="soft" />
      </div>
      <div className="flex max-w-companion flex-wrap gap-2">
        <PersonChip
          role="proposer"
          name="Maria Lindqvist-Abernathy-Kowalczyk of the Sales analytics team"
          date="2026-10-07"
        />
        <PersonChip role="reviewer" name="Jon Abara" size="sm" />
      </div>
    </div>
  ),
}

const agentDraft: Provenance = {
  by: 'agent',
  fields: {
    kind: 'prefilled',
    areaId: 'derived',
    ownerId: 'derived',
    title: 'prefilled',
    summary: 'prefilled',
    scope: 'prefilled',
    validity: 'prefilled',
    reviewDate: 'derived',
    riskLevel: 'default',
  },
  flags: [
    { code: 'may_be_high_risk', field: 'riskLevel', words: ['regulator', 'licence'] },
    {
      code: 'instruction_like_text',
      field: 'summary',
      words: ['ignore all previous instructions'],
    },
  ],
}

/**
 * A draft the assistant wrote from two web pages it read (read_source): the first sentence was
 * on its page, the second was not, so the person and the owner are warned (never stopped).
 */
const webDraft: Provenance = {
  by: 'assistant',
  fields: { title: 'prefilled', summary: 'prefilled', evidence: 'prefilled' },
  flags: [{ code: 'may_be_high_risk', field: 'riskLevel', words: ['lei', 'regulamentação'] }],
  external: [
    {
      url: 'https://consumer.example/pt/regras-de-devolucao',
      quote: 'Art. 1º Ficam os comerciantes obrigados a aceitar a devolução',
      readOn: '2026-10-15',
      quoteFound: true,
    },
    {
      url: 'https://news.example.com/eu-returns-rules',
      quote: 'Shops must refund a return within 5 days.',
      readOn: '2026-10-15',
      quoteFound: false,
    },
  ],
}

/**
 * Where each field of a draft an AI app or the assistant wrote came from (FR-121): every mark
 * as the person's editor shows it (a suggestion keeps the info ink, it asks for a look) and as
 * the review shows it, each a glyph named in its tooltip, the flags of the words, and the notice above the draft with and without flags, with
 * the fields the person answered in their AI app, and with evidence from web pages Heed read.
 */
export const FieldSources: Story = {
  render: () => (
    <div className="flex max-w-reading flex-col gap-4">
      {(['editor', 'review'] as const).map((where) =>
        (['agent', 'assistant'] as const).map((by) => (
          <div key={`${where}.${by}`} className="flex flex-wrap gap-2">
            {fieldMarks.map((mark) => (
              <ProvenanceMark key={mark} mark={mark} by={by} where={where} />
            ))}
          </div>
        )),
      )}
      <div className="flex flex-wrap gap-2">
        {agentDraft.flags.map((flag) => (
          <ProvenanceFlagBadge key={flag.code} flag={flag} />
        ))}
      </div>
      <DraftProvenanceNotice provenance={agentDraft} />
      <DraftProvenanceNotice
        provenance={{
          ...agentDraft,
          fields: { ...agentDraft.fields, validity: 'confirmed', evidence: 'confirmed' },
          flags: [],
        }}
      />
      <DraftProvenanceNotice
        provenance={{ by: 'assistant', fields: { summary: 'prefilled' }, flags: [] }}
      />
      <DraftProvenanceNotice provenance={webDraft} />
      <ExternalSources provenance={webDraft} where="review" />
    </div>
  ),
}

/** The review's summary line with its switch, and the rows it highlights. */
function AttributionTable({ provenance }: { provenance: Provenance }) {
  const rows: [string, string, FieldMark][] = [
    ['What happened', 'The regulator paused advertising in Norway on 2 October 2026.', 'prefilled'],
    ['Where it applies', 'Marketing spend · Market Norway', 'prefilled'],
    ['When it applies', 'From 2 Oct 2026, no end date', 'confirmed'],
    ['Domain', 'Marketing', 'derived'],
    ['Risk level', 'Normal risk', 'default'],
  ]
  return (
    <div className="flex flex-col gap-3">
      <ProvenanceSummary
        provenance={provenance}
        person="Priya Nair"
        you={false}
        counts={countMarks(rows.map(([, , mark]) => mark))}
        submitted
        marked
      />
      <FieldTable label="What the proposal says" wideLabels>
        {rows.map(([label, value, mark]) => (
          <FieldRow
            key={label}
            icon={FileTextIcon}
            label={label}
            mark={<ProvenanceMark mark={mark} by={provenance.by} where="review" />}
            wrote={mark === 'prefilled'}
          >
            {value}
            {label === 'Risk level' ? (
              <ProvenanceFlagBadge
                flag={{ code: 'may_be_high_risk', field: 'riskLevel', words: ['regulator'] }}
              />
            ) : null}
          </FieldRow>
        ))}
      </FieldTable>
    </div>
  )
}

/**
 * Quiet attribution (contract 6.13, "Field provenance"; 7.2, `Owner`): the proposer is the author
 * and the AI app a mark on their avatar; one summary line says who wrote what; each field carries
 * a muted glyph whose name is its tooltip; a flag keeps its soft badge; each field the app wrote
 * carries the line, under the summary's legend. Then the same mark in the proposer's chip, the
 * queue's Owner and a list row.
 */
export const Attribution: Story = {
  render: () => (
    <div className="flex max-w-reading flex-col gap-6">
      <AttributionTable provenance={{ by: 'agent', fields: {}, flags: [] }} />
      <ProvenanceSummary
        provenance={webDraft}
        person="Priya Nair"
        you
        counts={{ wrote: 3, confirmed: 0, filled: 2, left: 0 }}
        submitted={false}
      >
        <ExternalSources provenance={webDraft} where="review" />
      </ProvenanceSummary>
      <div className="flex flex-wrap items-center gap-4">
        <PersonChip role="proposer" name="Priya Nair" date="2026-10-07" drafted="agent" />
        <Owner name="Priya Nair" drafted="agent" />
        <Owner name="Priya Nair" drafted="assistant" size="md" />
        <span className="inline-flex items-center gap-2 text-caption text-muted-foreground">
          Draft <DraftedMark by="agent" />
        </span>
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Priya Nair drafted this with an AI app and sent it.'),
    ).toBeVisible()
    // The fields the app wrote carry the line, always: there is no switch.
    await expect(canvasElement.querySelectorAll('[data-slot="field-row"].ai-mark')).toHaveLength(2)
    await expect(canvas.queryByRole('switch')).toBeNull()
    await expect(canvas.getByText('A line marks what the app wrote')).toBeVisible()
    // Each field the app wrote carries one glyph, named for a screen reader; no badge per field.
    await expect(
      canvas.getAllByRole('img', {
        name: 'AI app wrote: Written by an AI app for the proposer, who sent it.',
      }),
    ).toHaveLength(2)
  },
}

/** Every part on one page in the real shell: the design preview's proposal parts page. */
export const Composed: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => <StoryApp path="/design-preview/proposal-parts" />,
}
