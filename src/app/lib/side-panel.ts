import * as React from 'react'

// Whether a side panel is open, as the person last left it this session: the editors' What agents
// get ("editor-side"), an item page's panel ("page-side"). Null until they choose, so a page can
// open it by itself when there is something to say (an overlap, a conflict).

function read(key: string): boolean | null {
  try {
    const v = sessionStorage.getItem(key)
    return v === null ? null : v === 'open'
  } catch {
    return null
  }
}

export function useSideChoice(key = 'editor-side') {
  const [choice, setChoice] = React.useState<boolean | null>(() => read(key))
  const set = React.useCallback(
    (open: boolean) => {
      setChoice(open)
      try {
        sessionStorage.setItem(key, open ? 'open' : 'closed')
      } catch {
        // Storage can be blocked; the toggle still works on this page.
      }
    },
    [key],
  )
  return [choice, set] as const
}
