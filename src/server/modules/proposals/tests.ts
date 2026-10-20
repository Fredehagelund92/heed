import type { ProposalTest } from '../../../contract/proposals.ts'
import type { Queryable } from '../../db/database.ts'

const iso = (column: string) =>
  `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`

/**
 * The test questions attached to a proposal's check (FR-524), as row security shows them to the
 * reader: a question held out since it was attached only to its area's maintainers.
 */
export function attachedTests(tx: Queryable, proposalId: string): Promise<ProposalTest[]> {
  return tx.query<ProposalTest>(
    `select a.question_id as question, q.status = 'active' as active,
            ${iso('a.attached_hour')} as "attachedHour"
       from proposal_tests a join golden_questions q on q.id = a.question_id
      where a.proposal_id = $1
      order by a.attached_hour, a.question_id`,
    [proposalId],
  )
}

/** The active attached questions a check or an answer run reports on; none without a proposal. */
export async function attachedQuestions(
  tx: Queryable,
  proposalId: string | null,
): Promise<Set<string>> {
  if (!proposalId) return new Set()
  const tests = await attachedTests(tx, proposalId)
  return new Set(tests.filter((test) => test.active).map((test) => test.question))
}
