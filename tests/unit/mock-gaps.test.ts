import { createMockApi } from '@/api/mock-api'
import { createMockWorkflow } from '@/api/mock-workflow'
import { getFixtureItems } from '@/mocks/fixtures'
import { GAP_MINIMUM_COUNT, gapFixtures, gapTopics } from '@/mocks/gaps'
import { areas, FIXTURE_TODAY, people, roleGrants, vocabulary } from '@/mocks/reference-data'
import { describeContextApiGaps, gapPeople, type GapApis } from '../conformance/context-api-gaps.ts'

// A world of its own, holding the fixture gaps and nothing the demo adds. The same suite runs
// against the real service in tests/integration/gaps-api.test.ts.
const workflow = createMockWorkflow({
  today: FIXTURE_TODAY,
  areas,
  people,
  vocabulary,
  items: getFixtureItems,
  approvers: roleGrants.approvers,
  administrators: roleGrants.administrators,
  gaps: { topics: gapTopics, gaps: gapFixtures, minimum: GAP_MINIMUM_COUNT },
})
const apis = Object.fromEntries(
  gapPeople.map((person) => [
    person,
    createMockApi({ personId: () => `per_${person}`, workflow: () => Promise.resolve(workflow) }),
  ]),
) as GapApis

describeContextApiGaps('mock binding', () => apis)
