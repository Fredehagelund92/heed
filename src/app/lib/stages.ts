import * as React from 'react'

// The timing of a staged look-up, as Ask has it: looking up for 450ms, reading until 1100ms, then
// done. Something read before opens at once (the fast path), and so does everything with reduced
// motion: the result is the point, not the wait.

export const LOOK = 450
export const READ = 1100
export type Stage = 'looking' | 'reading' | 'done'

const seenKeys = new Set<string>()
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Whether `key` was read before in this visit. */
export const wasRead = (key: string) => seenKeys.has(key)
export const markRead = (key: string) => void seenKeys.add(key)

/** The stage for `key`, and whether the stages ran (so what follows can settle in, or simply be there). */
export function useStages(key: string): { stage: Stage; staged: boolean } {
  const [start] = React.useState(() => (seenKeys.has(key) || reduced() ? null : performance.now()))
  const [stage, setStage] = React.useState<Stage>(start === null ? 'done' : 'looking')
  React.useEffect(() => {
    seenKeys.add(key)
    if (start === null) return
    const a = window.setTimeout(() => setStage('reading'), LOOK)
    const b = window.setTimeout(() => setStage('done'), READ)
    return () => {
      window.clearTimeout(a)
      window.clearTimeout(b)
    }
  }, [key, start])
  return { stage, staged: start !== null }
}
