import { ORPCError } from '@orpc/client'
import type * as z from 'zod/mini'
import { createHash } from 'node:crypto'
import { settingSchemas } from '../../../contract/admin.ts'
import type {
  Dashboard,
  Gap,
  GapDetail,
  GapHistoryEntry,
  gapListInputSchema,
  GapReport,
  GapReportInput,
  GapTest,
  TopicCounts,
  WeeklyCalls,
} from '../../../contract/gaps.ts'
import { contentDigest } from '../../../domain/canonical.ts'
import type { ProposalRecord } from '../../../contract/proposals.ts'
import { textFindings } from '../../../domain/draft.ts'
import {
  clearsVerification,
  dimensionOfValue,
  draftFromTopic,
  gapHistoryActions,
  gapOrigin,
  readerWeek,
  visibleCount,
  visibleShare,
  visibleTotal,
  type GapStatus,
  type GapType,
} from '../../../domain/gaps.ts'
import { noteFindings, scopeIssueFindings, topicFor } from '../../../domain/gap-reports.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { scopeOf } from '../../mcp/service.ts'
import { loadLiveBundle } from '../editions/index.ts'
import { createProposalsService } from '../proposals/index.ts'

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

/** Gaps, notes and the area dashboard. Runs as the API role inside the caller's transaction. */
export function createGapsService(tx: Queryable, clock: Clock, personId: string) {
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

  return {
    /**
     * FR-606 case 5: a person reports a gap about the scope they were looking at. The scope is
     * resolved on the live edition as get_context resolves it, so a term outside the governed
     * vocabulary is refused and a scope without dates is read at today; the topic comes from it
     * alone (FR-604).
     * One report counts against the topic's gap as report_gap does (FR-308). The function writes
     * no person, and nothing here logs or audits who asked (FR-608, FR-613): the gap's history
     * holds counts only. The retry key makes a double click or a retry count once.
     */
    async report(input: GapReportInput, retryKey: string): Promise<GapReport> {
      const bundle = await loadLiveBundle(tx)
      if (!bundle)
        throw new ORPCError('PRECONDITION_FAILED', {
          message: 'Gaps can be reported once AI apps get their first facts.',
        })
      const { type, note, ...scopeInput } = input
      const scope = scopeOf({ ...scopeInput, question: '' }, bundle, clock.today())
      if (scope.status !== 'resolved')
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message: "Add the metric, the market or the dates it's about.",
          data: { findings: scopeIssueFindings(scope.issues) },
        })
      if (note !== undefined) {
        const findings = noteFindings(note)
        if (findings.length)
          throw new ORPCError('UNPROCESSABLE_CONTENT', {
            message: 'Remove the email address, phone number or secret from the text.',
            data: { findings },
          })
      }
      const topic = topicFor(scope.scope, bundle.metricArea)
      const [row] = await tx
        .query<{ id: string }>(
          `select cl_report_gap_person($1,$2,$3,$4,$5,$6,$7,$8,decode($9,'hex'),decode($10,'hex'))::text as id`,
          [
            topic.key,
            topic.area,
            topic.metrics,
            topic.values,
            topic.dimensions,
            topic.month,
            type,
            note ?? null,
            // Bound to the caller, so one person's key never meets another's, and kept only as a
            // digest with the key, which the page alone holds: it names no one.
            createHash('sha256').update(`${personId}:${retryKey}`).digest('hex'),
            await contentDigest(input),
          ],
        )
        .catch((error: unknown) => {
          // The function refuses a retry key used for another report (22023).
          if (error instanceof Error && 'code' in error && error.code === '22023')
            throw new ORPCError('UNPROCESSABLE_CONTENT', { message: error.message })
          throw error
        })
      return { id: row!.id }
    },
    async list(input: z.infer<typeof gapListInputSchema>): Promise<Gap[]> {
      const rows = await tx.query<GapRow>(
        `${visibleGaps}
           and ($1::text is null or $1 = any(v.area_ids)) and ($2::gap_status is null or v.status = $2)
           and ($3::gap_type is null or v.type = $3)
         order by v.status in ('open', 'proposal_made') desc, v.last_seen desc, v.ref
         limit $4 offset $5`,
        [
          input.areaId ?? null,
          input.status ?? null,
          input.type ?? null,
          input.limit ?? 50,
          input.offset ?? 0,
        ],
      )
      return rows.map(toGap)
    },
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
    /**
     * FR-610: links a test question of the gap's area that captures it, with the failing run that
     * led to it if one is named. A held-out question may be linked: only the gap's managers read
     * its links. Linking it again changes nothing.
     */
    async linkTest(id: string, question: string, evidenceRun?: string): Promise<GapDetail> {
      const gap = await managed(id)
      // A held-out question is not found for anyone but its area's maintainers (FR-503).
      const [found] = await tx.query<{ area: string; readable: boolean }>(
        `select area_id as area,
                split = 'development' or cl_is_admin_now() or cl_is_owner_now(area_id) as readable
           from golden_questions where id = $1`,
        [question],
      )
      if (!found?.readable)
        throw new ORPCError('NOT_FOUND', {
          message: "We couldn't find this test question, or you can't see it.",
        })
      if (!gap.areaIds.includes(found.area))
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message: 'This test question belongs to another domain than the gap.',
        })
      if (evidenceRun !== undefined) {
        const [run] = await tx.query<{ ok: boolean }>(
          `select area_id = $2 and proposal_id is null and kind in ('scheduled', 'full') as ok
             from eval_runs where id = $1`,
          [evidenceRun, found.area],
        )
        if (!run?.ok)
          throw new ORPCError('UNPROCESSABLE_CONTENT', {
            message: 'Choose a weekly or full test run of the gap’s domain.',
          })
      }
      const linked = await tx.query(
        `insert into gap_tests (gap_id, question_id, evidence_run) values ($1, $2, $3)
         on conflict (gap_id, question_id) do nothing returning question_id`,
        [id, question, evidenceRun ?? null],
      )
      if (linked.length)
        await audit(gap, 'gap.test_linked', {
          question,
          ...(evidenceRun === undefined ? {} : { evidenceRun }),
        })
      return get(id)
    },
    /** Unlinks a test. A verification already recorded stays (FR-610); its pass goes with it. */
    async unlinkTest(id: string, question: string): Promise<GapDetail> {
      const gap = await managed(id)
      const unlinked = await tx.query(
        'delete from gap_tests where gap_id = $1 and question_id = $2 returning question_id',
        [id, question],
      )
      if (unlinked.length) await audit(gap, 'gap.test_unlinked', { question })
      return get(id)
    },
    async addNote(id: string, note: string): Promise<GapDetail> {
      const gap = await managed(id)
      rejectSensitive(note, 'note')
      await tx.query(`insert into gap_notes (gap_id, source, note) values ($1, 'owner', $2)`, [
        id,
        note,
      ])
      await audit(gap, 'gap.note_added')
      return get(id)
    },
    /** FR-616: one action from a gap to a draft filled with the topic's scope. */
    async startDraft(id: string, areaId?: string): Promise<ProposalRecord> {
      const gap = await row(id)
      const area = areaId ?? gap.areaId
      if (!area)
        throw new ORPCError('BAD_REQUEST', {
          message: 'This topic covers more than one domain. Choose the domain for the draft.',
        })
      const proposal = await createProposalsService(tx, clock, personId).create({
        draft: draftFromTopic(
          {
            metricKeys: gap.metricKeys,
            valueKeys: gap.valueKeys,
            dimensionKeys: gap.dimensionKeys,
          },
          area,
        ),
        channel: 'form',
      })
      await tx.query('update proposals set source_gap_id = $1 where id = $2', [id, proposal.id])
      await tx.query('insert into gap_proposals (gap_id, proposal_id) values ($1, $2)', [
        id,
        proposal.id,
      ])
      // FR-524: the draft carries the gap's linked development tests of its area, report-only.
      const tests = await tx.query<{ question: string }>(
        'select cl_gap_draft_tests as question from cl_gap_draft_tests($1)',
        [proposal.id],
      )
      await tx.query(
        `update gaps set status = 'proposal_made', status_since = date_trunc('hour', now(), 'UTC')
          where id = $1 and status = 'open'`,
        [id],
      )
      await audit(gap, 'gap.draft_started', {
        proposal: proposal.id,
        ...(tests.length ? { tests: tests.map((test) => test.question) } : {}),
      })
      return proposal
    },
    /** FR-615. Every count of calls below the minimum is hidden (FR-614). */
    async dashboard(areaId: string, weeks = 8): Promise<Dashboard> {
      const today = clock.today()
      const [area] = await tx.query<{ minimum: number; maintains: boolean }>(
        `select ${minimumCount} as minimum, cl_is_admin_now() or cl_is_owner_now(id) as maintains
           from areas where id = $1`,
        [areaId],
      )
      if (!area)
        throw new ORPCError('NOT_FOUND', {
          message: "We couldn't find this domain. Someone may have deleted it.",
        })
      if (!area.maintains)
        throw new ORPCError('FORBIDDEN', {
          message: 'Only the owners of the domain and admins can see its dashboard.',
        })
      const minimum = area.minimum
      const counts = await tx.query<{ week: string; calls: number; noItemCalls: number }>(
        `select w.week::date::text as week, coalesce(sum(c.calls), 0)::int as calls,
                coalesce(sum(c.no_item_calls), 0)::int as "noItemCalls"
           from generate_series(date_trunc('week', $2::date) - make_interval(weeks => $3 - 1),
                                date_trunc('week', $2::date), interval '1 week') w(week)
           left join (topic_week_counts c join topics t on t.id = c.topic_id
                        and $1 = any(cl_topic_domains(t.area_id, t.metric_keys)))
             on c.week = w.week::date
          group by w.week order by w.week`,
        [areaId, today, weeks],
      )
      const [past] = await tx.query<{ n: number }>(
        `select count(*)::int as n from v_item_list
          where area_id = $1 and status = 'accepted' and review_date < $2
            and (valid_until is null or valid_until > $2) and cl_audience_allows(audience_groups)`,
        [areaId, today],
      )
      const open = await tx.query<{ type: GapType; gaps: number }>(
        `select g.type, count(*)::int as gaps from gaps g join topics t on t.id = g.topic_id
          where $1 = any(cl_topic_domains(t.area_id, t.metric_keys)) and g.status in ('open', 'proposal_made')
          group by g.type order by g.type`,
        [areaId],
      )
      const [review] = await tx.query<{ decided: number; medianHours: number | null }>(
        `select decided, median_hours as "medianHours"
           from cl_area_review_times($1, date_trunc('week', $2::date) - make_interval(weeks => $3 - 1))`,
        [areaId, today, weeks],
      )
      return {
        areaId,
        today,
        minimumCount: minimum,
        weeks: counts.map((week) => {
          const calls = visibleCount(week.calls, minimum)
          const noItemCalls = visibleCount(week.noItemCalls, minimum)
          return {
            week: week.week,
            calls,
            noItemCalls,
            noItemShare: visibleShare(noItemCalls, calls),
          }
        }),
        itemsPastReview: past!.n,
        openGaps: open.reduce((sum, row) => sum + row.gaps, 0),
        openGapsByType: open,
        reviewTimes: review!,
      }
    },
    /**
     * Calls per week over every topic, for every reader: Home's exact weekly total. It names no
     * area or topic, so no reader can narrow it, and a total is hidden when it or what it adds
     * over the shown topic weeks is under the minimum (FR-614, `visibleTotal`).
     */
    async weeklyCalls(weeks = 8): Promise<WeeklyCalls> {
      const today = clock.today()
      const counts = await tx.query<{
        week: string
        calls: number
        shownCalls: number
        noItemCalls: number
        shownNoItemCalls: number
        minimum: number
      }>(
        `select w.week::date::text as week, coalesce(sum(c.calls), 0)::int as calls,
                coalesce(sum(c.calls) filter (where c.shown), 0)::int as "shownCalls",
                coalesce(sum(c.no_item_calls), 0)::int as "noItemCalls",
                coalesce(sum(c.shown_no_item_calls) filter (where c.shown), 0)::int as "shownNoItemCalls",
                ${minimumCount} as minimum
           from generate_series(date_trunc('week', $1::date) - make_interval(weeks => $2 - 1),
                                date_trunc('week', $1::date), interval '1 week') w(week)
           left join v_topic_weeks c on c.week = w.week::date
          group by w.week order by w.week`,
        [today, weeks],
      )
      const minimum = counts[0]!.minimum
      return {
        minimumCount: minimum,
        weeks: counts.map((week) => ({
          week: week.week,
          calls: visibleTotal(week.calls, week.shownCalls, minimum),
          noItemCalls: visibleTotal(week.noItemCalls, week.shownNoItemCalls, minimum),
          shownCalls: week.shownCalls,
        })),
      }
    },
    /** Calls per topic and week. Topic detail only where the week reaches the minimum (FR-614). */
    async topicCounts(areaId?: string, weeks = 8): Promise<TopicCounts> {
      const today = clock.today()
      const rows = await tx.query<{
        areaId: string | null
        areaIds: string[]
        metricKeys: string[]
        valueKeys: string[]
        dimensionKeys: string[]
        month: string
        week: string
        calls: number
        noItemCalls: number | null
        minimum: number
        hidden: number
      }>(
        `with c as (
           select c.topic_id, c.week, c.calls, c.shown_no_item_calls, c.shown
             from v_topic_weeks c join topics t on t.id = c.topic_id
            where c.week >= date_trunc('week', $2::date) - make_interval(weeks => $3 - 1)
              and ($1::text is null or $1 = any(cl_topic_domains(t.area_id, t.metric_keys)))),
         m as (select ${minimumCount} as minimum)
         select t.area_id as "areaId", cl_topic_domains(t.area_id, t.metric_keys) as "areaIds", t.metric_keys as "metricKeys", t.value_keys as "valueKeys",
                t.dimension_keys as "dimensionKeys", t.month::text as month, c.week::text as week, c.calls, c.shown_no_item_calls as "noItemCalls",
                m.minimum, (select count(*)::int from c where not c.shown) as hidden
           from m left join (c join topics t on t.id = c.topic_id) on c.shown
          order by c.week desc nulls last, c.calls desc, t.key`,
        [areaId ?? null, today, weeks],
      )
      const minimum = rows[0]!.minimum
      return {
        minimumCount: minimum,
        rows: rows
          .filter((row) => row.week !== null)
          .map((row) => ({
            topic: {
              areaId: row.areaId,
              areaIds: row.areaIds,
              metrics: row.metricKeys,
              dimensions: row.dimensionKeys,
              dimensionValues: row.valueKeys.map((value) => ({
                dimension: dimensionOfValue(value),
                value,
              })),
              month: row.month,
            },
            week: row.week,
            calls: row.calls,
            noItemCalls: row.noItemCalls,
            noItemShare: visibleShare(row.noItemCalls, row.calls),
          })),
        hiddenTopicWeeks: rows[0]!.hidden,
      }
    },
  }
}

export type GapsService = ReturnType<typeof createGapsService>
