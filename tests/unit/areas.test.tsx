import { describe, expect, it } from 'vitest'
import { refusals } from '../../src/contract/refusals.ts'
import { createMockWorkflow } from '@/api/mock-workflow'
import { invalidateAfter, queryKeys } from '@/api/queries'
import { QueryClient } from '@tanstack/react-query'
import { domainAbout, domainAboutProblems } from '@/lib/areas'
import { validateEvalsSearch } from '@/lib/search-params'
import { areas, FIXTURE_TODAY, people, roleGrants, vocabulary } from '@/mocks/reference-data'

function world() {
  return createMockWorkflow({
    today: FIXTURE_TODAY,
    people,
    areas: structuredClone(areas),
    vocabulary,
    items: () => [],
    ...roleGrants,
  })
}

const about = {
  summary: 'Revenue and payments, by market.',
  description: 'Sales covers **net revenue**.\n\n- Ask Jon first.',
}

describe('what a domain is (FR-813)', () => {
  it('keeps the Areas tab in a shared URL', () => {
    expect(validateEvalsSearch({ tab: 'areas' })).toMatchObject({ tab: 'areas' })
  })

  it('lists every domain with its summary and description, and no state', () => {
    const listed = world().as('per_maria').listAreas()
    expect(listed).toHaveLength(5)
    for (const area of listed) {
      expect(area.summary.length).toBeGreaterThan(0)
      expect(area.summary.length).toBeLessThanOrEqual(160)
      expect(area.description.length).toBeLessThanOrEqual(1500)
      expect(area).not.toHaveProperty('state')
    }
  })

  it("lets the domain's owner, its deputy or an administrator write it, and nobody else", () => {
    const mock = world()
    const commercial = () =>
      mock
        .as('per_maria')
        .listAreas()
        .find((a) => a.id === 'area_sales')!
    // Tomas is Marketing's owner, Maria a contributor.
    for (const who of ['per_tomas', 'per_maria'])
      expect(() => mock.as(who).describeArea({ id: 'area_sales', revision: 1, ...about })).toThrow(
        "Only the domain's owners and admins can describe it.",
      )
    const saved = mock.as('per_jon').describeArea({ id: 'area_sales', revision: 1, ...about })
    expect(saved).toMatchObject({ ...about, revision: 2 })
    expect(commercial()).toMatchObject({ ...about, revision: 2 })
    // The deputy and an administrator may too, on the revision they read.
    expect(() =>
      mock.as('per_sofia').describeArea({ id: 'area_sales', revision: 1, ...about }),
    ).toThrow('Someone changed this domain after you opened it.')
    mock
      .as('per_sofia')
      .describeArea({ id: 'area_sales', revision: 2, summary: 'One line.', description: '' })
    mock
      .as('per_ravi')
      .describeArea({ id: 'area_sales', revision: 3, summary: '', description: '' })
    expect(commercial()).toMatchObject({ summary: '', description: '', revision: 4 })
    // Each change is in the history log, with what it was before and after.
    const log = mock.as('per_ravi').searchAudit({ areaId: 'area_sales', limit: 3 })
    expect(log.entries.map((entry) => [entry.action, entry.details])).toEqual([
      ['area.changed', { from: { summary: 'One line.' }, to: { summary: '' } }],
      [
        'area.changed',
        {
          from: { summary: about.summary, description: about.description },
          to: { summary: 'One line.', description: '' },
        },
      ],
      [
        'area.changed',
        {
          from: { summary: areas[0]!.summary, description: areas[0]!.description },
          to: about,
        },
      ],
    ])
  })

  it('refuses a summary over one line or 160 characters, and a description over 1,500', () => {
    const owner = world().as('per_jon')
    for (const bad of [
      { ...about, summary: 'x'.repeat(161) },
      { ...about, summary: 'Two\nlines' },
      { ...about, description: 'x'.repeat(1501) },
    ])
      expect(() => owner.describeArea({ id: 'area_sales', revision: 1, ...bad })).toThrow(
        refusals.badRequest,
      )
  })

  it("keeps a person's email, phone number or a secret out of what a domain is", () => {
    const owner = world().as('per_jon')
    for (const bad of [
      { ...about, summary: 'Ask jon.abara@example.com' },
      { ...about, description: 'Call +44 (020) 555-0100 for access.' },
      { ...about, description: 'api_key: not-a-real-key' },
    ]) {
      expect(() => owner.describeArea({ id: 'area_sales', revision: 1, ...bad })).toThrow(
        'Remove the email address, phone number or secret',
      )
      const problems = domainAboutProblems(bad)
      expect(Object.values(problems)).toEqual([
        'Remove the email address, phone number or secret. Everyone can read this, and so can the assistant and AI apps.',
      ])
    }
  })

  it('says in the form what is wrong, and trims what it saves', () => {
    expect(domainAboutProblems({ summary: '', description: '' })).toEqual({})
    expect(domainAboutProblems({ summary: 'x'.repeat(161), description: '' })).toEqual({
      summary: 'Keep the summary to 160 characters.',
    })
    expect(domainAboutProblems({ summary: 'a\tb', description: 'x'.repeat(1501) })).toEqual({
      summary: 'Keep the summary to one line.',
      description: 'Keep the description to 1,500 characters.',
    })
    expect(domainAbout({ summary: '  Line ', description: '\n\nText\n\n' })).toEqual({
      summary: 'Line',
      description: 'Text',
    })
  })

  it('refreshes the domains, their detail and the history log after a description', async () => {
    const client = new QueryClient()
    const keys = [queryKeys.areas, queryKeys.areaDetail('area_sales'), queryKeys.audit]
    for (const key of keys) client.setQueryData(key, [])
    const input = { id: 'area_sales', revision: 1, ...about }
    await invalidateAfter(client, 'describeArea', input, world().as('per_jon').describeArea(input))
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    client.clear()
  })
})
