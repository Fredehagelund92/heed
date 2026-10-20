import type { Verdict } from '../../../domain/golden-question.ts'
import {
  gapVerification,
  passVerifies,
  verifyingRunKinds,
  type LinkedTest,
} from '../../../domain/gaps.ts'
import type { Queryable } from '../../db/database.ts'

/** A finished answer run, as `finishRun` returns it. */
type FinishedRun = {
  id: string
  kind: string
  state: string
  area_id: string | null
  proposal_id: string | null
  item_version_id: string | null
  baseline_edition_seq: string | null
  summary: { result?: { questions: { id: string; baseline: Verdict | null }[] } }
}

/** One linked test of a resolved gap with the run's area among its domains (`cl_gap_run_tests`). */
type LinkRow = {
  gap: string
  ref: string
  resolvedSeq: string
  verified: boolean
  question: string
  active: boolean
  passedSeq: string | null
  passedHour: Date | null
}

/** A gap a run verified: its id, its reference, the edition it was verified on and the hour. */
export type VerifiedGap = { id: string; ref: string; edition: string; hour: string }

/**
 * FR-610: verify by test when a run finishes, inside the run's own transaction. A finished weekly
 * or full answer run of an area records, for each resolved gap of that area, the first pass of
 * every linked test it passed on the resolving edition or a later one (`passVerifies`), and
 * verifies the gaps whose active tests have all passed (`gapVerification`). Each verification is
 * audited as the service, never a person, and tells the area's owners and deputies; neither
 * names a test, so a held-out one stays with its maintainers (FR-503). Any other run, and a gap
 * already verified, changes nothing, so finishing the same run again is harmless.
 */
export async function verifyGapsByRun(tx: Queryable, run: FinishedRun): Promise<VerifiedGap[]> {
  // Only an area's own run: a proposal's paired runs test a candidate edition that was never sealed.
  if (
    run.state !== 'finished' ||
    !(verifyingRunKinds as readonly string[]).includes(run.kind) ||
    run.proposal_id ||
    run.item_version_id ||
    !run.area_id ||
    !run.baseline_edition_seq
  )
    return []
  const rows = await tx.query<LinkRow>(
    `select gap::text, ref, resolved_seq::text as "resolvedSeq", verified, question, active,
            passed_seq::text as "passedSeq", passed_hour as "passedHour"
       from cl_gap_run_tests($1)`,
    [run.id],
  )
  const facts = { kind: run.kind, finished: true, editionSeq: Number(run.baseline_edition_seq) }
  const verdicts = new Map((run.summary.result?.questions ?? []).map((q) => [q.id, q.baseline]))
  const byGap = new Map<string, LinkRow[]>()
  for (const row of rows) byGap.set(row.gap, [...(byGap.get(row.gap) ?? []), row])
  const verified: VerifiedGap[] = []
  for (const [gap, links] of byGap) {
    const { ref, verified: already } = links[0]!
    const resolvedSeq = Number(links[0]!.resolvedSeq)
    const tests: LinkedTest[] = []
    for (const link of links) {
      let pass =
        link.passedSeq === null || link.passedHour === null
          ? null
          : { editionSeq: Number(link.passedSeq), hour: link.passedHour.toISOString() }
      if (!pass && passVerifies(facts, verdicts.get(link.question) ?? null, resolvedSeq)) {
        const [recorded] = await tx.query<{ hour: Date | null }>(
          'select cl_gap_record_pass($1, $2, $3) as hour',
          [run.id, gap, link.question],
        )
        if (recorded?.hour)
          pass = { editionSeq: facts.editionSeq, hour: recorded.hour.toISOString() }
      }
      tests.push({ questionId: link.question, active: link.active, pass })
    }
    if (already) continue
    const verification = gapVerification(tests, resolvedSeq)
    if (verification.state !== 'verified') continue
    const [done] = await tx.query<{ edition: string }>(
      `update gaps g set verified_at = $2, verified_edition_seq = $3
        where g.id = $1 and g.status = 'resolved' and g.verified_at is null
          and g.resolved_edition_seq <= $3
       returning (select label from editions where seq = $3) as edition`,
      [gap, verification.hour, verification.editionSeq],
    )
    if (!done) continue
    await tx.query(
      `insert into audit_log(actor_id,actor_kind,action,area_id,subject_type,subject_id,details)
       values(null,'service','gap.verified',$1,'gap',$2,$3)`,
      [run.area_id, ref, JSON.stringify({ edition: done.edition, run: run.id })],
    )
    await tx.query(
      `insert into outbox_events(topic,area_id,aggregate_type,aggregate_id,payload)
       values('gap.verified',$1,'gap',$2,$3)`,
      [run.area_id, gap, JSON.stringify({ edition: done.edition })],
    )
    verified.push({ id: gap, ref, edition: done.edition, hour: verification.hour })
  }
  return verified
}
