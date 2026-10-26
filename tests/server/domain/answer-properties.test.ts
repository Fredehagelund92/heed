import { expect, it } from 'vitest'
import fc from 'fast-check'
import {
  answer,
  answerStates,
  type AnswerBundle,
  type AnswerStepName,
} from '../../../src/domain/answer.ts'
import { metricsOf, type EditionBundle, type ResolveRequest } from '../../../src/domain/resolver.ts'
import { terms } from './fixtures.ts'
import { oracle } from './oracle.ts'
import { bundleArb, requestArb } from './resolver-arbitraries.ts'

/*
  The answer engine gives what get_context gives: the resolver's items for the reader's audience
  (no groups, no hidden metrics, no preview of a draft), cut to the item limit. These properties
  hold it to the resolver's independent full-scan oracle on the resolver's own boundary-heavy
  cases, and check the answer state, the left-out reasons and the steps around them.
*/

const asAnswerBundle = (bundle: EditionBundle): AnswerBundle => ({
  ...bundle,
  terms,
  items: bundle.items.map((item) => ({ ...item, kind: 'event', title: `Title of ${item.id}` })),
})
/** What get_context asks the resolver: the agent's audience, every size. */
const agentRequest = (request: ResolveRequest): ResolveRequest => {
  const { preview: _preview, ...rest } = request
  return { ...rest, groups: [], hiddenMetrics: [], sizeLimit: Number.MAX_SAFE_INTEGER }
}
const steps: AnswerStepName[] = ['read_scope', 'looked_up', 'left_out', 'checked', 'said']

it(
  'gives what the resolver oracle gives, cut to the item limit, with a state that follows it',
  { timeout: 60_000 },
  () => {
    const seen = new Set<string>()
    fc.assert(
      fc.property(
        bundleArb,
        requestArb,
        fc.integer({ min: 1, max: 9 }),
        (edition, raw, maxItems) => {
          const request = agentRequest(raw)
          if (request.scope.status !== 'resolved') return
          const scope = request.scope.scope
          const bundle = asAnswerBundle(edition)
          const expected = oracle(edition, request)
          const result = answer(bundle, { scope }, { today: request.today, maxItems })

          expect(result.status).toBe(expected.status)
          const given = expected.items.slice(0, maxItems)
          expect(
            result.items.map((item) => ({
              id: item.id,
              version: item.version,
              match: item.match,
              unverified: item.unverified,
              checkFlag: edition.items.find((i) => i.id === item.id)!.checkFlag,
              restrictions: item.restrictions,
              startsAfterQuestion: item.validity.start > scope.window.start,
            })),
          ).toEqual(given)
          const reasons = (reason: string) =>
            result.leftOut.filter((l) => l.reason === reason).map((l) => l.id)
          expect(reasons('cut')).toEqual(expected.items.slice(maxItems).map((m) => m.id))
          expect(
            result.leftOut
              .filter((l) =>
                ['source_visibility', 'stopped', 'high_risk_unverified'].includes(l.reason),
              )
              .map((l) => ({ id: l.id, reason: l.reason })),
          ).toEqual(expected.withheld.filter((w) => w.reason !== 'audience'))
          // An item for another group is counted, and never named: not given, not left out.
          const others = expected.withheld.filter((w) => w.reason === 'audience')
          expect(result.forAnotherGroup).toBe(others.length)
          for (const other of others) expect(JSON.stringify(result)).not.toContain(other.id)
          for (const miss of result.leftOut)
            expect(edition.items.find((i) => i.id === miss.id)!.audience).toEqual({
              kind: 'everyone',
            })

          // Nothing is both given and left out, and no draft reaches an agent.
          const ids = new Set(result.items.map((item) => item.id))
          expect(result.leftOut.filter((l) => ids.has(l.id))).toEqual([])
          for (const item of result.items)
            expect(edition.items.find((i) => i.id === item.id)!.status).toBe('accepted')
          // A near miss is about an asked metric (or its group), and the reason it missed holds.
          const asked = scope.metrics.flatMap((key) => [key, ...metricsOf(edition, key)])
          const related = new Set(
            asked.flatMap((key) => [key, ...(edition.groupsOfMetric[key] ?? [])]),
          )
          for (const miss of result.leftOut.filter((l) =>
            ['dates', 'values', 'dimension'].includes(l.reason),
          )) {
            const item = edition.items.find((i) => i.id === miss.id)!
            expect(item.scope.metrics.some((key) => related.has(key))).toBe(true)
            if (miss.reason === 'dates')
              expect(
                item.validity.start < scope.window.end! &&
                  (item.validity.end === null || scope.window.start < item.validity.end),
              ).toBe(false)
          }

          // The state follows what was given (FR-349).
          expect(answerStates).toContain(result.state)
          seen.add(result.state)
          for (const miss of result.leftOut) seen.add(miss.reason)
          if (result.forAnotherGroup) seen.add('another group')
          expect(result.state === 'missing').toBe(result.items.length === 0)
          expect(result.state === 'conflict').toBe(expected.status === 'conflict')
          const covered = !result.uncovered.metrics.length && !result.uncovered.values.length
          if (result.state === 'partial') expect(covered).toBe(false)
          if (result.state === 'stale')
            expect(covered && result.items.some((item) => item.unverified)).toBe(true)
          if (result.state === 'grounded')
            expect(covered && result.items.every((item) => !item.unverified)).toBe(true)
          for (const value of result.uncovered.values)
            expect(Object.values(scope.filters).flat()).toContain(value)

          // Five steps in order; with no clock they take no time.
          expect(result.steps.map((s) => s.step)).toEqual(steps)
          expect(result.ms).toBe(0)
          // The same answer whatever order the bundle holds its items in.
          expect(
            answer(
              { ...bundle, items: [...bundle.items].reverse() },
              { scope },
              { today: request.today, maxItems },
            ),
          ).toEqual(result)
        },
      ),
      { seed: 20261026, numRuns: 5_000 },
    )
    // The cases reach every state the resolver can lead to, and every reason an agent's answer
    // can have but `replaced` (the fixtures retire no item for another). Agents have no hidden
    // metrics, so nothing is left out as `source_visibility`.
    expect([...seen].sort()).toEqual(
      [
        'missing',
        'conflict',
        'partial',
        'stale',
        'grounded',
        'another group',
        'stopped',
        'high_risk_unverified',
        'cut',
        'dates',
        'values',
        'dimension',
      ].sort(),
    )
  },
)
