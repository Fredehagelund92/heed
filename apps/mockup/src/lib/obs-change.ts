import type { Change } from "@/data/observability"

// How Observability's numbers say a move from the period before, and where a chart's publish
// labels have room: shared by the cells and the chart.

/**
 * How a number moved from the period before, as a cell says it: the words ("+4 pts", "About the
 * same"), an arrow when it went up or down by more than chance would, and whether that is good or
 * bad. Colour comes only with an arrow, and only when the move means something.
 */
export type KpiChange = { words: string; direction?: "up" | "down"; tone?: "good" | "bad" }

/** A move as a cell says it: "About the same" within the margin; else the words, the arrow, and good or bad when `better` says which way is better. */
export function kpiChange(change: Change | null, words: (change: Change) => string, better?: "up" | "down"): KpiChange | undefined {
  if (!change) return undefined
  if (change.direction === "same") return { words: "About the same" }
  return { words: words(change), direction: change.direction, ...(better ? { tone: change.direction === better ? "good" : "bad" } : {}) }
}

/** "3 more", "3 fewer": a move in calls. */
export const moreOrFewer = (c: Change) => `${Math.abs(c.by).toLocaleString("en-GB")} ${c.by > 0 ? "more" : "fewer"}`

/** About how wide a chart label of 10 px is, per character. */
const LABEL_CHAR = 5.6

/**
 * One dashed line per bar with a publish, and its label above the plot ("Published", "2
 * published") only where it has room: a label that would run into the one before it is left out,
 * and the line, the tooltip and the table for a screen reader still say it. A label that would run
 * past the right edge ends at its line instead.
 */
export function publishLines(marks: readonly { index: number }[], xOf: (index: number) => number, left: number, right: number) {
  const counts = new Map<number, number>()
  for (const m of marks) counts.set(m.index, (counts.get(m.index) ?? 0) + 1)
  let free = left
  return [...counts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, n]): { index: number; x: number; label?: string; end?: boolean } => {
      const x = xOf(index)
      const label = n > 1 ? `${n} published` : "Published"
      const width = label.length * LABEL_CHAR
      const end = x + 4 + width > right
      const from = end ? x - 4 - width : x + 4
      if (from < free) return { index, x }
      free = from + width + 6
      return { index, x, label, end }
    })
}
