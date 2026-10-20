import pg from 'pg'
import type { Logger } from 'pino'

/**
 * Days are UTC calendar days (NFR-048): a DATE column reads as its `YYYY-MM-DD` text. The pg
 * default would build a Date at local midnight, which shifts the day in any zone east of UTC.
 */
export const calendarDateTypes: pg.CustomTypesConfig = {
  getTypeParser(oid, format) {
    return oid === pg.types.builtins.DATE
      ? (value: string) => value
      : (pg.types.getTypeParser(oid, format) as (value: string) => unknown)
  },
}

export interface Queryable {
  query<Row extends pg.QueryResultRow>(text: string, values?: unknown[]): Promise<Row[]>
}

export interface PoolStats {
  total: number
  idle: number
  waiting: number
}

export interface Database extends Queryable {
  ping(): Promise<void>
  /** The connection pool's state, for the metrics endpoint. */
  stats?(): PoolStats
  /**
   * One transaction as the person (`cl.person_id`). With a request id (`cl.request_id`), every
   * history entry it writes carries the id that the request's log lines carry (NFR-071).
   */
  transaction<T>(
    personId: string | null,
    work: (tx: Queryable) => Promise<T>,
    options?: { requestId?: string },
  ): Promise<T>
  close(): Promise<void>
}

/** The same database, whose transactions all name the request: for work that outlives its first one. */
export function forRequest(database: Database, requestId: string): Database {
  return {
    ...database,
    transaction: (personId, work) => database.transaction(personId, work, { requestId }),
  }
}

/** Each transaction owns one connection. SET LOCAL is cleared on commit and rollback. */
export function databaseFromPool(pool: pg.Pool): Database {
  return {
    async ping() {
      await pool.query('select 1')
    },
    stats: () => ({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }),
    async query<Row extends pg.QueryResultRow>(text: string, values?: unknown[]) {
      return (await pool.query<Row>(text, values)).rows
    },
    async transaction(personId, work, options) {
      const client = await pool.connect()
      let broken = false
      try {
        // One round trip opens the transaction and names it: a busy server pays for each trip.
        const person = client.escapeLiteral(personId ?? '')
        const request = client.escapeLiteral(options?.requestId ?? '')
        await client.query(
          `begin; select set_config('cl.person_id', ${person}, true), set_config('cl.request_id', ${request}, true)`,
        )
        const result = await work({
          async query<Row extends pg.QueryResultRow>(text: string, values?: unknown[]) {
            return (await client.query<Row>(text, values)).rows
          },
        })
        await client.query('commit')
        return result
      } catch (error) {
        try {
          await client.query('rollback')
        } catch {
          broken = true
        }
        throw error
      } finally {
        client.release(broken)
      }
    },
    close: () => pool.end(),
  }
}

export function createDatabase(databaseUrl: string, logger: Logger): Database {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    application_name: 'heed',
    connectionTimeoutMillis: 2_000,
    types: calendarDateTypes,
  })
  pool.on('error', (error) => logger.error({ err: error }, 'idle database connection failed'))
  return databaseFromPool(pool)
}
