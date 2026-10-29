import type { Draft } from '../../domain/draft.ts'
import type { ProposalState } from '../../domain/proposal-state.ts'
import { provenanceOf, type FieldMark, type MarkedField } from '../../domain/provenance.ts'
import { shiftDate } from '../../domain/validity.ts'
import type { MockWorkflow } from './mock-workflow.ts'

/**
 * Maria's proposals in the shared mock world: one in every state, written and reviewed over the
 * week before the fixture day, so the Proposals page and the status page open on believable
 * data (the front end plan's gap G15, for the mock). Other people write too, so Jon's To review
 * queue holds every state of the decision bar: one ready to accept, a high-risk one he claimed,
 * one a deputy claimed, one he wrote, one in a domain with no test questions, an overdue one and
 * a retirement. Every step goes through the same workflow a person uses, so the events, checks
 * and decisions are the ones the screens read in real use.
 */

const MARIA = 'per_maria'
const JON = 'per_jon'
const SOFIA = 'per_sofia'
const LARS = 'per_lars'
const ALEX = 'per_alex'
const INES = 'per_ines'
const KOFI = 'per_kofi'
const ELLA = 'per_ella'
const RAVI = 'per_ravi'

const evidence = (url: string, quote: string, date: string) => [{ url, quote, date }]

/** A complete draft for the Sales or Marketing domain, in the API's prefixed keys. */
function draft({
  kind,
  summaryMarkup,
  metrics,
  markets = [],
  start,
  end = null,
  areaId = 'area_sales',
  source,
}: {
  kind: NonNullable<Draft['kind']>
  summaryMarkup: string
  metrics: string[]
  markets?: string[]
  start: string
  end?: string | null
  areaId?: string
  source: [url: string, quote: string, date: string]
}): Draft {
  return {
    kind,
    summaryMarkup,
    scope: {
      metrics: metrics.map((metric) => `metric:${metric}`),
      dimensions: [],
      dimensionValues: markets.map((market) => ({
        dimension: 'dim:market',
        value: `val:market/${market}`,
      })),
    },
    validity: { start, end },
    evidence: evidence(...source),
    areaId,
  }
}

/**
 * The demo proposals' ids, by state. The mock counts its ids, so the same steps give the same
 * ids; stories link to a proposal by them, and a unit test keeps them equal to what the seed
 * makes.
 */
export const demoProposalIds = {
  accepted: '00000000-0000-4000-8000-000000000001',
  rejected: '00000000-0000-4000-8000-000000000010',
  withdrawn: '00000000-0000-4000-8000-000000000019',
  changes_requested: '00000000-0000-4000-8000-000000000035',
  in_review: '00000000-0000-4000-8000-00000000004b',
  submitted: '00000000-0000-4000-8000-000000000051',
  draft: '00000000-0000-4000-8000-000000000058',
} as const satisfies Record<ProposalState, string>

/**
 * The proposals in Jon's To review queue by the state of his decision bar, for the stories and
 * the tests of the review screen; a unit test keeps them equal to what the seed makes.
 */
export const demoReviewIds = {
  /** Kofi's change, claimed by Jon and raised to high risk: every check passed. */
  ready: '00000000-0000-4000-8000-00000000005a',
  /** Ines's high-risk event, claimed by Jon: one accept publishes it, as any other. */
  highRisk: '00000000-0000-4000-8000-000000000042',
  /** Alex's change, claimed by Sofia. */
  claimed: '00000000-0000-4000-8000-000000000028',
  /** Jon's own note in Sales, which he decides as its owner (FR-206). */
  proposer: '00000000-0000-4000-8000-000000000064',
  /** Kofi's high-risk change in Sandbox, which has no test questions: it needs only levels 1 to 3. */
  sandbox: '00000000-0000-4000-8000-00000000002f',
  /** Lars's guide, waiting since last week. */
  overdue: '00000000-0000-4000-8000-000000000007',
  /** Ravi's proposal to retire an item. */
  retire: '00000000-0000-4000-8000-000000000026',
  /** Ella's low-risk note in Sandbox. */
  low: '00000000-0000-4000-8000-000000000020',
  /** Alex's note, resubmitted after Jon asked for changes: it reads as what changed since. */
  resubmitted: '00000000-0000-4000-8000-00000000006a',
} as const

/** When the demo week's clock starts: before the first step of `seedDemoProposals`. */
export const demoStartsAt = (today: string) => `${shiftDate(today, -9)}T08:00:00.000Z`

/** Plays the demo week. `today` is the fixture day; the clock ends at noon on it. */
export function seedDemoProposals(workflow: MockWorkflow, today: string) {
  const maria = workflow.as(MARIA)
  const jon = workflow.as(JON)
  const sofia = workflow.as(SOFIA)
  const lars = workflow.as(LARS)
  const alex = workflow.as(ALEX)
  const ines = workflow.as(INES)
  const kofi = workflow.as(KOFI)
  const ella = workflow.as(ELLA)
  const ravi = workflow.as(RAVI)
  const day = (offset: number, time: string) => `${shiftDate(today, offset)}T${time}:00.000Z`
  const at = (offset: number, time: string) => workflow.travelTo(day(offset, time))

  // Accepted: a low-risk note Jon accepted, now live.
  at(-8, '10:02')
  let accepted = maria.createProposal({
    draft: draft({
      kind: 'note',
      summaryMarkup: 'First-time buyers excludes test accounts and accounts closed within a day.',
      metrics: ['first_time_buyers'],
      start: '2026-09-01',
      source: [
        'https://wiki.example/payments/first-time-buyers',
        'Test accounts and accounts closed within 24 hours are left out of the count.',
        '2026-09-28',
      ],
    }),
  })
  at(-8, '10:20')
  accepted = maria.submitProposal(accepted)
  // To review, overdue: Lars's guide has waited since last week.
  at(-8, '11:05')
  const churn = lars.createProposal({
    draft: {
      title: 'How to investigate a drop in Churn rate in Spain',
      ...draft({
        kind: 'guide',
        summaryMarkup:
          'How to investigate a drop in Churn rate in Spain: rule out the app tracking outage first, then compare with Poland.',
        metrics: ['churn_rate'],
        markets: ['spain'],
        start: '2026-09-01',
        source: [
          'https://wiki.example/customers/churn-playbook',
          'Check tracking and payment incidents before reading a churn drop as customer behaviour.',
          '2026-09-29',
        ],
      }),
    },
  })
  at(-8, '11:20')
  lars.submitProposal(churn)

  at(-7, '09:14')
  accepted = jon.claimProposal(accepted)
  at(-7, '09:31')
  jon.decide({
    id: accepted.id,
    revision: accepted.revision,
    outcome: 'accept',
    reason: 'Matches the definition in the payments wiki.',
  })

  // Rejected: an event Jon turned down, with the reason.
  at(-6, '14:05')
  let rejected = maria.createProposal({
    draft: draft({
      kind: 'event',
      summaryMarkup:
        'Orders in Poland dropped on 22 September 2026 after a payment provider change.',
      metrics: ['orders'],
      markets: ['poland'],
      start: '2026-09-22',
      source: [
        'https://status.example/payments/poland',
        'Card payments in Poland moved to the new provider on 22 September.',
        '2026-09-30',
      ],
    }),
  })
  rejected = maria.submitProposal(rejected)
  at(-5, '11:40')
  rejected = jon.claimProposal(rejected)
  at(-5, '11:52')
  jon.decide({
    id: rejected.id,
    revision: rejected.revision,
    outcome: 'reject',
    reason:
      'The provider change is already in the library for every market. Suggest a change to that fact instead.',
  })

  // Withdrawn: Maria took a Marketing note back before Tomas decided.
  at(-5, '15:10')
  let withdrawn = maria.createProposal({
    draft: draft({
      kind: 'note',
      summaryMarkup: 'Marketplace sign-ups in September were counted twice in Cube.',
      metrics: ['new_customers'],
      start: '2026-09-01',
      end: '2026-09-30',
      areaId: 'area_marketing',
      source: [
        'https://wiki.example/marketing/marketplace-sign-ups',
        'A duplicated feed doubled marketplace sign-ups for September.',
        '2026-10-01',
      ],
    }),
  })
  withdrawn = maria.submitProposal(withdrawn)
  at(-4, '10:03')
  maria.withdrawProposal({
    id: withdrawn.id,
    revision: withdrawn.revision,
    reason: 'Tomas fixed the feed in the source, so the numbers are right now.',
  })

  // To review in Sandbox: a low-risk note from Ella.
  at(-3, '10:15')
  const margin = ella.createProposal({
    draft: draft({
      kind: 'note',
      summaryMarkup:
        'Data for Gross margin before 7 June 2026 is incomplete for Sweden: the clothing feed started that day.',
      metrics: ['gross_margin'],
      markets: ['sweden'],
      start: '2026-01-01',
      end: '2026-06-07',
      areaId: 'area_sandbox',
      source: [
        'https://wiki.example/sandbox/sweden-clothing-feed',
        'The Sweden clothing feed was connected on 7 June 2026.',
        '2026-10-02',
      ],
    }),
  })
  at(-3, '10:30')
  ella.submitProposal(margin)

  // To review: Ravi proposes that an item nobody needs any more is retired.
  at(-3, '14:00')
  ravi.proposeRetirement({
    id: 'itm_phps9mci',
    reason:
      'Online share now leaves test accounts out at the source, so this note no longer helps.',
  })

  // To review, claimed by Sofia: Alex's change to a definition note.
  at(-2, '10:00')
  const conversion = alex.createProposal({
    itemId: 'itm_8mmwwc5n',
    draft: {
      title: 'Conversion rate counts sign-ups from 15 January 2024',
      summaryMarkup:
        'Conversion rate counts sign-ups, not visits, from 15 January 2024 in Germany.',
    },
  })
  const sent = alex.submitProposal(conversion)
  at(-2, '10:40')
  sofia.claimProposal(sent)

  // To review in Sandbox, which has no test questions: like every change, it needs levels 1 to 3.
  at(-2, '11:10')
  const taxChange = kofi.createProposal({
    itemId: 'itm_3l5dlg30',
    draft: {
      title: 'Compare Net revenue in Italy with markets that had the same tax change',
      summaryMarkup:
        'Compare Net revenue in @[Italy](val:market/italy) only with markets that had the same tax change in 2025; other markets mislead.',
      riskLevel: 'high',
    },
  })
  at(-2, '11:25')
  kofi.submitProposal(taxChange)

  // Changes requested: Jon asked for the customs notice; Maria answered.
  at(-2, '16:20')
  let norway = maria.createProposal({
    draft: draft({
      kind: 'event',
      summaryMarkup:
        'Online sales to @[Norway](val:market/norway) stopped on 4 August 2026 after a new customs rule.',
      metrics: ['units_sold'],
      markets: ['norway'],
      start: '2026-08-04',
      source: [
        'https://news.example/norway-online-sales-stopped',
        'The customs office ordered carriers to stop taking webshop parcels for Norway from 4 August.',
        '2026-08-05',
      ],
    }),
  })
  for (const time of ['16:24', '16:29', '16:33']) {
    at(-2, time)
    norway = maria.saveDraft({
      id: norway.id,
      revision: norway.revision,
      draft: norway.draft,
    })
  }
  at(-2, '16:38')
  norway = maria.submitProposal(norway)
  at(-1, '09:05')
  norway = jon.claimProposal(norway)
  at(-1, '09:12')
  const asked = jon.decide({
    id: norway.id,
    revision: norway.revision,
    outcome: 'request_changes',
    reason:
      "Please add the link to the customs notice and say whether orders in other markets are affected. We don't know when it ends, so set a date to check this again.",
  })
  at(-1, '09:30')
  maria.commentOnProposal({
    id: norway.id,
    revision: asked.proposal.revision,
    text: "Will do. The notice is in Norway's own language, so I will add the English summary as the quote.",
  })

  // To review: Ines's high-risk event, which Jon claimed. A high risk needs nothing more.
  at(-1, '10:05')
  const unitedStates = ines.createProposal({
    draft: {
      title: 'Regulator paused price promotions in the United States on 15 June 2026',
      ...draft({
        kind: 'event',
        summaryMarkup:
          "Regulator paused price promotions in @[United States](val:market/united_states) on 15 June 2026. Compare spend against a market that wasn't affected.",
        metrics: ['marketing_spend', 'gross_sales'],
        markets: ['united_states'],
        start: '2026-06-15',
        source: [
          'https://regulator.example/united-states/promotions-pause',
          'All price promotions in the United States are paused from 15 June 2026.',
          '2026-06-16',
        ],
      }),
      riskLevel: 'high',
    },
  })
  at(-1, '10:20')
  const paused = ines.submitProposal(unitedStates)
  at(-1, '11:02')
  const reviewing = jon.claimProposal(paused)
  at(-1, '11:41')
  const checked = jon.commentOnProposal({
    id: reviewing.id,
    revision: reviewing.revision,
    text: 'Regulator notice checked. The start date matches the notice. Is the end date known yet?',
  })
  at(-1, '12:05')
  ines.commentOnProposal({
    id: checked.id,
    revision: checked.revision,
    text: 'Not yet. The regulator says it will announce the end at least a week ahead.',
  })

  // In review: a change to an accepted note, claimed by Jon this morning.
  at(-1, '13:45')
  let change = maria.createProposal({
    itemId: 'itm_yz287ldv',
    draft: {
      title: 'Units sold lags by two days in Cube',
      summaryMarkup:
        'Units sold lags by two days in Cube since the reporting upgrade on 1 October 2026.',
    },
    reason: 'It still says one day. Since the reporting upgrade it is two.',
  })
  change = maria.submitProposal(change)

  // Waiting for review: an open issue, still going on.
  at(0, '08:10')
  const issue = maria.createProposal({
    draft: draft({
      kind: 'issue',
      summaryMarkup: 'Reporting from the payment provider is down for the United Kingdom.',
      metrics: ['orders'],
      markets: ['united_kingdom'],
      start: shiftDate(today, -2),
      source: [
        'https://status.example/payments/united-kingdom',
        'Order reporting for the United Kingdom is delayed while the provider restores its feed.',
        shiftDate(today, -1),
      ],
    }),
  })
  at(0, '08:20')
  maria.submitProposal(issue)
  // Jon takes the change for review this morning.
  at(0, '08:40')
  jon.claimProposal(change)

  // Draft: started this morning, not sent yet.
  at(0, '09:41')
  maria.createProposal({
    draft: {
      kind: 'note',
      summaryMarkup: 'Discount cost in Spain includes a one-off welcome campaign in October.',
      scope: {
        metrics: ['metric:discount_cost'],
        dimensions: [],
        dimensionValues: [{ dimension: 'dim:market', value: 'val:market/spain' }],
      },
      validity: { start: '2026-10-01', end: null },
      areaId: 'area_marketing',
    },
  })

  // To review, ready to accept: Kofi says the United Kingdom campaign ended; Jon claimed it and
  // raised it to high risk, so every check ran again.
  at(0, '09:50')
  const campaign = kofi.createProposal({
    itemId: 'itm_kwiriumn',
    draft: {
      title: 'United Kingdom launch campaign ran from 21 February 2025 to 30 September 2026',
      summaryMarkup:
        'The United Kingdom launch campaign started on 21 February 2025 and ended on 30 September 2026. Compare acquisition costs before and after the end date.',
      validity: { start: '2025-02-21', end: '2026-10-01' },
      evidence: evidence(
        'https://wiki.example/marketing/united-kingdom-launch',
        'The United Kingdom launch campaign closed on 30 September 2026.',
        '2026-10-02',
      ),
    },
    reason: 'It has no end date, but the campaign closed on 30 September.',
  })
  at(0, '10:05')
  const ended = kofi.submitProposal(campaign)
  at(0, '10:30')
  const mine = jon.claimProposal(ended)
  at(0, '10:42')
  jon.editReview({
    id: mine.id,
    revision: mine.revision,
    riskLevel: 'high',
    reason:
      'An end date changes how agents compare acquisition costs for every United Kingdom question.',
  })

  // To review, Jon wrote it: someone else must decide.
  at(0, '11:15')
  const own = jon.createProposal({
    draft: {
      ...draft({
        kind: 'note',
        summaryMarkup:
          'Net revenue for September 2026 includes a one-off correction for August discounts.',
        metrics: ['net_revenue'],
        start: '2026-09-01',
        end: '2026-10-01',
        source: [
          'https://wiki.example/finance/september-close',
          'September net revenue includes the August discount correction.',
          '2026-10-03',
        ],
      }),
      riskLevel: 'normal',
    },
  })
  at(0, '11:20')
  jon.submitProposal(own)

  // To review again: Jon asked Alex for the source and the market; Alex resubmitted with both.
  at(0, '11:24')
  const giftCards = alex.createProposal({
    draft: draft({
      kind: 'note',
      summaryMarkup: 'Units sold leaves out gift cards from 1 October 2026.',
      metrics: ['units_sold'],
      start: '2026-10-01',
      source: [
        'https://wiki.example/finance/units-sold',
        'Gift cards are no longer counted in units sold.',
        '2026-10-02',
      ],
    }),
  })
  const firstSent = alex.submitProposal(giftCards)
  at(0, '11:31')
  const claimedGiftCards = jon.claimProposal(firstSent)
  at(0, '11:36')
  const askedAlex = jon.decide({
    id: claimedGiftCards.id,
    revision: claimedGiftCards.revision,
    outcome: 'request_changes',
    reason: 'Which markets does this cover? Link the finance notice itself, not the wiki summary.',
  })
  at(0, '11:48')
  const edited = alex.saveDraft({
    id: giftCards.id,
    revision: askedAlex.proposal.revision,
    draft: draft({
      kind: 'note',
      summaryMarkup:
        'Units sold leaves out gift cards in @[Germany](val:market/germany) from 1 October 2026.',
      metrics: ['units_sold'],
      markets: ['germany'],
      start: '2026-10-01',
      source: [
        'https://finance.example/notices/gift-cards-germany',
        "From 1 October 2026 gift cards in Germany aren't counted in units sold.",
        '2026-10-02',
      ],
    }),
  })
  at(0, '11:52')
  const replied = alex.commentOnProposal({
    id: giftCards.id,
    revision: edited.revision,
    text: 'Only Germany. I linked the finance notice and quoted it.',
  })
  alex.submitProposal({ id: giftCards.id, revision: replied.revision })

  // What a person does next happens after the story, from noon on the fixture day.
  at(0, '12:00')
}

/**
 * The gaps' part of the demo: Jon started a draft from the gap about units sold in Spain and
 * began to write it, so that gap reads "Draft started" with its draft linked; and he linked the
 * regression's test question to the gap about net revenue in Spain. Runs after
 * `seedDemoProposals`, at noon on the fixture day.
 */
export function seedDemoGaps(workflow: MockWorkflow) {
  const jon = workflow.as(JON)
  const draft = jon.startDraftFromGap({ id: demoGapIds.draftStarted })
  jon.saveDraft({
    id: draft.id,
    revision: draft.revision,
    draft: {
      ...draft.draft,
      kind: 'note',
      summaryMarkup:
        'Units sold in Spain counts paid orders only, from the definition change of 1 September 2026.',
    },
  })
  // As the service's demo seed (db/seed/demo.ts): the regression's test question is linked to the
  // open gap on its scope, naming the failing weekly run that led to the link (FR-610).
  const failing = jon
    .listEvalRuns({ area: 'area_sales', limit: 50 })
    .find((run) => run.kind === 'scheduled')
  if (failing)
    jon.linkGapTest({
      id: demoGapIds.regression,
      question: 'net-revenue-month-to-date',
      evidenceRun: failing.id,
    })
}

/** The fixture gaps the demo and the stories point at (db/seed/fixtures/gaps.ts). */
export const demoGapIds = {
  /** Orders in Norway: open, Sales, notes from an agent and from Jon. */
  open: 'ca9a0000-0000-4000-8000-000000000001',
  /** Units sold in Spain: the demo starts a draft from it. */
  draftStarted: 'ca9a0000-0000-4000-8000-000000000002',
  /** Active customers and marketing spend: the topic spans domains. */
  spansDomains: 'ca9a0000-0000-4000-8000-000000000005',
  /** Returns in the United Kingdom: a person reported it, and every count is below the minimum. */
  smallCounts: 'ca9a0000-0000-4000-8000-000000000008',
  /**
   * Return on ad spend in paid search: people reported it five times in one week, which only its
   * owners and admins see.
   */
  fromPeople: 'ca9a0000-0000-4000-8000-000000000009',
  /**
   * Net revenue in Spain in October: open since the note it needs was ended, the mock's
   * regression (mocks/fixtures.ts). Its first week is below the minimum.
   */
  regression: 'ca9a0000-0000-4000-8000-00000000000a',
} as const

const PRIYA = 'per_priya'
/** The marks the MCP draft tool gives a draft (src/domain/agent-draft.ts, FR-121). */
const agentMarks: Partial<Record<MarkedField, FieldMark>> = {
  kind: 'prefilled',
  title: 'prefilled',
  summary: 'prefilled',
  body: 'prefilled',
  scope: 'prefilled',
  validity: 'prefilled',
  evidence: 'prefilled',
  areaId: 'derived',
  ownerId: 'derived',
  reviewDate: 'derived',
  references: 'derived',
  changeMarks: 'derived',
  claimLevel: 'default',
  riskLevel: 'default',
  audience: 'default',
  notToConclude: 'default',
  replaces: 'not_inferred',
  conflicts: 'not_inferred',
}
/** The marks, when Priya answered the tool's questions about the dates and the source in Claude Code. */
const answered = {
  provenance: (saved: Draft) =>
    provenanceOf('agent', { ...agentMarks, validity: 'confirmed', evidence: 'confirmed' }, saved),
}

/** Priya's drafts that an AI agent wrote for her: one still a draft, one waiting for Tomas. */
export const demoAgentIds = {
  draft: '00000000-0000-4000-8000-00000000007c',
  review: '00000000-0000-4000-8000-00000000007e',
} as const

/**
 * Drafts an AI agent saved for Priya with `draft_context` (FR-121), each field marked with where it
 * came from: one she has not submitted yet, and one she submitted, which waits for Tomas in
 * Marketing and reads like a regulatory matter. Her agent asked her about the dates and the
 * source of both, so those are confirmed. Runs after `seedDemoGaps`.
 */
export function seedDemoAgentDrafts(workflow: MockWorkflow) {
  const priya = workflow.as(PRIYA)
  priya.createProposal(
    {
      channel: 'mcp',
      draft: {
        title: 'Discount cost in France arrives a day late',
        ...draft({
          kind: 'issue',
          summaryMarkup:
            'Discount cost for France arrives a day late since 6 October 2026, while the discount tool moves to a new server.',
          metrics: ['discount_cost'],
          markets: ['france'],
          start: '2026-10-06',
          areaId: 'area_marketing',
          source: [
            'https://status.example/discount-tool/france',
            'Discount data for France arrives one day later than usual.',
            '2026-10-07',
          ],
        }),
      },
    },
    answered,
  )
  const sent = priya.createProposal(
    {
      channel: 'mcp',
      draft: draft({
        kind: 'event',
        summaryMarkup:
          'The regulator paused price promotions in Norway on 2 October 2026, so Marketing spend there drops to zero.',
        metrics: ['marketing_spend'],
        markets: ['norway'],
        start: '2026-10-02',
        areaId: 'area_marketing',
        source: [
          'https://news.example/norway/promotions-pause',
          'The regulator ordered retailers to stop price promotions in Norway from 2 October.',
          '2026-10-06',
        ],
      }),
    },
    answered,
  )
  priya.submitProposal(sent)
}

/**
 * The `own-proposals` scenario: Ravi, the administrator, proposed the model's open members as
 * terms himself, as the pilot's administrator does after setting it up. An administrator decides
 * their own proposals, so his To review lists them, ready to accept (FR-206, FR-223).
 */
export function seedOwnTerms(workflow: MockWorkflow) {
  const ravi = workflow.as('per_ravi')
  const terms = ravi
    .listTermCandidates()
    .slice(0, 6)
    .map((candidate) => ({
      key: candidate.key,
      kind: candidate.kind,
      parentKey: null,
      name: candidate.name,
      aliases: candidate.aliases,
      // A metric needs a domain; a dimension many views share has none.
      areaId: candidate.areaId ?? (candidate.kind === 'metric' ? 'area_sales' : null),
      definitionRefs: candidate.definitionRefs,
    }))
  if (terms.length) ravi.proposeTerms({ terms, sourceName: 'Cube' })
}
