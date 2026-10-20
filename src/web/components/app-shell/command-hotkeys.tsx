import { useEffect } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { commands, inScope, isAvailable, type Command, type CommandContext } from '@/lib/commands'

/** Menus, dialogs, popovers and listboxes own their keys (contract 9.2, "Overlay"). */
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

/**
 * An overlay that is open. A combobox keeps its listbox in the page, hidden, while it is closed
 * (the scope input does, for `aria-controls`); a hidden one is not open. A toast is a dialog to
 * Base UI but never holds the page: the queue's keys go on working under an Undo toast, and only
 * the keys pressed inside a toast stay with it.
 */
const OPEN_OVERLAY = [...OVERLAY.split(', '), '[data-slot="popover-content"]']
  .map((selector) => `${selector}:not([hidden]):not([data-slot="toast"])`)
  .join(', ')

function insideOverlay(event: KeyboardEvent): boolean {
  const target = event.target
  if (target instanceof Element && target.closest(OVERLAY)) return true
  // Escape and the arrows must not reach the page while any overlay is open.
  return document.querySelector(OPEN_OVERLAY) !== null
}

/** How long the library waits for a sequence's second key ("g then a"), its default. */
const SEQUENCE_TIMEOUT_MS = 1000

/** The registry's sequences, such as "g>a": their second key must not also run a key alone. */
const sequences = new Set(
  commands.flatMap((command) => (command.hotkey?.includes('>') ? [command.hotkey] : [])),
)

/** The key pressed before the one being handled, recorded before any hotkey sees it. */
let previousKey: { key: string; at: number } | null = null
let currentKey: { key: string; at: number } | null = null

function recordKey(event: KeyboardEvent) {
  previousKey = currentKey
  currentKey = { key: event.key.toLowerCase(), at: event.timeStamp }
}

/**
 * Whether this key ends a sequence of the registry: "a" right after "g" goes to the assistant,
 * and must not also open Accept on a review.
 */
function endsSequence(hotkey: string, event: KeyboardEvent): boolean {
  if (!previousKey || event.timeStamp - previousKey.at > SEQUENCE_TIMEOUT_MS) return false
  return sequences.has(`${previousKey.key}>${hotkey}`)
}

/**
 * One hook per hotkey. react-hotkeys-hook tracks a sequence per call, so sequences that share a
 * first key ("g then l", "g then h") must not share a call.
 */
function CommandHotkey({
  command,
  hotkey,
  context,
}: {
  command: Command
  hotkey: string
  context: CommandContext
}) {
  // A command checked on press is bound while its screen is shown (lib/commands.ts).
  const enabled = command.checkedOnPress ? inScope(command, context) : isAvailable(command, context)
  // Modifier chords work everywhere. Plain keys pause inside menus, dialogs and fields.
  const chord = hotkey.includes('mod+')
  useHotkeys(
    hotkey,
    (event) => {
      if (!chord && insideOverlay(event)) return
      if (endsSequence(hotkey, event)) return
      if (command.checkedOnPress && !isAvailable(command, context)) return
      event.preventDefault()
      command.run(context)
    },
    {
      enabled,
      preventDefault: false,
      enableOnFormTags: command.whileTyping,
      enableOnContentEditable: command.whileTyping,
    },
    [command, context, chord],
  )
  return null
}

/**
 * Binds every hotkey in the command registry. There is one binding site, so a shortcut can
 * never exist without a command and never be shown without being bound. A scoped command is
 * bound only while its screen is shown, so `j` moves the list cursor on the library and goes to
 * the next item on an item page.
 */
export function CommandHotkeys({ context }: { context: CommandContext }) {
  // In the capture phase, so the key before is known when a hotkey handles the next one.
  useEffect(() => {
    window.addEventListener('keydown', recordKey, true)
    return () => window.removeEventListener('keydown', recordKey, true)
  }, [])
  return commands.map((command) =>
    command.hotkey ? (
      <CommandHotkey key={command.id} command={command} hotkey={command.hotkey} context={context} />
    ) : null,
  )
}
