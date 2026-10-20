import type pg from 'pg'
import { gapFixtures, gapTopics } from '../../src/web/mocks/gaps.ts'

/**
 * The fixture topics and gaps of src/web/mocks/gaps.ts, written straight into the tables the
 * gateway and the detection job fill, so the service answers about them as the mock does. Runs
 * in the caller's transaction.
 */
export async function seedGaps(client: pg.Client) {
  const topicIds = new Map<string, string>()
  for (const topic of gapTopics) {
    const { rows } = await client.query<{ id: string }>(
      `insert into topics (key, area_id, metric_keys, value_keys, month)
       values ($1, $2, $3, $4, $5) returning id`,
      [topic.key, topic.areaId, topic.metrics, topic.values, topic.month],
    )
    topicIds.set(topic.key, rows[0]!.id)
    for (const week of topic.weeks)
      await client.query(
        `insert into topic_week_counts (topic_id, week, status, calls, no_item_calls)
         values ($1, $2, 'no_match', $3, $4)`,
        [rows[0]!.id, week.week, week.calls, week.noItemCalls],
      )
  }
  for (const gap of gapFixtures) {
    await client.query(
      `insert into gaps (id, ref, topic_id, type, status, severity, opened_by_case, first_seen,
                         last_seen, status_since, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
      [
        gap.id,
        gap.ref,
        topicIds.get(gap.topic),
        gap.type,
        gap.status,
        gap.severity,
        gap.openedByCase,
        gap.firstSeen,
        gap.lastSeen,
        gap.statusSince,
      ],
    )
    for (const week of gap.weeks)
      await client.query(
        `insert into gap_weekly_counts (gap_id, week, reports, human_reports, no_item_calls)
         values ($1, $2, $3, $4, $5)`,
        [gap.id, week.week, week.reports, week.personReports ?? 0, week.noItemCalls],
      )
    for (const note of gap.notes)
      await client.query(
        'insert into gap_notes (gap_id, source, note, created_hour) values ($1, $2, $3, $4)',
        [gap.id, note.source, note.note, note.createdHour],
      )
  }
}
