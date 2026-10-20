import { createMockApi } from '@/api/mock-api'
import { createMockWorkflow } from '@/api/mock-workflow'
import { getFixtureItems } from '@/mocks/fixtures'
import { areas, FIXTURE_TODAY, people, roleGrants, vocabulary } from '@/mocks/reference-data'
import { describeContextApiLive } from '../conformance/context-api-live.ts'
import { conformancePeople, type SignedIn } from '../conformance/context-api-writes.ts'

// A world of its own, so these steps do not leak into other tests. The same suite runs against
// the real service in tests/integration/api-live.test.ts.
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

// The mock delivers each event as it is posted, so there is nothing to wait for.
describeContextApiLive('mock binding', () => apis, {
  personId: (id) => id,
  settle: () => Promise.resolve(),
})
