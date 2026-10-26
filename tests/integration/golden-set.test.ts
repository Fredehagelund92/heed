import { beforeAll, expect, it } from 'vitest'
import { bulkSeed } from '../../db/seed/bulk.ts'
import { goldenExtras, goldenLibrary } from '../../db/seed/golden-fixtures.ts'
import { loadGoldenSet } from '../../db/seed/golden-set.ts'
import { formatHeldOut, heldOutUnavailable } from '../../db/seed/held-out.ts'
import { heldOutL1 } from '../../db/seed/held-out-runs.ts'
import { answer } from '../../src/domain/answer.ts'
import { systemClock } from '../../src/server/clock.ts'
import { loadLiveBundle, type ServingBundle } from '../../src/server/modules/editions/index.ts'
import { deliver, goldenL1, type GoldenL1Result } from '../../src/server/modules/evals/index.ts'
import { testDatabase } from './support.ts'

const { client } = testDatabase()

/*
  Stage 1 of the output test plan: the golden set's L1 pass, with no model (USD 0). The golden
  library is the bulk seed's 1,500 items plus the fixtures; every case's wordings and follow-ups
  go through get_facts's own code at the case's as-of date, as served. A change to the library, the fixtures or get_facts that alters what any case is given
  fails here, until the case or the change is fixed (a known product gap is declared in the case
  and fails here once it closes). The held-out cases are sealed (FR-525): they run here only where
  they exist and the key holder gives the key, and say only how many passed and failed, by type.
*/
const { cases } = loadGoldenSet()
let results: GoldenL1Result[]
let served: ServingBundle
const tx = {
  query: async <Row extends object>(sql: string, values?: unknown[]) =>
    (await client.query(sql, values)).rows as Row[],
}

beforeAll(async () => {
  await client.query('reset role')
  await bulkSeed(client, goldenLibrary(), goldenExtras)
  results = await goldenL1(tx, cases)
  served = (await loadLiveBundle(tx))!
}, 600_000)

it('gives every golden case what it expects, as served', () => {
  const failed = results
    .filter((r) => !r.passed)
    .map((r) => ({ id: r.id, unexpected: r.unexpected, resolved: r.resolved }))
  expect(failed).toEqual([])
  expect(results).toHaveLength(cases.length)
  expect(results.flatMap((r) => r.calls).every((c) => c.mode === 'served')).toBe(true)
})

it('gives the held-out cases what they expect too, reported as counts only', async (context) => {
  const unavailable = heldOutUnavailable()
  if (unavailable) context.skip(unavailable)
  const run = await heldOutL1(tx)
  // Written out, as the runner's console of a passing test is not shown: counts only.
  process.stdout.write(`${formatHeldOut('agent cases (L1)', run)}\n`)
  expect(run.ran && run.counts.failed + run.counts.skipped).toBe(0)
})

/*
  Every domain that exists is served (the captain's decision, 14 October 2026; FR-320): a
  question about a metric gets the items of every domain about it, and the reply names the
  metric's domain with what its owner wrote about it (FR-813). Nothing says a domain is live or
  not.
*/
type DomainReply = {
  status: string
  items: { id: string }[]
  domains?: { id: string; name: string; summary?: string; description?: string }[]
  check_report: { statements: string[]; checked: string[] }
}
const areaOf = () => new Map(served.items.map((item) => [item.id, item.areaId]))

it("serves the items of every domain, and names the asked metric's domain with what it is", async () => {
  const c = cases.find((x) => x.id === 'gs-conflict-active-customers-mexico')!
  const w = c.wordings[0]!
  const ask = { question: w.text, ...c.scope }
  const reply = (await deliver(served, systemClock(c.as_of), ask)) as DomainReply
  const area = areaOf()
  // Active customers is Customer value's (Cube's domain). The items of every domain about it are
  // given: the Sandbox's conflict pair and Paid media's, which was not live before.
  expect(new Set(reply.items.map((i) => area.get(i.id)))).toEqual(
    new Set(['area_sandbox', 'area_marketing', 'area_paid_media']),
  )
  expect(reply.domains).toEqual([
    {
      id: 'area_customer_value',
      name: 'Customer value',
      summary: expect.stringContaining('Customers over their lifetime') as string,
      description: expect.stringContaining('**active customers**') as string,
    },
  ])
  expect(JSON.stringify(reply)).not.toMatch(/not live|area_not_live|domains_not_live|starting/)
  expect(reply.check_report.checked).not.toContain('area')
  // The concise reply names the domain and leaves what it is to the full reply and
  // domain_overview, so it stays within a few kB (FR-342).
  const concise = (await deliver(served, systemClock(c.as_of), {
    ...ask,
    response_format: 'concise',
  })) as DomainReply
  expect(concise.domains).toEqual([{ id: 'area_customer_value', name: 'Customer value' }])
})

/*
  Round 4 of the real-model test, "a different dead end": asked in the natural wording, the agent
  called get_facts with plain names and no dates, got need_more_detail with no items, and gave
  up, although with dates the same question got 6 of 6. The captain's decision (14 October 2026):
  a question without dates is read at today, and the reply says so. Stage 0 of the composer (option
  B, 14 October 2026) reads the dates the words give instead: "this past week" is the 7 days to the
  as-of day, the case's own window, so the call gets the case's items and assumes nothing.
*/
it('gives the round 4 question the dates its words give, and says how it read them', async () => {
  const c = cases.find((x) => x.id === 'gs-baseline-orders-united-kingdom')!
  const natural = c.wordings.find((w) => w.kind === 'natural')!
  expect(natural.text).toBe('How much did customers spend in the United Kingdom this past week?')
  type Dated = {
    status: string
    say: string
    items: { id: string }[]
    scope_used: { window: { start: string; end: string } }
    assumed_date?: Record<string, string>
    dates_read?: Record<string, string>
  }
  const clock = systemClock(c.as_of)
  const names = {
    metrics: ['Orders'],
    dimension_filters: [{ dimension: 'Market', values: ['United Kingdom'] }],
  }
  const reply = (await deliver(served, clock, { question: natural.text, ...names })) as Dated
  expect(reply).toMatchObject({
    status: 'matched',
    scope_used: { window: { start: c.scope!.window!.from, end: '2026-10-08' } },
    dates_read: {
      words: 'this past week',
      reads_as: '1-7 Oct 2026 (the 7 days to today; UTC)',
    },
  })
  expect(reply).not.toHaveProperty('assumed_date')
  expect(reply.say).toContain(
    'Orders in United Kingdom from 1 to 7 October 2026 (the 7 days to today)',
  )
  const ids = reply.items.map((i) => i.id)
  expect(ids).toContain(c.delivery.must_deliver[0])
  expect(ids).not.toContain(c.delivery.must_not_deliver[0])
  expect(ids.indexOf(c.delivery.must_deliver[0]!)).toBeLessThan(c.delivery.rank_max!)
  // The same question with the case's own dates gets the same items.
  const dated = (await deliver(served, clock, { question: natural.text, ...c.scope })) as Dated
  expect(dated.items.map((i) => i.id).sort()).toEqual([...ids].sort())
  expect(dated).not.toHaveProperty('dates_read')
  // Without any dates in the words, the question is read at today, and the reply says so.
  const today = (await deliver(served, clock, {
    question: 'How much did customers put into their accounts in the United Kingdom?',
    ...names,
  })) as Dated & { check_report: { statements: string[] }; instructions: string }
  expect(today).toMatchObject({
    status: 'matched',
    scope_used: { window: { start: '2026-10-07', end: '2026-10-08' } },
    assumed_date: {
      date: '2026-10-07',
      time_zone: 'UTC',
      reason: 'no date given',
      sentence: 'I assumed today, 7 October 2026. Tell me if you meant a different period.',
    },
  })
  expect(today.check_report.statements.join(' ')).toContain('today was assumed, 7 Oct 2026 (UTC)')
  expect(today.instructions).toContain('I assumed today, 7 October 2026')
})

/*
  The answer engine (src/domain/answer.ts) answers people the way get_context answers agents:
  Ask, Try it, the replay and the saved-question check read it. On every golden case, as asked
  at its as-of date, it gives what get_context gives: the status, the items in their order with
  their versions, matches and freshness, the items cut, the scope it read and the sentences. And it
  answers fast: under 50 ms at the 95th percentile on the golden library (the demo library and the
  fixtures).
*/
type Delivered = {
  status?: string
  say?: string
  next?: string
  scope_used?: unknown
  items?: { id: string; version: number; match: string; freshness: string }[]
  check_report?: { cut_ids: string[] }
}
it('gives what get_context gives on every golden case, and fast', async () => {
  const durations: number[] = []
  const compared: string[] = []
  for (const c of cases) {
    const format = c.response_format ? { response_format: c.response_format } : {}
    const asks = [
      ...(c.scope ? c.wordings.map((w) => ({ question: w.text, ...c.scope })) : []),
      ...(c.turns ?? []).flatMap((turn) =>
        turn.scope ? [{ question: turn.text, ...turn.scope }] : [],
      ),
    ]
    for (const ask of asks) {
      const reply = (await deliver(served, systemClock(c.as_of), {
        ...ask,
        ...format,
      })) as Delivered
      const result = answer(served, ask, { today: c.as_of, now: () => performance.now() })
      durations.push(result.ms)
      compared.push(c.id)
      expect(
        {
          status: result.status,
          items: result.items.map((i) => ({
            id: i.id,
            version: i.version,
            match: i.match,
            freshness: i.unverified ? 'unverified' : 'verified',
          })),
          // get_context lists the items it cut last-ranked first; the engine in rank order.
          cut: result.leftOut
            .filter((l) => l.reason === 'cut')
            .map((l) => l.id)
            .sort(),
          scope: result.scope,
          say: result.say,
          next: result.next,
        },
        `${c.id}: ${ask.question}`,
      ).toEqual({
        status: reply.status,
        items: (reply.items ?? []).map(({ id, version, match, freshness }) => ({
          id,
          version,
          match,
          freshness,
        })),
        cut: [...(reply.check_report?.cut_ids ?? [])].sort(),
        scope: reply.scope_used ?? null,
        say: reply.say,
        next: reply.next ?? null,
      })
    }
  }
  // Every case with a scope was compared, and so was every follow-up turn with one.
  expect(new Set(compared)).toEqual(
    new Set(cases.filter((c) => c.scope || c.turns?.some((t) => t.scope)).map((c) => c.id)),
  )
  expect(compared.length).toBeGreaterThanOrEqual(100)
  const sorted = [...durations].sort((a, b) => a - b)
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!
  process.stdout.write(
    `answer engine on the golden library: ${sorted.length} answers, p95 ${p95} ms\n`,
  )
  expect(p95).toBeLessThan(50)
})
