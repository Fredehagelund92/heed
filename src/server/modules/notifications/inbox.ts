import type * as z from 'zod/mini'
import type { InboxItem, inboxListSchema } from '../../../contract/notifications.ts'
import type { Queryable } from '../../db/database.ts'
import { actorJson, decisionNote, iso, subjectTitle } from './visibility.ts'

/**
 * The signed-in person's inbox. The relay writes the items (`cl_outbox_relay`); here the person
 * reads, marks and archives their own, inside the request's transaction, where row security
 * already limits every statement to their rows. Each change posts an `inbox.changed` event that
 * only the same person's streams receive, so other open tabs update their unread count.
 */
export function createInboxService(tx: Queryable) {
  async function unread(): Promise<number> {
    const [row] = await tx.query<{ n: number }>(
      `select count(*)::int as n from inbox_items
       where person_id = cl_person() and read_at is null and archived_at is null`,
    )
    return row!.n
  }
  async function changed(rows: unknown[]) {
    const count = await unread()
    if (rows.length)
      await tx.query(
        `insert into outbox_events (topic, aggregate_type, aggregate_id, payload)
         values ('inbox.changed', 'inbox', cl_person()::text, $1)`,
        [JSON.stringify({ unread: count })],
      )
    return { changed: rows.length, unread: count }
  }

  return {
    async list({ filter = 'all', limit = 50, before }: z.infer<typeof inboxListSchema>) {
      const items = await tx.query<InboxItem>(
        `select i.id::text, i.kind, ${iso('i.created_at')} as at, i.area_id as "areaId",
         json_build_object('type', i.subject_type, 'id', i.subject_id) as subject,
         i.payload->>'state' as state, ${subjectTitle('i.subject_type', 'i.subject_id')} as title,
         ${actorJson('i.actor_id')} as actor, ${decisionNote('i')} as note,
         ${iso('i.read_at')} as "readAt", ${iso('i.archived_at')} as "archivedAt"
         from inbox_items i
         where i.person_id = cl_person() and ($1::uuid is null or i.id < $1)
         and case $2 when 'unread' then i.read_at is null and i.archived_at is null
                     when 'archived' then i.archived_at is not null
                     else i.archived_at is null end
         order by i.id desc limit $3`,
        [before ?? null, filter, limit + 1],
      )
      const more = items.length > limit
      if (more) items.pop()
      return {
        items,
        unread: await unread(),
        nextBefore: more ? items[items.length - 1]!.id : null,
      }
    },
    async markRead(ids: string[]) {
      return changed(
        await tx.query(
          `update inbox_items set read_at = now()
           where person_id = cl_person() and id = any($1::uuid[]) and read_at is null returning id`,
          [ids],
        ),
      )
    },
    async markAllRead() {
      return changed(
        await tx.query(
          `update inbox_items set read_at = now()
           where person_id = cl_person() and read_at is null and archived_at is null returning id`,
        ),
      )
    },
    async archive(ids: string[]) {
      return changed(
        await tx.query(
          `update inbox_items set archived_at = now(), read_at = coalesce(read_at, now())
           where person_id = cl_person() and id = any($1::uuid[]) and archived_at is null returning id`,
          [ids],
        ),
      )
    },
  }
}
