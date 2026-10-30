import { setTimeout as sleep } from 'node:timers/promises'
import pg from 'pg'
import type { Logger } from 'pino'
import type { Database } from '../../db/database.ts'
import type { ScheduledJob } from '../jobs/index.ts'

/**
 * The outbox relay. Every write puts its event in `outbox_events` in the same transaction; the
 * relay then writes the inbox items (`cl_outbox_relay`, migration 0020). Delivery is at least once and every consumer is keyed on
 * the event, so a repeated relay adds nothing.
 *
 * In the service the relay runs on the insert trigger's NOTIFY (`cl_events`) and every five
 * seconds. The scheduled
 * `outbox.relay` job repeats it every minute, so the watchdog notices when events stop moving.
 */

const batchSize = 200

export interface RelayPass {
  relayed: number
  delivered: number
}

/** Relays until no event is waiting. Safe to run from several places at once. */
export async function relayOutbox(database: Database): Promise<RelayPass> {
  const total = { relayed: 0, delivered: 0 }
  for (;;) {
    const [pass] = await database.query<RelayPass>(
      'select relayed, delivered from cl_outbox_relay($1)',
      [batchSize],
    )
    total.relayed += pass!.relayed
    total.delivered += pass!.delivered
    if (pass!.relayed < batchSize) return total
  }
}

export const outboxRelayJob: ScheduledJob = {
  name: 'outbox.relay',
  cron: '* * * * *',
  expectedEverySeconds: 5 * 60,
  async run({ database }) {
    return { ...(await relayOutbox(database)) }
  },
}

export interface RelayOptions {
  /** The API role's connection string, for the one connection that listens. */
  connectionString: string
  database: Database
  logger: Logger
  pollMs?: number
}

export interface Relay {
  /** Listens and relays until stopped, reconnecting with growing waits while the database is down. */
  start(): void
  stop(): Promise<void>
}

export function createRelay({
  connectionString,
  database,
  logger,
  pollMs = 5_000,
}: RelayOptions): Relay {
  const stopping = new AbortController()
  const stopped = new Promise<void>((resolve) =>
    stopping.signal.addEventListener('abort', () => resolve(), { once: true }),
  )
  let timer: NodeJS.Timeout | undefined
  let running: Promise<void> | undefined
  let again = false
  let failing = false

  /** One relay at a time in this process; a request while one runs queues exactly one more. */
  function relay(): Promise<void> {
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      do {
        again = false
        try {
          await relayOutbox(database)
          if (failing) logger.info('outbox relay recovered')
          failing = false
        } catch (error) {
          if (!failing) logger.error({ err: error }, 'outbox relay failed; retrying')
          failing = true
        }
      } while (again && !stopping.signal.aborted)
    })().finally(() => {
      running = undefined
    })
    return running
  }

  async function listen(): Promise<void> {
    let wait = 1_000
    while (!stopping.signal.aborted) {
      const client = new pg.Client({
        connectionString,
        application_name: 'heed-relay',
        connectionTimeoutMillis: 2_000,
      })
      const lost = new Promise<void>((resolve) => {
        client.on('error', (error) => {
          logger.warn({ err: error }, 'outbox listener lost its connection')
          resolve()
        })
        client.on('end', () => resolve())
      })
      client.on('notification', () => void relay())
      try {
        await client.connect()
        await client.query('listen cl_events')
        wait = 1_000
        // Catch up on anything written while nobody listened.
        void relay()
        await Promise.race([lost, stopped])
      } catch (error) {
        if (!stopping.signal.aborted)
          logger.error(
            { err: error, retryInSeconds: wait / 1000 },
            'outbox listener cannot connect',
          )
      } finally {
        await client.end().catch(() => undefined)
      }
      if (stopping.signal.aborted) return
      await sleep(wait, undefined, { signal: stopping.signal }).catch(() => undefined)
      wait = Math.min(wait * 2, 60_000)
    }
  }

  let listening: Promise<void> | undefined
  return {
    start() {
      if (listening) return
      listening = listen()
      timer = setInterval(() => void relay(), pollMs)
      timer.unref()
    },
    async stop() {
      stopping.abort()
      clearInterval(timer)
      await listening
      await running
    },
  }
}
