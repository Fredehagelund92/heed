// Picking several rows of a list, the same way in every list: a click on a checkbox (or Cmd or Ctrl
// and a click on a row) ticks one and makes it the anchor; Shift and a click ticks everything between
// the anchor and that row, in the order the list shows now, across its groups. A range takes the
// anchor's state, so unticking a row and Shift-clicking another unticks the rows between, and a second
// Shift-click re-draws the range from the same anchor instead of adding to the first. Rows are named
// by id, so the anchor outlives a re-render, a new sort and a filter that hides it for a while.

export type Selection = {
  /** The ticked rows, in the order they were ticked. */
  ids: string[]
  /** The last row ticked or unticked on its own: the fixed end of a Shift range. */
  anchor?: string
  /** Whether the anchor was ticked: a range ticks, or unticks, like it. */
  anchorOn: boolean
  /** The ticked rows when the anchor was set: a range is drawn on top of these. */
  base: string[]
  /** The moving end of the last range: where Shift and an arrow carry on from. */
  head?: string
}

export const NONE: Selection = { ids: [], anchorOn: true, base: [] }

/** The rows from one id to another, both included, in the list's order. */
export function between(order: string[], a: string, b: string) {
  const i = order.indexOf(a)
  const j = order.indexOf(b)
  if (i < 0 || j < 0) return []
  return order.slice(Math.min(i, j), Math.max(i, j) + 1)
}

/** One row ticked or unticked on its own; it becomes the anchor. */
export function toggle(s: Selection, id: string): Selection {
  const on = !s.ids.includes(id)
  const ids = on ? [...s.ids, id] : s.ids.filter((x) => x !== id)
  return { ids, anchor: id, anchorOn: on, base: ids, head: id }
}

/**
 * Shift and a click: the rows from the anchor to this one take the anchor's state. With no anchor in
 * the list as it is now (none yet, or hidden by a filter), the row is ticked on its own instead.
 */
export function extend(s: Selection, order: string[], id: string): Selection {
  if (!s.anchor || !order.includes(s.anchor) || !order.includes(id)) return toggle(s, id)
  const range = between(order, s.anchor, id)
  const ids = s.anchorOn ? [...s.base, ...range.filter((x) => !s.base.includes(x))] : s.base.filter((x) => !range.includes(x))
  return { ...s, ids, head: id }
}

/**
 * Shift and an arrow, from the row the cursor is on to the next. It carries on the last range when
 * the cursor is at its moving end; anywhere else the cursor's row becomes a ticked anchor first.
 */
export function step(s: Selection, order: string[], from: string, to: string): Selection {
  if (s.anchor && order.includes(s.anchor) && s.head === from) return extend(s, order, to)
  const ids = s.ids.includes(from) ? s.ids : [...s.ids, from]
  return extend({ ids, anchor: from, anchorOn: true, base: ids, head: from }, order, to)
}

/** Cmd or Ctrl and A: every row the list shows, and nothing it hides. */
export function all(order: string[]): Selection {
  return { ids: [...order], anchorOn: true, base: [...order] }
}

/** What a screen reader hears when the count changes. */
export const countLine = (n: number) => (n ? `${n} selected` : "Selection cleared")
