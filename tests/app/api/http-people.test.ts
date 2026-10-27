import { describe, expect, it } from 'vitest'
import { lastActiveOf, peopleOf } from '@/api/http-people'

// The workspace's people as the service lists them, in the app's shape (src/app/api/http-people.ts).
const now = new Date('2026-10-23T15:00:00Z')

describe('when someone last signed in, in words', () => {
  it.each([
    [null, 'Not yet'],
    ['2026-10-23T01:00:00Z', 'Today'],
    ['2026-10-22T23:59:00Z', 'Yesterday'],
    ['2026-10-20T09:00:00Z', '3 days ago'],
    ['2026-10-14T09:00:00Z', 'Last week'],
    ['2026-10-01T09:00:00Z', '3 weeks ago'],
    ['2026-09-10T09:00:00Z', 'Last month'],
    ['2026-05-01T09:00:00Z', 'A while ago'],
  ])('%s reads %s', (at, words) => {
    expect(lastActiveOf(at, now)).toBe(words)
  })
})

describe('the people and their domains', () => {
  it('names members by their role and domains, and an invite by its address, owning its domains', () => {
    const { people, domains } = peopleOf({
      now,
      domains: [
        { id: 'area_sales', name: 'Sales', owners: ['Jon Abara'], covers: '', text: '' },
        { id: 'area_marketing', name: 'Marketing', owners: [], covers: '', text: '' },
      ],
      members: [
        {
          id: 'p1',
          name: 'Jon Abara',
          initials: 'JA',
          email: 'jon@larchwood.example',
          role: 'admin',
          owns: ['area_sales', 'area_gone'],
          lastSignedInAt: '2026-10-23T08:00:00Z',
        },
      ],
      invites: [
        {
          id: 'i1',
          email: 'nina@larchwood.example',
          role: 'member',
          areaIds: ['area_marketing'],
          invitedBy: 'p1',
          sentAt: '2026-10-23T09:00:00Z',
          expiresAt: '2026-10-30T09:00:00Z',
          expired: false,
        },
      ],
    })
    expect(people).toEqual([
      {
        name: 'Jon Abara',
        role: 'Owner of Sales, admin',
        owns: ['area_sales'],
        admin: true,
        email: 'jon@larchwood.example',
        lastActive: 'Today',
      },
      {
        name: 'nina@larchwood.example',
        role: 'Invited',
        owns: ['area_marketing'],
        admin: false,
        email: 'nina@larchwood.example',
        invited: true,
        lastActive: 'Not yet',
      },
    ])
    expect(domains.map((d) => d.owners)).toEqual([['Jon Abara'], ['nina@larchwood.example']])
  })
})
