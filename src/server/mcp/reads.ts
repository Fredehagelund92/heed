import type { Database, Queryable } from '../db/database.ts'
import { waitingMembers, type WaitingMember } from '../modules/review/index.ts'

/*
  What find_context reads beside the served edition: the members of the definition sources a
  domain has that are no vocabulary term yet. The read goes through the service function the API
  uses (the names a read made), so nothing here decides what a reader may see: the outcome tools
  then keep only what an agent may read of the live edition (FR-314).
*/

/** The members of the definition sources that domains have and the vocabulary does not yet. */
export type WaitingTerms = { members: WaitingMember[] }

export interface ServingReads {
  /** The source members that are no vocabulary term yet, by domain. */
  waiting(): Promise<WaitingTerms>
}

/** The reads in a transaction already open as a person or as nobody (an agent). */
function readsIn(tx: Queryable): ServingReads {
  return {
    async waiting() {
      return { members: await waitingMembers(tx) }
    },
  }
}

/** The reads for an agent over MCP, in a transaction of their own that names no person. */
export function createServingReads(database: Database): ServingReads {
  return { waiting: () => database.transaction(null, (tx) => readsIn(tx).waiting()) }
}
