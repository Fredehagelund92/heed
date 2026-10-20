import { useState } from 'react'
import { selectionRange } from '@/lib/list-selection'

/**
 * The review queue's selection (FR-223), as the library keeps its own: the selected rows, and the
 * anchor a Shift-click or Shift with `j` or `k` extends from. Only rows still in the list count,
 * so a filter or a decided proposal leaves the selection without a stale row. `selectable` are
 * the rows the person may decide (`canDecideInList`); a range or Select all passes over the rest.
 */
export function useQueueSelection(ids: readonly string[], selectable: readonly string[] = ids) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const open = new Set(selectable)
  const selected = new Set(ids.filter((id) => picked.has(id) && open.has(id)))
  const only = (range: readonly string[]) => range.filter((id) => open.has(id))

  const add = (range: readonly string[]) =>
    setPicked((current) => new Set([...current, ...only(range)]))
  const all = only(ids)

  return {
    selected: selected as ReadonlySet<string>,
    size: selected.size,
    /** How many rows the selection can hold. */
    capacity: all.length,
    /** Selects or unselects a row; with `range`, every row from the anchor to it. */
    toggle: (id: string, range = false) => {
      if (range) {
        add(selectionRange(ids, anchor ?? id, id))
        return
      }
      if (!open.has(id)) return
      setAnchor(id)
      setPicked((current) => {
        const next = new Set(current)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    },
    /** Shift with j or k: selects from the anchor (or the row left) to the row reached. */
    extend: (from: string, to: string) => {
      const start = anchor ?? from
      if (!anchor) setAnchor(from)
      add(selectionRange(ids, start, to))
    },
    /** Selects every row, or clears them when every one is selected already. */
    toggleAll: () => {
      if (selected.size === all.length) setPicked(new Set())
      else setPicked(new Set(all))
    },
    selectAll: () => setPicked(new Set(all)),
    /** Keeps only these rows selected, such as the ones a step left out. */
    restore: (rows: readonly string[]) => setPicked(new Set(rows)),
    /** Selects these rows too, such as the ones an Undo puts back. */
    add: (rows: readonly string[]) => add(rows),
    clear: () => {
      setPicked(new Set())
      setAnchor(null)
    },
  }
}
