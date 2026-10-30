import { ORPCError } from '@orpc/client'
import { settingSchemas } from '../../../contract/admin.ts'
import type { Gap, GapDetail, GapHistoryEntry, GapTest } from '../../../contract/gaps.ts'
import { textFindings } from '../../../domain/draft.ts'
import {
  clearsVerification,
  dimensionOfValue,
  gapHistoryActions,
  gapOrigin,
  readerWeek,
  type GapStatus,
  type GapType,
} from '../../../domain/gaps.ts'
import type { Queryable } from '../../db/database.ts'

type GapRow = {
  id: string
  ref: string
  type: GapType
  status: GapStatus
  severity: number
  openedByCase: number
  firstSeen: string
  lastSeen: string
  statusSince: string
  areaId: string | null
  areaIds: string[]
  metricKeys: string[]
  valueKeys: string[]
  dimensionKeys: string[]
  month: string
  weeks: { week: string; reports: number; personReports: number; noItemCalls: number }[]
  proposals: string[]
  canManage: boolean
  minimum: number
  resolvedEdition: string | null
  verifiedAt: string | null
  verifiedEdition: string | null
}

const iso = (column: string) =>
  `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
const minimumCount = `(select (value #>> '{}')::int from settings_current where key = 'privacy.min_count')`

/**
 * Gaps a person may see. Owners of the topic's domains and administrators see every gap in full:
 * a topic that spans domains reaches the owners of each (`cl_manages_topic`).
 * Anyone else sees a gap only through weeks where the topic week reaches the minimum count (the
 * one rule of v_topic_weeks) and the gap's own reports and no-item calls reach it too (FR-614), so
 * this is no way around the topic counts. People's reports never count towards it, nor show to
 * such a reader (`readerWeek`): anyone may add them. Drafts can start from the gaps that show
 * (FR-616).
 */
const visibleGaps = `
  with visible as (
    select g.*, t.area_id, t.metric_keys, t.value_keys, t.dimension_keys, t.month,
           cl_topic_domains(t.area_id, t.metric_keys) as area_ids,
           cl_manages_topic(t.area_id, t.metric_keys) as can_manage
      from gaps g join topics t on t.id = g.topic_id),
  shaped as (
    select v.*,
           coalesce((select jsonb_agg(jsonb_build_object('week', w.week::text, 'reports', w.reports,
                                                    'personReports', w.human_reports, 'noItemCalls', w.no_item_calls)
                     order by w.week)
                       from gap_weekly_counts w
                      where w.gap_id = v.id
                        and (v.can_manage
                             or (w.reports - w.human_reports + w.no_item_calls >= ${minimumCount}
                                 and exists (select 1 from v_topic_weeks tw
                                              where tw.topic_id = v.topic_id and tw.week = w.week and tw.shown)))), '[]') as weeks
      from visible v)
  select v.id::text, v.ref, v.type, v.status, v.severity::int, v.opened_by_case::int as "openedByCase",
         v.first_seen::text as "firstSeen", v.last_seen::text as "lastSeen", ${iso('v.status_since')} as "statusSince",
         v.area_id as "areaId", v.area_ids as "areaIds", v.metric_keys as "metricKeys",
         v.value_keys as "valueKeys", v.dimension_keys as "dimensionKeys", v.month::text as month,
         v.weeks,
         coalesce((select array_agg(p.proposal_id::text order by p.proposal_id) from gap_proposals p where p.gap_id = v.id
           and not exists (select 1 from proposals d where d.id = p.proposal_id and d.discarded_at is not null)), '{}') as proposals,
         v.can_manage as "canManage", ${minimumCount} as minimum,
         (select label from editions where seq = v.resolved_edition_seq) as "resolvedEdition",
         ${iso('v.verified_at')} as "verifiedAt",
         (select label from editions where seq = v.verified_edition_seq) as "verifiedEdition"
    from shaped v
   where (v.can_manage or jsonb_array_length(v.weeks) > 0)`

function toGap(row: GapRow): Gap {
  const {
    openedByCase,
    areaId,
    areaIds,
    metricKeys,
    valueKeys,
    dimensionKeys,
    month,
    weeks,
    minimum,
    resolvedEdition: _resolvedEdition,
    verifiedAt: _verifiedAt,
    verifiedEdition: _verifiedEdition,
    ...rest
  } = row
  const shown = weeks.map((week) => {
    if (row.canManage) return week
    const { shown: _shown, ...counts } = readerWeek(week, minimum)
    return { week: week.week, ...counts }
  })
  const total = (pick: (week: (typeof shown)[number]) => number | null) => {
    const sum = shown.reduce((acc, week) => acc + (pick(week) ?? 0), 0)
    return row.canManage || sum >= minimum ? sum : null
  }
  return {
    ...rest,
    openedBy: gapOrigin(openedByCase),
    topic: {
      areaId,
      areaIds,
      metrics: metricKeys,
      dimensions: dimensionKeys,
      dimensionValues: valueKeys.map((value) => ({ dimension: dimensionOfValue(value), value })),
      month,
    },
    reports: total((week) => week.reports),
    // Never for a reader: anyone may add to it (readerWeek).
    personReports: row.canManage ? total((week) => week.personReports) : null,
    noItemCalls: total((week) => week.noItemCalls),
    weeks: shown,
  }
}

/** The migration's default (0040), for a database that has lost the setting. */
const DEFAULT_GAP_REPORTS_PER_MINUTE = 5

/** A person's gap reports per minute (`limits.gap_reports_per_minute`, FR-408). */
export async function gapReportsPerMinute(tx: Queryable): Promise<number> {
  const [row] = await tx.query<{ value: unknown }>(
    "select value from settings_current where key = 'limits.gap_reports_per_minute'",
  )
  const parsed = settingSchemas['limits.gap_reports_per_minute'].safeParse(row?.value)
  return parsed.success ? parsed.data.person : DEFAULT_GAP_REPORTS_PER_MINUTE
}

function rejectSensitive(text: string, field: string) {
  const findings = textFindings(text, field)
  if (findings.length)
    throw new ORPCError('UNPROCESSABLE_CONTENT', {
      message: 'Remove the email address, phone number or secret from the text.',
      data: { findings },
    })
}

/** A gap and its status. Runs as the API role inside the caller's transaction. */
export function createGapsService(tx: Queryable) {
  async function row(id: string): Promise<GapRow> {
    const [found] = await tx.query<GapRow>(`${visibleGaps} and v.id = $1`, [id])
    if (!found)
      throw new ORPCError('NOT_FOUND', {
        message: "We couldn't find this gap, or you can't see it.",
      })
    return found
  }
  async function managed(id: string) {
    const found = await row(id)
    if (!found.canManage)
      throw new ORPCError('FORBIDDEN', {
        message: 'Only an owner of the domain or an admin can do this.',
      })
    return found
  }
  async function audit(gap: GapRow, action: string, details: Record<string, unknown> = {}) {
    await tx.query(
      `insert into audit_log(actor_id,actor_kind,action,area_id,subject_type,subject_id,details)
       values(cl_person(),'person',$1,$2,'gap',$3,$4)`,
      [action, gap.areaId, gap.ref, JSON.stringify(details)],
    )
  }
  async function get(id: string): Promise<GapDetail> {
    const found = await row(id)
    const detail = {
      ...toGap(found),
      resolvedEdition: found.resolvedEdition,
      verifiedAt: found.verifiedAt,
      verifiedEdition: found.verifiedEdition,
    }
    // Row security on gap_notes and gap_tests holds the same rule (FR-611, FR-610); this only
    // names the answer.
    if (!found.canManage) return { ...detail, notes: null, tests: null, history: null }
    const notes = await tx.query<NonNullable<GapDetail['notes']>[number]>(
      `select id::text, source, note, ${iso('created_hour')} as "createdHour"
         from gap_notes where gap_id = $1 order by created_hour, id`,
      [id],
    )
    const tests = await testsOf(id)
    const history = await tx.query<GapHistoryEntry>(
      `select action, ${iso('hour')} as hour, details from cl_gap_history($1) where action = any($2)`,
      [id, gapHistoryActions],
    )
    return { ...detail, notes, tests, history }
  }
  /**
   * A gap's linked tests, each with its first pass on the resolving edition or a later one, and
   * its result in the newest finished weekly or full run of its area that tested it.
   */
  function testsOf(id: string): Promise<GapTest[]> {
    return tx.query<GapTest>(
      `select x.question_id as question, q.split::text as split, q.status = 'active' as active,
              ${iso('x.linked_hour')} as "linkedHour", x.evidence_run::text as "evidenceRun",
              case when x.passed_run is null then null
                   else jsonb_build_object('run', x.passed_run::text, 'edition', e.label,
                                           'revision', x.passed_revision, 'hour', ${iso('x.passed_hour')}) end as passed,
              (select jsonb_build_object('run', r.id::text, 'kind', r.kind::text, 'edition', r.summary->>'edition',
                                         'finishedAt', ${iso('r.finished_at')}, 'verdict', t->'baseline')
                 from eval_runs r cross join lateral jsonb_array_elements(r.summary->'result'->'questions') t
                where r.area_id = q.area_id and r.kind in ('scheduled', 'full') and r.state = 'finished'
                  and r.proposal_id is null and t->>'id' = x.question_id
                order by r.finished_at desc, r.id desc limit 1) as latest
         from gap_tests x join golden_questions q on q.id = x.question_id
         left join editions e on e.seq = x.passed_edition_seq
        where x.gap_id = $1
        order by x.linked_hour, x.question_id`,
      [id],
    )
  }

  const service = {
    get,
    /**
     * FR-609, FR-610: resolving a gap records the live edition (none when no edition is live yet);
     * leaving `resolved` clears that edition, the verification and every pass of its tests.
     */
    async setStatus(id: string, status: GapStatus, reason?: string): Promise<GapDetail> {
      const gap = await managed(id)
      if (reason !== undefined) rejectSensitive(reason, 'reason')
      if (gap.status === status) return get(id)
      const clears = clearsVerification(gap.status, status)
      const [changed] = await tx
        .query<{ edition: string | null; recorded: boolean }>(
          `with before as (select resolved_edition_seq, verified_at from gaps where id = $1 for update)
           update gaps g set status = $2::gap_status, status_since = date_trunc('hour', now(), 'UTC'),
                  resolved_edition_seq = case when $2::gap_status = 'resolved' then (select seq from live_edition) end,
                  verified_at = null, verified_edition_seq = null
             from before b where g.id = $1
           returning (select label from editions where seq = g.resolved_edition_seq) as edition,
                     (b.resolved_edition_seq is not null or b.verified_at is not null) as recorded`,
          [id, status],
        )
        .catch((error: unknown) => {
          if (error instanceof Error && 'code' in error && error.code === '23505')
            throw new ORPCError('CONFLICT', {
              message: 'This topic already has an open gap of this type.',
            })
          throw error
        })
      const passes = clears
        ? await tx.query(
            `update gap_tests set passed_run = null, passed_edition_seq = null, passed_revision = null,
                    passed_hour = null
              where gap_id = $1 and passed_run is not null returning question_id`,
            [id],
          )
        : []
      await audit(gap, 'gap.status_changed', {
        from: gap.status,
        to: status,
        ...(changed?.edition ? { edition: changed.edition } : {}),
        ...(reason === undefined ? {} : { reason }),
      })
      if (clears && (changed?.recorded || passes.length))
        await audit(gap, 'gap.verification_cleared')
      return get(id)
    },
  }
  return service
}

export type GapsService = ReturnType<typeof createGapsService>
