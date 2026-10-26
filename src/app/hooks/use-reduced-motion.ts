import * as React from 'react'

const query = '(prefers-reduced-motion: reduce)'

function subscribe(onChange: () => void) {
  const m = window.matchMedia(query)
  m.addEventListener('change', onChange)
  return () => m.removeEventListener('change', onChange)
}

/** Whether the person asked for less motion: then nothing moves on its own, and transitions cut. */
export function useReducedMotion() {
  return React.useSyncExternalStore(subscribe, () => window.matchMedia(query).matches)
}
