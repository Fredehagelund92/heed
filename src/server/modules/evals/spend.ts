import type { Queryable } from '../../db/database.ts'
import { formatUsd, spendCapReached } from '../models/index.ts'
import type { EvalSettings } from './settings.ts'

/**
 * Spend caps for evaluation runs (FR-409, NFR-062) on the shared spend ledger: before every answer
 * the runner checks the month's total, the month's evaluation spend and, for a run a person
 * started, that person's day. The model call meter writes what each call spent.
 */

export const evalFeature = 'eval'

/** Why the next call may not run, or null. `next` is the cost the call may add. */
export const capReached = (
  tx: Queryable,
  settings: EvalSettings,
  next: number,
  person: string | null,
) => spendCapReached(tx, evalFeature, settings, next, person)

export { formatUsd }
