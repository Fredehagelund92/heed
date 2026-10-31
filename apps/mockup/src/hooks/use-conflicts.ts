import * as React from "react"
import { conflictPairs, keptBoth, type ConflictPair } from "@/data/conflicts"
import { useFacts, useStore } from "@/lib/store"

/** The pairs on the conflict lists: every pair agents get both of, minus those kept as both until either changes. */
export function useConflictList(): ConflictPair[] {
  const facts = useFacts()
  const { state } = useStore()
  return React.useMemo(() => conflictPairs(facts).filter((p) => !keptBoth(p, state.settled[p.key])), [facts, state.settled])
}
