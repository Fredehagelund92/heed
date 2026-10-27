import * as z from 'zod/mini'
import type { AttachedTest, Gate, LevelResult } from '../../../contract/review.ts'
import { contentDigest } from '../../../domain/canonical.ts'
import { formatOutcome, type Draft } from '../../../domain/draft.ts'
import { retrievalChecks } from '../../../domain/golden-question.ts'
import type { ItemVersion } from '../../../domain/item-version.ts'
import { matchingCheck, matchingProbes } from '../../../domain/review.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { asDelivered, loadServingBundle, type ServingBundle } from '../editions/index.ts'
import { deliver, deliveredIds } from '../evals/index.ts'
import {
  attachedQuestions,
  attachedTests,
  candidateBundle,
  checkDraft,
  type StoredVersion,
} from '../proposals/index.ts'

export type Head = { seq: string; label: string; overlay: string }
type Outcome = 'passed' | 'failed' | 'error'
export type CheckRun = {
  level: 'format' | 'matching' | 'delivery'
  outcome: Outcome
  details: object
}

/** The live edition, or the empty one before the first is published: the checks then read nothing live. */
async function liveHead(tx: Queryable): Promise<Head> {
  const [head] = await tx.query<Head>(
    `select e.seq::text,e.label,coalesce((select seq::text from serving_overlay),'0') as overlay
       from editions e join live_edition l on l.seq=e.seq`,
  )
  return head ?? { seq: '0', label: '', overlay: '0' }
}

/** The governed content as a draft, so level 1 runs on exactly what was submitted. */
export function draftOf(version: ItemVersion): Draft {
  const { proposerId: _p, createdVia: _c, mentions: _m, ...draft } = version
  return draft
}

const wording = z.union([z.string(), z.object({ text: z.string() })])
const goldenQuestion = z.object({
  id: z.string(),
  wordings: z.array(wording).check(z.minLength(1)),
  scope: z.object({
    metrics: z.optional(z.array(z.string())),
    dimension_filters: z.optional(
      z.array(z.object({ dimension: z.string(), values: z.array(z.string()) })),
    ),
    window: z.optional(z.object({ from: z.string(), to: z.string() })),
  }),
  expected: z.object({
    must_deliver: z.optional(z.array(z.string())),
    must_not_deliver: z.optional(z.array(z.string())),
  }),
})

type Reply = Awaited<ReturnType<typeof deliver>>
const delivered = (reply: Reply) => new Set(deliveredIds(reply))

/**
 * Level 3 (FR-507): the candidate goes through the live reply's code. Its own probe must deliver
 * it, the items it replaces must be absent and the reply must fit the size limit. The area's
 * active test questions keep their expected and forbidden items: a question that passes on the
 * live edition must not fail with the candidate. A question attached to the proposal (FR-524) is
 * marked so its result reads with the change; attaching it changes no outcome.
 */
async function deliveryCheck(
  tx: Queryable,
  clock: Clock,
  live: ServingBundle,
  candidate: ServingBundle,
  stored: Candidate,
  attached: ReadonlySet<string>,
): Promise<{ outcome: Outcome; details: object }> {
  const id = stored.itemId
  const own = candidate.items.find((i) => i.id === id)!
  const probe = matchingProbes(own, candidate, candidate.terms)[0]!
  const input = {
    question: '',
    metrics: probe.scope.metrics,
    dimension_filters: Object.entries(probe.scope.filters).map(([dimension, values]) => ({
      dimension,
      values,
    })),
    window: { from: probe.scope.window.start, to: probe.scope.window.start },
  }
  const serving = asDelivered(candidate, stored.version.areaId)
  const reply = await deliver(serving, clock, input)
  const ids = delivered(reply)
  const cut = reply.check_report?.cut_ids?.includes(id) ?? false
  const replacedShown = stored.version.replaces.filter((r) => ids.has(r))
  const ownOk = reply.status !== 'check_failed' && (ids.has(id) || cut)
  const rows = await tx.query<{ id: string; wordings: unknown; scope: unknown; expected: unknown }>(
    `select id,wordings,scope,expected from golden_questions
      where area_id=$1 and status='active' order by id`,
    [stored.version.areaId],
  )
  const baseline = asDelivered(live, stored.version.areaId)
  const questions = []
  for (const row of rows) {
    const mark = attached.has(row.id) ? { attached: true } : {}
    const parsed = goldenQuestion.safeParse(row)
    if (!parsed.success) {
      questions.push({
        id: row.id,
        error: 'The test question cannot be read',
        regression: false,
        ...mark,
      })
      continue
    }
    const q = parsed.data
    const first = q.wordings[0]!
    const ask = {
      question: typeof first === 'string' ? first : first.text,
      ...q.scope,
    }
    // The retrieval pass's own checks, without the status: the gate never asked for it.
    const passes = (reply: Reply) => {
      const checks = retrievalChecks(
        {
          must_deliver: q.expected.must_deliver ?? [],
          must_not_deliver: q.expected.must_not_deliver ?? [],
        },
        { status: reply.status ?? null, delivered: deliveredIds(reply) },
      )
      return checks.delivered && checks.not_delivered && reply.status !== 'check_failed'
    }
    const before = passes(await deliver(baseline, clock, ask))
    const after = passes(await deliver(serving, clock, ask))
    const names = [...(q.expected.must_deliver ?? []), ...(q.expected.must_not_deliver ?? [])]
    questions.push({
      id: q.id,
      baseline: before,
      candidate: after,
      regression: !after && (before || names.includes(id)),
      ...mark,
    })
  }
  const passed = ownOk && !replacedShown.length && !questions.some((q) => q.regression)
  return {
    outcome: passed ? 'passed' : 'failed',
    details: {
      probe: input,
      status: reply.status ?? 'check_failed',
      delivered: ids.has(id),
      cut,
      replacedShown,
      questions,
      note: 'Checked as delivered once nothing stops it.',
    },
  }
}

/**
 * The live edition's bundle, read once per transaction while the edition and the overlay stay
 * the same: a bulk decision checks each of its proposals against it, and publishes only after
 * the last one, so it reads the bundle once instead of once per proposal. Nothing reads a bundle
 * to change it: a candidate is a copy (`candidateBundle`).
 */
const liveBundles = new WeakMap<Queryable, { head: string; bundle: Promise<ServingBundle> }>()
function liveBundle(tx: Queryable, head: Head): Promise<ServingBundle> {
  const key = `${head.seq}/${head.overlay}`
  const held = liveBundles.get(tx)
  if (held?.head === key) return held.bundle
  const bundle = loadServingBundle(tx, head)
  liveBundles.set(tx, { head: key, bundle })
  // A failed read is not kept: the next check reads again.
  bundle.catch(() => {
    if (liveBundles.get(tx)?.bundle === bundle) liveBundles.delete(tx)
  })
  return bundle
}

/** A version to check: a submitted one, or a draft the person has not submitted yet. */
export type Candidate = Pick<StoredVersion, 'itemId' | 'versionNo' | 'version'>

/** Levels 1 to 3 against the live edition, recording nothing. */
async function computeChecks(
  tx: Queryable,
  clock: Clock,
  proposal: { id: string | null; channel: ItemVersion['createdVia'] },
  stored: Candidate,
  levels: readonly CheckRun['level'][],
): Promise<{ head: Head; runs: CheckRun[] }> {
  const head = await liveHead(tx)
  const today = clock.today()
  const live = await liveBundle(tx, head)
  const candidate = candidateBundle(live, {
    id: stored.itemId,
    versionNo: stored.versionNo,
    proposerId: stored.version.proposerId,
    version: stored.version,
  })
  const runs: CheckRun[] = []
  if (levels.includes('format')) {
    const format = await checkDraft(
      tx,
      draftOf(stored.version),
      stored.version.proposerId,
      proposal.channel,
      stored.itemId,
    )
    runs.push({
      level: 'format',
      outcome: formatOutcome(format.findings),
      details: { findings: format.findings },
    })
  }
  if (levels.includes('matching')) {
    const matching = matchingCheck(candidate, stored.itemId, candidate.terms, today)
    runs.push({
      level: 'matching',
      outcome: matching.passed ? 'passed' : 'failed',
      details: { edition: head.label, probes: matching.probes },
    })
  }
  if (levels.includes('delivery')) {
    const attached = await attachedQuestions(tx, proposal.id)
    runs.push({
      level: 'delivery',
      ...(await deliveryCheck(tx, clock, live, candidate, stored, attached)),
    })
  }
  return { head, runs }
}

/** Runs levels 1 to 3 against the live edition and records each result (FR-505 to FR-507). */
export async function runChecks(
  tx: Queryable,
  clock: Clock,
  proposal: { id: string; channel: ItemVersion['createdVia'] },
  stored: StoredVersion,
  levels: readonly CheckRun['level'][] = ['format', 'matching', 'delivery'],
): Promise<CheckRun[]> {
  const { head, runs } = await computeChecks(tx, clock, proposal, stored, levels)
  const today = clock.today()
  const rows = await Promise.all(
    runs.map(async (run) => ({
      level: run.level,
      outcome: run.outcome,
      digest: await contentDigest({
        level: run.level,
        edition: head.label,
        overlay: head.overlay,
        version: stored.digest,
        today,
      }),
      details: run.details,
    })),
  )
  // Every level's result in one statement, in the order the levels ran.
  await tx.query(
    `insert into check_results(item_version_id,level,outcome,inputs_digest,details)
     select $1,(r->>'level')::check_level,(r->>'outcome')::check_outcome,decode(r->>'digest','hex'),r->'details'
       from jsonb_array_elements($2::jsonb) with ordinality as x(r,n) order by x.n`,
    [stored.id, JSON.stringify(rows)],
  )
  return runs
}

export type DraftToCheck = {
  draft: Draft
  proposerId: string | null
  channel: ItemVersion['createdVia']
  itemId: string | null
  /** Names a new item's place in the candidate edition: the proposal id, or any unique key. */
  key: string
  /** A saved draft's proposal, whose attached tests level 3 reports (FR-524); null for none. */
  proposalId: string | null
}
export type DraftCheck =
  CheckRun | { level: CheckRun['level']; outcome: 'not_run'; details: { reason: string } }

/**
 * Levels 1 to 3 on a draft, exactly as submit and review run them, recording nothing: the
 * assistant explains these results and never decides them (FR-704, FR-708). Levels 2 and 3 wait
 * for a draft that passes level 1, and for a live edition.
 */
export async function draftChecks(
  tx: Queryable,
  clock: Clock,
  draft: DraftToCheck,
): Promise<{ edition: string | null; levels: DraftCheck[] }> {
  const format = await checkDraft(tx, draft.draft, draft.proposerId, draft.channel, draft.itemId)
  const levels: DraftCheck[] = [
    {
      level: 'format',
      outcome: formatOutcome(format.findings),
      details: { findings: format.findings },
    },
  ]
  const notRun = (reason: string) =>
    (['matching', 'delivery'] as const).map((level) => ({
      level,
      outcome: 'not_run' as const,
      details: { reason },
    }))
  if (!format.version || format.findings.some((f) => f.severity === 'error'))
    return { edition: null, levels: [...levels, ...notRun('Resolve the format checks first.')] }
  if (!(await tx.query('select 1 from live_edition')).length)
    return { edition: null, levels: [...levels, ...notRun('There is no live edition yet.')] }
  const id = draft.itemId ?? `itm_${draft.key.replaceAll('-', '').slice(-16)}`
  const [live] = await tx.query<{ version_no: number }>(
    `select max(v.version_no) as version_no from item_versions v where v.item_id=$1`,
    [id],
  )
  const { head, runs } = await computeChecks(
    tx,
    clock,
    { id: draft.proposalId, channel: draft.channel },
    { itemId: id, versionNo: (live?.version_no ?? 0) + 1, version: format.version },
    ['matching', 'delivery'],
  )
  return { edition: head.label, levels: [...levels, ...runs] }
}

/**
 * The newest result of every required level (levels 1 to 3, FR-513), whether an owner or an
 * administrator accepted, and the database's own verdict. No approver is needed any more, so its
 * approval is always null.
 */
export async function readGate(tx: Queryable, versionId: string): Promise<Gate> {
  const levels = await tx.query<LevelResult>(
    `select need.level::text as level,coalesce(r.outcome::text,'not_run') as outcome,
            r.ran_at::text as "ranAt",coalesce(r.details,'{}'::jsonb) as details
       from item_versions v cross join unnest(cl_required_levels(v.risk)) with ordinality as need(level,n)
       left join lateral (select c.outcome,c.ran_at,c.details from check_results c
              where c.item_version_id=v.id and c.level=need.level order by c.ran_at desc,c.id desc limit 1) r on true
      where v.id=$1 order by need.n`,
    [versionId],
  )
  const [row] = await tx.query<{ owner: boolean; problem: string | null }>(
    `select exists(select 1 from decisions d where d.item_version_id=v.id and d.outcome='accept'
              and d.capacity in ('owner','deputy','administrator')) as owner,
            cl_item_version_problem(v.id) as problem
       from item_versions v where v.id=$1`,
    [versionId],
  )
  return {
    required: levels.map((l) => l.level),
    levels,
    approvals: { owner: row?.owner ?? false, approver: null },
    problem: row?.problem ?? null,
    attached: await attachedResults(tx, versionId, levels),
  }
}

/**
 * FR-524: the tests attached to the version's proposal, each with its result in the newest level 3
 * check. A test attached after that ran has no result there until it runs again. No answer tests
 * run on a suggestion, so no attached test has an answer result.
 */
async function attachedResults(
  tx: Queryable,
  versionId: string,
  levels: readonly LevelResult[],
): Promise<AttachedTest[]> {
  const [proposal] = await tx.query<{ id: string }>(
    'select id::text from proposals where item_version_id=$1 order by created_at desc limit 1',
    [versionId],
  )
  if (!proposal) return []
  const tests = await attachedTests(tx, proposal.id)
  let delivery: (LevelResult & { level: 'delivery' })['details'] | undefined
  for (const level of levels)
    if (level.outcome !== 'not_run' && level.level === 'delivery') delivery = level.details
  return tests.map((test) => {
    const checked = delivery?.questions?.find((q) => q.id === test.question)
    return {
      ...test,
      retrieval:
        checked?.baseline === undefined || checked.candidate === undefined
          ? null
          : { baseline: checked.baseline, candidate: checked.candidate },
      answer: null,
    }
  })
}

export const gatePasses = (gate: Gate) => gate.levels.every((l) => l.outcome === 'passed')
