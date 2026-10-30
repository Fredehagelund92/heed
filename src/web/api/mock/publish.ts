import type { Relation, Review } from '@/model/review'
import { cards } from './data/inbox'
import type { Action } from './store'

// What publishing a suggestion does, the same for one Publish and for "Publish the ones you've
// read": the change lands on its context item (or a new one), the item says it was just
// published, and each overlap the owner said it replaces is archived, that one only. touchedBy
// names what it changed, so Undo can put exactly that back.

export function publishEffects(
  r: Review,
  me: string,
  dispatch: (a: Action) => void,
  relations: Record<string, Relation> = {},
) {
  const card = cards.find((c) => c.id === r.id)
  const s = card?.suggestion
  if (s?.factId && r.mode === 'edit')
    dispatch({ type: 'editFact', id: s.factId, patch: { ...s.draft, checkedOn: '23 Oct 2026' } })
  if (r.mode === 'new' && s) dispatch({ type: 'addFact', fact: { ...s.draft, id: `itm_${r.id}` } })
  // A draft for a Not found card: published, it is checked by whoever published it.
  if (card?.gap?.draft) dispatch({ type: 'addFact', fact: { ...card.gap.draft, checkedBy: me } })
  const itemId = itemOf(r)
  if (itemId) dispatch({ type: 'published', id: itemId })
  for (const c of r.clash?.items ?? [])
    if (relations[c.factId] === 'replaces')
      dispatch({ type: 'editFact', id: c.factId, patch: { status: 'Archived' } })
  return { itemId, domain: card?.domain ?? 'sales' }
}

/** The context item a suggestion lands on. */
function itemOf(r: Review) {
  const card = cards.find((c) => c.id === r.id)
  const s = card?.suggestion
  return r.mode === 'edit'
    ? s?.factId
    : card?.gap?.draft
      ? card.gap.draft.id
      : s
        ? `itm_${r.id}`
        : undefined
}

/** The context items a decision on this suggestion can change: what Undo puts back. */
export const touchedBy = (r: Review) =>
  [itemOf(r), ...(r.clash?.items.map((c) => c.factId) ?? []), r.retire?.factId].filter(
    (x): x is string => !!x,
  )
