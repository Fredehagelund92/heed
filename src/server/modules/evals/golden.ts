import {
  deliveryChecks,
  type Delivery,
  type DeliveryChecks,
  type DeliveryReply,
  type GoldenCase,
} from '../../../domain/golden-set.ts'
import { systemClock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { findContext } from '../../mcp/outcomes.ts'
import { findInput } from '../../mcp/schemas.ts'
import { loadServingBundle, type ServingBundle } from '../editions/index.ts'
import { deliverContext } from './retrieval.ts'
import { liveHead } from './runs.ts'

/**
 * Stage 1 of the output test plan: the golden set's L1 pass on the live edition, with no model
 * (USD 0). Every wording and every follow-up turn goes through get_context's own code at the
 * case's as-of date, as served: every domain is served, so there is one reply to check. It is the
 * full reply unless a case asks for the concise one, the agent contract's default (FR-342).
 * A definition case also checks the term points at the
 * Cube member it names, and whether Cube describes it; and that find_context's search, the tool
 * for a definition question (FR-338), gives the source's words and names where they come from, or
 * invents nothing for a name that is no metric; and that get_context gives the same definition
 * to the question as asked. A case may name metrics by the data tool's member names (CON-517).
 */

export type GoldenCheck = {
  /** Which call: a wording by its kind, or a follow-up turn by its place (`turn 1`). */
  call: string
  mode: 'served'
  status: string | null
  delivered: string[]
  checks: DeliveryChecks
}
export type GoldenL1Result = {
  id: string
  type: GoldenCase['type']
  area: string
  split: GoldenCase['split']
  passed: boolean
  calls: GoldenCheck[]
  definition: DeliveryChecks
  /** Every failed check as `call/mode/check`, for a readable failure. */
  failures: string[]
  /** Failed checks the case does not declare a known gap for. */
  unexpected: string[]
  /** Known failures (`mode/check`) that hold now: the gap closed, so the case needs updating. */
  resolved: string[]
}

async function described(tx: Queryable, ref: string): Promise<boolean | null> {
  const [row] = await tx.query<{ described: boolean }>(
    'select description_copy is not null as described from definitions where ref=$1',
    [ref],
  )
  return row?.described ?? null
}

async function definitionChecks(
  tx: Queryable,
  bundle: ServingBundle,
  c: GoldenCase,
): Promise<DeliveryChecks> {
  const d = c.definition
  if (!d) return {}
  const natural = c.wordings.find((w) => w.kind === 'natural') ?? c.wordings[0]!
  const found = findContext(bundle, findInput.parse({ query: natural.text }), c.as_of)
  const definitions = 'definitions' in found ? (found.definitions ?? []) : []
  // A name that is no term: nothing in the vocabulary may answer for it.
  // It may offer close names, named in part, but never answers for the name as if it were one.
  if (d.term === null)
    return { find_invents_nothing: !definitions.some((x) => x.named === 'exactly') }
  const term = bundle.terms.find((t) => t.key === d.term)
  const checks: DeliveryChecks = { term: term !== undefined }
  if (d.ref !== undefined)
    checks.definition_ref =
      term?.definitionRefs.includes(d.ref) === true &&
      term.definitions.some((definition) => definition.ref === d.ref && !definition.missing)
  if (d.ref !== undefined && d.described !== undefined)
    checks.described = (await described(tx, d.ref)) === d.described
  const answer = definitions.find((x) => x.key === d.term)
  checks.find_term = answer !== undefined
  if (d.ref !== undefined)
    checks.find_source = answer?.origin === 'source' && answer.source?.ref === d.ref
  if (d.described !== undefined)
    checks.find_words =
      (answer?.definition !== null && answer?.definition !== undefined) === d.described
  // get_context gives a definition question the same definition first, beside the items.
  if (c.scope) {
    const reply = (await deliverContext(bundle, systemClock(c.as_of), {
      question: natural.text,
      ...c.scope,
    })) as { definitions?: { key: string; definition: string | null; source?: { ref: string } }[] }
    const given = reply.definitions?.find((x) => x.key === d.term)
    checks.context_term = given !== undefined
    if (d.ref !== undefined) checks.context_source = given?.source?.ref === d.ref
    if (d.described !== undefined)
      checks.context_words = (given?.definition !== null && given !== undefined) === d.described
  }
  return checks
}

async function run(
  bundle: ServingBundle,
  asOf: string,
  input: object,
  expected: Delivery,
  call: string,
  mode: GoldenCheck['mode'],
): Promise<GoldenCheck> {
  const reply = (await deliverContext(bundle, systemClock(asOf), input)) as DeliveryReply
  return {
    call,
    mode,
    status: reply.status ?? null,
    delivered: (reply.context ?? []).map((i) => i.id),
    checks: deliveryChecks(expected, reply, JSON.stringify(reply)),
  }
}

/** The L1 pass of the given cases on the live edition, read in the caller's transaction. */
export async function goldenL1(
  tx: Queryable,
  cases: readonly GoldenCase[],
): Promise<GoldenL1Result[]> {
  const head = await liveHead(tx)
  if (!head) throw new Error('The golden set needs a live edition')
  const served = await loadServingBundle(tx, head)
  const results: GoldenL1Result[] = []
  for (const c of cases) {
    const calls: GoldenCheck[] = []
    const format = c.response_format ? { response_format: c.response_format } : {}
    if (c.scope)
      for (const wording of c.wordings)
        calls.push(
          await run(
            served,
            c.as_of,
            { question: wording.text, ...c.scope, ...format },
            c.delivery,
            wording.kind,
            'served',
          ),
        )
    for (const [index, turn] of (c.turns ?? []).entries())
      if (turn.scope)
        calls.push(
          await run(
            served,
            c.as_of,
            { question: turn.text, ...turn.scope, ...format },
            turn.delivery ?? { must_deliver: [], must_not_deliver: [] },
            `turn ${index + 1}`,
            'served',
          ),
        )
    const definition = await definitionChecks(tx, served, c)
    const failures = [
      ...calls.flatMap((k) =>
        Object.entries(k.checks)
          .filter(([, ok]) => !ok)
          .map(([name]) => `${k.call}/${k.mode}/${name}`),
      ),
      ...Object.entries(definition)
        .filter(([, ok]) => !ok)
        .map(([name]) => `definition/${name}`),
    ]
    const known = c.known_failures ?? []
    const gap = (failure: string) => failure.split('/').slice(-2).join('/')
    const unexpected = failures.filter((f) => !known.includes(gap(f)))
    const resolved = known.filter((k) => !failures.some((f) => gap(f) === k))
    results.push({
      id: c.id,
      type: c.type,
      area: c.area,
      split: c.split,
      passed: unexpected.length === 0 && resolved.length === 0,
      calls,
      definition,
      failures,
      unexpected,
      resolved,
    })
  }
  return results
}
