import { closeToast, showToast } from '@/lib/toast'

/*
  A bulk decision held for a moment before it is sent (FR-223, contract 9.3 and 9.4): the screen
  shows the outcome at once, a toast offers Undo for 8 seconds (paused on hover and focus, and
  Command or Control Z does the same), and only when the toast closes is the step sent. Undo in
  that window cancels it before anything is written, so a governed change is still never undone
  once it is made: it is only held back until the person has had the chance to take it back.
  While a step is held the browser asks before the page is left; leaving all the same sends it
  at once.
*/

type Held = { id: string; undo: () => void; send: () => void }

const held: Held[] = []
let counter = 0
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((listener) => listener())

/** How long a held step waits for Undo: the contract's 8 seconds. */
export const HOLD_MS = 8000

function onPageHide() {
  // The person leaves: send what is held rather than drop it.
  for (const step of [...held]) step.send()
}
function onBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault()
}

/**
 * Holds a step: shows `title` with Undo, then runs `send` when the toast closes, or `undone` if
 * the person takes it back first.
 */
export function holdAction({
  title,
  description,
  send,
  undone,
}: {
  title: string
  description?: string
  send: () => void | Promise<void>
  undone: () => void
}) {
  const id = `held-${++counter}`
  let settled = false
  const settle = (run: boolean) => {
    if (settled) return
    settled = true
    held.splice(
      held.findIndex((step) => step.id === id),
      1,
    )
    if (!held.length) {
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
    changed()
    if (run) void send()
    else undone()
  }
  const step: Held = {
    id,
    undo: () => {
      settle(false)
      closeToast(id)
    },
    send: () => {
      settle(true)
      closeToast(id)
    },
  }
  if (!held.length) {
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('beforeunload', onBeforeUnload)
  }
  held.push(step)
  changed()
  showToast(title, description, {
    id,
    timeout: HOLD_MS,
    action: { label: 'Undo', onClick: step.undo },
    onClose: () => settle(true),
  })
  return step
}

/** Whether a step is held, waiting for Undo. */
export const hasHeldAction = () => held.length > 0

/** Takes back the newest held step (Command or Control Z). */
export function undoHeldAction() {
  held.at(-1)?.undo()
}

/** Follows whether a step is held. */
export function subscribeHeld(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
