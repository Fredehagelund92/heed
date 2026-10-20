import { describe, expect, it } from 'vitest'
import { proposalStates, type ProposalState } from '@domain/proposal-state'
import type { ProposalEvent, ProposalRecord } from '@/api'
import { createMockApi } from '@/api/mock-api'
import { demoProposalIds, demoStartsAt, seedDemoProposals } from '@/api/mock-demo-proposals'
import { createMockWorkflow } from '@/api/mock-workflow'
import { webLink } from '@/components/proposal/proposal-fields'
import { fitProposalColumns } from '@/components/proposals/proposal-columns'
import { getFixtureItems } from '@/mocks/fixtures'
import { mockTestQuestions } from '@/mocks/test-questions'
import { areas, FIXTURE_TODAY, people, roleGrants, vocabulary } from '@/mocks/reference-data'
import { mineProposals } from '@/lib/my-drafts'
import { buildActivity, discussionOf, historyRows, proposalSteps } from '@/lib/proposal-activity'
import {
  changeLabel,
  describeProposalFilters,
  draftFindingNotes,
  editLinkOf,
  groupProposalRows,
  openIssueReviewDays,
  proposalActions,
  proposalViewOf,
  refusedTextMessage,
  stageOf,
  toProposalRow,
  visibleProposalRows,
} from '@/lib/proposals'

const names: Record<string, string> = { per_maria: 'Maria Lindqvist', per_jon: 'Jon Abara' }
const nameOf = (id: string) => names[id] ?? null
const context = {
  viewerId: 'per_maria',
  nameOf,
  proposal: { channel: 'form', proposerId: 'per_maria' } as const,
}

let seq = 0
const event = (
  kind: string,
  at: string,
  actorId: string | null = 'per_maria',
  data: Record<string, unknown> = {},
): ProposalEvent => ({ id: `e${++seq}`, at: `2026-10-0${at}:00.000Z`, actorId, kind, data })

/** Maria's #4: written, saved, sent, checked, claimed, changes asked, a reply. */
const story: ProposalEvent[] = [
  event('created', '5T16:20'),
  event('saved', '5T16:24'),
  event('saved', '5T16:29'),
  event('submitted', '5T16:38'),
  event('checked', '5T16:38', 'per_maria', { level: 'format', findings: [] }),
  event('checked', '5T16:39', null, { levels: { matching: 'passed', delivery: 'passed' } }),
  event('claimed', '6T09:05', 'per_jon', { personId: 'per_jon' }),
  event('decided', '6T09:12', 'per_jon', {
    outcome: 'request_changes',
    reason: 'Please add the link to the regulator notice.',
  }),
  event('commented', '6T09:30', 'per_maria', { text: 'Will do.' }),
]

describe('the timeline of a proposal (buildActivity)', () => {
  it('merges events, checks, decisions and comments, newest first', () => {
    const rows = buildActivity(story, context)
    expect(rows.map((row) => [row.kind, row.actor, row.action])).toEqual([
      ['commented', 'You', 'replied'],
      ['changes_requested', 'Jon Abara', 'asked for changes'],
      ['claimed', 'Jon Abara', 'claimed this review'],
      ['checked', undefined, 'Checks ran'],
      ['submitted', 'You', 'sent it for review'],
      ['started', 'You', 'started this draft'],
    ])
    expect(rows[0]?.body).toBe('Will do.')
    expect(rows[1]?.body).toBe('Please add the link to the regulator notice.')
  })

  it('folds autosaves into the start and one run of checks into one row', () => {
    const rows = buildActivity(story, context)
    expect(rows.at(-1)?.detail).toBe('In the web form. Saved automatically 2 times.')
    const checks = rows.find((row) => row.kind === 'checked')
    expect(checks?.tone).toBe('success')
    expect(checks?.checks?.levels.map((level) => [level.level, level.outcome])).toEqual([
      ['format', 'passed'],
      ['matching', 'passed'],
      ['delivery', 'passed'],
    ])
  })

  it('orders by time whatever order the events come in, and says when it was sent again', () => {
    const resent = [
      ...story,
      event('saved', '6T10:00'),
      event('submitted', '6T10:05'),
      event('checked', '6T10:06', null, { levels: { matching: 'failed' } }),
    ].reverse()
    const rows = buildActivity(resent, context)
    expect(rows[0]).toMatchObject({ kind: 'checked', tone: 'danger' })
    expect(rows[1]).toMatchObject({ kind: 'submitted', action: 'sent it back for review' })
    expect(rows.at(-1)?.detail).toBe('In the web form. Saved automatically 3 times.')
  })

  it('reads an owner commenting, an accept, a rejection and a withdrawal', () => {
    const rows = buildActivity(
      [
        event('commented', '6T08:00', 'per_jon', { text: 'Looking now.' }),
        event('decided', '6T09:00', 'per_jon', {
          outcome: 'accept',
          reason: 'Fine.',
          edition: '2026-10-07.2',
        }),
        event('decided', '6T09:30', 'per_jon', { outcome: 'reject', reason: 'No.' }),
        event('withdrawn', '6T10:00', 'per_maria', { reason: 'Fixed at the source.' }),
      ],
      context,
    )
    expect(rows.map((row) => [row.kind, row.action, row.body])).toEqual([
      ['withdrawn', 'withdrew it', 'Fixed at the source.'],
      ['rejected', 'rejected it', 'No.'],
      ['accepted', 'accepted it', 'Fine.'],
      ['commented', 'commented', 'Looking now.'],
    ])
    expect(rows[2]?.detail).toBe('From then on, AI apps get it.')
  })

  it('names an administrator and says plainly when its proposer decided (FR-206)', () => {
    const rows = buildActivity(
      [
        event('approved', '6T08:00', 'per_maria', {
          outcome: 'accept',
          capacity: 'administrator',
          byProposer: true,
        }),
        event('decided', '6T09:00', 'per_maria', {
          outcome: 'accept',
          capacity: 'administrator',
          byProposer: true,
          edition: '2026-10-07.2',
        }),
        event('decided', '6T09:30', 'per_maria', {
          outcome: 'reject',
          capacity: 'owner',
          byProposer: true,
        }),
        event('decided', '6T10:00', 'per_jon', { outcome: 'request_changes', capacity: 'owner' }),
      ],
      context,
    )
    expect(rows.map((row) => [row.kind, row.action, row.detail])).toEqual([
      ['changes_requested', 'asked for changes', undefined],
      ['rejected', 'rejected it', 'Decided by its proposer.'],
      [
        'accepted',
        'accepted it as admin',
        'Decided by its proposer. From then on, AI apps get it.',
      ],
      [
        'approved',
        'accepted it as admin',
        "Decided by its proposer. It's high risk, so an approver gives the second yes.",
      ],
    ])
  })

  it('leaves out what it cannot read and names nobody it does not know', () => {
    const rows = buildActivity(
      [
        event('discarded', '6T08:00'),
        event('checked', '6T08:01', null, { levels: { unknown: 'passed', format: 'odd' } }),
        event('claimed', '6T09:00', 'per_somebody'),
      ],
      context,
    )
    expect(rows).toEqual([expect.objectContaining({ kind: 'claimed', actor: 'Someone' })])
  })
})

describe('where a proposal stands (proposalSteps)', () => {
  const steps = (state: ProposalState, events: ProposalEvent[], claimedBy: string | null = null) =>
    proposalSteps({ state, claimedBy, dueAt: '2026-10-09T08:20:00.000Z' }, events, null, context)

  it('shows a draft as not sent, everything else not yet', () => {
    expect(
      steps('draft', [event('created', '7T09:41')]).map((step) => [step.label, step.state]),
    ).toEqual([
      ['Not sent yet', 'current'],
      ['Checks', 'waiting'],
      ['Claimed', 'waiting'],
      ['Decision', 'waiting'],
    ])
  })

  it('waits for a reviewer, with the day the decision is due', () => {
    const waiting = steps('submitted', story.slice(0, 6))
    expect(waiting.map((step) => [step.label, step.state])).toEqual([
      ['Sent for review', 'done'],
      ['Checks passed', 'done'],
      ['Waiting for an owner', 'current'],
      ['Decision', 'waiting'],
    ])
    expect(waiting[3]?.due).toBe('2026-10-09')
  })

  it('names the reviewer and the reviewer’s word', () => {
    expect(
      steps('changes_requested', story).map((step) => [step.label, step.state, step.at]),
    ).toEqual([
      ['Sent for review', 'done', '2026-10-05T16:38:00.000Z'],
      ['Checks passed', 'done', '2026-10-05T16:39:00.000Z'],
      ['Claimed by Jon Abara', 'done', '2026-10-06T09:05:00.000Z'],
      ['Changes requested', 'attention', '2026-10-06T09:12:00.000Z'],
    ])
  })

  it('starts over from the latest submission, and the gate has the last word on checks', () => {
    const again = [...story, event('submitted', '7T08:00')]
    const read = proposalSteps(
      { state: 'submitted', claimedBy: null, dueAt: null },
      again,
      {
        levels: [{ level: 'matching', outcome: 'failed', ranAt: null, details: {} }],
      },
      context,
    )
    expect(read.map((step) => [step.label, step.state])).toEqual([
      ['Sent again', 'done'],
      ['A check failed', 'failed'],
      ['Waiting for an owner', 'current'],
      ['Decision', 'waiting'],
    ])
  })

  it('names who decided when nobody claimed it, and keeps the checks it was decided on', () => {
    const accepted = proposalSteps(
      { state: 'accepted', claimedBy: null, dueAt: null },
      [...story.slice(0, 6), event('decided', '6T10:00', 'per_jon', { outcome: 'accept' })],
      // Its acceptance made a new edition, so the gate checks it again.
      { levels: [{ level: 'answer_impact', outcome: 'not_run', ranAt: null, details: {} }] },
      context,
    )
    expect(accepted.map((step) => [step.label, step.state])).toEqual([
      ['Sent for review', 'done'],
      ['Checks passed', 'done'],
      ['Reviewed by Jon Abara', 'done'],
      ['Accepted', 'done'],
    ])
  })

  it('ends accepted, rejected or withdrawn', () => {
    expect(
      steps('accepted', [
        ...story.slice(0, 7),
        event('decided', '6T10:00', 'per_jon', { outcome: 'accept' }),
      ])[3],
    ).toMatchObject({ label: 'Accepted', state: 'done' })
    expect(steps('rejected', story)[3]).toMatchObject({ label: 'Rejected', state: 'failed' })
    expect(steps('withdrawn', [...story, event('withdrawn', '7T10:00')])[3]).toMatchObject({
      label: 'Withdrawn',
      state: 'done',
      at: '2026-10-07T10:00:00.000Z',
    })
  })
})

describe('what the writer may do in each state (proposalActions)', () => {
  const matrix = Object.fromEntries(
    proposalStates.map((state) => [
      state,
      {
        author: proposalActions(state, { author: true, reviewer: false }),
        reviewer: proposalActions(state, { author: false, reviewer: true }),
        reader: proposalActions(state, { author: false, reviewer: false }),
      },
    ]),
  )

  it('covers every state', () => {
    expect(Object.keys(matrix)).toEqual([...proposalStates])
  })

  it.each([
    ['draft', 'continue', false, true, false],
    ['submitted', null, true, false, true],
    ['in_review', null, true, false, true],
    ['changes_requested', 'resubmit', true, false, true],
    ['accepted', null, false, false, false],
    ['rejected', null, false, false, false],
    ['withdrawn', null, false, false, false],
  ] as const)(
    '%s: primary %s, withdraw %s, discard %s, reply %s',
    (state, primary, withdraw, discard, reply) => {
      expect(matrix[state]?.author).toEqual({ primary, withdraw, discard, reply })
    },
  )

  it('lets an owner of the domain reply while it is sent, and nothing else', () => {
    for (const state of proposalStates) {
      const { reviewer, reader } = matrix[state]!
      expect(reviewer).toEqual({
        primary: null,
        withdraw: false,
        discard: false,
        reply: ['submitted', 'in_review', 'changes_requested'].includes(state),
      })
      expect(reader).toEqual({ primary: null, withdraw: false, discard: false, reply: false })
    }
  })

  it('edits a new item in Add a fact and a change in Suggest a change', () => {
    expect(editLinkOf({ id: 'p1', action: 'create', itemId: 'itm_new00001' })).toEqual({
      to: '/library/new',
      search: { draft: 'p1' },
    })
    expect(editLinkOf({ id: 'p2', action: 'change', itemId: 'itm_old00001' })).toEqual({
      to: '/library/$itemId/suggest',
      params: { itemId: 'itm_old00001' },
      search: { draft: 'p2' },
    })
  })
})

describe('the rows of the Proposals page', () => {
  const proposal = (
    number: number,
    state: ProposalState,
    updatedAt: string,
    extra: Partial<ProposalRecord> = {},
  ): ProposalRecord => ({
    subject: 'item',
    vocabularyVersionId: null,
    vocabulary: null,
    title: '',
    reason: null,
    id: `p${number}`,
    number,
    action: 'create',
    state,
    areaId: 'area_commercial',
    itemId: null,
    itemVersionId: null,
    proposerId: 'per_maria',
    channel: 'form',
    revision: 1,
    draft: { title: `Proposal ${number} about Norway`, kind: 'event', riskLevel: 'normal' },
    provenance: null,
    findings: [],
    claimedBy: null,
    dueAt: '2026-10-09T08:20:00.000Z',
    createdAt: updatedAt,
    updatedAt,
    ...extra,
  })
  const records = [
    proposal(1, 'accepted', '2026-09-30T10:00:00Z'),
    proposal(2, 'submitted', '2026-10-06T10:00:00Z', { areaId: 'area_marketing' }),
    proposal(3, 'changes_requested', '2026-10-05T10:00:00Z'),
    proposal(4, 'draft', '2026-10-07T10:00:00Z', { draft: {} }),
    proposal(5, 'in_review', '2026-10-07T09:00:00Z', { action: 'change', itemId: 'itm_x' }),
  ]
  const rows = records.map((record) => toProposalRow(record, areas))

  it('reads names, the change and the due day only while a decision is due', () => {
    expect(rows[1]).toMatchObject({ areaName: 'Marketing', areaLabel: 'pink', dueOn: '2026-10-09' })
    expect(rows[0]?.dueOn).toBeNull()
    expect(rows[2]?.dueOn).toBeNull()
    expect(rows[3]).toMatchObject({ title: 'Untitled draft', kind: 'note' })
    expect(changeLabel(rows[4]!)).toBe('Change #5')
    expect(changeLabel(rows[0]!)).toBe('New #1')
  })

  it('lists item creates and changes and proposed terms on Mine, not retire proposals', () => {
    const vocabulary = proposal(6, 'submitted', '2026-10-07T10:00:00Z', {
      subject: 'vocabulary',
      areaId: null,
      draft: {},
      title: 'Market',
      vocabulary: {
        key: 'dim:market',
        kind: 'dimension',
        parentKey: null,
        name: 'Market',
        aliases: [],
        areaId: null,
        definitionRefs: [],
      },
    })
    const retire = proposal(7, 'submitted', '2026-10-07T10:00:00Z', {
      action: 'retire',
      itemId: 'itm_x',
    })
    expect(mineProposals([...records, vocabulary, retire]).map((record) => record.number)).toEqual([
      1, 2, 3, 4, 5, 6,
    ])
    // A term reads as its name and kind, of no domain when it has none.
    expect(toProposalRow(vocabulary, areas)).toMatchObject({
      title: 'Market',
      term: 'dimension',
      areaName: 'No domain',
    })
    expect(rows[0]?.term).toBeNull()
  })

  it('carries who drafted it with the person, for the quiet mark on the row', () => {
    expect(rows[0]?.drafted).toBeNull()
    const drafted = proposal(6, 'draft', '2026-10-07T10:00:00Z', {
      channel: 'mcp',
      provenance: { by: 'agent', fields: { title: 'prefilled' }, flags: [] },
    })
    expect(toProposalRow(drafted, areas).drafted).toBe('agent')
  })

  it('groups by where each stands, unsubmitted drafts first and apart, the newest change first in a group', () => {
    const entries = groupProposalRows(visibleProposalRows(rows, {}))
    expect(
      entries.map((entry) =>
        entry.type === 'group' ? `${entry.stage} ${entry.count}` : entry.row.number,
      ),
    ).toEqual(['draft 1', 4, 'yours 1', 3, 'reviewing 2', 5, 2, 'closed 1', 1])
    expect(proposalStates.map(stageOf)).toEqual([
      'draft',
      'reviewing',
      'reviewing',
      'yours',
      'closed',
      'closed',
      'closed',
    ])
  })

  it('filters by status, domain and words, and says what is on', () => {
    expect(visibleProposalRows(rows, { state: 'submitted' }).map((row) => row.number)).toEqual([2])
    expect(visibleProposalRows(rows, { area: 'area_marketing' }).map((row) => row.number)).toEqual([
      2,
    ])
    expect(visibleProposalRows(rows, { q: 'norway 3' }).map((row) => row.number)).toEqual([3])
    expect(visibleProposalRows(rows, { q: '#5' }).map((row) => row.number)).toEqual([5])
    expect(
      describeProposalFilters(
        { q: 'tax', state: 'rejected', area: 'area_sandbox' },
        () => 'Sandbox',
      ),
    ).toBe('Nothing matches “tax” with Status: Rejected; Domain: Sandbox.')
  })

  it('opens To review for someone who reviews, Mine for everyone else', () => {
    expect(proposalViewOf({}, { reviews: true })).toBe('review')
    expect(proposalViewOf({ view: 'mine' }, { reviews: true })).toBe('mine')
    expect(proposalViewOf({ view: 'checks' }, { reviews: true })).toBe('review')
    expect(proposalViewOf({})).toBe('mine')
    expect(proposalViewOf({ view: 'review' })).toBe('mine')
  })
})

describe('the proposal grid’s column budget', () => {
  it('shows every column at 1440 and drops Updated, Due and Domain in turn', () => {
    expect(fitProposalColumns(1184, 24)).toEqual({
      columns: ['change', 'status', 'domain', 'due', 'updated'],
      narrow: false,
    })
    expect(fitProposalColumns(1008, 24).columns).toEqual(['change', 'status', 'domain', 'due'])
    expect(fitProposalColumns(976, 24).columns).toEqual(['change', 'status', 'domain'])
    expect(fitProposalColumns(864, 24).columns).toEqual(['change', 'status', 'domain'])
    expect(fitProposalColumns(976, 24, { oneDomain: true }).columns).toEqual([
      'change',
      'status',
      'due',
      'updated',
    ])
  })

  it('becomes the narrow row on a phone', () => {
    expect(fitProposalColumns(390, 16).narrow).toBe(true)
    expect(fitProposalColumns(767, 24).narrow).toBe(true)
  })
})

describe('evidence links in a draft', () => {
  it('links only an http or https address; anything else stays text', () => {
    expect(webLink('https://news.example/a?b=1')).toEqual({
      href: 'https://news.example/a?b=1',
      host: 'news.example',
    })
    expect(webLink('javascript:alert(1)')).toBeNull()
    expect(webLink('data:text/html,hi')).toBeNull()
    expect(webLink('news.example/no-scheme')).toBeNull()
  })
})

describe('words for the writer', () => {
  it('says how soon an open issue is asked again', () => {
    const issue = { kind: 'issue', validity: { start: '2026-10-05', end: null } } as const
    expect(openIssueReviewDays({ ...issue, reviewDate: '2026-10-19' })).toBe(14)
    expect(openIssueReviewDays({ ...issue, reviewDate: '2026-10-26' })).toBe(21)
    expect(openIssueReviewDays(issue)).toBe(14)
    expect(
      openIssueReviewDays({ kind: 'issue', validity: { start: '2026-10-05', end: '2026-10-07' } }),
    ).toBeNull()
    expect(
      openIssueReviewDays({ kind: 'event', validity: { start: '2026-10-05', end: null } }),
    ).toBeNull()
  })

  it('names the pattern the service refused in a reply', () => {
    expect(refusedTextMessage([{ code: 'phone_number' }])).toBe(
      'It looks like it holds a phone number. Take that out, then send it again.',
    )
    expect(refusedTextMessage([{ code: 'email_address' }, { code: 'access_key' }])).toContain(
      'an email address and an access key',
    )
    expect(refusedTextMessage([{ code: 'format' }])).toBeNull()
  })

  it('names the field of a draft’s format finding, never the schema’s words', () => {
    expect(
      draftFindingNotes([
        { field: 'evidence.0.url', message: 'Invalid input' },
        { field: '', message: 'Invalid input' },
      ]).map((finding) => finding.message),
    ).toEqual(['Where this comes from needs attention.', 'Something needs attention.'])
  })
})

describe('the demo week in the mock', () => {
  it('holds one proposal of Maria’s in every state, told through the real workflow', async () => {
    const workflow = createMockWorkflow({
      today: FIXTURE_TODAY,
      areas,
      people,
      vocabulary,
      items: getFixtureItems,
      approvers: roleGrants.approvers,
      administrators: roleGrants.administrators,
      startsAt: demoStartsAt(FIXTURE_TODAY),
      testQuestions: mockTestQuestions,
    })
    seedDemoProposals(workflow, FIXTURE_TODAY)
    const api = createMockApi({
      personId: () => 'per_maria',
      workflow: () => Promise.resolve(workflow),
    })
    const { rows: mine } = await api.listProposals({ own: true })
    expect(mine.map((proposal) => proposal.state).sort()).toEqual([...proposalStates].sort())
    expect(Object.fromEntries(mine.map((proposal) => [proposal.state, proposal.id]))).toEqual(
      demoProposalIds,
    )
    const asked = mine.find((proposal) => proposal.state === 'changes_requested')!
    const events = await api.listProposalEvents(asked.id)
    expect(events.map((entry) => entry.kind)).toEqual([
      'created',
      'saved',
      'saved',
      'saved',
      'submitted',
      'checked',
      'checked',
      'claimed',
      'decided',
      'commented',
    ])
    // The story happens before noon on the fixture day; what a person does next comes after.
    expect(events.at(-1)!.at < `${FIXTURE_TODAY}T12:00:00.000Z`).toBe(true)
    const draft = await api.createProposal({ draft: { areaId: 'area_sandbox', kind: 'note' } })
    expect(draft.createdAt >= `${FIXTURE_TODAY}T12:00:00.000Z`).toBe(true)
  })
})

describe("a proposal's discussion (FR-222)", () => {
  const events = [
    ...story,
    event('commented', '6T09:20', 'per_jon', {
      text: 'The notice is on the regulator site.',
      decisionId: 'd1',
    }),
    event('commented', '6T09:40', 'per_sofia', { text: '  ' }),
    event('commented', '6T10:00', 'per_lars', { text: 'Approver here.' }),
  ]
  const area = { ownerIds: ['per_jon', 'per_sofia'] }

  it('lists the comments oldest first, with each writer’s part and the request they came with', () => {
    expect(
      discussionOf(events, { proposerId: 'per_maria', area }).map((comment) => [
        comment.role,
        comment.text,
        comment.withRequest,
      ]),
    ).toEqual([
      ['owner', 'The notice is on the regulator site.', true],
      ['proposer', 'Will do.', false],
      ['reviewer', 'Approver here.', false],
    ])
  })

  it('keeps one line for each comment in the history, its words in the discussion', () => {
    const rows = historyRows(buildActivity(story, context))
    const comment = rows.find((row) => row.kind === 'commented')
    expect(comment).toMatchObject({ body: undefined, detail: 'In the discussion.' })
    // A decision keeps its reason.
    expect(rows.find((row) => row.kind === 'changes_requested')?.body).toBe(
      'Please add the link to the regulator notice.',
    )
  })
})
