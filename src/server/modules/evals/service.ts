import { ORPCError } from '@orpc/client'
import type * as z from 'zod/mini'
import type { EvalRun, runDetailSchema } from '../../../contract/evals.ts'
import type { Agreement } from '../../../domain/golden-question.ts'
import type { Queryable } from '../../db/database.ts'
import { importQuestions } from './questions.ts'
import {
  planArea,
  resumeRun,
  runColumns,
  type EvalDeps,
  type RunRow,
  type Scorecard,
} from './runs.ts'

type RunDetail = z.infer<typeof runDetailSchema>

export function publicRun(
  row: RunRow & { test_set_digest?: string; tool_schema_digest?: string },
): EvalRun {
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    areaId: row.area_id,
    proposalId: row.proposal_id,
    itemVersionId: row.item_version_id,
    edition: row.summary.edition,
    modelId: row.model_id,
    judgeModelId: row.judge_model_id,
    modelProvider: row.answer_provider,
    judgeProvider: row.judge_provider,
    modelFamily: row.answer_family,
    judgeFamily: row.judge_family,
    judgeSameFamily:
      row.answer_family && row.judge_family ? row.answer_family === row.judge_family : null,
    modelVendor: row.answer_vendor,
    judgeVendor: row.judge_vendor,
    judgeSameVendor:
      row.answer_vendor && row.judge_vendor ? row.answer_vendor === row.judge_vendor : null,
    trigger: row.summary.trigger ?? null,
    toolSchemaDigest: row.tool_schema_digest ?? '',
    testSetDigest: row.test_set_digest ?? '',
    tries: row.tries,
    flipRepeats: row.flip_repeats,
    questions: row.summary.plan.questions.length,
    setAside: row.summary.plan.setAside.length,
    estimatedCostMicros: Number(row.estimated_cost_micros),
    actualCostMicros: Number(row.actual_cost_micros),
    costCeilingMicros: row.cost_ceiling_micros === null ? null : Number(row.cost_ceiling_micros),
    passRule: row.summary.passRule ?? 'majority',
    requestedBy: row.requested_by,
    approvedBy: row.approved_by,
    failure: row.failure,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }
}
const columns = `${runColumns},tool_schema_digest,encode(test_set_digest,'hex') as test_set_digest`
/**
 * A proposal's runs are visible to whoever may read the proposal (row security decides), so its
 * review screen shows them to the proposer and the approvers. Other runs are test results: for
 * the owners and deputies of their area, administrators, and the person who started the run.
 */
const visible = `(case when proposal_id is not null
    then exists (select 1 from proposals p where p.id=eval_runs.proposal_id)
    else cl_is_admin_now() or requested_by = cl_person()
         or (area_id is not null and cl_is_owner_now(area_id)) end)`

async function maintains(tx: Queryable, area: string | null) {
  const [row] = await tx.query<{ ok: boolean }>(
    'select cl_is_admin_now() or ($1::text is not null and cl_is_owner_now($1)) as ok',
    [area],
  )
  return row?.ok ?? false
}

/**
 * Held-out questions are for checks and reports only (FR-503): writers never learn which they
 * are. Returns the ids among `ids` the reader may not see: held-out, outside the areas they
 * maintain.
 */
async function hiddenQuestions(tx: Queryable, ids: readonly string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const rows = await tx.query<{ id: string }>(
    `select id from golden_questions where id=any($1) and split='held_out'
       and not (cl_is_admin_now() or cl_is_owner_now(area_id))`,
    [[...new Set(ids)]],
  )
  return new Set(rows.map((r) => r.id))
}
const heldOutLabel = 'held-out'
type PublicScorecard = Omit<Scorecard, 'layers' | 'failedChecks' | 'agreement'> & {
  layers: NonNullable<Scorecard['layers']> | null
  failedChecks: NonNullable<Scorecard['failedChecks']> | null
  agreement: NonNullable<Scorecard['agreement']> | null
}
/** Judge against code, with held-out questions named as such to those who may not see them. */
function redactAgreement<T extends Agreement | null | undefined>(
  agreement: T,
  hidden: Set<string>,
): T {
  if (!agreement) return agreement
  const shown = (ids: string[]) => ids.map((id) => (hidden.has(id) ? heldOutLabel : id))
  return {
    ...agreement,
    judgePassedCodeFailed: shown(agreement.judgePassedCodeFailed),
    codePassedJudgeFailed: shown(agreement.codePassedJudgeFailed),
  }
}
function redactCard(card: Scorecard | null, hidden: Set<string>): PublicScorecard | null {
  if (!card) return null
  const shown = (ids: string[]) => ids.map((id) => (hidden.has(id) ? heldOutLabel : id))
  return {
    ...card,
    failing: shown(card.failing),
    regressions: shown(card.regressions),
    // Runs scored before the layers were kept have none.
    layers: card.layers ?? null,
    failedChecks: card.failedChecks ?? null,
    agreement: redactAgreement(card.agreement ?? null, hidden),
  }
}

/**
 * `reader` is who reads runs: a signed-in person sees the runs they requested or maintain, while
 * the operator, at the command line with the database's own credentials (`npm run eval`), reads
 * any run. Held-out questions stay hidden from both unless the person maintains their area.
 */
export function createEvalsService(
  tx: Queryable,
  deps: EvalDeps,
  reader: 'person' | 'operator' = 'person',
) {
  const seen = reader === 'operator' ? 'true' : visible
  async function loadRun(
    id: string,
    lock = false,
  ): Promise<RunRow & { test_set_digest: string; tool_schema_digest: string }> {
    const [row] = await tx.query<RunRow & { test_set_digest: string; tool_schema_digest: string }>(
      `select ${columns} from eval_runs where id=$1 and ${seen}${lock ? ' for update' : ''}`,
      [id],
    )
    if (!row) throw new ORPCError('NOT_FOUND', { message: "We couldn't find this test run." })
    return row
  }
  return {
    questions: {
      import: (input: { content: string; dryRun: boolean }) =>
        importQuestions(tx, input.content, input.dryRun),
    },
    runs: {
      async list(filter: {
        area?: string | undefined
        proposal?: string | undefined
        limit?: number | undefined
      }) {
        const rows = await tx.query<
          RunRow & { test_set_digest: string; tool_schema_digest: string }
        >(
          `select ${columns} from eval_runs
            where ($1::text is null or area_id=$1) and ($2::uuid is null or proposal_id=$2) and ${seen}
            order by created_at desc limit $3`,
          [filter.area ?? null, filter.proposal ?? null, filter.limit ?? 20],
        )
        return rows.map(publicRun)
      },
      async get(id: string): Promise<RunDetail> {
        const row = await loadRun(id)
        const cells = await tx.query<RunDetail['cells'][number]>(
          `select id::text,question_id as "questionId",wording::int as wording,arm::text as arm,trial::int as trial,
                  state::text as state,passed,refused,reused_from is not null as reused,error,
                  failure_kind as "failureKind",
                  coalesce(cost_micros,0)::float8 as "costMicros"
             from eval_cells where run_id=$1 order by question_id,wording,arm,trial`,
          [id],
        )
        const [judging] = await tx.query<RunDetail['judging']>(
          `select count(*) filter (where state='finished' and not refused)::int as judged,
                  count(*) filter (where state='finished' and scores ? 'judgeError')::int as errors
             from eval_cells where run_id=$1`,
          [id],
        )
        const hidden = await hiddenQuestions(tx, [
          ...row.summary.plan.questions.map((q) => q.id),
          ...cells.map((c) => c.questionId),
        ])
        const shown = (id: string) => (hidden.has(id) ? heldOutLabel : id)
        const results = (row.summary.result?.questions ?? []).map((q) => ({
          ...q,
          id: shown(q.id),
          layers: q.layers ?? null,
        }))
        return {
          run: publicRun(row),
          results,
          flips: results.flatMap((q) => (q.flip ? [{ id: q.id, flip: q.flip }] : [])),
          levels: row.summary.result?.levels ?? {},
          scorecard: redactCard(row.summary.result?.scorecard ?? null, hidden),
          links: row.summary.result?.links
            ? {
                ...row.summary.result.links,
                gained: row.summary.result.links.gained.map(shown),
                lost: row.summary.result.links.lost.map(shown),
              }
            : null,
          replay: row.summary.replay ?? null,
          agreement: row.summary.result?.agreement
            ? {
                baseline: redactAgreement(row.summary.result.agreement.baseline, hidden),
                candidate: redactAgreement(row.summary.result.agreement.candidate, hidden),
              }
            : null,
          judging: judging ?? { judged: 0, errors: 0 },
          stopped: row.state === 'incomplete' ? (row.summary.stopped ?? null) : null,
          cells: cells.map((c) => ({ ...c, questionId: shown(c.questionId) })),
        }
      },
      async estimate(area: string, kind: 'full' | 'links' = 'full') {
        const plan = await planArea(tx, deps, area, kind)
        const [budget] = await tx.query<{ n: number }>(
          "select (value #>> '{}')::bigint::float8 as n from settings_current where key='evals.run_budget_micros'",
        )
        const budgetMicros = budget?.n ?? 2_000_000
        return {
          area,
          kind,
          edition: plan?.head.label ?? null,
          questions: plan?.planned.length ?? 0,
          setAside: plan?.setAside.length ?? 0,
          cells: plan?.cost.cells ?? 0,
          cached: plan?.cost.cached ?? 0,
          costMicros: plan?.cost.micros ?? 0,
          budgetMicros,
          needsApproval: (plan?.cost.micros ?? 0) > budgetMicros,
          modelId: plan?.models.answer.id ?? deps.port.choose('eval_answer').id,
        }
      },
      /** FR-516: an administrator approves a run estimated above the budget. */
      async approve(id: string) {
        const run = await loadRun(id, true)
        if (run.state !== 'awaiting_approval')
          throw new ORPCError('CONFLICT', {
            message: 'This test run no longer waits for approval.',
          })
        await tx.query("update eval_runs set state='queued',approved_by=cl_person() where id=$1", [
          id,
        ])
        await tx.query(
          `insert into audit_log(actor_id,actor_kind,action,area_id,subject_type,subject_id,details)
           values(cl_person(),'person','eval_run.approved',$1,'eval_run',$2,$3)`,
          [
            run.area_id,
            id,
            JSON.stringify({ estimatedCostMicros: Number(run.estimated_cost_micros) }),
          ],
        )
        return publicRun(await loadRun(id))
      },
      async cancel(id: string) {
        const run = await loadRun(id, true)
        const [me] = await tx.query<{ id: string | null }>('select cl_person()::text as id')
        const requester = run.requested_by !== null && me?.id === run.requested_by
        if (!requester && !(await maintains(tx, run.area_id)))
          throw new ORPCError('FORBIDDEN', {
            message:
              'Only the person who started this test run, an owner of the domain or an admin can cancel it.',
          })
        if (['finished', 'failed', 'cancelled'].includes(run.state))
          throw new ORPCError('CONFLICT', { message: 'This test run has already ended.' })
        await tx.query(
          "update eval_runs set state='cancelled',finished_at=now(),worker=null,lease_until=null where id=$1",
          [id],
        )
        return publicRun(await loadRun(id))
      },
      /**
       * R6: an incomplete run is queued again; only its missing answers are made. A run approved
       * with a cost ceiling at the command line ran with that command's models: it is resumed there.
       */
      async resume(id: string) {
        const run = await loadRun(id, true)
        const [me] = await tx.query<{ id: string | null }>('select cl_person()::text as id')
        const requester = run.requested_by !== null && me?.id === run.requested_by
        if (!requester && !(await maintains(tx, run.area_id)))
          throw new ORPCError('FORBIDDEN', {
            message:
              'Only the person who started this test run, an owner of the domain or an admin can resume it.',
          })
        if (run.state !== 'incomplete')
          throw new ORPCError('CONFLICT', {
            message: 'Only a test run that stopped before it finished can be resumed.',
          })
        if (run.cost_ceiling_micros !== null)
          throw new ORPCError('CONFLICT', {
            message: `This test run was approved at the command line with a spending limit. Resume it there: npm run eval -- --resume ${id}`,
          })
        await resumeRun(tx, id)
        return publicRun(await loadRun(id))
      },
    },
  }
}
export type EvalsService = ReturnType<typeof createEvalsService>
