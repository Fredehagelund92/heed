import { createContext } from 'react'

/*
  What the shell provides to the panels and pages that take room from it. Only the contexts live
  here, because the shell is the first load; the hooks those panels and pages call are in
  dock-hooks.ts, which only their lazy chunks import.
*/

/** A docked panel tells the shell it is docked (useDockedPanel). */
export const DockScopeContext = createContext<((docked: boolean) => void) | null>(null)

/** A page with a record open in its own flow folds the sidebar (useFoldedSidebar). */
export const SidebarFoldContext = createContext<((folded: boolean) => void) | null>(null)

/** Tells the shell a record's panel opened. The assistant's panel is outside it. */
export const PanelOpenedContext = createContext<(() => void) | null>(null)

/**
 * One panel at a time: while the assistant is open, a record's panel under it is hidden (not
 * closed), so closing the assistant shows the record again where it was. The assistant's own
 * panel is outside it.
 */
export const PanelCoveredContext = createContext(false)
