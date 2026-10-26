import * as React from 'react'

// Whether a person keeps the Settings help aside open: folded until they open it, then the way they left it.

const key = (person: string) => `help-aside:${person}`

function read(person: string) {
  try {
    return localStorage.getItem(key(person)) === 'open'
  } catch {
    return false
  }
}

export function useHelpAside(person: string) {
  const [open, setOpenState] = React.useState(() => read(person))
  const setOpen = React.useCallback(
    (next: boolean) => {
      setOpenState(next)
      try {
        localStorage.setItem(key(person), next ? 'open' : 'closed')
      } catch {
        // Storage can be blocked; the toggle still works for this page.
      }
    },
    [person],
  )
  return { open, setOpen }
}
