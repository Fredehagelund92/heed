import type { Draft } from '../../domain/draft.ts'
import type { Audience, CheckFlag } from '../../domain/item.ts'
import type { ItemVersion } from '../../domain/item-version.ts'
import { ownCaveat } from '../../domain/proposal-rules.ts'
import { explainApplicability, type Applicability } from '../../domain/applicability.ts'
import {
  coverageStatement,
  resolve,
  type EditionBundle,
  type ResolveRequest,
} from '../../domain/resolver.ts'
import { contextSaid } from '../../domain/say.ts'
import { assumedDate, type ScopeResult } from '../../domain/scope.ts'
import { overlaps, shiftDate } from '../../domain/validity.ts'
import { acceptedByRole, ownerRole, type ServedReview } from '../../domain/served-review.ts'
import type { PreviewInput, PreviewReply } from './client.ts'
import type { MockWorld } from './mock-workflow.ts'

/** An item as the mock serves it: a version's fields, its id and version, and its flag. */
export type MockServedItem = Pick<
  ItemVersion,
  | 'kind'
  | 'areaId'
  | 'title'
  | 'summary'
  | 'body'
  | 'scope'
  | 'validity'
  | 'reviewDate'
  | 'claimLevel'
  | 'riskLevel'
  | 'evidence'
  | 'ownerId'
  | 'conflicts'
  | 'notToConclude'
> & {
  id: string
  version: number
  checkFlag: CheckFlag | null
  proposerId: string
  /** A fixture item may be for a narrower audience; a draft is for everyone. */
  audience: Audience
  /** How the served version was accepted (FR-326); a draft in a preview has none. */
  review?: ServedReview | null
}

/** What the mock's edition serves besides its items: each metric's domain, and the stops. */
export type MockServing = Pick<EditionBundle, 'stopped' | 'metricArea'>

/**
 * get_facts's reply over the mock's items, from the delivery resolver itself: it does not turn
 * every scope into a match. The mock follows no links, so an item names none.
 */
export function mockReply(
  world: MockWorld,
  items: readonly MockServedItem[],
  scope: ScopeResult,
  edition: string,
  serving: MockServing,
  /** The names of the terms, for the reply's sentences ("Orders in Norway"). */
  terms: readonly { key: string; name: string }[] = [],
): PreviewReply {
  const byId = new Map(items.map((item) => [item.id, item]))
  const bundle = mockBundle(items, edition, serving)
  const result = resolve(bundle, agentRequest(world, scope))
  // What an agent receives names roles, never people (FR-326).
  const domain = (id: string) => world.areas.find((area) => area.id === id)?.name ?? id
  // A question without dates is read at today, and the reply says so, as get_facts does.
  const assumed = scope.status === 'resolved' && scope.assumed ? assumedDate(scope.assumed) : null
  const read = (scope.status === 'resolved' && scope.dates) || null
  // What the person hears and what the agent does next, in the service's own sentences (FR-344).
  const said = contextSaid(
    { terms },
    {
      status: result.status,
      scope: result.scope,
      issues: result.issues,
      question: '',
      delivered: result.items.length,
      partial: result.items.filter((hit) => hit.match === 'partial').length,
      unverified: result.items.filter((hit) => hit.unverified).length,
      cut: result.cut.length,
      withheld: result.withheld.map((w) => w.reason),
      assumed: assumed?.note.sentence ?? null,
      readsAs: read?.reads_as ?? null,
    },
  )
  return {
    say: said.say,
    ...(said.next ? { next: said.next } : {}),
    status: result.status,
    edition,
    scope_used: result.scope,
    ...(assumed ? { assumed_date: assumed.note } : {}),
    items: result.items.map((hit) => {
      const version = byId.get(hit.id)!
      return {
        id: hit.id,
        version: hit.version,
        edition,
        kind: version.kind,
        title: version.title,
        summary: version.summary,
        ...(version.body === undefined ? {} : { body: version.body }),
        validity: version.validity,
        claim_level: version.claimLevel,
        risk: version.riskLevel,
        freshness: hit.unverified ? 'unverified' : 'verified',
        ...(hit.unverified ? { unverified_reason: hit.checkFlag ?? 'past_review_date' } : {}),
        evidence: version.evidence.map(({ url, quote, date }) => ({ url, quote, read_on: date })),
        ...(ownCaveat(version.notToConclude)
          ? { not_to_conclude: ownCaveat(version.notToConclude)! }
          : {}),
        owner: { team: null, role: ownerRole(domain(version.areaId)) },
        ...(version.review
          ? {
              reviewed: {
                accepted_on: version.review.acceptedOn,
                accepted_by: acceptedByRole(
                  version.review.acceptedAs,
                  domain(version.review.areaId),
                ),
                in_edition: version.review.edition,
              },
            }
          : {}),
        links: [],
        // Its page in Heed, as the service gives it without a web address (FR-347).
        url: `/library/${encodeURIComponent(hit.id)}`,
        match: hit.match,
        ...(hit.restrictions.length
          ? {
              applies_note: hit.restrictions
                .map((r) => `Applies to ${r.dimension}: ${r.values.join(', ')} only.`)
                .join(' '),
            }
          : {}),
      }
    }),
    options: result.issues,
    check_report: {
      status: result.status,
      matched: result.report.matched,
      withheld: result.report.withheld,
      links_withheld: 0,
      cut: result.report.cut,
      cut_ids: result.cut,
      checked: result.report.checked,
      statements: [coverageStatement, ...(assumed ? [assumed.statement] : [])],
    },
    instructions: assumed ? `${result.instructions} ${assumed.instruction}` : result.instructions,
  }
}

/** The mock's served items as the resolver's edition. */
function mockBundle(
  items: readonly MockServedItem[],
  edition: string,
  serving: MockServing,
): EditionBundle {
  return {
    edition,
    overlay: '0',
    items: items.map((item) => ({ ...item, status: 'accepted' })),
    groupsOfMetric: {},
    ...serving,
  }
}

/** What an agent asks for: everyone's audience, nothing hidden, the mock's size limit. */
const agentRequest = (world: MockWorld, scope: ScopeResult): ResolveRequest => ({
  today: world.today,
  sizeLimit: 20000,
  dependenciesAvailable: true,
  groups: [],
  hiddenMetrics: [],
  scope,
})

/**
 * Whether one served item applies to a scope, and why or why not: the assistant's explain_item,
 * from the same resolver as the reply (FR-703, FR-709).
 */
export function mockExplain(
  world: MockWorld,
  items: readonly MockServedItem[],
  scope: ScopeResult,
  edition: string,
  serving: MockServing,
  itemId: string,
): Applicability {
  return explainApplicability(
    mockBundle(items, edition, serving),
    agentRequest(world, scope),
    itemId,
  )
}

/** The draft's reply as if it were accepted, alone in an edition of the live areas. */
export function mockPreview(
  world: MockWorld,
  version: ItemVersion,
  input: PreviewInput,
  edition: string,
  itemId: string,
): PreviewReply {
  const filters = Object.fromEntries(
    (input.dimension_filters ?? []).map(({ dimension, values }) => [dimension, values]),
  )
  const reply = mockReply(
    world,
    [{ ...version, id: itemId, version: 1, checkFlag: null }],
    input.window
      ? {
          status: 'resolved',
          scope: {
            metrics: input.metrics ?? [],
            filters,
            // The window's last day is inclusive, as in get_facts.
            window: { start: input.window.from, end: shiftDate(input.window.to, 1) },
          },
        }
      : { status: 'need_more_detail', issues: [] },
    edition,
    {
      metricArea: Object.fromEntries(version.scope.metrics.map((key) => [key, version.areaId])),
      stopped: { all: false, areas: [], items: [] },
    },
  )
  return { ...reply, delivery_id: 'preview' }
}

/**
 * The SQL overlap predicate (`cl_scopes_overlap`), over the mock's prefixed draft scopes. A
 * dimension with any value overlaps every value of its dimension, so it only counts as scope.
 */
export function draftsOverlap(a: Draft, b: Draft): boolean {
  if (!a.validity?.start || !b.validity?.start || !a.scope || !b.scope) return false
  const sa = a.scope
  const sb = b.scope
  if (
    !(sa.metrics.length + sa.dimensions.length + sa.dimensionValues.length) ||
    !(sb.metrics.length + sb.dimensions.length + sb.dimensionValues.length)
  )
    return false
  return (
    overlaps(a.validity, b.validity) &&
    (!sa.metrics.length || !sb.metrics.length || sa.metrics.some((m) => sb.metrics.includes(m))) &&
    !sa.dimensionValues.some(
      ({ dimension }) =>
        sb.dimensionValues.some((v) => v.dimension === dimension) &&
        !sa.dimensionValues.some(
          (x) =>
            x.dimension === dimension &&
            sb.dimensionValues.some((y) => y.dimension === dimension && x.value === y.value),
        ),
    )
  )
}
