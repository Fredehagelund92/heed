import type { Gate, LevelResult, PreviewReply } from '@/api/client'
import type { Overlap } from '@/components/proposal/overlap-list'

/*
  Sample data for the proposal parts, in the shapes the service sends (review.get's gate, the
  result of proposals.preview, proposals.overlap). The design preview and the Storybook stories
  share it, so a screenshot and a story show the same thing. Names, domains and edition numbers
  are the fixtures'; the proposals are invented because the dev database holds none yet.
*/

export const LIVE_EDITION = '2026-10-07.2'
const RAN_AT = '2026-10-07T16:40:00Z'

const probeScope = {
  metrics: ['metric:orders'],
  filters: { 'dim:market': ['val:market/norway'] },
  window: { start: '2026-08-04', end: '2026-08-05' },
}
const probes = (passed: number, total: number) =>
  Array.from({ length: total }, (_, index) => ({
    name: ['inside', 'before_start', 'on_end_day', 'other_value:dim:market', 'other_metric'][
      index % 5
    ]!,
    scope: probeScope,
    expect: index === 0 ? ('delivered' as const) : ('silent' as const),
    actual: index === 0 ? ('delivered' as const) : ('silent' as const),
    passed: index < passed,
  }))

const questions = (total: number, worse = 0) =>
  Array.from({ length: total }, (_, index) => ({
    id: `gq_${String(index + 1).padStart(3, '0')}`,
    baseline: true,
    candidate: index >= worse,
    regression: index < worse,
  }))

const level = <Level extends LevelResult['level']>(
  name: Level,
  outcome: LevelResult['outcome'],
  details: Extract<LevelResult, { level: Level }>['details'],
) =>
  ({
    level: name,
    outcome,
    ranAt: outcome === 'not_run' ? null : RAN_AT,
    details,
  }) as LevelResult

const format = level('format', 'passed', { findings: [] })
const matching = level('matching', 'passed', { edition: LIVE_EDITION, probes: probes(7, 7) })
const delivery = level('delivery', 'passed', {
  status: 'matched',
  delivered: true,
  cut: false,
  replacedShown: [],
  questions: questions(31),
})
const impact = level('answer_impact', 'passed', {
  edition: LIVE_EDITION,
  run: 'run_impact',
  message: '2 test questions could change. None got worse.',
  questions: 2,
})

/** A normal-risk change that passed every check (the status page of #231). */
export const normalGate: Pick<Gate, 'required' | 'levels'> = {
  required: ['format', 'matching', 'delivery', 'answer_impact'],
  levels: [format, matching, delivery, impact],
}

/** A high-risk change whose five levels all passed (the review screen of #228). */
export const highGate: Pick<Gate, 'required' | 'levels'> = {
  required: ['format', 'matching', 'delivery', 'answer_impact', 'answer_full'],
  levels: [
    format,
    matching,
    delivery,
    level('answer_impact', 'passed', {
      edition: LIVE_EDITION,
      message: '3 test questions could change. None got worse.',
    }),
    level('answer_full', 'passed', {
      edition: LIVE_EDITION,
      message: 'All 31 test questions of the domain pass.',
    }),
  ],
}

/** Each outcome once: failed, could not finish, running and not run yet. */
export const mixedGate: Pick<Gate, 'required' | 'levels'> = {
  required: ['format', 'matching', 'delivery', 'answer_impact', 'answer_full'],
  levels: [
    format,
    matching,
    level('delivery', 'failed', {
      status: 'matched',
      delivered: true,
      cut: false,
      replacedShown: ['itm_jyfuvl07'],
      questions: questions(31, 2),
    }),
    level('answer_impact', 'not_run', {
      message: 'The answer tests are running against the live edition.',
      run: 'run_queued',
      runState: 'running',
    }),
    level('answer_full', 'error', {
      edition: LIVE_EDITION,
      message:
        'The answering AI gave no answer for gq_014. Run the checks again, or set the questions aside with a reason.',
    }),
  ],
}

/** A draft that fails its format check: levels 2 and 3 wait for it. */
export const formatFailedGate: Pick<Gate, 'required' | 'levels'> = {
  required: ['format', 'matching', 'delivery'],
  levels: [
    level('format', 'failed', {
      findings: [
        {
          code: 'format',
          field: 'evidence',
          message: 'Add a short quote from the source.',
          severity: 'error',
        },
        { code: 'email', field: 'summary', message: 'Text matches email', severity: 'error' },
      ],
    }),
    level('matching', 'not_run', {}),
    level('delivery', 'not_run', {}),
  ],
}

/** Results recorded without their details: a plain sentence, never an error. */
export const unreadableGate: Pick<Gate, 'required' | 'levels'> = {
  required: ['format', 'matching'],
  levels: [level('format', 'passed', {}), level('matching', 'failed', {})],
}

const report = {
  withheld: 0,
  links_withheld: 0,
  cut: false,
  cut_ids: [],
  checked: ['itm_prp231draft'],
  statements: ['No match does not prove that no caveat exists.'],
}

const norway: NonNullable<PreviewReply['items']>[number] = {
  id: 'itm_prp231draft',
  version: 1,
  edition: LIVE_EDITION,
  kind: 'event',
  title: 'Online sales to Norway stopped on 4 August 2026 after a new customs rule',
  summary:
    'Online sales to Norway stopped on 4 August 2026 after a new customs rule. Compare Orders against a market that was not affected.',
  validity: { start: '2026-08-04', end: null },
  claim_level: 'fact_only',
  risk: 'normal',
  freshness: 'verified',
  evidence: [
    {
      url: 'https://www.regulator.example/notices/2026-08',
      quote: 'Carriers must stop taking webshop parcels for Norway from 4 August 2026.',
      read_on: '2026-08-05',
    },
  ],
  // What an AI app receives names the role, never the person (FR-326).
  owner: { team: 'Sales', role: 'the owner of Sales' },
  links: [],
  match: 'exact',
}

/** The get_context reply for the draft of #231: one item matched. */
export const matchedReply: PreviewReply = {
  edition: LIVE_EDITION,
  status: 'matched',
  delivery_id: 'preview',
  items: [norway],
  check_report: { ...report, status: 'matched', matched: 1 },
  instructions: 'State the documented fact with its source and dates.',
}

/** Two items that conflict, one of them past its review date and one a partial match. */
export const conflictReply: PreviewReply = {
  ...matchedReply,
  status: 'conflict',
  items: [
    norway,
    {
      ...norway,
      id: 'itm_r8k2m4p1',
      kind: 'note',
      title: 'Norway online sales continued through August 2026 through the marketplaces',
      summary: 'Marketplaces kept taking orders in Norway through August 2026.',
      validity: { start: '2026-08-01', end: '2026-09-01' },
      claim_level: 'effect_stated',
      freshness: 'unverified',
      unverified_reason: 'past_review_date',
      applies_note: 'Applies to brand: Lucky North only.',
      // A live item, accepted before: it says how it was reviewed. The draft above has no review.
      reviewed: {
        accepted_on: '2026-08-02',
        accepted_by: 'the owner of Sales',
        in_edition: '2026-08-02.1',
      },
      evidence: [
        {
          url: 'https://news.example/norway',
          quote: 'Licensed brands continue.',
          read_on: '2026-08-10',
        },
      ],
    },
  ],
  check_report: { ...report, status: 'conflict', matched: 2, cut: true, cut_ids: ['itm_x'] },
}

export const noMatchReply: PreviewReply = {
  edition: LIVE_EDITION,
  status: 'no_match',
  items: [],
  check_report: { ...report, status: 'no_match', matched: 0 },
}

export const checkFailedReply: PreviewReply = {
  status: 'check_failed',
  check_report: { ...report, status: 'check_failed', matched: 0, checked: [] },
  instructions: 'Context checks could not run. Try again shortly.',
}

export const domains = {
  sales: { name: 'Sales', label: 'teal' as const },
  marketing: { name: 'Marketing', label: 'pink' as const },
}

export const fullOverlap: Overlap = {
  accepted: [
    {
      id: 'itm_jyfuvl07',
      title: 'Norway launch campaign started on 21 September 2025',
      kind: 'event',
      domain: domains.sales,
    },
  ],
  ownProposals: [
    {
      id: '7d0e1c52-3a54-4c8e-9a76-0c4f1b6d2a31',
      number: 226,
      title: 'First-time buyers exclude test accounts',
    },
  ],
  otherProposalExists: true,
}

export const statusOverlap: Overlap = {
  accepted: fullOverlap.accepted,
  ownProposals: [],
  otherProposalExists: true,
}

export const noOverlap: Overlap = { accepted: [], ownProposals: [], otherProposalExists: false }

export const longTitleOverlap: Overlap = {
  accepted: [
    {
      id: 'itm_l0ngt1tle',
      title:
        'Orders in every market moved to the new payment provider over two weekends in June 2026, and the first-time buyer counts for those weekends are lower because payment checks took longer',
      kind: 'guide',
      domain: domains.marketing,
    },
  ],
  ownProposals: [],
  otherProposalExists: false,
}
