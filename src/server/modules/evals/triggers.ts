import type { Database } from '../../db/database.ts'
import { toolSchemaDigest } from '../../mcp/tools.ts'
import { queueAreaRun, type EvalDeps, type RunTrigger } from './runs.ts'

/**
 * Full answer runs for changes that bypass the review gate. The gate tests a proposal's
 * impact set only; three other changes can alter answers without a proposal:
 *
 * - `tool_descriptions`: the tool descriptions the model reads changed (a new service version);
 * - `source_sync`: a sync brought changed or missing definitions for an area's metrics;
 * - `date_expiry`: the date alone changed what an area's test questions are delivered: the
 *   live edition's daily retrieval pass differs from the previous pass of the same edition and
 *   serving overlay (retrieval.ts).
 *
 * Each queues one full run of an area that has had a full or scheduled run before (the
 * weekly run covers the rest), unless such a run was already created after the change. Every
 * check reads state, so it is safe to run twice (NFR-047). A run above the budget waits for an
 * administrator (FR-516) and the runner stops at the spending caps (FR-409). A triggered run does
 * not move the baseline (FR-518).
 */
export async function queueTriggeredRuns(
  database: Database,
  deps: EvalDeps,
): Promise<Partial<Record<RunTrigger, string[]>>> {
  // Areas with their newest full or scheduled run, and what changed since it was made.
  const areas = await database.query<{
    area: string
    tools: boolean
    synced: boolean
    expired: boolean
  }>(
    `select l.area_id as area,r.tool_schema_digest<>$1 as tools,
            exists (select 1 from connector_snapshots s join definitions d on d.connector_id=s.connector_id
                     where s.status<>'failed' and s.fetched_at>r.created_at
                       and (d.missing_since_snapshot=s.id or exists (select 1 from definition_marks m
                                                                      where m.snapshot_id=s.id and m.definition_ref=d.ref))
                       and (d.area_hint=l.area_id or exists (select 1 from vocab_term_refs tr
                                                             join vocab_term_versions t on t.id=tr.version_id
                                                             where tr.definition_ref=d.ref and t.area_id=l.area_id))) as synced,
            exists (select 1 from retrieval_runs n
                      join lateral (select p.id from retrieval_runs p
                                     where p.edition_seq=n.edition_seq and p.overlay_seq=n.overlay_seq
                                       and p.created_at<n.created_at order by p.created_at desc limit 1) p on true
                      join retrieval_results x on x.run_id=n.id and x.area_id=l.area_id
                      join retrieval_results o on o.run_id=p.id and o.question_id=x.question_id
                                              and o.question_revision=x.question_revision
                     where n.trigger='daily' and n.created_at>r.created_at
                       and x.delivery_digest<>o.delivery_digest) as expired
       from (select id as area_id from areas where archived_at is null) l
       join lateral (select created_at,tool_schema_digest from eval_runs r
                      where r.area_id=l.area_id and r.kind in ('full','scheduled')
                      order by created_at desc limit 1) r on true
      order by l.area_id`,
    [toolSchemaDigest],
  )
  const queued: Partial<Record<RunTrigger, string[]>> = {}
  for (const { area, tools, synced, expired } of areas) {
    const trigger: RunTrigger | null = tools
      ? 'tool_descriptions'
      : synced
        ? 'source_sync'
        : expired
          ? 'date_expiry'
          : null
    if (!trigger) continue
    const run = await database.transaction(null, (tx) =>
      queueAreaRun(tx, deps, area, 'full', false, trigger),
    )
    if (run) (queued[trigger] ??= []).push(area)
  }
  return queued
}
