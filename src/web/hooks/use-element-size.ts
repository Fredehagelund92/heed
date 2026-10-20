import { useLayoutEffect, useState } from 'react'

function useElementSize(element: HTMLElement | null, side: 'width' | 'height') {
  const [size, setSize] = useState(0)
  useLayoutEffect(() => {
    if (!element) return
    const measure = () => setSize(element.getBoundingClientRect()[side])
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element, side])
  return size
}

/** The element's width in CSS pixels, kept current as it resizes; 0 before it mounts. */
export const useElementWidth = (element: HTMLElement | null) => useElementSize(element, 'width')

/** The element's height in CSS pixels, kept current as it resizes; 0 before it mounts. */
export const useElementHeight = (element: HTMLElement | null) => useElementSize(element, 'height')
