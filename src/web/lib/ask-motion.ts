import * as React from 'react'
import { isLive, type Turn } from '@/model/ask-turn'

// How an Ask answer moves as it arrives (docs/design/motion.md, "An Ask answer"), as named values
// so they can be tuned. Nothing here decides what is shown: only checked sentences are revealed,
// and the look-up's labels come from its real steps. The values are the recommended ones of the
// feel research of 1 November 2026; the choices beside them are its other options.

/**
 * How a checked sentence appears: `words`, revealed word by word at `ASK_REVEAL_CPS`, each word
 * fading in (`--ask-word-fade`); `sentences`, each fading in whole; `instant`, each there at once.
 */
export const ASK_CADENCE: 'words' | 'sentences' | 'instant' = 'words'
/** The steady reveal of checked words, in characters a second. */
export const ASK_REVEAL_CPS = 360
/** The longest a backlog of checked words takes to show while the model still writes. */
export const ASK_CATCH_UP_MS = 600
/** The longest what is left takes to show once the model is done (or stopped). */
export const ASK_FLUSH_MS = 400
/** The working line shows only once a look-up has taken this long: a fast one never flashes it. */
export const ASK_WORKING_AFTER_MS = 150
/** A working label stays at least this long, so it can be read. */
export const ASK_LABEL_MIN_MS = 300
/** After this long looking up, the line says it is still looking. */
export const ASK_STILL_WAITING_MS = 9000
/**
 * Where a new question goes: `top`, to the top of the view with room kept under it, and the view
 * stays put while the answer grows and when it ends; `follow`, the view follows the growing answer
 * down while the reader is at the bottom, and brings the finished answer into view.
 */
export const ASK_ANCHOR: 'top' | 'follow' = 'top'
/** The room under the newest question: the view's height less this, so it can reach the top. */
export const ASK_ROOM_GAP_PX = 56

/** What the look-up shows: nothing yet, a working label, or the engine's answer. */
export type ShownStage = 'quiet' | 'looking' | 'reading' | 'answered'

const stageOf = (turn: Turn): ShownStage =>
  turn.answered ? 'answered' : turn.stage === 'reading' ? 'reading' : 'looking'

/**
 * The look-up's stage as the person sees it: nothing for the first `ASK_WORKING_AFTER_MS` (an
 * answer that comes sooner shows at once), then each label for at least `ASK_LABEL_MIN_MS`, then
 * the answer. A stopped look-up shows where it stopped at once.
 */
export function useShownStage(turn: Turn): ShownStage {
  const target = stageOf(turn)
  const [shown, setShown] = React.useState<{ stage: ShownStage; at: number }>(() => ({
    stage: isLive(turn) ? 'quiet' : target,
    at: performance.now(),
  }))
  const stopped = turn.stopped
  React.useEffect(() => {
    if (shown.stage === target || stopped) return
    const wait =
      shown.stage === 'quiet'
        ? target === 'answered'
          ? 0
          : ASK_WORKING_AFTER_MS
        : ASK_LABEL_MIN_MS
    const id = window.setTimeout(
      () => setShown({ stage: target, at: performance.now() }),
      Math.max(0, shown.at + wait - performance.now()),
    )
    return () => window.clearTimeout(id)
  }, [shown, target, stopped])
  return stopped ? target : shown.stage
}

/** Whether a look-up has been looking for `ASK_STILL_WAITING_MS`. */
export function useStillLooking(looking: boolean) {
  const [still, setStill] = React.useState(false)
  React.useEffect(() => {
    if (!looking) return
    const id = window.setTimeout(() => setStill(true), ASK_STILL_WAITING_MS)
    return () => window.clearTimeout(id)
  }, [looking])
  // Looking only ever comes once in an answer's life: asked again, its answer is drawn anew.
  return looking && still
}

/**
 * How many characters of `total` are shown: at once when `instant`, else growing at
 * `ASK_REVEAL_CPS`, faster when it falls behind, so the backlog shows within `ASK_CATCH_UP_MS`
 * while more may come (`flowing`) and within `ASK_FLUSH_MS` once nothing more will.
 */
export function useReveal(
  total: number,
  { flowing, instant }: { flowing: boolean; instant: boolean },
) {
  const [shown, setShown] = React.useState(() => (instant ? total : 0))
  const at = React.useRef(shown)
  React.useEffect(() => {
    if (instant) {
      at.current = total
      return
    }
    if (at.current >= total) return
    let last = performance.now()
    let frame = requestAnimationFrame(function step(now) {
      const backlog = total - at.current
      const within = (flowing ? ASK_CATCH_UP_MS : ASK_FLUSH_MS) / 1000
      const rate = Math.max(ASK_REVEAL_CPS, backlog / within)
      at.current = Math.min(total, at.current + (rate * (now - last)) / 1000)
      last = now
      setShown(Math.floor(at.current))
      if (at.current < total) frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  }, [total, flowing, instant])
  return instant ? total : Math.min(shown, total)
}
