import type { FastifyInstance } from 'fastify'
import { settingSchemas } from '../../contract/admin.ts'
import type { Clock } from '../clock.ts'
import type { Database } from '../db/database.ts'
import { sessionPersonId } from '../modules/auth/index.ts'
import { labelOperation } from '../observability/metrics.ts'

/**
 * Fixed one-minute windows per key, in this process only. A request counts against every key it
 * names, and only when all of them have room; the answer is 0, or the seconds until the fullest
 * window ends. A key marked `peek` is only checked, never counted. Keys never leave memory and are
 * discarded after their minute.
 */
export function createLimiter(now: () => Date) {
  const buckets = new Map<string, { until: number; count: number }>()
  let pruned = 0
  return (keys: { key: string; limit: number; peek?: boolean }[]) => {
    const time = now().getTime()
    // An ended window counts as empty whether or not it has been pruned yet.
    if (time - pruned >= 1000) {
      for (const [key, value] of buckets) if (value.until <= time) buckets.delete(key)
      pruned = time
    }
    const live = (key: string) => {
      const bucket = buckets.get(key)
      return bucket && bucket.until > time ? bucket : undefined
    }
    for (const entry of keys) {
      const bucket = live(entry.key)
      if (bucket && bucket.count >= entry.limit)
        return Math.max(1, Math.ceil((bucket.until - time) / 1000))
    }
    for (const entry of keys) {
      if (entry.peek) continue
      const bucket = live(entry.key) ?? { until: time + 60000, count: 0 }
      bucket.count++
      buckets.set(entry.key, bucket)
    }
    return 0
  }
}

type ApiLimits = { person: number; ip: number }
/** The migration's defaults (0029), for a database that has lost the setting. */
const defaultLimits: ApiLimits = { person: 600, ip: 120 }
/** How long a read of the setting serves, so a flood of refused requests does not reach the database. */
const LIMITS_TTL_MS = 5000

/**
 * FR-408 for the web API: every request under /api, the operations endpoints and the assistant
 * included, counts per minute against the signed-in person, or against the caller's address before
 * sign-in. An administrator sets both numbers in `limits.api_rate_per_minute`; a change reaches new
 * requests within five seconds. Over the limit, the answer is 429 with `Retry-After` in seconds.
 * Health checks and metrics are outside /api and never limited. When the database cannot say who
 * is asking, the request goes on and its route answers for the database.
 */
export function registerRateLimit(
  app: FastifyInstance,
  deps: { database: Database; clock: Clock },
): void {
  const limit = createLimiter(() => deps.clock.now())
  let cached: { limits: ApiLimits; until: number } | undefined
  const currentLimits = async (): Promise<ApiLimits> => {
    const time = deps.clock.now().getTime()
    if (cached && cached.until > time) return cached.limits
    const [row] = await deps.database.query<{ value: unknown }>(
      "select value from settings_current where key='limits.api_rate_per_minute'",
    )
    const parsed = settingSchemas['limits.api_rate_per_minute'].safeParse(row?.value)
    const limits = parsed.success ? parsed.data : defaultLimits
    cached = { limits, until: time + LIMITS_TTL_MS }
    return limits
  }

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return
    let key: { key: string; limit: number }
    try {
      const [limits, person] = await Promise.all([
        currentLimits(),
        sessionPersonId(deps.database, request.headers.cookie),
      ])
      key = person
        ? { key: `person:${person}`, limit: limits.person }
        : { key: `ip:${request.ip}`, limit: limits.ip }
    } catch {
      return
    }
    const retry = limit([key])
    if (!retry) return
    labelOperation(request, 'rate_limited')
    reply.header('retry-after', String(retry))
    return reply.code(429).send({
      code: 'TOO_MANY_REQUESTS',
      message: `That was a lot at once. Try again in ${retry} seconds.`,
      data: { retryAfterSeconds: retry },
    })
  })
}
