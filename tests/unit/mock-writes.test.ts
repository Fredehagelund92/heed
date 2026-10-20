import { createMockApi } from '@/api/mock-api'
import { expect, it } from 'vitest'
import { proposalRecordSchema, type ProposalRecord } from '../../src/contract/proposals.ts'
import { createMockWorkflow } from '@/api/mock-workflow'
import { getFixtureItems } from '@/mocks/fixtures'
import { areas, FIXTURE_TODAY, people, roleGrants, vocabulary } from '@/mocks/reference-data'
import {
  conformancePeople,
  describeContextApiWrites,
  type SignedIn,
} from '../conformance/context-api-writes.ts'

// A world of its own, so these steps do not leak into other tests. The same suite runs against
// the real service in tests/integration/api-writes.test.ts.
const workflow = createMockWorkflow({
  today: FIXTURE_TODAY,
  areas,
  people,
  vocabulary,
  items: getFixtureItems,
  approvers: roleGrants.approvers,
  administrators: roleGrants.administrators,
})
const apis = Object.fromEntries(
  conformancePeople.map((person) => [
    person,
    createMockApi({ personId: () => `per_${person}`, workflow: () => Promise.resolve(workflow) }),
  ]),
) as SignedIn

describeContextApiWrites('mock binding', () => apis, { personId: (id) => id })

it('reads seeded vocabulary proposals with the same visibility and pagination as item proposals', async () => {
  const term: ProposalRecord = {
    id: '00000000-0000-4000-8001-000000000001',
    number: 100,
    subject: 'vocabulary',
    action: 'create',
    state: 'submitted',
    areaId: null,
    itemId: null,
    itemVersionId: null,
    vocabularyVersionId: '00000000-0000-4000-8001-000000000002',
    title: 'Product',
    reason: null,
    vocabulary: {
      key: 'dim:product',
      kind: 'dimension',
      name: 'Product',
      aliases: [],
      parentKey: null,
      areaId: null,
      definitionRefs: [],
    },
    proposerId: 'per_maria',
    channel: 'form',
    revision: 1,
    draft: {},
    provenance: null,
    findings: [],
    claimedBy: null,
    dueAt: null,
    createdAt: '2026-10-07T12:00:00Z',
    updatedAt: '2026-10-07T12:00:00Z',
  }
  const changed: ProposalRecord = {
    ...term,
    id: '00000000-0000-4000-8001-000000000003',
    number: 101,
    action: 'change',
    state: 'rejected',
    // Earlier than the original's noon UTC, despite its larger local clock time.
    createdAt: '2026-10-07T13:00:00+02:00',
  }
  const world = createMockWorkflow({
    today: FIXTURE_TODAY,
    areas,
    people,
    vocabulary,
    items: getFixtureItems,
    approvers: roleGrants.approvers,
    administrators: roleGrants.administrators,
    proposals: [term, changed],
  })
  const api = (person: string) =>
    createMockApi({ personId: () => person, workflow: () => Promise.resolve(world) })
  expect(proposalRecordSchema.parse(await api('per_maria').getProposal(term.id))).toEqual(term)
  expect(await api('per_maria').listProposals({ own: true, limit: 1 })).toEqual({
    rows: [term],
    total: 2,
    limit: 1,
    offset: 0,
  })
  expect(await api('per_maria').listProposals({ state: 'rejected' })).toMatchObject({
    rows: [changed],
    total: 1,
  })
  expect(await api('per_maria').listProposals({ offset: 2 })).toMatchObject({ rows: [], total: 2 })
  expect(await api('per_maria').listProposals({ areaId: 'area_sales' })).toMatchObject({
    rows: [],
    total: 0,
  })
  for (const person of ['per_kofi', 'per_jon']) {
    expect(await api(person).getProposal(term.id)).toBeNull()
    expect(await api(person).listProposals()).toMatchObject({ rows: [], total: 0 })
  }
  expect(await api('per_ravi').getProposal(term.id)).toEqual(term)
  expect(await api('per_ravi').listProposals()).toMatchObject({ total: 2 })
})
