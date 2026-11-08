import { describe, expect, it } from 'vitest'
import { scriptedLoopChoice } from '../../../src/server/modules/answer/index.ts'
import type { ModelChoice, ModelPort } from '../../../src/server/modules/models/index.ts'
import { askWorld } from './ask-world.ts'

/*
  Ask's loop and the service's pool (FR-719.7): a turn holds no connection while its model works
  or while it waits for one. Today's main deadlocks once as many live asks are in flight as the
  pool has connections (a look-up holds one for its request while its planner opens a second);
  here a slow scripted model on the live path, with the spending checks and the meter, answers N
  asks at once for N equal to the test pool's 4 connections and twice that.
*/

const ML = 'Maria Lindqvist'
const POOL = 4

/** A slow reader: each step takes a while, one look-up, then its words with what it found. */
const slow = scriptedLoopChoice('slow', ({ question, results }) =>
  results.length
    ? { text: 'What is written is listed under the answer.', delay: 300 }
    : { calls: [{ toolName: 'get_context', input: { about: question } }], delay: 300 },
)
// Priced, so the spending checks before each step have a cost to weigh.
const priced: ModelChoice = { ...slow, prices: { input: 1, output: 1, cacheRead: 1 } }
const live: ModelPort = {
  mode: 'live',
  choose: () => priced,
  otherLine: () => priced,
  check: () => {},
  creditsUsed: () => Promise.resolve(null),
}
const world = askWorld({ askLoop: true, models: live })

/** What comes back within `ms`, or a failure that says the asks waited on each other. */
const within = <T>(work: Promise<T>, ms: number) =>
  Promise.race([
    work,
    new Promise<never>((_, fail) =>
      setTimeout(
        () => fail(new Error(`No answer within ${ms} ms: the asks wait on each other.`)),
        ms,
      ),
    ),
  ])

describe("Ask's loop and the service's pool", () => {
  /** The assistant's calls the meter has written for the scripted provider. */
  const metered = async () =>
    Number(
      (
        await world.client.query<{ calls: string }>(
          "select coalesce(sum(calls), 0) as calls from llm_spend_monthly where feature = 'assistant' and provider = 'mock'",
        )
      ).rows[0]!.calls,
    )

  it.each([POOL, POOL * 2])(
    'answers %i live asks at once',
    async (n) => {
      const api = await world.as(ML)
      const before = await metered()
      const answers = await within(
        Promise.all(
          Array.from({ length: n }, (_, i) =>
            api.ask({ question: i % 2 ? 'orders in Norway' : 'net revenue in Spain' }),
          ),
        ),
        45_000,
      )
      expect(answers).toHaveLength(n)
      for (const a of answers) {
        expect(a.stopped).toBeUndefined()
        expect(a.read?.[0]).toMatch(/^Looked up /)
      }
      // Every step was metered as the assistant's: two a turn.
      expect((await metered()) - before).toBe(n * 2)
    },
    60_000,
  )

  it('stops at the spending limits, before a step, and says so', async () => {
    const key = 'limits.llm_daily_micros_per_person'
    const { rows } = await world.client.query<{ value: string }>(
      'select value from settings_versions where key = $1 order by version desc limit 1',
      [key],
    )
    const earlier = rows[0]?.value
    const set = (value: string, reason: string) =>
      world.client.query(
        `insert into settings_versions (key, version, value, reason)
         select key, max(version) + 1, $2, $3 from settings_versions
          where key = $1 group by key`,
        [key, value, reason],
      )
    await set('1', 'test')
    try {
      const api = await world.as(ML)
      const a = await api.ask({ question: 'orders in Norway' })
      expect(a.stopped).toBe('spending')
      expect(a.state).toBeNull()
      expect(a.sources).toEqual([])
    } finally {
      if (earlier !== undefined) await set(earlier, 'test: restored')
    }
  }, 30_000)
})
