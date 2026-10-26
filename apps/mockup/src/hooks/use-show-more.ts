import * as React from "react"

/**
 * A long list inside a page shows its first few and grows in steps, so the page grows instead of a
 * box scrolling inside it. `more` is how many are still hidden; `next` how many the button adds.
 */
export function useShowMore<T>(items: T[], first = 5, step = 10) {
  const [count, setCount] = React.useState(first)
  const shown = items.slice(0, count)
  const more = Math.max(0, items.length - count)
  return {
    shown,
    more,
    next: Math.min(step, more),
    showMore: () => setCount((c) => c + step),
    showFewer: count > first ? () => setCount(first) : undefined,
  }
}
