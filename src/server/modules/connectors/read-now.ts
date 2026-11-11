import type { Queryable } from '../../db/database.ts'

/**
 * Asks for sources to be read now (Read again, Run now): makes them due, then runs the job.
 * Sources are queued only when the job runner answers. When it does not (`ran` is false), each
 * source goes back to the time it had, so a dead runner never leaves a source queued with a
 * spinner behind it. A source whose time moved since (a read ended, a setting changed) is left as
 * that write made it. The writes use the database's own connection, outside any request's
 * transaction, because the job may start before that transaction ends.
 *
 * `ids` null asks for every source that is on.
 */
export async function readNow<T>(
  database: Queryable,
  ids: readonly string[] | null,
  run: () => Promise<{ result: T; ran: boolean }>,
): Promise<T> {
  // Times travel as text: a JavaScript Date keeps milliseconds, the column microseconds.
  const queued = await database.query<{ id: string; was: string; at: string }>(
    `update connectors c set next_read_at = now()
       from (select id, next_read_at from connectors
              where enabled and removed_at is null and ($1::text[] is null or id = any($1))
              for update) was
      where c.id = was.id
      returning c.id, was.next_read_at::text as was, c.next_read_at::text as at`,
    [ids],
  )
  let asked: { result: T; ran: boolean } | undefined
  try {
    asked = await run()
    return asked.result
  } finally {
    if (!asked?.ran && queued.length)
      await database.query(
        `update connectors c set next_read_at = back.was::timestamptz
           from unnest($1::text[], $2::text[], $3::text[]) back(id, was, at)
          where c.id = back.id and c.next_read_at = back.at::timestamptz`,
        [queued.map((q) => q.id), queued.map((q) => q.was), queued.map((q) => q.at)],
      )
  }
}
