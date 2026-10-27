import { durationSeconds } from '../../../domain/connector-manifest.ts'
import { scheduleSeconds } from '../../../domain/source-schedule.ts'
import type { Queryable } from '../../db/database.ts'

/** The period a source is read at, and how long it may go unread, in seconds. */
export async function scheduleOf(
  tx: Queryable,
  sourceId: string,
  manifest: { schedule: { default: string; minimum: string }; staleAfter: string },
) {
  const [row] = await tx.query<{ own: number | null; failures: number }>(
    `select extract(epoch from schedule)::int as own, failures from connectors where id=$1`,
    [sourceId],
  )
  return {
    periodSeconds: scheduleSeconds(row?.own ?? null, {
      defaultSeconds: durationSeconds(manifest.schedule.default),
      minimumSeconds: durationSeconds(manifest.schedule.minimum),
    }),
    staleAfterSeconds: durationSeconds(manifest.staleAfter),
    failures: row?.failures ?? 0,
  }
}
