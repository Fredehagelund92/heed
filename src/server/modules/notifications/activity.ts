import type * as z from 'zod/mini'
import type { ActivityEntry, activityListSchema } from '../../../contract/notifications.ts'
import type { Queryable } from '../../db/database.ts'
import { actorJson, iso, subjectTitle, visibleEvent } from './visibility.ts'

/**
 * The topics an activity feed shows: steps of review and release, not draft autosaves, check
 * runs or inbox housekeeping. `proposal.decided` and `edition.published` arrive with the review
 * and release slice.
 */
export const activityTopics = [
  'proposal.submitted',
  'proposal.commented',
  'proposal.claimed',
  'proposal.handed_over',
  'proposal.withdrawn',
  'proposal.decided',
  'edition.published',
] as const

/**
 * The activity feed for Home or one area, read from the relayed outbox (kept for
 * `retention.outbox_days`), newest first, limited to the events the reader may see. Entry ids are
 * the live stream's event ids, so a page and the stream can be merged.
 */
export function createActivityService(tx: Queryable) {
  return {
    async list({ areaId, limit = 50, before }: z.infer<typeof activityListSchema>) {
      const rows = await tx.query<Omit<ActivityEntry, 'id'> & { id: string }>(
        `select o.relay_seq::text as id, o.topic, ${iso('o.at')} as at, o.area_id as "areaId",
         json_build_object('type', o.aggregate_type, 'id', o.aggregate_id) as subject,
         o.payload->>'state' as state, ${subjectTitle('o.aggregate_type', 'o.aggregate_id')} as title,
         ${actorJson('o.actor_id')} as actor
         from outbox_events o
         where o.relay_seq is not null and o.topic = any($1::text[])
         and ($2::text is null or o.area_id = $2) and ($3::bigint is null or o.relay_seq < $3)
         and ${visibleEvent}
         order by o.relay_seq desc limit $4`,
        [activityTopics, areaId ?? null, before ?? null, limit + 1],
      )
      const more = rows.length > limit
      if (more) rows.pop()
      const entries = rows.map((row) => ({ ...row, id: Number(row.id) }))
      return { entries, nextBefore: more ? entries[entries.length - 1]!.id : null }
    },
  }
}
