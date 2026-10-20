import { ORPCError } from '@orpc/client'
import type { QuestionComparison, QuestionHistory } from '../../../contract/quality.ts'
import {
  wordingVerdict,
  type Expected,
  type QuestionLayers,
  type Verdict,
} from '../../../domain/golden-question.ts'
import { heldConstant, tryEvidence, type RunSetup } from '../../../domain/quality.ts'
import type { Queryable } from '../../db/database.ts'
import { compareEditions } from '../editions/index.ts'
import { hiddenQuestions, readableAreas } from '../evals/index.ts'
import { againstRun, comparable, iso, loadAreaRun, type ComparableRun } from './runs.ts'

/**
 * The Workbench's reads of one test question (implementation plan, slice W3): the question across
 * two runs of its area, try by try, and its history over the area's recent runs and editions.
 * Both read what the evaluation runner already stores and store nothing. Like `evals.transcript`
 * they are for the owners and deputies of the question's area and administrators; a held-out
 * question is not found for anyone else, so its id is never confirmed (FR-503).
 */

type Side = QuestionComparison['run']
type Named = QuestionComparison['items'][number]['named'][number]
const namings = ['must_deliver', 'must_not_deliver', 'reachable_via_link'] as const

/** The question's area, once the reader may read it: not found when held out from them. */
async function readableQuestion(tx: Queryable, id: string): Promise<{ area: string }> {
  const [question] = await tx.query<{ area: string }>(
    'select area_id as area from golden_questions where id=$1',
    [id],
  )
  if (!question || (await hiddenQuestions(tx, [id])).has(id))
    throw new ORPCError('NOT_FOUND', {
      message: "We couldn't find this test question, or you can't see it.",
    })
  await readableAreas(tx, question.area)
  return question
}

/** A run of the question's area that can be compared. */
async function runOf(tx: Queryable, id: string, area: string): Promise<ComparableRun> {
  const run = await loadAreaRun(tx, id)
  comparable(run)
  if (run.area !== area)
    throw new ORPCError('UNPROCESSABLE_CONTENT', {
      message: 'This test run belongs to another domain than the test question.',
    })
  return run
}

type Revision = { wordings: string; expected: Expected }
type CellRow = {
  cell: string
  wording: number
  trial: number
  passed: boolean | null
  refused: boolean
  reused: boolean
  error: string | null
  scores: Record<string, unknown> | null
  messages: unknown[] | null
}

/** One run's side: its setup, the question's verdict and layers, and every try with its answer. */
async function sideOf(
  tx: Queryable,
  run: ComparableRun,
  question: string,
): Promise<{ side: Side; setup: RunSetup; expected: Expected | null }> {
  const [meta] = await tx.query<{
    modelId: string
    judgeModelId: string | null
    toolSchemaDigest: string | null
    promptDigest: string | null
    tries: number
  }>(
    `select model_id as "modelId",judge_model_id as "judgeModelId",
            nullif(tool_schema_digest,'') as "toolSchemaDigest",system_prompt_digest as "promptDigest",tries
       from eval_runs where id=$1`,
    [run.id],
  )
  const revision = run.summary.plan.questions.find((q) => q.id === question)?.revision ?? null
  const result = run.summary.result?.questions.find((q) => q.id === question)
  // A digest of the wordings, so two revisions that kept them compare as the same.
  const [body] =
    revision === null
      ? []
      : await tx.query<Revision>(
          `select encode(sha256(convert_to((body->'wordings')::text,'UTF8')),'hex') as wordings,
                  body->'expected' as expected
             from golden_question_revisions where question_id=$1 and revision=$2`,
          [question, revision],
        )
  // Area runs ask on the live edition alone: the baseline arm.
  const cells = await tx.query<CellRow>(
    `select c.id::text as cell,c.wording::int as wording,c.trial::int as trial,c.passed,c.refused,
            c.reused_from is not null as reused,c.error,c.scores,t.messages
       from eval_cells c left join eval_transcripts t on t.cell_id=coalesce(c.reused_from,c.id)
      where c.run_id=$1 and c.question_id=$2 and c.arm='baseline'
      order by c.wording,c.trial`,
    [run.id, question],
  )
  const wordings = [...new Set(cells.map((c) => c.wording))].map((wording) => {
    const tries = cells.filter((c) => c.wording === wording)
    return {
      wording,
      verdict:
        revision === null
          ? null
          : wordingVerdict(
              tries.map((c) => ({
                passed: c.passed,
                caveat: typeof c.scores?.caveat === 'boolean' ? c.scores.caveat : null,
                checks: tryEvidence(c.scores, []).checks,
              })),
            ),
      tries: tries.map((c) => ({
        cell: c.cell,
        trial: c.trial,
        passed: c.passed,
        refused: c.refused,
        reused: c.reused,
        error: c.error,
        ...tryEvidence(c.scores, c.messages ?? []),
      })),
    }
  })
  const layers: QuestionLayers | null = result?.layers?.baseline ?? null
  return {
    side: {
      run: {
        id: run.id,
        kind: run.kind,
        edition: run.edition,
        finishedAt: run.finishedAt,
        ...meta!,
      },
      revision,
      verdict: result?.baseline ?? null,
      layers,
      wordings,
    },
    setup: {
      edition: run.edition,
      revision,
      wordings: body?.wordings ?? null,
      tries: meta!.tries,
      answer_model: meta!.modelId,
      judge_model: meta!.judgeModelId,
      tool_descriptions: meta!.toolSchemaDigest,
      prompt: meta!.promptDigest,
    },
    expected: body?.expected ?? null,
  }
}

const deliveredIn = (side: Side) =>
  new Set(side.wordings.flatMap((w) => w.tries.flatMap((t) => t.delivered)))

/**
 * One test question across two finished weekly or full runs of its area (by default the weekly
 * run before `run`): each side's setup, verdict, layers and tries with the judge's reason and the
 * answer; what was held constant; and the items the question names or either side delivered that
 * differ between the two editions, from the editions comparison, never worked out again here.
 */
export async function compareQuestion(
  tx: Queryable,
  input: { question: string; run: string; against?: string | undefined },
): Promise<QuestionComparison> {
  const { area } = await readableQuestion(tx, input.question)
  const run = await runOf(tx, input.run, area)
  const before = await againstRun(tx, run, input.against)
  const now = await sideOf(tx, run, input.question)
  const then = before ? await sideOf(tx, before, input.question) : null
  const factors = then
    ? heldConstant(then.setup, now.setup)
    : { held: [], changed: [], unknown: [] }

  const named = new Map<string, Set<Named>>()
  for (const expected of [now.expected, then?.expected])
    for (const naming of namings)
      for (const item of expected?.[naming] ?? [])
        named.set(item, (named.get(item) ?? new Set()).add(naming))
  const delivered = { run: deliveredIn(now.side), against: then ? deliveredIn(then.side) : null }
  const items = [...new Set([...named.keys(), ...delivered.run, ...(delivered.against ?? [])])]
  const editions =
    then && then.side.run.edition !== now.side.run.edition && items.length
      ? await compareEditions(
          tx,
          { from: then.side.run.edition, to: now.side.run.edition, limit: items.length },
          { items },
        )
      : null
  return {
    question: input.question,
    area,
    run: now.side,
    against: then?.side ?? null,
    heldConstant: factors.held,
    changed: factors.changed,
    unknown: factors.unknown,
    items: (editions?.items ?? []).map((item) => ({
      itemId: item.itemId,
      title: item.title,
      kind: item.kind,
      change: item.change,
      fields: item.fields,
      named: namings.filter((naming) => named.get(item.itemId)?.has(naming)),
      delivered: {
        run: delivered.run.has(item.itemId),
        against: delivered.against?.has(item.itemId) ?? false,
      },
    })),
    withheld: editions?.withheld ?? 0,
  }
}

/**
 * One test question in its area's last `limit` finished weekly and full runs, newest first, with
 * its verdict and layers or why it was not tested; and its result in the newest retrieval pass
 * of each of the last `limit` editions that passed it.
 */
export async function questionHistory(
  tx: Queryable,
  question: string,
  limit: number,
): Promise<QuestionHistory> {
  const { area } = await readableQuestion(tx, question)
  const runs = await tx.query<{
    run: string
    kind: 'scheduled' | 'full'
    edition: string
    finishedAt: string
    revision: number | null
    setAside: boolean
    result: { baseline: Verdict | null; layers?: { baseline: QuestionLayers } } | null
  }>(
    `select id::text as run,kind::text as kind,summary->>'edition' as edition,
            ${iso('finished_at')} as "finishedAt",
            (select (p->>'revision')::int from jsonb_array_elements(summary->'plan'->'questions') p
              where p->>'id'=$2) as revision,
            coalesce(summary->'plan'->'setAside' ? $2,false) as "setAside",
            (select q from jsonb_array_elements(summary->'result'->'questions') q
              where q->>'id'=$2) as result
       from eval_runs
      where area_id=$1 and kind in ('scheduled','full') and state='finished' and proposal_id is null
        and summary ? 'result'
      order by finished_at desc,id desc limit $3`,
    [area, question, limit],
  )
  const retrieval = await tx.query<QuestionHistory['retrieval'][number]>(
    `select distinct on (r.edition_seq) r.id::text as run,e.label as edition,r.as_of::text as "asOf",
            x.question_revision as revision,x.passed,x.checks
       from retrieval_results x join retrieval_runs r on r.id=x.run_id join editions e on e.seq=r.edition_seq
      where x.question_id=$1
      order by r.edition_seq desc,r.created_at desc,r.id desc limit $2`,
    [question, limit],
  )
  return {
    question,
    area,
    runs: runs.map((row) => ({
      run: row.run,
      kind: row.kind,
      edition: row.edition,
      finishedAt: row.finishedAt,
      state: row.revision !== null ? 'tested' : row.setAside ? 'set_aside' : 'absent',
      revision: row.revision,
      verdict: row.result?.baseline ?? null,
      layers: row.result?.layers?.baseline ?? null,
    })),
    retrieval,
  }
}
