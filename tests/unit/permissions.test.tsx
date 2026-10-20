import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Permissions } from '@/api'
import { MOCK_PERSON_KEY } from '@/api/mock-scenario'
import { createQueryClient } from '@/api/query-client'
import {
  canDecide,
  canDecideInList,
  canReadAudit,
  isFor,
  canRetire,
  canReview,
  capacitiesIn,
  roleLines,
  listDecisionWords,
  roleSummary,
  undecidableSummary,
  type DecidableProposal,
  type ListDecision,
  type ListedProposal,
} from '@/lib/permissions'
import { usePermissions } from '@/lib/use-session'
import { areas } from '@/mocks/reference-data'

const contributor: Permissions = { roles: [], assignments: [] }
const jon: Permissions = {
  roles: [],
  assignments: [
    { areaId: 'area_sales', role: 'owner' },
    { areaId: 'area_sandbox', role: 'owner' },
  ],
}
/** Sales's second owner, beside Jon. */
const sofia: Permissions = {
  roles: [],
  assignments: [{ areaId: 'area_sales', role: 'owner' }],
}
const lars: Permissions = {
  roles: [],
  assignments: [{ areaId: 'area_sales', role: 'approver' }],
}
const ravi: Permissions = { roles: ['administrator'], assignments: [] }

const open = (extra: Partial<DecidableProposal> = {}): DecidableProposal => ({
  areaId: 'area_sales',
  proposerId: 'per_maria',
  state: 'submitted',
  riskLevel: 'low',
  claimedBy: null,
  ...extra,
})

describe('role words', () => {
  it('names each role with its areas, and calls everyone else a contributor', () => {
    expect(roleLines(contributor, areas)).toEqual(['Contributor'])
    expect(roleSummary(jon, areas)).toBe('Owner of Sales and Sandbox')
    expect(roleLines(sofia, areas)).toEqual(['Owner of Sales'])
    expect(roleLines(lars, areas)).toEqual(['High-risk approver of Sales'])
    expect(roleLines(ravi, areas)).toEqual(['Admin'])
    expect(roleLines({ roles: ['auditor'], assignments: [] }, areas)).toEqual(['Auditor'])
  })

  it('lists several areas in order and several roles one per line', () => {
    const busy: Permissions = {
      roles: ['administrator'],
      assignments: [
        { areaId: 'area_sandbox', role: 'owner' },
        { areaId: 'area_marketing', role: 'approver' },
        { areaId: 'area_sales', role: 'owner' },
        { areaId: 'area_paid_media', role: 'owner' },
      ],
    }
    expect(roleLines(busy, areas)).toEqual([
      'Admin',
      'Owner of Paid media, Sales and Sandbox',
      'High-risk approver of Marketing',
    ])
    expect(roleSummary(busy, areas)).toBe(
      'Admin, Owner of Paid media, Sales and Sandbox, High-risk approver of Marketing',
    )
  })

  it('never shows an area id: the role stands alone until the names load', () => {
    expect(roleLines(jon, undefined)).toEqual(['Owner'])
    expect(
      roleLines({ roles: [], assignments: [{ areaId: 'area_gone', role: 'approver' }] }, areas),
    ).toEqual(['High-risk approver'])
  })
})

describe('what a person may do', () => {
  it('reads capacities per area, owner first', () => {
    const both: Permissions = {
      roles: [],
      assignments: [
        { areaId: 'area_sales', role: 'approver' },
        { areaId: 'area_sales', role: 'owner' },
      ],
    }
    expect(capacitiesIn(both, 'area_sales')).toEqual(['owner', 'approver'])
    expect(capacitiesIn(jon, 'area_marketing')).toEqual([])
    expect(capacitiesIn(jon, null)).toEqual([])
    expect(canReview(sofia, 'area_sales')).toBe(true)
    expect(canReview(lars, 'area_sales')).toBe(false)
    expect(canRetire(ravi, 'area_sales')).toBe(true)
    expect(canRetire(contributor, 'area_sales')).toBe(false)
    expect(canReadAudit(ravi)).toBe(true)
    expect(canReadAudit({ roles: ['auditor'], assignments: [] })).toBe(true)
    expect(canReadAudit(jon)).toBe(false)
  })

  it('opens each audience to its roles: Quality to owners, Admin to administrators', () => {
    for (const person of [contributor, jon, sofia, lars, ravi])
      expect(isFor(person, 'everyone')).toBe(true)
    expect([contributor, jon, sofia, lars, ravi].map((p) => isFor(p, 'quality'))).toEqual([
      false,
      true,
      true,
      false,
      true,
    ])
    expect([contributor, jon, sofia, lars, ravi].map((p) => isFor(p, 'administrators'))).toEqual([
      false,
      false,
      false,
      false,
      true,
    ])
    expect(isFor({ roles: ['auditor'], assignments: [] }, 'administrators')).toBe(false)
  })

  it('opens Administration to administrators and auditors, and to no one while the roles load', () => {
    const auditor = { roles: ['auditor' as const], assignments: [] }
    expect(
      [contributor, jon, sofia, lars, ravi, auditor].map((p) => isFor(p, 'administration')),
    ).toEqual([false, false, false, false, true, true])
    expect(isFor(undefined, 'administration')).toBe(false)
  })

  it('opens the Gaps entry to everyone the Workbench is not for, and nothing narrower while the roles load', () => {
    const auditor = { roles: ['auditor' as const], assignments: [] }
    // Lars is a high-risk approver only: he decides proposals, he does not look after a domain.
    expect(
      [contributor, jon, sofia, lars, ravi, auditor].map((p) => isFor(p, 'contributors')),
    ).toEqual([true, false, false, true, false, true])
    for (const person of [contributor, jon, sofia, lars, ravi, auditor])
      expect(isFor(person, 'contributors')).toBe(!isFor(person, 'quality'))
    expect(isFor(undefined, 'everyone')).toBe(true)
    for (const audience of ['quality', 'contributors', 'administrators'] as const)
      expect(isFor(undefined, audience)).toBe(false)
  })

  it('lets an owner decide in their own area, and an admin in every area', () => {
    expect(canDecide(jon, 'per_jon', open())).toEqual({ allowed: true, capacity: 'owner' })
    expect(canDecide(sofia, 'per_sofia', open(), 'reject')).toEqual({
      allowed: true,
      capacity: 'owner',
    })
    expect(canDecide(jon, 'per_jon', open({ areaId: 'area_marketing' }))).toMatchObject({
      allowed: false,
    })
    // An administrator decides in any area, as administrator (FR-202).
    expect(canDecide(ravi, 'per_ravi', open())).toEqual({
      allowed: true,
      capacity: 'administrator',
    })
    expect(canDecide(ravi, 'per_ravi', open({ areaId: 'area_marketing' }))).toMatchObject({
      allowed: true,
    })
    expect(canDecide(contributor, 'per_maria', open())).toEqual({
      allowed: false,
      reason: 'Only an owner or high-risk approver of the domain, or an admin, can decide.',
    })
  })

  it('lets an admin and an owner of the area decide their own proposal, at every risk', () => {
    for (const riskLevel of ['low', 'normal', 'high'] as const) {
      expect(canDecide(jon, 'per_jon', open({ proposerId: 'per_jon', riskLevel }))).toEqual({
        allowed: true,
        capacity: 'owner',
      })
      expect(canDecide(ravi, 'per_ravi', open({ proposerId: 'per_ravi', riskLevel }))).toEqual({
        allowed: true,
        capacity: 'administrator',
      })
    }
    // An owner of another domain, or a contributor, decides nothing there, their own neither.
    expect(
      canDecide(jon, 'per_jon', open({ proposerId: 'per_jon', areaId: 'area_marketing' })),
    ).toMatchObject({ allowed: false })
    expect(canDecide(contributor, 'per_maria', open())).toMatchObject({ allowed: false })
    // An approver who is neither never adds the second accept to their own.
    expect(
      canDecide(lars, 'per_lars', open({ proposerId: 'per_lars', riskLevel: 'high' })),
    ).toEqual({ allowed: false, reason: 'Someone else must accept a proposal you wrote.' })
  })

  it('leaves a claimed proposal to its reviewer', () => {
    expect(canDecide(jon, 'per_jon', open({ claimedBy: 'per_sofia' }))).toEqual({
      allowed: false,
      reason: 'Someone else has claimed this proposal.',
    })
    expect(canDecide(jon, 'per_jon', open({ claimedBy: 'per_jon' }))).toMatchObject({
      allowed: true,
    })
  })

  it('lets an approver add only the second accept of a high-risk proposal', () => {
    expect(canDecide(lars, 'per_lars', open({ riskLevel: 'high', claimedBy: 'per_jon' }))).toEqual({
      allowed: true,
      capacity: 'approver',
    })
    expect(canDecide(lars, 'per_lars', open({ riskLevel: 'high' }), 'reject')).toMatchObject({
      allowed: false,
    })
    expect(canDecide(lars, 'per_lars', open({ riskLevel: 'normal' }))).toMatchObject({
      allowed: false,
    })
  })

  it('decides nothing that is not waiting for a decision', () => {
    for (const state of [
      'draft',
      'changes_requested',
      'accepted',
      'rejected',
      'withdrawn',
    ] as const)
      expect(canDecide(jon, 'per_jon', open({ state }))).toEqual({
        allowed: false,
        reason: "This proposal isn't waiting for a decision.",
      })
  })
})

describe('canDecideInList: whether a list row can be selected for a bulk step (FR-223)', () => {
  const item = (extra: Partial<ListedProposal> = {}): ListedProposal => ({
    subject: 'item',
    areaId: 'area_sales',
    proposerId: 'per_maria',
    state: 'submitted',
    riskLevel: 'normal',
    ...extra,
  })
  const term = (extra: Partial<ListedProposal> = {}) =>
    item({ subject: 'vocabulary', riskLevel: null, ...extra })
  const denied = (decision: ListDecision) => {
    if (decision.allowed) throw new Error('expected a refusal')
    return decision
  }

  it('lets an owner decide their domain, and an approver a high-risk item', () => {
    expect(canDecideInList(jon, 'per_jon', item())).toEqual({ allowed: true })
    expect(canDecideInList(sofia, 'per_sofia', item())).toEqual({ allowed: true })
    expect(canDecideInList(lars, 'per_lars', item({ riskLevel: 'high' }))).toEqual({
      allowed: true,
    })
    expect(canDecideInList(lars, 'per_lars', item())).toMatchObject({
      allowed: false,
      why: 'role',
    })
    expect(
      canDecideInList(contributor, 'per_maria', item({ proposerId: 'per_jon' })),
    ).toMatchObject({ allowed: false, why: 'role' })
  })

  it('lets an admin decide any proposal in any domain', () => {
    expect(canDecideInList(ravi, 'per_ravi', term())).toEqual({ allowed: true })
    expect(canDecideInList(ravi, 'per_ravi', term({ areaId: null }))).toEqual({ allowed: true })
    expect(canDecideInList(ravi, 'per_ravi', item())).toEqual({ allowed: true })
    expect(canDecideInList(ravi, 'per_ravi', item({ areaId: 'area_marketing' }))).toEqual({
      allowed: true,
    })
  })

  it('lets an admin and an owner of its domain decide their own, and nobody else', () => {
    for (const riskLevel of ['low', 'normal', 'high'] as const) {
      expect(
        canDecideInList(ravi, 'per_ravi', item({ proposerId: 'per_ravi', riskLevel })),
      ).toEqual({ allowed: true })
      expect(canDecideInList(jon, 'per_jon', item({ proposerId: 'per_jon', riskLevel }))).toEqual({
        allowed: true,
      })
    }
    expect(canDecideInList(ravi, 'per_ravi', term({ proposerId: 'per_ravi' }))).toEqual({
      allowed: true,
    })
    expect(canDecideInList(jon, 'per_jon', term({ proposerId: 'per_jon' }))).toEqual({
      allowed: true,
    })
    // An owner of another domain, a contributor and an approver who is neither do not.
    expect(
      canDecideInList(jon, 'per_jon', item({ proposerId: 'per_jon', areaId: 'area_marketing' })),
    ).toMatchObject({ allowed: false, why: 'proposer' })
    expect(
      canDecideInList(contributor, 'per_maria', item({ proposerId: 'per_maria' })),
    ).toMatchObject({ allowed: false, why: 'proposer' })
    expect(
      canDecideInList(lars, 'per_lars', item({ proposerId: 'per_lars', riskLevel: 'high' })),
    ).toMatchObject({ allowed: false, why: 'proposer' })
  })

  it('selects nothing that does not wait for a decision', () => {
    for (const state of ['draft', 'changes_requested', 'accepted', 'withdrawn'] as const)
      expect(canDecideInList(jon, 'per_jon', item({ state }))).toMatchObject({
        allowed: false,
        why: 'waiting',
      })
  })

  it('says who can decide instead, by role and domain, and "another" for a role the person holds', () => {
    const own = denied(canDecideInList(contributor, 'per_maria', item({ proposerId: 'per_maria' })))
    expect(listDecisionWords(own, 'Sales', contributor)).toBe(
      "You can't decide a proposal you made. An owner of Sales, or an admin, can.",
    )
    const ownTerm = denied(
      canDecideInList(contributor, 'per_maria', term({ proposerId: 'per_maria', areaId: null })),
    )
    expect(listDecisionWords(ownTerm, 'No domain', contributor)).toBe(
      "You can't decide a proposal you made. An admin can.",
    )
    const ownHighRisk = denied(
      canDecideInList(lars, 'per_lars', item({ proposerId: 'per_lars', riskLevel: 'high' })),
    )
    expect(listDecisionWords(ownHighRisk, 'Sales', lars)).toBe(
      "You can't decide a proposal you made. Another owner or high-risk approver of Sales, or an admin, can.",
    )
    const highRisk = denied(canDecideInList(contributor, 'per_ella', item({ riskLevel: 'high' })))
    expect(listDecisionWords(highRisk, 'Sales', contributor)).toBe(
      "You can't decide this proposal. An owner or high-risk approver of Sales, or an admin, can.",
    )
    expect(
      listDecisionWords(denied(canDecideInList(jon, 'per_jon', item({ state: 'draft' }))), 'Sales'),
    ).toBe("It isn't waiting for a decision.")
  })

  it('sums up the rows the person cannot decide in one line above the list', () => {
    const row = (
      proposal: ListedProposal,
      areaName: string,
      [who, id]: [Permissions, string] = [contributor, 'per_maria'],
    ) => ({ decision: canDecideInList(who, id, proposal), areaName })
    const mine = { proposerId: 'per_maria' }
    // An administrator decides every row, their own too: nothing to sum up.
    expect(
      undecidableSummary(
        [
          row(term(), 'Sales', [ravi, 'per_ravi']),
          row(term({ proposerId: 'per_ravi' }), 'Sales', [ravi, 'per_ravi']),
        ],
        ravi,
      ),
    ).toBeNull()
    expect(
      undecidableSummary([row(item(mine), 'Sales'), row(term(mine), 'Sales')], contributor),
    ).toBe(
      "You can't decide these proposals, as you made them. An owner of Sales, or an admin, can.",
    )
    expect(
      undecidableSummary(
        [
          row(term(mine), 'Sales'),
          row(term({ ...mine, areaId: 'area_sandbox' }), 'Sandbox'),
          row(term({ ...mine, state: 'accepted' }), 'Sandbox'),
        ],
        contributor,
      ),
    ).toBe(
      "You can't decide these proposals, as you made them. For each, an owner of its domain, or an admin, can.",
    )
    expect(
      undecidableSummary(
        [
          row(item(), 'Sales', [jon, 'per_jon']),
          row(item({ areaId: 'area_marketing' }), 'Marketing', [jon, 'per_jon']),
        ],
        jon,
      ),
    ).toBe("You can't decide 1 of these proposals. An owner of Marketing, or an admin, can.")
  })
})

describe('usePermissions', () => {
  // The session comes from the mock API, whose first load can take over a second on a busy machine.
  const loaded = { timeout: 5_000 }
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>
  }

  it('answers no while the session loads, then follows the signed-in person', async () => {
    window.localStorage.setItem(MOCK_PERSON_KEY, 'per_jon')
    const { result } = renderHook(() => usePermissions(), { wrapper })
    expect(result.current.ready).toBe(false)
    expect(result.current.canReview('area_sales')).toBe(false)
    await waitFor(
      () => expect(result.current.roleLines).toEqual(['Owner of Sales and Sandbox']),
      loaded,
    )
    expect(result.current).toMatchObject({ ready: true, personId: 'per_jon', isAdmin: false })
    expect(result.current.canReview('area_sandbox')).toBe(true)
    expect(
      result.current.canDecide(open({ proposerId: 'per_jon', riskLevel: 'high' })),
    ).toMatchObject({ allowed: true, capacity: 'owner' })
    expect(result.current.canDecide(open({ areaId: 'area_marketing' }))).toMatchObject({
      allowed: false,
    })
  })

  it('reads a contributor by default', async () => {
    const { result } = renderHook(() => usePermissions(), { wrapper })
    await waitFor(() => expect(result.current.roleLines).toEqual(['Contributor']), loaded)
    expect(result.current.personId).toBe('per_maria')
  })
})
