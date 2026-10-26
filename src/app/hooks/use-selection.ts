import * as React from 'react'
import { isTyping } from '@/lib/keys'
import { all, extend, NONE, step, toggle, type Selection } from '@/lib/selection'

// One way to pick rows in every list (Context, Definitions, the Inbox, a source's folders): the
// rules are in lib/selection.ts, the clicks and keys here.
//
// - A checkbox ticks one row; Shift and a click on a checkbox or a row ticks the range from the anchor.
// - Cmd or Ctrl and a click on a row (its title too) ticks one, instead of opening it.
// - A plain click on a row opens it; while rows are ticked it ticks that row instead. A title always opens.
// - Shift and Up or Down extends from the row the cursor is on; X ticks that row.
// - Cmd or Ctrl and A ticks every row shown; Esc clears; Delete or Backspace asks to delete, never deletes.
// - On a phone, Select starts picking: a tap on a row then ticks it.
//
// Rows mark their title (or the button that opens them) with data-row-open={id}: the keys find the
// cursor's row by it. `order` is the rows as the list shows them now, after its sort, filters and
// folded groups, so a range runs in the order on screen.

type ChangeDetails = { event: Event }

export function useSelection(
  order: string[],
  {
    scope,
    keys = true,
    initial,
    onDeleteKey,
  }: {
    /** Where Cmd or Ctrl and A works besides an unfocused page: the list, with its header. */
    scope?: React.RefObject<HTMLElement | null>
    /** Off where Esc and Cmd or Ctrl and A belong to something else, as in a form. */
    keys?: boolean
    /** The rows ticked to begin with. */
    initial?: string[]
    /** Delete or Backspace on a selection: opens the list's confirmation. */
    onDeleteKey?: () => void
  } = {},
) {
  const [s, set] = React.useState<Selection>(() =>
    initial ? { ...NONE, ids: initial, base: initial } : NONE,
  )
  // The newest order, so an update always draws its range over the rows on screen now.
  const orderRef = React.useRef(order)
  React.useLayoutEffect(() => {
    orderRef.current = order
  })
  // Picking on a phone, before anything is ticked: a tap on a row ticks it instead of opening it.
  const [picking, setPicking] = React.useState(false)
  const ticked = React.useMemo(() => new Set(s.ids), [s.ids])
  const count = s.ids.length
  const allShown = order.length > 0 && order.every((id) => ticked.has(id))

  const one = React.useCallback((id: string) => set((x) => toggle(x, id)), [])
  const range = React.useCallback((id: string) => set((x) => extend(x, orderRef.current, id)), [])
  const clear = React.useCallback(() => {
    set(NONE)
    setPicking(false)
  }, [])
  const deleteKey = React.useRef(onDeleteKey)
  React.useLayoutEffect(() => {
    deleteKey.current = onDeleteKey
  })
  const selectAll = React.useCallback(() => set(() => all(orderRef.current)), [])

  /** A click with Shift, Cmd or Ctrl picks rather than opens. Returns whether it did. */
  const pick = (id: string, e: React.MouseEvent) => {
    if (e.shiftKey) range(id)
    else if (e.metaKey || e.ctrlKey) one(id)
    else return false
    e.preventDefault()
    return true
  }

  React.useEffect(() => {
    if (!keys) return
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.defaultPrevented) return
      const t = e.target as Node
      if (e.key === 'Escape' && count) {
        e.preventDefault()
        clear()
      }
      // Delete or Backspace on a selection opens the confirmation; nothing is deleted from a key alone.
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        count &&
        deleteKey.current &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault()
        deleteKey.current()
      }
      // Cmd or Ctrl and A in the list, or with nothing focused: the rows, not the page's text.
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === 'a' &&
        orderRef.current.length
      ) {
        if (t !== document.body && !scope?.current?.contains(t)) return
        e.preventDefault()
        selectAll()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keys, scope, count, clear, selectAll])

  return {
    /** The ticked ids, in the order they were ticked. */
    ids: s.ids,
    count,
    isSelected: (id: string) => ticked.has(id),
    /** Every row shown is ticked: the header checkbox's state. */
    allShown,
    clear,
    selectAll,
    /** These rows, and only these: "Select all 23 matching", or what failed, kept for a retry. */
    select: (ids: string[]) => set(all(ids)),
    picking,
    setPicking,
    /** A row's checkbox: Shift draws a range, anything else ticks the one row. */
    checkbox: (id: string) => ({
      checked: ticked.has(id),
      onCheckedChange: (_: boolean, details: ChangeDetails) =>
        (details.event as MouseEvent).shiftKey ? range(id) : one(id),
    }),
    /** The header's checkbox: ticks every row shown, or clears when they all are. */
    toggleAll: () => (allShown ? clear() : selectAll()),
    /** A click on a row's title: with Shift, Cmd or Ctrl it picks, and so does a tap while picking on a phone; otherwise the caller opens the row. */
    titleClick: (id: string, e: React.MouseEvent) => {
      if (pick(id, e)) return true
      if (!picking) return false
      one(id)
      return true
    },
    /** A click on the row around it: it picks with a modifier, or while rows are ticked. Returns whether it did. */
    rowClick: (id: string, e: React.MouseEvent) => {
      if (pick(id, e)) return true
      if (!count && !picking) return false
      one(id)
      return true
    },
    /** Shift and a press would start a text highlight across the rows: a range is meant, not that. */
    onMouseDown: (e: React.MouseEvent<HTMLElement>) => {
      if (!e.shiftKey) return
      e.preventDefault()
      // Kept from the press, focus still moves to the row: Shift and an arrow carries on from there.
      const hit = (e.target as HTMLElement).closest<HTMLElement>('[role=checkbox], [data-row-open]')
      const to =
        hit ??
        e.currentTarget.querySelector<HTMLElement>('[data-row-open]') ??
        e.currentTarget.querySelector<HTMLElement>('[role=checkbox]')
      to?.focus({ preventScroll: true })
    },
    /** On the list: Shift and Up or Down extends from the cursor's row, X ticks it. */
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement
      if (target.closest('input, textarea')) return
      const stops = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-row-open]')]
      const at = stops.findIndex(
        (r) => r === target || r.contains(target) || r.closest('tr, li')?.contains(target),
      )
      if (at < 0) return
      const from = stops[at].dataset.rowOpen!
      if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault()
        const next = stops[at + (e.key === 'ArrowDown' ? 1 : -1)]
        if (!next) return
        next.focus()
        next.scrollIntoView({ block: 'nearest' })
        const to = next.dataset.rowOpen!
        set((x) => step(x, orderRef.current, from, to))
      } else if (e.key === 'x' && !e.shiftKey) {
        e.preventDefault()
        one(from)
      }
    },
  }
}

export type RowSelection = ReturnType<typeof useSelection>
