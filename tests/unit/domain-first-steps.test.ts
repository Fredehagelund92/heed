import { describe, expect, it } from 'vitest'
import {
  areaRemovalOutcome,
  confirmsDeletion,
  DELETE_DOMAIN_PHRASE,
  termFates,
  type AreaHoldings,
} from '@domain/area-removal'
import type { AreaRemoved } from '@/api'
import { deletedSummary, deletionEffect, deletionLines } from '@/lib/areas'
import { noDomainHint } from '@/lib/context-form'
import { areaFormProblems, areaIdFrom, type AreaFormValues } from '@/lib/settings'

/*
  The pilot's first session (15 Oct 2026): a first domain needs only its name; deleting a domain
  takes everything under it in one step, typed to confirm, and never leaves accepted context
  without a domain (16 Oct 2026); and a metric without a domain says what it needs.
*/

const nothing: AreaHoldings = {
  items: 0,
  terms: 0,
  openProposals: 0,
  sourceMembers: 0,
  drafts: 0,
  team: 0,
  history: false,
}

describe('deleting a domain in one step (FR-814)', () => {
  it('deletes one that holds nothing, team or not, keeps one as history otherwise, and never the demo', () => {
    expect(areaRemovalOutcome(nothing, false)).toBe('delete')
    expect(areaRemovalOutcome({ ...nothing, team: 2 }, false)).toBe('delete')
    expect(areaRemovalOutcome({ ...nothing, history: true }, false)).toBe('archive')
    for (const kind of ['items', 'terms', 'openProposals', 'sourceMembers', 'drafts'] as const)
      expect(areaRemovalOutcome({ ...nothing, [kind]: 1 }, false)).toBe('archive')
    expect(areaRemovalOutcome(nothing, true)).toBe('blocked')
  })

  it('asks for the words permanently delete exactly, not the domain name', () => {
    expect(DELETE_DOMAIN_PHRASE).toBe('permanently delete')
    expect(confirmsDeletion(' permanently delete ')).toBe(true)
    expect(confirmsDeletion('Permanently delete')).toBe(false)
    expect(confirmsDeletion('Traffic')).toBe(false)
    expect(confirmsDeletion('')).toBe(false)
  })

  it('retires a term nothing else uses, and keeps one another domain uses, with what it sits under', () => {
    const fates = termFates(
      [
        { key: 'group:baking', parentKey: null, usedElsewhere: false },
        { key: 'metric:loaves', parentKey: 'group:baking', usedElsewhere: false },
        { key: 'metric:visits', parentKey: 'group:baking', usedElsewhere: true },
        { key: 'dim:kiosk', parentKey: null, usedElsewhere: false },
        { key: 'val:kiosk/north', parentKey: 'dim:kiosk', usedElsewhere: false },
        { key: 'dim:flour', parentKey: null, usedElsewhere: false },
      ],
      // A value of another domain sits under `dim:flour`.
      new Set(['dim:flour']),
    )
    expect(Object.fromEntries(fates)).toEqual({
      'group:baking': 'kept',
      'metric:loaves': 'retired',
      'metric:visits': 'kept',
      'dim:kiosk': 'retired',
      'val:kiosk/north': 'retired',
      'dim:flour': 'kept',
    })
    expect(termFates([], new Set())).toEqual(new Map())
  })

  it('lists what happens to each kind, every one named, and nothing it does not hold', () => {
    const lines = deletionLines({
      name: 'Practice',
      outcome: 'archive',
      holdings: {
        ...nothing,
        items: 2,
        terms: 2,
        openProposals: 1,
        drafts: 1,
        team: 1,
        history: true,
      },
      items: [{ id: 'itm_aaaaaaaa', title: 'Kiosk closed', kind: 'event' }],
      terms: [
        { key: 'metric:loaves', name: 'Loaves', kind: 'metric', fate: 'retired' },
        { key: 'metric:visits', name: 'Visits', kind: 'metric', fate: 'kept' },
      ],
      openProposals: [{ id: 'p1', title: 'Oven repair', number: 12, subject: 'item' }],
      drafts: [{ id: 'd1', title: 'Started', author: 'Kofi Mensah' }],
      team: [{ personId: 'x', name: 'Ines Duarte', role: 'owner' }],
    })
    expect(lines.map((line) => [line.kind, line.title])).toEqual([
      ['items', '2 accepted facts'],
      ['terms', '2 names'],
      ['openProposals', '1 open proposal'],
      ['drafts', '1 draft'],
      ['team', '1 team role'],
      ['history', 'Its history'],
    ])
    expect(lines[0]).toMatchObject({
      detail: expect.stringMatching(
        /^They move to the Bin, and AI apps stop getting them at once/,
      ) as string,
      entries: [{ label: 'Kiosk closed', detail: 'Event' }],
      more: 1,
    })
    expect(lines[1]!.detail).toMatch(/1 name stays, without a domain/)
    expect(lines[1]!.entries[1]).toEqual({
      key: 'metric:visits',
      label: 'Visits',
      detail: 'Metric · stays, without a domain: another domain uses it',
    })
    expect(lines[2]!.detail).toBe(
      "They're withdrawn, with the reason Domain deleted. Its author is told.",
    )
    expect(lines[2]!.entries[0]!.detail).toBe('Proposal #12 · Fact')
    expect(lines[3]!.detail).toMatch(/Stays with its author, marked Domain deleted/)
    expect(lines[4]!.entries[0]).toMatchObject({ label: 'Ines Duarte', detail: 'Owner' })
    expect(
      deletionLines({
        name: 'Oops',
        outcome: 'delete',
        holdings: nothing,
        items: [],
        terms: [],
        openProposals: [],
        drafts: [],
        team: [],
      }),
    ).toEqual([])
  })

  it('says what deleting does in one sentence, and what it did after', () => {
    const base = { name: 'Traffic', demo: false }
    expect(deletionEffect({ ...base, outcome: 'delete' })).toMatch(/deleted for good/)
    expect(deletionEffect({ ...base, outcome: 'archive' })).toMatch(
      /you don't have to move anything first\. An admin can restore it later/,
    )
    expect(deletionEffect({ ...base, outcome: 'blocked', demo: true })).toMatch(/always stays/)
    expect(
      deletedSummary({
        outcome: 'archived',
        holdings: { ...nothing, items: 4, terms: 6, openProposals: 3, drafts: 1, team: 3 },
        edition: { label: '2026-10-16.2' } as AreaRemoved['edition'],
      }),
    ).toEqual([
      '4 facts moved to the Bin and 6 names left this domain. AI apps no longer get them.',
      '3 proposals withdrawn.',
      '1 draft kept for its author.',
      '3 team roles ended.',
      'Restore it from Deleted domains, below the domains.',
    ])
    expect(
      deletedSummary({
        outcome: 'deleted',
        holdings: nothing,
        edition: null,
      }),
    ).toEqual([
      "It's gone from every list and picker. The history log keeps a record that it existed.",
    ])
  })
})

describe('creating a first domain', () => {
  const values: AreaFormValues = {
    id: 'traffic',
    name: 'Traffic',
    label: 'teal',
    reviewDays: '5',
    chatChannel: '',
    ownerTeam: '',
    summary: '',
    description: '',
    reason: '',
  }

  it('suggests the id a view-to-domain file uses, starting with a letter', () => {
    expect(areaIdFrom('Paid media')).toBe('paid_media')
    expect(areaIdFrom('Ångström Café')).toBe('angstrom_cafe')
    expect(areaIdFrom('2026 plan')).toBe('area_2026_plan')
    expect(areaIdFrom('X')).toBe('area_x')
    expect(areaIdFrom('  ')).toBe('')
  })

  it('needs no reason for a new domain, and one for a change', () => {
    expect(areaFormProblems(values, true, [])).toEqual({})
    expect(areaFormProblems(values, false, [])).toEqual({
      reason: "Say why you're changing it.",
    })
  })
})

describe('a metric without a domain', () => {
  it('says why we cannot choose the domain, and who can give the metric one', () => {
    expect(noDomainHint(['Cost (EUR)'], false)).toBe(
      "Cost (EUR) has no domain yet, so we can't choose this fact's domain from it. Choose the domain the fact belongs to. Ask an admin to give it a domain.",
    )
    expect(noDomainHint(['A', 'B', 'C'], true)).toMatch(
      /^A, B and 1 more have no domain yet.* You can give a metric its domain in Administration › Sources/,
    )
  })
})
