import type { ParsedHistoryState, RouterHistory } from '@tanstack/history'

/*
  History discipline (contract 9.11): what pushes an entry, what replaces it, and what never
  touches it. The entries that matter later say so in their history state, so a way back can go
  back when the entry behind is the one it means, and otherwise moves on with a new entry.
  `window.history.length` is never asked: it counts entries before Heed and ahead of this one.
*/

declare module '@tanstack/history' {
  interface HistoryState {
    /** Opened from its parent page, the entry behind (a record expanded from a list's panel). */
    fromParent?: true
    /** Opened from the library's list, so the item page carries that list. */
    fromList?: true
    /** Opened a record in the docked panel over the list, the entry behind. */
    panelOpened?: true
    /**
     * The page this entry was opened from, for the way back to it (Back to origin): its address,
     * path and search only, and its place in the tab's history. Never a label: the label is
     * worked out from the route table (lib/crumbs.ts), so nothing here names or leads outside.
     */
    from?: Origin
  }
}

export type Origin = { href: string; index: number }

const pathnameOf = (href: string) => href.replace(/[?#].*$/, '')

/**
 * Has every entry of the tab say where it was opened from (contract 9.11). A new entry for
 * another page was opened from the entry behind it. One for the same page (a filter, a view, a
 * panel) keeps what that page was opened from, which is then further back. A replaced entry
 * (stepping, a tab, typing, a redirect) keeps it too. A deep link, a new tab and the first
 * entry of a tab have none; a reload keeps the tab's entries and so their origins.
 */
export function recordOrigins(history: RouterHistory): RouterHistory {
  const { push, replace } = history
  history.push = (path, state, options) => {
    const here = history.location
    const from: Origin | undefined =
      pathnameOf(path) === here.pathname
        ? here.state.from
        : { href: here.pathname + here.search, index: here.state.__TSR_index }
    push(path, { ...state, from }, options)
  }
  history.replace = (path, state, options) =>
    replace(path, { from: history.location.state.from, ...state }, options)
  return history
}

/**
 * A row's link to its record in the docked panel: a new entry when no record is open, marked so
 * closing the panel goes back to the list; stepping to another record replaces the entry and
 * keeps what it says.
 */
export const panelRowHistory = (recordOpen: boolean) =>
  recordOpen
    ? ({ replace: true, state: true } as const)
    : ({ replace: false, state: { panelOpened: true } } as const)

/** Whether closing the panel can go back: the entry opened it over the list behind it. */
export const panelOpenedHere = (state: ParsedHistoryState) =>
  state.panelOpened === true && state.__TSR_index > 0

/** Whether going up can go back: the entry was opened from its parent, behind it. */
export const fromParentHere = (state: ParsedHistoryState) =>
  state.fromParent === true && state.__TSR_index > 0
