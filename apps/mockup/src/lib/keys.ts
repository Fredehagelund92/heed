// Single-key shortcuts (J, K, N, P, ?, Esc) belong to the page only while nobody is typing: never
// in a field, a rich-text editor (a note, a comment), an open list, a menu or a dialog.

const TYPING =
  "input, textarea, select, [contenteditable=''], [contenteditable=true], [role=textbox], [role=combobox], [role=listbox], [role=dialog], [role=alertdialog], [role=menu]"

export function isTyping(target: EventTarget | null) {
  return target instanceof Element && !!target.closest(TYPING)
}

/** A plain key press for a page shortcut: nothing typed into, no modifier held. */
export const pageKey = (e: KeyboardEvent) => !isTyping(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey
