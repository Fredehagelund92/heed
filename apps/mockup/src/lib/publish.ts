import { cards } from "@/data/inbox"
import type { Review } from "@/data/review"
import type { Action } from "@/lib/store"
import { afterPublish } from "@/lib/saved-check"

// What publishing a suggestion does, the same for one Publish and for "Publish the ones you've
// read": the change lands on its context item (or a new one), the item says it was just
// published, and an overlap the owner said it replaces is archived. touchedBy names what it
// changed, so Undo can put exactly that back.

/** Publishes; gives back what Undo needs beyond the store (the saved questions it touched), if anything. */
export function publishEffects(r: Review, me: string, dispatch: (a: Action) => void, relation?: string | null): (() => void) | undefined {
  const card = cards.find((c) => c.id === r.id)
  const s = card?.suggestion
  if (s?.factId && r.mode === "edit") dispatch({ type: "editFact", id: s.factId, patch: { ...s.draft, checkedOn: "23 Oct 2026" } })
  if (r.mode === "new" && s) dispatch({ type: "addFact", fact: { ...s.draft, id: `itm_${r.id}` } })
  // A draft for a Not found card: published, it is checked by whoever published it.
  if (card?.gap?.draft) dispatch({ type: "addFact", fact: { ...card.gap.draft, checkedBy: me } })
  const itemId = itemOf(r)
  if (itemId) dispatch({ type: "published", id: itemId })
  if (r.clash && relation === "replaces") dispatch({ type: "editFact", id: r.clash.factId, patch: { status: "Archived" } })
  // The saved questions that answer from it are checked, and a gap's question can be saved.
  return afterPublish(r, me, itemId, card?.domain ?? "sales")
}

/** The context item a suggestion lands on. */
function itemOf(r: Review) {
  const card = cards.find((c) => c.id === r.id)
  const s = card?.suggestion
  return r.mode === "edit" ? s?.factId : card?.gap?.draft ? card.gap.draft.id : s ? `itm_${r.id}` : undefined
}

/** The context items a decision on this suggestion can change: what Undo puts back. */
export const touchedBy = (r: Review) => [itemOf(r), r.clash?.factId, r.retire?.factId].filter((x): x is string => !!x)
