import { withEventMeta } from '@orpc/server'
import type { StreamEvent } from '../../../contract/notifications.ts'
import type { Database, Queryable } from '../../db/database.ts'
import type { Hub } from './hub.ts'
import { iso, visibleEvent } from './visibility.ts'

export interface StreamOptions {
  database: Database
  hub: Hub
  /**
   * The reader's person id, resolved again inside every read's transaction; null ends the stream
   * (signed out, session expired, person deactivated).
   */
  reader: (tx: Queryable) => Promise<string | null>
  /** The `Last-Event-ID` header, when the client resumes. */
  lastEventId: string | undefined
  /** Aborted when the client goes away. */
  signal: AbortSignal
  /** How long a quiet stream waits before it checks the session again. */
  idleMs?: number
  /** Events read per query. */
  batchSize?: number
}

type Row = Omit<StreamEvent, 'id'> & { id: string }
type Position = { head: string; first: string | null; known: boolean }

const message = (event: StreamEvent) => withEventMeta(event, { id: String(event.id) })
const marker = (topic: string, id: number): StreamEvent => ({
  id,
  topic,
  at: new Date().toISOString(),
  areaId: null,
  subject: null,
  payload: {},
  inbox: false,
})

/**
 * One person's live stream: relayed outbox events they may see, in relay order, each with its
 * relay number as the SSE id (FR-114's status page and the review queue refresh from it).
 *
 * - No `Last-Event-ID`: the stream starts at the newest event with `stream.ready`.
 * - A known `Last-Event-ID`: every later event the reader may see is replayed first.
 * - An unknown or expired one (retention removed the events since): `stream.reset`, then live.
 *
 * One generator serves one connection and reads, then yields, then waits, so a burst of wake-ups
 * never sends an event twice. Visibility is decided per read, with the reader's current roles.
 */
export async function* streamEvents(options: StreamOptions): AsyncGenerator<StreamEvent> {
  const { database, hub, reader, signal, idleMs = 60_000, batchSize = 200 } = options
  const read = <T>(work: (tx: Queryable) => Promise<T>) =>
    database.transaction(null, async (tx) => {
      const person = await reader(tx)
      if (!person) return null
      await tx.query("select set_config('cl.person_id', $1, true)", [person])
      const result = await work(tx)
      // Read committed: an event that landed after the session ended is seen only by a read that
      // also sees the session end, so check again once the events are read.
      return (await reader(tx)) ? result : null
    })

  const requested = /^\d{1,15}$/.test(options.lastEventId ?? '')
    ? Number(options.lastEventId)
    : undefined
  const position = await read(async (tx) => {
    const [row] = await tx.query<Position>(
      `select coalesce(max(relay_seq), 0)::text as head, min(relay_seq)::text as first,
       exists (select 1 from outbox_events where relay_seq = $1) as known
       from outbox_events where relay_seq is not null`,
      [requested ?? 0],
    )
    return row!
  })
  if (!position) return
  const head = Number(position.head)
  let cursor: number
  if (requested === undefined) {
    if (options.lastEventId === undefined) yield message(marker('stream.ready', head))
    else yield message(marker('stream.reset', head))
    cursor = head
  } else if (
    requested > head ||
    (requested > 0 && !position.known) ||
    (requested === 0 && position.first !== null && Number(position.first) > 1)
  ) {
    yield message(marker('stream.reset', head))
    cursor = head
  } else cursor = requested

  const subscription = hub.subscribe()
  try {
    while (!signal.aborted) {
      // Scan a window of events, visible or not, so a reader who sees few events does not
      // rescan the same hidden ones on every wake-up.
      const rows = await read((tx) =>
        tx.query<Row & { visible: boolean }>(
          `with scanned as (select * from outbox_events where relay_seq > $1 order by relay_seq limit $2)
           select o.relay_seq::text as id, o.topic, ${iso('o.at')} as at, o.area_id as "areaId",
           json_build_object('type', o.aggregate_type, 'id', o.aggregate_id) as subject, o.payload,
           exists (select 1 from inbox_items i where i.event_seq = o.seq and i.person_id = cl_person()) as inbox,
           ${visibleEvent} as visible
           from scanned o order by o.relay_seq`,
          [cursor, batchSize],
        ),
      )
      if (!rows) return
      for (const { visible, ...row } of rows) {
        cursor = Number(row.id)
        if (visible) yield message({ ...row, id: cursor })
      }
      if (rows.length === batchSize) continue
      if (!(await subscription.wait(signal, idleMs))) return
    }
  } finally {
    subscription.close()
  }
}
