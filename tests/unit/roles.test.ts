import { describe, expect, it } from 'vitest'
import {
  giveChanges,
  grantKey,
  heldRoleName,
  lastSignInWords,
  leftWithoutOwner,
  removal,
  roleInSentence,
  stepCounts,
} from '@/lib/roles'

const areaName = (id: string) => ({ area_finance: 'Finance' })[id]

describe('role words', () => {
  it('names a role with its domain, and keeps the id of a domain that is gone', () => {
    expect(heldRoleName({ role: 'administrator', areaId: null }, areaName)).toBe('Admin')
    expect(heldRoleName({ role: 'owner', areaId: 'area_finance' }, areaName)).toBe(
      'Owner of Finance',
    )
    expect(heldRoleName({ role: 'approver', areaId: 'area_gone' }, areaName)).toBe(
      'Approver of area_gone',
    )
    // A history entry from before the deputy role went keeps its word.
    expect(roleInSentence({ role: 'deputy', areaId: 'area_finance' }, areaName)).toBe(
      'deputy of Finance',
    )
  })
})

describe('last sign-in words', () => {
  const now = '2026-10-13T09:00:00.000Z'
  it('counts days for a week, then names the day, with the year only when it differs', () => {
    expect(lastSignInWords(null, now)).toBe('Never')
    expect(lastSignInWords('2026-10-13T01:00:00.000Z', now)).toBe('Today')
    expect(lastSignInWords('2026-10-12T23:59:00.000Z', now)).toBe('Yesterday')
    expect(lastSignInWords('2026-10-08T12:00:00.000Z', now)).toBe('5 days ago')
    expect(lastSignInWords('2026-09-29T12:00:00.000Z', now)).toBe('29 Sept')
    expect(lastSignInWords('2025-12-01T12:00:00.000Z', now)).toBe('1 Dec 2025')
  })
})

/*
  The role changes a screen sends as one step (FR-804): giving a role to many people in many
  domains, which domains a removal leaves without an owner, and what a step did, in counts.
*/

describe('the changes of a step', () => {
  it('gives a role across Heed to each person', () => {
    expect(giveChanges(['per_kofi', 'per_ines'], 'auditor', ['area_marketing'])).toEqual([
      { op: 'grant', personId: 'per_kofi', role: 'auditor' },
      { op: 'grant', personId: 'per_ines', role: 'auditor' },
    ])
  })

  it('gives approvers in every domain chosen, each person in each', () => {
    expect(
      giveChanges(['per_kofi', 'per_ines'], 'approver', ['area_marketing', 'area_sandbox']),
    ).toEqual(
      ['area_marketing', 'area_sandbox'].flatMap((areaId) =>
        ['per_kofi', 'per_ines'].map((personId) => ({
          op: 'grant',
          personId,
          areaId,
          role: 'approver',
        })),
      ),
    )
  })

  it('adds an owner beside the ones a domain has, and removes nobody', () => {
    expect(giveChanges(['per_kofi'], 'owner', ['area_marketing', 'area_sandbox'])).toEqual([
      { op: 'grant', personId: 'per_kofi', areaId: 'area_marketing', role: 'owner' },
      { op: 'grant', personId: 'per_kofi', areaId: 'area_sandbox', role: 'owner' },
    ])
  })

  it('names the domains a removal would leave without an owner, and only those', () => {
    const domains = [
      { id: 'area_marketing', name: 'Marketing', ownerIds: ['per_tomas'] },
      {
        id: 'area_core',
        name: 'Core',
        ownerIds: ['per_jon', 'per_sofia', 'per_tomas'],
      },
      { id: 'area_new', name: 'New', ownerIds: [] },
    ]
    const owner = (personId: string, areaId: string) =>
      ({ personId, areaId, role: 'owner' }) as const
    const left = (removed: Parameters<typeof leftWithoutOwner>[0]) =>
      leftWithoutOwner(removed, domains).map((area) => area.name)
    expect(left([owner('per_tomas', 'area_marketing')])).toEqual(['Marketing'])
    // Core has three owners: removing one, or two, leaves one to review.
    expect(left([owner('per_jon', 'area_core')])).toEqual([])
    expect(left([owner('per_jon', 'area_core'), owner('per_sofia', 'area_core')])).toEqual([])
    expect(
      left([
        owner('per_jon', 'area_core'),
        owner('per_sofia', 'area_core'),
        owner('per_tomas', 'area_core'),
      ]),
    ).toEqual(['Core'])
    // Tomas owners two domains: leaving Core leaves Marketing his, and the other way round.
    expect(left([owner('per_tomas', 'area_core')])).toEqual([])
    // An approver's removal, or a domain with no owner to begin with, leaves nothing new.
    expect(left([{ personId: 'per_tomas', areaId: 'area_marketing', role: 'approver' }])).toEqual(
      [],
    )
  })

  it('removes a grant as it is held, and names it on the page', () => {
    const held = { personId: 'per_lars', areaId: 'area_marketing', role: 'approver' } as const
    expect(removal(held)).toEqual({ ...held, op: 'revoke' })
    expect(grantKey(held)).toBe('area_marketing.approver.per_lars')
    expect(grantKey({ personId: 'per_ravi', role: 'administrator' })).toBe('administrator.per_ravi')
  })

  it('counts what a step gave, removed and found already so', () => {
    expect(
      stepCounts({
        batchId: 'batch',
        changes: [
          { op: 'revoke', personId: 'per_tomas', areaId: 'area_x', role: 'owner', changed: true },
          { op: 'grant', personId: 'per_kofi', areaId: 'area_x', role: 'owner', changed: true },
          { op: 'grant', personId: 'per_lars', role: 'auditor', changed: false },
        ],
      }),
    ).toEqual({ given: 1, removed: 1, unchanged: 1 })
  })
})
