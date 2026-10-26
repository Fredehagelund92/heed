import * as React from 'react'

/**
 * Whether a container is wide enough for a side panel beside the page (64rem by default), measured
 * before paint and kept current as it resizes. Pages render their side panel once, where it fits,
 * instead of twice with one copy hidden: no duplicate ids, no double key listeners.
 */
export function useWide<T extends HTMLElement>(min = 1024) {
  const [el, setEl] = React.useState<T | null>(null)
  const [wide, setWide] = React.useState(false)
  React.useLayoutEffect(() => {
    if (!el) return
    const measure = () => setWide(el.getBoundingClientRect().width >= min)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el, min])
  return [setEl, wide] as const
}
