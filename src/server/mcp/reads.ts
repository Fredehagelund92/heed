import type { Database, Queryable } from '../db/database.ts'
import { waitingMembers, type WaitingMember } from '../modules/review/index.ts'

/*
  What find_context reads beside the served edition: the members of the definition sources a
  domain has that are no vocabulary term yet. The read goes through the service function the API
  uses (the vocabulary's candidates), so nothing here decides what a reader may see: the outcome
  tools then keep only what an agent may read of the live edition (FR-314).
*/

/**
 * The members of the definition sources that domains have and the vocabulary does not yet, and
 * who may propose them as terms: an administrator, in Administration, Sources.
 */
export type WaitingTerms = {
  members: WaitingMember[]
  /** Whether the reader is an administrator, who proposes them. */
  canPropose: boolean
}

export interface ServingReads {
  /** The source members that are no vocabulary term yet, by domain, and who may propose them. */
  waiting(): Promise<WaitingTerms>
}

/** The reads in a transaction already open as a person or as nobody (an agent). */
function readsIn(tx: Queryable): ServingReads {
  return {
    async waiting() {
      const members = await waitingMembers(tx)
      const [reader] = await tx.query<{ admin: boolean }>('select cl_is_admin_now() as admin')
      return { members, canPropose: reader?.admin === true }
    },
  }
}

/** The reads for an agent over MCP, in a transaction of their own that names no person. */
export function createServingReads(database: Database): ServingReads {
  return { waiting: () => database.transaction(null, (tx) => readsIn(tx).waiting()) }
}
