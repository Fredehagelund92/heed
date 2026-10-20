import { ORPCError } from '@orpc/client'
import type { Queryable } from '../../db/database.ts'
import type { RunSummary } from '../evals/index.ts'

/** A run of an area as the Quality reads compare it: its kind, state, edition and summary. */
export type AreaRun = {
  id: string
  kind: 'scheduled' | 'full' | 'impact' | 'links'
  state: string
  area: string | null
  edition: string
  finishedAt: string | null
  summary: RunSummary
}
/** A run that can be compared: a finished weekly or full run of an area, with its result. */
export type ComparableRun = AreaRun & {
  kind: 'scheduled' | 'full'
  area: string
  finishedAt: string
}

export const iso = (column: string) =>
  `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`

/** A run that is not a proposal's, or not found. */
export async function loadAreaRun(tx: Queryable, id: string): Promise<AreaRun> {
  const [run] = await tx.query<AreaRun>(
    `select id::text,kind::text,state::text,area_id as area,summary->>'edition' as edition,
            ${iso('finished_at')} as "finishedAt",summary
       from eval_runs where id=$1 and proposal_id is null`,
    [id],
  )
  if (!run) throw new ORPCError('NOT_FOUND', { message: "We couldn't find this test run." })
  return run
}

export function comparable(run: AreaRun): asserts run is ComparableRun {
  if (
    (run.kind !== 'scheduled' && run.kind !== 'full') ||
    run.state !== 'finished' ||
    !run.area ||
    !run.summary.result
  )
    throw new ORPCError('UNPROCESSABLE_CONTENT', {
      message: 'Only finished weekly and full test runs of a domain can be compared.',
    })
}

/**
 * The run to compare `run` with: `againstId`, which must be a comparable run of the same area,
 * or by default the weekly run of the area that finished before it; null when there is none.
 */
export async function againstRun(
  tx: Queryable,
  run: ComparableRun,
  againstId: string | undefined,
): Promise<ComparableRun | null> {
  if (againstId) {
    const against = await loadAreaRun(tx, againstId)
    if (against.area !== run.area)
      throw new ORPCError('UNPROCESSABLE_CONTENT', {
        message: "Test runs of different domains can't be compared.",
      })
    comparable(against)
    return against
  }
  const [previous] = await tx.query<{ id: string }>(
    `select id::text from eval_runs
      where area_id=$1 and kind='scheduled' and state='finished' and id<>$2
        and finished_at < (select finished_at from eval_runs where id=$2)
      order by finished_at desc, id desc limit 1`,
    [run.area, run.id],
  )
  // The query asks for a finished weekly run of the area, so it compares.
  return previous ? ((await loadAreaRun(tx, previous.id)) as ComparableRun) : null
}
