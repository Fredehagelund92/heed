import type { TestQuestion } from '../api/client.ts'

/*
  Invented test questions for the mock (FR-501): Sales has a small set, so a change there
  runs answer tests in the mock as it would on a service whose domain has questions. The other
  domains have none, like the service with an empty set: a high-risk change there cannot pass the
  whole-domain tests (the conformance suite runs on a world without these).

  One of them is the mock's regression (fixtures.ts, `regression`): it expects the note on net
  revenue and test accounts, and its caveat. It passes until the edition that ended the note on
  30 September, and fails the weekly run of 5 October.
*/

const updatedAt = '2026-09-30T08:00:00.000Z'

function question(
  id: string,
  natural: string,
  precise: string,
  metrics: string[],
  markets: string[] = [],
  expected: Pick<TestQuestion['expected'], 'must_deliver' | 'caveat'> = { must_deliver: [] },
): TestQuestion {
  return {
    id,
    area: 'area_sales',
    wordings: [
      { text: natural, kind: 'natural' },
      { text: precise, kind: 'precise' },
    ],
    scope: {
      metrics,
      ...(markets.length ? { dimension_filters: [{ dimension: 'market', values: markets }] } : {}),
    },
    expected: {
      ...expected,
      must_not_deliver: [],
      no_cause_claim: true,
      clarifying_question: false,
    },
    rubrics: [],
    risk: 'normal',
    source: 'Sales analysts, September 2026',
    status: 'active',
    split: 'development',
    revision: 1,
    setAsideReason: null,
    updatedAt,
  }
}

export const mockTestQuestions: readonly TestQuestion[] = [
  question(
    'units-sold-norway-august',
    'Why did units sold in Norway drop in August?',
    'What explains the change in units sold for market Norway between 1 and 31 August 2026?',
    ['units_sold'],
    ['norway'],
  ),
  question(
    'units-sold-source-lag',
    'Is yesterday’s count of units sold complete?',
    'Does the units sold figure reported for the latest day in the source tool include every order?',
    ['units_sold'],
  ),
  question(
    'orders-united-kingdom-september',
    'Why are orders low in the United Kingdom this week?',
    'What explains orders for market United Kingdom in the last seven days?',
    ['orders'],
    ['united_kingdom'],
  ),
  question(
    'orders-poland-provider',
    'Did the payment provider change affect orders in Poland?',
    'What changed for orders in market Poland after 22 September 2026?',
    ['orders'],
    ['poland'],
  ),
  question(
    'first-buyers-test-accounts',
    'Are test accounts counted as first-time buyers?',
    'Which accounts does first-time buyers leave out?',
    ['first_time_buyers'],
  ),
  question(
    'net-revenue-month-to-date',
    'How is net revenue in Spain doing this month?',
    'What should an analyst know about net revenue for market Spain, month to date?',
    ['net_revenue'],
    ['spain'],
    { must_deliver: ['itm_q2upr28v'], caveat: 'Net revenue excludes test accounts.' },
  ),
  question(
    'gross-sales-united-states-june',
    'Why are gross sales in the United States flat in June?',
    'What explains gross sales for market United States in June 2026?',
    ['gross_sales'],
    ['united_states'],
  ),
  question(
    'cpa-united-kingdom-campaign',
    'Why did acquisition costs in the United Kingdom change this autumn?',
    'What explains cost per acquisition for market United Kingdom from September 2026?',
    ['cost_per_acquisition'],
    ['united_kingdom'],
  ),
  question(
    'returns-weekend',
    'Are weekend returns delayed?',
    'Is there a known delay in returns reported on Saturdays and Sundays?',
    ['returns'],
  ),
]
