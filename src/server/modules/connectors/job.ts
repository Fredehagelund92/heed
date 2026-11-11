import { isDue } from '../../../domain/source-state.ts'
import { systemClock, type Clock } from '../../clock.ts'
import type { ScheduledJob } from '../jobs/index.ts'
import { ContentPipeline, withdrawDisconnected } from './content.ts'
import type { ConnectorRegistry } from './registry.ts'
import { ConnectorService } from './service.ts'

/**
 * The reads of every source that is due (CON-115, CON-506): the server's own and those
 * administrators added, of definitions and of content. Each source has its own schedule, so the
 * job runs every five minutes and reads only the sources whose next read has come; one never
 * read yet is due (a source is queued when its next read has come, and the job marks the one it is
 * reading, so its page tells a queued source from a running read). Read again on a source's page
 * makes it due now and runs the job (CON-115).
 * A source that cannot be read records a failed read, which its page and the operations view
 * show; the job itself still succeeds, and the watchdog alerts once the data is older than the
 * connector allows (CON-104). A source that is switched off is left out. One source that breaks
 * the read itself does not keep the others from being read: the job reads them all, then fails.
 * A content source an admin disconnected has its open suggestions withdrawn (CON-118).
 */
export function connectorSyncJob(
  registry: ConnectorRegistry,
  { clock = systemClock() }: { clock?: Clock } = {},
): ScheduledJob {
  return {
    name: 'connectors.sync',
    cron: '*/5 * * * *',
    expectedEverySeconds: 30 * 60,
    async run({ database }) {
      const definitions = new ConnectorService(database, registry)
      const content = new ContentPipeline(database, clock)
      const connectors: Record<string, unknown> = {}
      const rows = await database.query<{
        id: string
        enabled: boolean
        next_read_at: Date
        now: Date
      }>(`select id, enabled, next_read_at, now() as now from connectors`)
      const stored = new Map(rows.map((row) => [row.id, row]))
      // A source the server's configuration selects is registered at its first read: it is due.
      const due = (id: string) => {
        const row = stored.get(id)
        return row === undefined || (row.enabled && isDue(row.next_read_at, row.now))
      }
      let broken: Error | undefined
      const read = async (id: string, work: () => Promise<Record<string, unknown>>) => {
        try {
          connectors[id] = await work()
        } catch (error) {
          broken ??= error instanceof Error ? error : new Error('A source could not be read')
          connectors[id] = { status: 'error' }
        }
      }
      // The mark is the source's page saying "reading"; it ends with the read, whatever came of it.
      const readSource = async (id: string, work: () => Promise<Record<string, unknown>>) => {
        await database.query('update connectors set reading_since = now() where id = $1', [id])
        try {
          await read(id, work)
        } finally {
          await database.query('update connectors set reading_since = null where id = $1', [id])
        }
      }
      for (const source of await registry.current(database)) {
        if (!due(source.id)) continue
        await readSource(source.id, async () => {
          const {
            snapshotId: _snapshot,
            coverage: _coverage,
            ...result
          } = await definitions.syncSource(source)
          return result
        })
      }
      for (const source of await registry.contents(database)) {
        if (!due(source.id)) continue
        await readSource(source.id, async () => {
          const { readId: _read, ...result } = await content.sync(source)
          return result
        })
      }
      // A content source disconnected withdraws its open suggestions as it goes; one whose
      // withdrawal failed then is finished here.
      const removed = await database.query<{ id: string }>(
        `select id from connectors where removed_at is not null and kind = 'context_source'`,
      )
      for (const { id } of removed)
        await read(`${id}.disconnected`, async () => ({
          withdrawn: await withdrawDisconnected(database, clock, id),
        }))
      if (broken !== undefined) throw broken
      return { connectors }
    },
  }
}
