import { settingSchemas } from '../../../contract/admin.ts'
import type { Rating, RatingInput } from '../../../contract/assistant.ts'
import { areaOfMetrics } from '../../../domain/gap-reports.ts'
import type { Queryable } from '../../db/database.ts'
import { loadLiveBundle } from '../editions/index.ts'

/**
 * A person rates one of the assistant's answers (FR-712), as an agent gives feedback with
 * give_feedback (FR-309): only the verdict, the area of the answer's metrics on the live edition
 * (as a gap's topic takes it, so the two always agree) and the hour are stored. Nothing here
 * reads the person, logs or audits who rated, or keeps the metrics themselves (FR-613): the row
 * cannot be found again, so a rating is never changed or taken back.
 */
export async function rateAnswer(tx: Queryable, input: RatingInput): Promise<Rating> {
  const bundle = await loadLiveBundle(tx)
  const area = bundle ? areaOfMetrics(input.metrics ?? [], bundle.metricArea) : null
  await tx.query('insert into assistant_ratings (verdict, area_id) values ($1, $2)', [
    input.verdict,
    area,
  ])
  return { counted: true }
}

/** The migration's default (0058), for a database that has lost the setting. */
const DEFAULT_RATINGS_PER_MINUTE = 20

/** A person's ratings per minute (`limits.assistant_ratings_per_minute`, FR-408). */
export async function ratingsPerMinute(tx: Queryable): Promise<number> {
  const [row] = await tx.query<{ value: unknown }>(
    "select value from settings_current where key = 'limits.assistant_ratings_per_minute'",
  )
  const parsed = settingSchemas['limits.assistant_ratings_per_minute'].safeParse(row?.value)
  return parsed.success ? parsed.data.person : DEFAULT_RATINGS_PER_MINUTE
}
