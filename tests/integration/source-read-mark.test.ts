import { describe, expect, it } from 'vitest'
import { systemClock } from '../../src/server/clock.ts'
import {
  ConnectorRegistry,
  connectorSyncJob,
  createDemoSource,
} from '../../src/server/modules/connectors/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { apiDatabase, queueReads, testDatabase } from './support.ts'

/*
  The job marks the source it is reading, so the sources' page tells a read that is running from
  one that is queued (CON-115), and takes the mark off when the read ends, whatever came of it.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const logger = createLogger({ level: 'silent' })
const demo = createDemoSource()

/** What the source's row said while the job was inside its read. */
const seen: { readingSince: Date | null; nextReadAt: Date | null }[] = []
let failing = false
const registry = new ConnectorRegistry([
  {
    ...demo,
    async read(request) {
      const [row] = (
        await client.query<{ reading_since: Date | null; next_read_at: Date }>(
          `select reading_since, next_read_at from connectors where id = 'demo'`,
        )
      ).rows
      // A server source is registered by its first read, in a transaction this cannot see yet.
      seen.push({ readingSince: row?.reading_since ?? null, nextReadAt: row?.next_read_at ?? null })
      if (failing) throw new Error('The tool fell over')
      return demo.read(request)
    },
  },
])

const run = () =>
  connectorSyncJob(registry, { clock: systemClock('2026-10-08') }).run({
    database,
    logger,
    signal: new AbortController().signal,
  })
const state = async () =>
  (
    await client.query<{ marked: boolean; queued: boolean }>(
      `select reading_since is not null as marked, next_read_at <= now() as queued
         from connectors where id = 'demo'`,
    )
  ).rows[0]!

describe('the mark of a read that is running', () => {
  it('is set while the job reads a source and gone once the read ends', async () => {
    // A server source is registered at its first read: due, with no row to mark yet.
    await run()
    expect(seen).toHaveLength(1)
    expect(await state()).toEqual({ marked: false, queued: false })

    await queueReads(client, ['demo'])
    expect(await state()).toEqual({ marked: false, queued: true })
    await run()
    expect(seen).toHaveLength(2)
    expect(seen[1]!.readingSince).not.toBeNull()
    // Its time had come when the job took it; the read ends with the next one a period away.
    expect(seen[1]!.nextReadAt!.getTime()).toBeLessThanOrEqual(Date.now())
    expect(await state()).toEqual({ marked: false, queued: false })
  })

  it('leaves a source whose time has not come alone, with no mark', async () => {
    await run()
    expect(seen).toHaveLength(2)
    expect(await state()).toEqual({ marked: false, queued: false })
  })

  it('is taken off when the read fails too', async () => {
    await queueReads(client, ['demo'])
    failing = true
    expect(await run()).toMatchObject({ connectors: { demo: { status: 'failed' } } })
    expect(seen).toHaveLength(3)
    expect(seen[2]!.readingSince).not.toBeNull()
    expect(await state()).toEqual({ marked: false, queued: false })
  })
})
