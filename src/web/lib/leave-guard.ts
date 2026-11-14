import * as React from 'react'
import { useBlocker } from '@tanstack/react-router'

/**
 * Asks before the person leaves a page that holds words nobody has saved: a link, Back, or closing
 * the tab. Moving within the page (its own address with another query) never asks. `release` lets
 * one move through, for the page's own Save, which ends on another page.
 */
export function useLeaveGuard(unsaved: boolean) {
  const guard = React.useRef({ unsaved, released: false })
  React.useEffect(() => {
    guard.current.unsaved = unsaved
  })
  const holds = () => guard.current.unsaved && !guard.current.released
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => holds() && current.pathname !== next.pathname,
    enableBeforeUnload: holds,
    withResolver: true,
  })
  return {
    /** A move is waiting for the person's answer. */
    asking: blocker.status === 'blocked',
    /** Stay on the page. */
    stay: () => blocker.status === 'blocked' && blocker.reset(),
    /** Leave, and lose the words. */
    leave: () => blocker.status === 'blocked' && blocker.proceed(),
    release: () => {
      guard.current.released = true
    },
  }
}
