import * as React from 'react'
import type { RowSelection } from '@/hooks/use-selection'
import { askDelete, type Confirming } from '@/lib/bulk'

// The delete confirmation of a list with a bulk bar, as one small machine: shut, or open holding the
// rows it was opened with. The Delete button and the Delete key both go through `ask`, so they share
// one guard: a selection that can't be deleted opens nothing and says why (`refuse`). The
// dialog and the delete itself read the held rows, never the selection as it is now.

export function useDeleteConfirmation(
  sel: RowSelection,
  /** Why nothing can be deleted from the rows ticked now, or undefined when something can. */
  reason: string | undefined,
  /** Where the reason is said when the Delete key is refused (the button says it on a hover). */
  refuse: (reason: string) => void,
) {
  const [confirming, setConfirming] = React.useState<Confirming>(null)
  const ask = () => {
    const asked = askDelete(sel.ids, reason)
    if ('refused' in asked) refuse(asked.refused)
    else setConfirming(asked.confirming)
  }
  // Each render hands the key the newest guard: the rows and the reason as they are now.
  const { bindDeleteKey } = sel
  React.useLayoutEffect(() => bindDeleteKey(ask))
  return { confirming, ask, close: () => setConfirming(null) }
}
