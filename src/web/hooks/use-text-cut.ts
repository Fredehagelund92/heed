import { useCallback, useLayoutEffect, useRef, useState } from 'react'

/*
  One ResizeObserver for every text that may be cut, so a table of names that end in an ellipsis
  costs one observer, not one per row. Each watched element keeps its own check.
*/
const checks = new WeakMap<Element, () => void>()
let shared: ResizeObserver | null | undefined
function observer() {
  shared ??=
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((entries) => {
          for (const entry of entries) checks.get(entry.target)?.()
        })
  return shared
}

/**
 * Whether an element's text is cut by its box (it ends in an ellipsis, `truncate`), kept current
 * as the box resizes: what a truncated text's tooltip answers to (contract 7.1). Pass `ref` to the
 * element that truncates; `text` re-checks when the words change in a box that keeps its size.
 */
export function useTextCut<T extends HTMLElement>(text?: string) {
  const node = useRef<T | null>(null)
  const [cut, setCut] = useState(false)
  const check = useCallback(() => {
    const element = node.current
    if (element) setCut(element.scrollWidth > element.clientWidth)
  }, [])
  const ref = useCallback(
    (element: T | null) => {
      if (!element) return
      node.current = element
      checks.set(element, check)
      observer()?.observe(element)
      return () => {
        checks.delete(element)
        observer()?.unobserve(element)
        if (node.current === element) node.current = null
      }
    },
    [check],
  )
  useLayoutEffect(check, [check, text])
  return { ref, cut }
}
