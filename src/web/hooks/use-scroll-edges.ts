import { useCallback, useLayoutEffect, useRef, useState } from 'react'

/**
 * Whether a row that scrolls sideways has more out of sight before its start (`start`) and
 * after its end (`end`), kept current as it scrolls, resizes and its content changes: what the
 * row's edge fade (`scroll-fade-x`) and its tab stop answer to. Pass `ref` to the row.
 */
export function useScrollEdges<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [edges, setEdges] = useState({ start: false, end: false })
  const update = useCallback(() => {
    const row = ref.current
    if (!row) return
    // A pixel of slack: a zoomed page scrolls in fractions.
    const scrolled = Math.abs(row.scrollLeft)
    const start = scrolled > 1
    const end = scrolled + row.clientWidth < row.scrollWidth - 1
    setEdges((was) => (was.start === start && was.end === end ? was : { start, end }))
  }, [])
  const observer = useRef<ResizeObserver>(null)
  useLayoutEffect(() => {
    const row = ref.current
    if (!row) return
    row.addEventListener('scroll', update, { passive: true })
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    resized?.observe(row)
    observer.current = resized
    return () => {
      row.removeEventListener('scroll', update)
      resized?.disconnect()
      observer.current = null
    }
  }, [update])
  // Again after each render, whose content may be wider or narrower; a child that grows by
  // itself later (a name that arrives, a font that loads) is watched too.
  useLayoutEffect(() => {
    const row = ref.current
    if (!row) return
    for (const child of row.children) observer.current?.observe(child)
    update()
  })
  return { ref, ...edges }
}
