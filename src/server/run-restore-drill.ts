import { parseArgs } from 'node:util'
import { describeDrill, restoreDrill } from './db/restore-drill.ts'

/**
 * `npm run db:restore-drill`: back up the local database with pg_dump, restore it into a scratch
 * database and prove the copy is identical: rows, edition digests, content digests and the
 * history log's hash chain (NFR-044, NFR-045). It reads `DATABASE_URL_MIGRATE` (the owner), or
 * `--source <url>`. The source is only read; the scratch database is dropped unless `--keep`.
 * `--json` prints the full report. The exit code is 1 when any check fails.
 */

const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    keep: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
})
const sourceUrl =
  values.source ??
  process.env.DATABASE_URL_MIGRATE ??
  'postgres://context_layer_owner@localhost:5432/context_layer_dev'

try {
  const report = await restoreDrill({ sourceUrl, keep: values.keep })
  console.log(values.json ? JSON.stringify(report, null, 2) : describeDrill(report))
  if (!report.ok) process.exitCode = 1
} catch (error) {
  console.error(`Restore drill could not run: ${(error as Error).message}`)
  process.exitCode = 1
}
