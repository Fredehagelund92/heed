import { createContext, useContext } from 'react'

/*
  The layers of contract 6.10: a popup (menu, select, combobox, popover, hover card) sits on the
  popover layer, under dialogs, sheets and drawers. A popup opened from inside one of those must
  sit above it, or a person could not reach its options. So an overlay tells the popups in it to
  take the overlay layer: they portal after the overlay, so on the same layer they come out on top.
*/
const InsideOverlay = createContext(false)

/** Wraps an overlay's content, so the popups opened in it rise above it. */
export const OverlayLayer = InsideOverlay.Provider

/** The layer class for a popup: the popover layer, or the overlay layer inside an overlay. */
export function usePopupLayer(): 'z-popover' | 'z-overlay' {
  return useContext(InsideOverlay) ? 'z-overlay' : 'z-popover'
}
