import type { ScheduledJob } from '../jobs/index.ts'
import type { ConnectorRegistry } from './registry.ts'
import { ConnectorService } from './service.ts'

/**
 * The hourly refresh of every definition source (CON-506): the server's own and those
 * administrators added. Administrators start one at any time from Sources or the operations view.
 * A source that cannot be read records a failed snapshot, which the operations view shows; the
 * job itself still succeeds, and the watchdog alerts once the data is older than the connector
 * allows (CON-104). A source that is switched off is left out. One source that breaks the refresh
 * itself does not keep the others from being read: the job reads them all, then fails.
 */
export function connectorSyncJob(registry: ConnectorRegistry): ScheduledJob {
  return {
    name: 'connectors.sync',
    cron: '7 * * * *',
    expectedEverySeconds: 2 * 60 * 60,
    async run({ database }) {
      const service = new ConnectorService(database, registry)
      const connectors: Record<string, unknown> = {}
      const switchedOff = new Set(
        (await database.query<{ id: string }>('select id from connectors where not enabled')).map(
          (row) => row.id,
        ),
      )
      let broken: Error | undefined
      for (const source of await registry.current(database)) {
        if (switchedOff.has(source.id)) continue
        try {
          const {
            snapshotId: _snapshot,
            coverage: _coverage,
            ...result
          } = await service.syncSource(source)
          connectors[source.id] = result
        } catch (error) {
          broken ??= error instanceof Error ? error : new Error('A source could not be refreshed')
          connectors[source.id] = { status: 'error' }
        }
      }
      if (broken !== undefined) throw broken
      return { connectors }
    },
  }
}
