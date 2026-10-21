import { describe, expect, it } from 'vitest'
import type { Gate, Permissions, Review, ReviewProposal } from '@/api'
import { createMockApi } from '@/api/mock-api'
import {
  demoProposalIds,
  demoReviewIds,
  demoStartsAt,
  seedDemoProposals,
} from '@/api/mock-demo-proposals'
import { createMockWorkflow } from '@/api/mock-workflow'
import { fitQueueColumns } from '@/components/proposals/queue-columns'
import { commands, isAvailable, type CommandContext, type ReviewScope } from '@/lib/commands'
import {
  chipDiff,
  diffRows,
  emptySide,
  plainText,
  rangeDiff,
  side,
  sourceMarks,
  unchangedRowNames,
  wordDiff,
} from '@/lib/field-diff'
import {
  canOpen,
  decisionBar,
  groupQueueRows,
  opensInReview,
  queueTotals,
  reviewEditInput,
  ownerEditEffects,
  ownerFieldProblems,
  toQueueRow,
  visibleQueueRows,
  type OwnerFields,
} from '@/lib/review'
import { modelMember, modelMembers, termDiff } from '@/lib/term-diff'
import { getFixtureItems } from '@/mocks/fixtures'
import { areas, FIXTURE_TODAY, people, roleGrants, vocabulary } from '@/mocks/reference-data'
import { mockTestQuestions } from '@/mocks/test-questions'

const jon: Permissions = {
  roles: [],
  assignments: [
    { areaId: 'area_sales', role: 'owner' },
    { areaId: 'area_sandbox', role: 'owner' },
  ],
}
const lars: Permissions = {
  roles: [],
  assignments: [{ areaId: 'area_sales', role: 'approver' }],
}
const maria: Permissions = { roles: [], assignments: [] }
const ravi: Permissions = { roles: ['administrator'], assignments: [] }

const commercial = areas.find((area) => area.id === 'area_sales')!
const nameOf = (id: string) => people.find((person) => person.id === id)?.name ?? null

function proposal(extra: Partial<ReviewProposal> = {}): ReviewProposal {
  return {
    id: '00000000-0000-4000-8000-0000000000aa',
    number: 7,
    subject: 'item',
    action: 'change',
    state: 'in_review',
    areaId: 'area_sales',
    itemId: 'itm_kwiriumn',
    itemVersionId: 'ver',
    vocabularyVersionId: null,
    termKey: null,
    title: 'United Kingdom launch campaign ended',
    riskLevel: 'normal',
    proposerId: 'per_kofi',
    channel: 'form',
    revision: 3,
    reason: null,
    claimedBy: null,
    dueAt: '2026-10-09T10:00:00.000Z',
    submittedAt: '2026-10-07T10:00:00.000Z',
    closedAt: null,
    createdAt: '2026-10-07T09:00:00.000Z',
    ...extra,
  }
}

const passed = (levels: Gate['required']): Gate['levels'] =>
  levels.map((level) => ({ level, outcome: 'passed', ranAt: null, details: {} }))

function gate(extra: Partial<Gate> = {}, risk: 'normal' | 'high' = 'normal'): Gate {
  const required: Gate['required'] =
    risk === 'high'
      ? ['format', 'matching', 'delivery', 'answer_impact', 'answer_full']
      : ['format', 'matching', 'delivery', 'answer_impact']
  return {
    required,
    levels: passed(required),
    approvals: { owner: false, approver: risk === 'high' ? false : null },
    problem: 'no accept decision by an owner of the domain or an administrator',
    attached: [],
    ...extra,
  }
}

const review = (
  extra: Partial<ReviewProposal> = {},
  checks: Gate | null = gate(),
  decisions: Review['decisions'] = [],
) => ({ proposal: proposal(extra), gate: checks, decisions })

const as = (permissions: Permissions, viewerId: string) => ({
  viewerId,
  permissions,
  area: commercial,
  nameOf,
})

describe('the word diff', () => {
  it('reads back each side as its own text and marks the changed words', () => {
    const before = 'Regulator paused price promotions in the United States on 15 June 2026.'
    const after =
      'Regulator paused price promotions in the United States on 15 June 2026 and lifted the pause.'
    const parts = wordDiff(before, after)
    expect(plainText(side(parts, 'before'))).toBe(before)
    expect(plainText(side(parts, 'after'))).toBe(after)
    expect(
      parts
        .filter((part) => part.kind === 'added')
        .map((part) => (part.type === 'text' ? part.text : '')),
    ).toEqual([' and lifted the pause'])
    expect(side(wordDiff('a b c', 'a x y c'), 'after').map((part) => part.kind)).toEqual([
      'same',
      'added',
      'same',
    ])
  })

  it('keeps a mention whole and compares it by its target', () => {
    const parts = wordDiff(
      'Paused in @[United States](val:market/united_states).',
      'Paused in @[Norway](val:market/norway).',
    )
    expect(
      parts
        .filter((part) => part.type === 'mention')
        .map((part) => [part.kind, part.type === 'mention' && part.target]),
    ).toEqual([
      ['removed', 'val:market/united_states'],
      ['added', 'val:market/norway'],
    ])
  })

  it('joins a changed phrase into one run across its spaces', () => {
    const parts = wordDiff('a b c', 'a x y c')
    expect(parts.map((part) => [part.kind, part.type === 'text' ? part.text : ''])).toEqual([
      ['same', 'a '],
      ['removed', 'b'],
      ['added', 'x'],
      ['removed', ' '],
      ['added', ' y '],
      ['same', 'c'],
    ])
  })
})

describe('the chip and range diffs', () => {
  it('keeps what stays in order, then what is added', () => {
    const diff = chipDiff(['metric:a', 'metric:b'], ['metric:b', 'metric:c'])
    expect(diff.before).toEqual([
      { key: 'metric:a', kind: 'removed' },
      { key: 'metric:b', kind: 'same' },
    ])
    expect(diff.after).toEqual([
      { key: 'metric:b', kind: 'same' },
      { key: 'metric:c', kind: 'added' },
    ])
    expect([diff.added, diff.removed]).toEqual([1, 1])
  })

  it('draws both ranges on one scale and reads the stored end as the day after the last', () => {
    const diff = rangeDiff(
      { start: '2026-06-15', end: null },
      { start: '2026-06-15', end: '2026-09-03' },
    )
    expect(diff.after.last).toBe('2026-09-02')
    expect(diff.after.open).toBe(false)
    expect(diff.before?.open).toBe(true)
    expect(diff.before?.left).toBe(0)
    expect(diff.after.left).toBe(0)
    // The open range runs to the end of the scale, past the closed one.
    expect(diff.before!.width).toBeGreaterThan(diff.after.width)
    expect(diff.from).toBe('2026-06-15')
    expect(diff.before!.left + diff.before!.width).toBeCloseTo(100)
  })
})

describe('the rows of the field diff', () => {
  it('puts fields in the form order and joins the parts of one field', () => {
    const { rows, unknown } = diffRows([
      { field: 'riskLevel', before: 'normal', after: 'high' },
      { field: 'title', before: 'A', after: 'B' },
      { field: 'summary', before: 'A.', after: 'B.' },
      {
        field: 'validity',
        before: { start: '2026-01-01', end: null },
        after: { start: '2026-01-01', end: '2026-02-01' },
      },
      { field: 'reviewDate', before: '2026-05-01', after: null },
      { field: 'somethingNew', before: 1, after: 2 },
    ])
    expect(rows.map((row) => row.id)).toEqual(['summary', 'validity', 'risk'])
    expect(rows[1]?.after).toEqual({
      validity: { start: '2026-01-01', end: '2026-02-01' },
      reviewDate: null,
    })
    expect(unknown.map((entry) => entry.field)).toEqual(['somethingNew'])
    expect(unchangedRowNames([{ field: 'riskLevel' }, { field: 'validity' }])).toEqual([
      'title',
      'kind',
      'where it applies',
      'where this comes from',
      'domain',
      'owner',
      'cause',
      'who can see it',
    ])
  })
  it('lists references with their source marks, and what a change adds, drops or re-marks (A9)', () => {
    const { rows } = diffRows([
      { field: 'references', before: ['cube:a', 'cube:b'], after: ['cube:a', 'cube:c'] },
      {
        field: 'changeMarks',
        before: { 'cube:a': 'old', 'cube:b': 'kept' },
        after: { 'cube:a': 'new', 'cube:c': 'fresh' },
      },
    ])
    expect(sourceMarks(rows, true)).toEqual([
      { reference: 'cube:a', mark: 'new', change: 'changed' },
      { reference: 'cube:c', mark: 'fresh', change: 'added' },
      { reference: 'cube:b', mark: 'kept', change: 'removed' },
    ])
    // A new item has nothing to compare with.
    expect(sourceMarks(rows, false).map((entry) => entry.change)).toEqual(['same', 'same'])
    expect(sourceMarks(diffRows([{ field: 'title', before: 'A', after: 'B' }]).rows, true)).toEqual(
      [],
    )
  })
})

describe('what changed in a term', () => {
  const live = {
    key: 'metric:net_revenue',
    kind: 'metric' as const,
    parentKey: null,
    name: 'Net revenue',
    aliases: ['Revenue'],
    areaId: 'area_sales',
    definitionRefs: ['cube:revenue.net_revenue'],
  }
  it('shows only the fields a change changes, and names the ones it leaves alone', () => {
    expect(termDiff(live, { ...live, name: 'Net sales', areaId: null })).toEqual({
      rows: ['name', 'domain'],
      unchanged: ['other names', 'linked to'],
    })
    expect(termDiff(live, live)).toEqual({
      rows: [],
      unchanged: ['name', 'other names', 'domain', 'linked to'],
    })
  })
  it('shows a new term without empty rows', () => {
    const value = {
      ...live,
      key: 'val:market/newland',
      kind: 'dimension_value' as const,
      parentKey: 'dim:market',
      aliases: [],
      definitionRefs: [],
    }
    expect(termDiff(null, value).rows).toEqual(['kind', 'name', 'parent', 'domain'])
    expect(termDiff(null, live).rows).toEqual(['kind', 'name', 'aliases', 'domain', 'model'])
  })
  it('names the model member without the source prefix', () => {
    expect(modelMember('cube:revenue.net_revenue')).toBe('revenue.net_revenue')
    expect(modelMember('revenue.net_revenue')).toBe('revenue.net_revenue')
    expect(modelMember(null)).toBeNull()
    // The same member in another source keeps its prefix, so the change shows.
    expect(modelMember('dbt:revenue.net_revenue', 'cube:revenue.net_revenue')).toBe(
      'dbt:revenue.net_revenue',
    )
  })
  it('counts a member read from another source as a change', () => {
    expect(termDiff(live, { ...live, definitionRefs: ['dbt:revenue.net_revenue'] }).rows).toEqual([
      'model',
    ])
  })
  it("shows a dimension linking another view's member as a change of its Cube names", () => {
    const market = {
      ...live,
      key: 'dim:market',
      kind: 'dimension' as const,
      definitionRefs: ['cube:segments.market'],
    }
    const linked = { ...market, definitionRefs: ['cube:orders.market', 'cube:segments.market'] }
    expect(termDiff(market, linked).rows).toEqual(['model'])
    // The same members in another order are no change.
    expect(
      termDiff(linked, { ...linked, definitionRefs: [...linked.definitionRefs].reverse() }).rows,
    ).toEqual([])
    expect(modelMembers(linked.definitionRefs)).toEqual(['orders.market', 'segments.market'])
    expect(modelMembers(['dbt:a.market', 'cube:b.market'], ['cube:a.market'])).toEqual([
      'dbt:a.market',
      'b.market',
    ])
  })
})

describe('the empty side of a field diff row', () => {
  it('reads nothing, blank text, an empty list and an empty record as empty', () => {
    const { rows } = diffRows([
      { field: 'notToConclude', before: null, after: '  ' },
      { field: 'evidence', before: null, after: [] },
      { field: 'validity', before: null, after: { start: '2026-01-01', end: null } },
    ])
    expect(rows.map((row) => [row.id, emptySide(row, 'after')])).toEqual([
      ['validity', false],
      ['evidence', true],
      ['notToConclude', true],
    ])
  })

  it('reads the stored default of what not to conclude as empty, and own words as filled', () => {
    const sides = (after: string) =>
      emptySide(diffRows([{ field: 'notToConclude', before: null, after }]).rows[0]!, 'after')
    expect(sides('cause not proven')).toBe(true)
    expect(sides('Cause not proven')).toBe(true)
    expect(sides('Low orders do not mean fewer customers.')).toBe(false)
  })
})

describe('the blocked-reason resolver', () => {
  it('is ready for the owner when every check passed', () => {
    const bar = decisionBar(review(), as(jon, 'per_jon'))
    expect(bar.state).toBe('ready')
    expect(bar.heading).toBe('Your decision, as owner of Sales')
    expect(bar.capacity).toBe('owner')
    expect(['accept', 'request_changes', 'reject'].map((o) => canOpen(bar, o as never))).toEqual([
      true,
      true,
      true,
    ])
  })

  it('blocks Accept, never the other two, while a check has not passed', () => {
    const checks = gate()
    checks.levels[3] = {
      level: 'answer_impact',
      outcome: 'not_run',
      ranAt: null,
      details: { runState: 'running' },
    }
    const bar = decisionBar(review({}, checks), as(jon, 'per_jon'))
    expect(bar.state).toBe('checks')
    expect(bar.outcomes.accept).toMatchObject({ allowed: false, title: "You can't accept yet" })
    expect(bar.detail).toMatch(/still running/)
    expect(canOpen(bar, 'reject')).toBe(true)
    expect(canOpen(bar, 'request_changes')).toBe(true)
  })

  it('lets an owner decide their own normal-risk proposal, and says it is theirs', () => {
    const bar = decisionBar(review({ proposerId: 'per_jon' }), as(jon, 'per_jon'))
    expect(bar.state).toBe('ready')
    expect(bar.detail).toBe('All required checks passed. You can decide your own proposal.')
    expect(Object.values(bar.outcomes).every((outcome) => outcome?.allowed === true)).toBe(true)
  })

  it('lets an administrator decide any proposal, their own too, as administrator', () => {
    const others = decisionBar(review(), as(ravi, 'per_ravi'))
    expect(others).toMatchObject({
      state: 'ready',
      heading: 'Your decision, as admin',
      capacity: 'administrator',
    })
    const own = decisionBar(
      review({ proposerId: 'per_ravi', riskLevel: 'high' }, gate({}, 'high')),
      as(ravi, 'per_ravi'),
    )
    expect(own.state).toBe('ready')
    expect(own.detail).toBe(
      'All required checks passed. High risk: the approver accepts after you. You can decide your own proposal.',
    )
    expect(canOpen(own, 'accept')).toBe(true)
  })

  it('never lets an approver who is neither add the second accept to their own', () => {
    const bar = decisionBar(
      review({ proposerId: 'per_lars', riskLevel: 'high' }, gate({}, 'high')),
      as(lars, 'per_lars'),
    )
    expect(bar.state).toBe('proposer')
    expect(bar.outcomes.accept).toMatchObject({ allowed: false, label: 'Accept as approver' })
  })

  it('lets an owner accept their own low-risk proposal', () => {
    const bar = decisionBar(
      review(
        { proposerId: 'per_jon', riskLevel: 'low' },
        gate({
          required: ['format', 'matching', 'delivery'],
          levels: passed(['format', 'matching', 'delivery']),
        }),
      ),
      as(jon, 'per_jon'),
    )
    expect(bar.state).toBe('ready')
    expect(canOpen(bar, 'accept')).toBe(true)
  })

  it('blocks everything while someone else holds it', () => {
    const bar = decisionBar(review({ claimedBy: 'per_sofia' }), as(jon, 'per_jon'))
    expect(bar.state).toBe('claimed')
    expect(bar.heading).toBe('Sofia Brandt is reviewing this')
    expect(bar.detail).toBe('Ask Sofia to hand it over, or wait.')
  })

  it('waits for the approver once the owner accepted a high-risk change', () => {
    const accepted = gate({ approvals: { owner: true, approver: false } }, 'high')
    const decisions: Review['decisions'] = [
      {
        id: 'd',
        decidedBy: 'per_jon',
        capacity: 'owner',
        outcome: 'accept',
        reason: 'Fine',
        decidedAt: '2026-10-07T09:41:00.000Z',
      },
    ]
    const bar = decisionBar(
      review({ riskLevel: 'high', claimedBy: 'per_jon' }, accepted, decisions),
      as(jon, 'per_jon'),
    )
    expect(bar.state).toBe('approver_next')
    expect(bar.heading).toBe('You accepted at 09:41. Waiting for the approver')
    expect(bar.outcomes.accept).toMatchObject({ allowed: false, label: 'Accepted by you' })

    const approver = decisionBar(
      review({ riskLevel: 'high', claimedBy: 'per_jon' }, accepted, decisions),
      as(lars, 'per_lars'),
    )
    expect(approver.state).toBe('approver')
    expect(approver.detail).toMatch(/^Jon Abara accepted at 09:41\./)
    expect(approver.outcomes).toMatchObject({
      accept: { allowed: true, label: 'Accept as approver' },
      request_changes: null,
      reject: null,
    })
  })

  it('offers an approver nothing below high risk, and nobody without a role', () => {
    expect(decisionBar(review(), as(lars, 'per_lars')).state).toBe('no_role')
    expect(decisionBar(review(), as(maria, 'per_maria')).state).toBe('no_role')
  })

  it('offers no request for changes on a retirement, and only an administrator decides an area-less term', () => {
    const retire = decisionBar(review({ action: 'retire' }, null), as(jon, 'per_jon'))
    expect(retire.outcomes.request_changes).toBeNull()
    expect(retire.outcomes.accept).toMatchObject({ allowed: true, label: 'Archive' })
    const term = review(
      { subject: 'vocabulary', action: 'create', areaId: null, itemId: null },
      null,
    )
    expect(decisionBar(term, { ...as(ravi, 'per_ravi'), area: undefined }).capacity).toBe(
      'administrator',
    )
    expect(
      decisionBar(
        { ...term, proposal: { ...term.proposal, proposerId: 'per_ravi' } },
        { ...as(ravi, 'per_ravi'), area: undefined },
      ),
    ).toMatchObject({
      state: 'ready',
      detail:
        'Once you accept, people and agents can use the name. You can decide your own proposal.',
    })
    expect(decisionBar(term, { ...as(jon, 'per_jon'), area: undefined }).state).toBe('no_role')
  })

  it('says when a decision is no longer due', () => {
    expect(decisionBar(review({ state: 'accepted' }), as(jon, 'per_jon')).state).toBe('closed')
  })
})

describe('which mode a proposal opens in', () => {
  it('opens review mode for a role in its domain, or an administrator, while it waits', () => {
    const open = {
      state: 'submitted' as const,
      areaId: 'area_sales',
      subject: 'item' as const,
    }
    expect(opensInReview(open, jon)).toBe(true)
    expect(opensInReview(open, lars)).toBe(true)
    expect(opensInReview(open, maria)).toBe(false)
    expect(opensInReview({ ...open, state: 'accepted' }, jon)).toBe(false)
    expect(opensInReview({ ...open, areaId: null, subject: 'vocabulary' }, ravi)).toBe(true)
    // An administrator decides any proposal, in any domain (FR-202).
    expect(opensInReview(open, ravi)).toBe(true)
    expect(opensInReview({ ...open, state: 'accepted' }, ravi)).toBe(false)
  })
})

describe('the owner edit', () => {
  const current: OwnerFields = {
    riskLevel: 'normal',
    reviewDate: '2027-01-05',
    claimLevel: 'fact_only',
    claimAuthority: '',
    claimQuote: '',
    areaId: 'area_sales',
    ownerId: 'per_jon',
  }
  const names = { areaName: () => 'Marketing', ownerName: 'Tomas Eriksen' }

  it('sends only what changes, with the reason', () => {
    expect(reviewEditInput({ id: 'p', revision: 4 }, current, current, '')).toBeNull()
    expect(
      reviewEditInput(
        { id: 'p', revision: 4 },
        current,
        { ...current, riskLevel: 'high' },
        ' Spend ',
      ),
    ).toEqual({
      id: 'p',
      revision: 4,
      riskLevel: 'high',
      reason: 'Spend',
    })
    expect(
      reviewEditInput(
        { id: 'p', revision: 4 },
        current,
        {
          ...current,
          claimLevel: 'effect_stated',
          claimAuthority: ' The regulator ',
          claimQuote: 'Paused.',
          areaId: 'area_marketing',
          ownerId: 'per_tomas',
        },
        '',
      ),
    ).toEqual({
      id: 'p',
      revision: 4,
      claim: { level: 'effect_stated', authority: 'The regulator', quote: 'Paused.' },
      areaId: 'area_marketing',
      ownerId: 'per_tomas',
    })
  })

  it('needs an authority and a quote for a stated cause, and a date for an open item', () => {
    expect(
      ownerFieldProblems(
        { ...current, claimLevel: 'effect_stated', reviewDate: null },
        { ends: false },
      ),
    ).toEqual({
      reviewDate: 'It has no end date, so it needs a day to check it again.',
      claimAuthority: 'Name who states the effect.',
      claimQuote: 'Quote what they said.',
    })
    expect(ownerFieldProblems({ ...current, reviewDate: null }, { ends: true })).toEqual({})
  })

  it('says the checks run again, and what a raise to high risk needs', () => {
    expect(ownerEditEffects(current, current, names)).toEqual([])
    const raised = ownerEditEffects(current, { ...current, riskLevel: 'high' }, names)
    expect(raised[0]).toMatch(/every check runs again/)
    expect(raised[1]).toMatch(/high-risk approver/)
    expect(
      ownerEditEffects(
        current,
        { ...current, areaId: 'area_marketing', ownerId: 'per_tomas' },
        names,
      ),
    ).toContain('It moves to Marketing, and Tomas Eriksen reviews it.')
  })
})

describe('the queue', () => {
  const rows = [
    proposal({ id: 'a', number: 1, riskLevel: 'normal', submittedAt: '2026-10-01T00:00:00Z' }),
    proposal({
      id: 'b',
      number: 2,
      riskLevel: 'high',
      submittedAt: '2026-10-05T00:00:00Z',
      claimedBy: 'per_jon',
    }),
    proposal({
      id: 'c',
      number: 3,
      riskLevel: 'low',
      areaId: 'area_sandbox',
      dueAt: '2026-10-01T00:00:00Z',
    }),
    proposal({ id: 'd', number: 4, action: 'retire', itemId: 'itm_phps9mci', riskLevel: 'low' }),
  ].map((row) =>
    toQueueRow(row, {
      areas,
      people,
      proposals: [{ id: 'a', draft: { kind: 'guide' } }],
      items: [{ id: 'itm_phps9mci', kind: 'note' }],
    }),
  )

  it('reads kinds, names and changes, and orders by risk, then age', () => {
    expect(rows.map((row) => [row.kind, row.change, row.proposerName])).toEqual([
      ['guide', 'change', 'Kofi Mensah'],
      ['note', 'change', 'Kofi Mensah'],
      ['note', 'change', 'Kofi Mensah'],
      ['note', 'retire', 'Kofi Mensah'],
    ])
    expect(visibleQueueRows(rows, {}, 'per_jon').map((row) => row.id)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('filters by risk, domain, holder and words, and groups by domain', () => {
    expect(visibleQueueRows(rows, { claimed: 'me' }, 'per_jon').map((row) => row.id)).toEqual(['b'])
    expect(
      visibleQueueRows(rows, { claimed: 'nobody', risk: 'low' }, 'per_jon').map((row) => row.id),
    ).toEqual(['c', 'd'])
    expect(
      visibleQueueRows(rows, { area: 'area_sandbox' }, 'per_jon').map((row) => row.id),
    ).toEqual(['c'])
    expect(visibleQueueRows(rows, { q: '#4' }, 'per_jon').map((row) => row.id)).toEqual(['d'])
    expect(
      groupQueueRows(visibleQueueRows(rows, {}, 'per_jon')).map((entry) =>
        entry.type === 'group' ? `${entry.name} ${entry.count}` : entry.row.id,
      ),
    ).toEqual(['Sales 3', 'b', 'a', 'd', 'Sandbox 1', 'c'])
    expect(queueTotals(rows, '2026-10-07')).toEqual({ count: 4, high: 1, overdue: 1 })
  })

  it('fits the columns at 1440, keeps Checks, and becomes cards on a phone', () => {
    // With the sidebar open, Proposed by leaves first; the checks always stay (FR-223).
    expect(fitQueueColumns(1184, 24)).toEqual({
      columns: ['change', 'status', 'checks', 'risk', 'due'],
      narrow: false,
    })
    expect(fitQueueColumns(1392, 24, { selectable: true }).columns).toEqual([
      'change',
      'status',
      'checks',
      'risk',
      'due',
      'proposer',
    ])
    // The checkbox column takes its 40 from the title.
    expect(fitQueueColumns(1268, 24, { selectable: true }).columns).not.toContain('proposer')
    // At 768 the fixed columns no longer fit beside the title: the queue is cards.
    expect(fitQueueColumns(768, 24)).toEqual({
      columns: ['status', 'checks', 'risk'],
      narrow: true,
    })
    expect(fitQueueColumns(358, 16).narrow).toBe(true)
  })
})

describe('the review keys', () => {
  const scope: ReviewScope = {
    canOpen: (outcome) => outcome !== 'accept',
    open: () => undefined,
    next: () => undefined,
    previous: null,
  }
  const base = {
    navigate: () => undefined,
    setAppearance: () => undefined,
    toggleSidebar: () => undefined,
  } satisfies CommandContext
  const byKey = (key: string) =>
    commands.find((command) => command.scope === 'review' && command.hotkey === key)!

  it('opens the dialogs with a, r and Shift r, and moves with j and k, on the review screen only', () => {
    expect(['a', 'r', 'shift+r', 'j', 'k'].map((key) => byKey(key).id)).toEqual([
      'review.accept',
      'review.request-changes',
      'review.reject',
      'review.next',
      'review.previous',
    ])
    expect(isAvailable(byKey('r'), base)).toBe(false)
    const context = { ...base, review: scope }
    expect(['a', 'r', 'shift+r', 'j', 'k'].map((key) => isAvailable(byKey(key), context))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ])
  })
})

describe('a bulk decision on the demo queue (FR-223)', () => {
  it('leaves out a failed check, a step the approver must take and a claimed one, not his own', async () => {
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
      personId: () => 'per_jon',
      workflow: () => Promise.resolve(workflow),
    })
    const queue = await api.listReviewQueue()
    const target = (key: keyof typeof demoReviewIds) => {
      const entry = queue.find((row) => row.id === demoReviewIds[key])!
      return { id: entry.id, revision: entry.revision }
    }
    // The queue shows the failed check at a glance.
    expect(queue.find((row) => row.id === demoReviewIds.checks)?.checks?.failed.length).toBe(1)
    const plan = await api.planDecisions({
      proposals: (['ready', 'checks', 'approverNext', 'proposer', 'claimed'] as const).map(target),
      outcome: 'accept',
    })
    // The ready one is high risk: Jon's accept is the first, the approver's still to come. His own
    // note he decides as its owner (FR-206).
    expect(plan.decided.map((entry) => [entry.id, entry.effect])).toEqual([
      [demoReviewIds.ready, 'wait'],
      [demoReviewIds.proposer, 'publish'],
    ])
    expect(Object.fromEntries(plan.skipped.map((entry) => [entry.id, entry.code]))).toEqual({
      [demoReviewIds.checks]: 'checks_failed',
      [demoReviewIds.approverNext]: 'not_waiting',
      [demoReviewIds.claimed]: 'claimed',
    })
    expect(plan.skipped.find((entry) => entry.code === 'checks_failed')?.message).toMatch(
      /^A check it needs failed: /,
    )
    // Rejecting is open to the failed one and the one waiting for the approver.
    const reject = await api.planDecisions({
      proposals: (['checks', 'approverNext'] as const).map(target),
      outcome: 'reject',
    })
    expect(reject.decided.map((entry) => entry.effect)).toEqual(['decide', 'decide'])
  })
})

describe('the demo queue in the mock', () => {
  it('holds a proposal in every state of Jon’s decision bar, with a readable answer run', async () => {
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
      personId: () => 'per_jon',
      workflow: () => Promise.resolve(workflow),
    })
    const session = await api.getSession()
    const queue = await api.listReviewQueue()
    expect(queue.map((row) => row.id)).toEqual(expect.arrayContaining(Object.values(demoReviewIds)))
    const states = await Promise.all(
      (['ready', 'approverNext', 'claimed', 'proposer', 'checks', 'retire'] as const).map(
        async (key) => {
          const data = (await api.getReview(demoReviewIds[key]))!
          return decisionBar(data, {
            viewerId: 'per_jon',
            permissions: session.person.permissions,
            area: areas.find((area) => area.id === data.proposal.areaId),
            nameOf,
          }).state
        },
      ),
    )
    expect(states).toEqual(['ready', 'approver_next', 'claimed', 'ready', 'checks', 'ready'])

    // Alex's resubmission reads as what changed since Jon asked (heed-ux B2).
    const resubmitted = (await api.getReview(demoReviewIds.resubmitted))!
    expect(resubmitted.sinceRequest?.diff.map((entry) => entry.field)).toEqual([
      'title',
      'summary',
      'summaryMarkup',
      'scope',
      'evidence',
    ])

    const ready = (await api.getReview(demoReviewIds.ready))!
    const full = ready.gate?.levels.find((level) => level.level === 'answer_full')
    const runId = full?.level === 'answer_full' ? full.details.run : undefined
    expect(runId).toEqual(expect.any(String))
    const run = await api.getEvalRun(runId!)
    expect(run?.run).toMatchObject({
      state: 'finished',
      kind: 'full',
      questions: mockTestQuestions.length,
    })
    expect((await api.listTestQuestions({ area: 'area_sales' })).length).toBe(
      mockTestQuestions.length,
    )
    expect(await api.getEvalRun('00000000-0000-4000-9000-ffffffffffff')).toBeNull()

    // The owner's change shows on the timeline, and Accepting the retirement retires the item.
    const events = await api.listProposalEvents(demoReviewIds.ready)
    expect(events.map((event) => event.kind)).toContain('edited')
    const retire = (await api.getReview(demoReviewIds.retire))!
    const decided = await api.decide({
      id: retire.proposal.id,
      revision: retire.proposal.revision,
      outcome: 'accept',
      reason: 'Not needed',
    })
    expect(decided.proposal.state).toBe('accepted')
    expect(decided.edition?.live).toBe(true)
    expect((await api.getItem('itm_phps9mci'))?.status).toBe('retired')
  })
})

describe('the app’s shared mock world', () => {
  it('gives the demo proposals the ids the stories and screenshots link to, gaps and all', async () => {
    const jon = createMockApi({ personId: () => 'per_jon' })
    expect((await jon.listReviewQueue()).map((row) => row.id)).toEqual(
      expect.arrayContaining(Object.values(demoReviewIds)),
    )
    const maria = createMockApi({ personId: () => 'per_maria' })
    const mine = await maria.listProposals({ own: true })
    expect(Object.fromEntries(mine.rows.map((row) => [row.state, row.id]))).toEqual(demoProposalIds)
  })
})
