import type { Queryable } from '../../db/database.ts'
import type { ModelPort } from './port.ts'

/**
 * The spend ledger against the providers' own counters, for the runs of one command. Round 5 found the
 * gateway's counter at USD 12.60 used where the ledgers added up to 9.39, and nothing said so
 * while the runs went on. The counters are read before the run's calls and again after them; each
 * provider's counter delta is set against what the ledger recorded for the run on that provider
 * in between. Another use of the same key in the meantime moves the counter too, so a difference
 * says where to look, not who spent it. The reads never change anything, and the key only travels
 * in their header.
 */

export type CreditsCheck = {
  /** One line per provider that keeps a counter, for the runs' calls since the check started. */
  finish(runIds: readonly string[]): Promise<string[]>
}

/** What a counter says the key has used, in micros, or why it could not be read. */
async function read(port: ModelPort, provider: string): Promise<number | string | null> {
  try {
    return await port.creditsUsed(provider)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

const dollars = (micros: number) =>
  `${micros < 0 ? '-' : ''}$${(Math.abs(micros) / 1_000_000).toFixed(6)}`

export async function startCreditsCheck(
  port: ModelPort,
  database: Queryable,
  providers: Iterable<string>,
): Promise<CreditsCheck> {
  const before = new Map<string, number | string>()
  for (const provider of new Set(providers)) {
    const reading = await read(port, provider)
    if (reading !== null) before.set(provider, reading)
  }
  const [start] = await database.query<{ at: string }>('select now()::text as at')
  return {
    async finish(runIds) {
      const lines: string[] = []
      for (const [provider, first] of before) {
        const [ledger] = await database.query<{ cost: string }>(
          `select coalesce(sum(cost_micros),0)::text as cost from model_calls
            where run_id=any($1::uuid[]) and provider=$2 and at>=$3::timestamptz`,
          [runIds, provider, start!.at],
        )
        const recorded = Number(ledger?.cost ?? 0)
        const last = (await read(port, provider)) ?? 'no answer'
        if (typeof first === 'string' || typeof last === 'string') {
          lines.push(
            `${provider}'s own counter could not be read (${typeof first === 'string' ? first : last}); ` +
              `the ledger recorded ${dollars(recorded)} for the run on it.`,
          )
          continue
        }
        const counted = last - first
        lines.push(
          `${provider}'s own counter moved ${dollars(counted)}; the ledger recorded ` +
            `${dollars(recorded)} for the run on it (difference ${dollars(counted - recorded)}; ` +
            'other use of the same key counts in the counter).',
        )
      }
      return lines
    },
  }
}
