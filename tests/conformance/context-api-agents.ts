/**
 * Connect an agent and What an agent would get, the same against the mock binding
 * (tests/unit/mock-api.test.ts) and the http binding on the real service and PostgreSQL 18 with
 * the same 1,500 generated items (tests/integration/api.test.ts): any signed-in person reads
 * them, it lists every tool in the gateway's registry (src/server/mcp/tools.ts), and Try it
 * answers get_facts's reply for a typed scope and refuses a question, and reads a question as
 * a scope only when asked to open Try it on it.
 */
import { describe, expect, it } from 'vitest'
import type { ContextApi } from '../../src/web/api/client.ts'
import { personOnly, toolNames } from '../../src/server/mcp/tools.ts'
import { ApiError } from '../../src/web/api/errors.ts'
import { generateItems } from '../../db/seed/fixtures/items.ts'
import { areas } from '../../db/seed/fixtures/reference-data.ts'

const known = new Set(areas.map((area) => area.id))
// An item every agent gets in both worlds: accepted, for everyone, in any domain, not high risk.
const served = generateItems().find(
  (item) =>
    item.status === 'accepted' &&
    item.audience.kind === 'everyone' &&
    known.has(item.areaId) &&
    item.riskLevel !== 'high' &&
    item.checkFlag === null &&
    item.scope.metrics.length > 0,
)!
const market = served.scope.dimensionValues.find((value) => value.dimension === 'market')!
const scope = {
  metrics: [`metric:${served.scope.metrics[0]}`],
  dimension_filters: [{ dimension: 'dim:market', values: [`val:market/${market.value}`] }],
  window: { from: served.validity.start, to: served.validity.start },
}

export function describeContextApiAgents(name: string, getApi: () => ContextApi) {
  const api = () => getApi()
  describe(`ContextApi Connect and Try it conformance: ${name}`, () => {
    it('tells a person without a role every tool and the clients that may connect', async () => {
      const info = await api().getConnectInfo()
      expect(info.tools).toContainEqual({ tool: 'get_context', enabled: true, personOnly: false })
      expect(info.tools).toContainEqual({ tool: 'get_related', enabled: true, personOnly: false })
      expect(info.tools).toContainEqual({
        tool: 'suggest_context',
        enabled: true,
        personOnly: true,
      })
      expect(info.clients).toEqual([{ label: 'claude-code', name: 'Claude Code with a token' }])
    })

    it("lists every tool in the gateway's registry, so a new tool cannot be left off", async () => {
      const { tools } = await api().getConnectInfo()
      expect(tools.map((tool) => tool.tool).sort()).toEqual([...toolNames].sort())
      for (const tool of tools)
        expect(tool.personOnly, tool.tool).toBe(personOnly(tool.tool as (typeof toolNames)[number]))
    })

    it("answers get_facts's reply on the live edition, without a delivery", async () => {
      const tried = await api().tryIt(scope)
      expect(['matched', 'conflict']).toContain(tried.result.status)
      expect(tried.result.items?.map((item) => item.id)).toContain(served.id)
      expect(tried.result).not.toHaveProperty('delivery_id')
      expect(tried.result.scope_used).toMatchObject({
        metrics: scope.metrics,
        filters: { 'dim:market': [`val:market/${market.value}`] },
      })
      expect(tried.bytes).toBeLessThan(tried.limit)
      // What the agent may tell the person, first, in the same words in both bindings (FR-344).
      expect(Object.keys(tried.result)[0]).toBe('say')
      expect(tried.result.say).toMatch(
        /^\d+ facts? appl(y|ies) to \w+ in \w+ .+\. Only that was checked\./,
      )
    })

    it('says nothing is written down for exactly what was asked, and gives the agent the rule', async () => {
      const tried = await api().tryIt({
        ...scope,
        window: { from: '1999-01-01', to: '1999-01-31' },
      })
      expect(tried.result).toMatchObject({ status: 'no_match', items: [] })
      expect(tried.result.say).toMatch(
        /^Nothing is written down for \w+ in \w+ in January 1999\. Only that was checked\.$/,
      )
      expect(tried.result.next).toMatch(/^That does not prove there is no caveat/)
    })

    it('reads a question as a scope for Try it and the composer, and keeps nothing of it', async () => {
      const reading = await api().readTryItQuestion({
        question: 'Why did orders drop in Norway in August 2026?',
      })
      expect(reading).toEqual({
        about: [
          { key: 'metric:orders', name: 'Orders', kind: 'metric', dimension: null },
          {
            key: 'val:market/norway',
            name: 'Norway',
            kind: 'dimension_value',
            dimension: 'Market',
          },
        ],
        from: '2026-08-01',
        to: '2026-08-31',
        dates: { words: 'August 2026', reads_as: '1-31 Aug 2026 (UTC)', note: null },
        ambiguous: [],
        dates_problem: null,
        today: '2026-10-07',
        spans: [
          { start: 8, end: 14, keys: ['metric:orders'], dates: false },
          { start: 23, end: 29, keys: ['val:market/norway'], dates: false },
          { start: 33, end: 44, keys: [], dates: true },
        ],
      })
      expect(await api().readTryItQuestion({ question: 'What is going on?' })).toEqual({
        about: [],
        from: null,
        to: null,
        dates: null,
        ambiguous: [],
        dates_problem: null,
        today: '2026-10-07',
        spans: [],
      })
      // Words Heed cannot read as dates are named, with what it reads instead.
      const launch = await api().readTryItQuestion({ question: 'orders since the launch' })
      expect(launch.dates_problem).toMatchObject({ words: 'since the launch' })
      expect(launch.dates_problem?.message).toMatch(/^'since the launch' cannot be read as dates/)
    })

    it('reads a scope without dates at today and says so, and refuses a question', async () => {
      const open = await api().tryIt({ metrics: scope.metrics })
      expect(open.result).toMatchObject({
        scope_used: { window: { start: '2026-10-07', end: '2026-10-08' } },
        assumed_date: {
          date: '2026-10-07',
          time_zone: 'UTC',
          reason: 'no date given',
          sentence: 'I assumed today, 7 October 2026. Tell me if you meant a different period.',
        },
        options: [],
      })
      expect(open.result.say).toMatch(
        / I assumed today, 7 October 2026\. Tell me if you meant a different period\.$/,
      )
      expect(open.result.check_report.statements.at(-1)).toMatch(
        /^No dates were given, so today was assumed, 7 Oct 2026 \(UTC\)/,
      )
      const asked = await api()
        .tryIt({ ...scope, question: 'Why?' } as typeof scope)
        .catch((error: unknown) => error)
      expect(asked).toBeInstanceOf(ApiError)
      expect((asked as ApiError).kind).toBe('bad-request')
    })
  })
}
