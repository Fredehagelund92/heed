import { createContext, useContext } from 'react'

/**
 * The assistant panel's tabs: Ask (the assistant) and What an agent would get (Try it). Connecting
 * an AI client is a person's own setting (Settings, Connect your AI).
 */
export type AssistantTab = 'ask' | 'agent'

/** Shell actions that pages and menus can call: the overlays and the item actions. */
export type ShellActions = {
  openPalette: () => void
  openShortcuts: () => void
  addContext: () => void
  toggleFavorite: (itemId: string) => void
  isFavorite: (itemId: string) => boolean
  copyLinks: (itemIds: string[]) => void
  /** Whether the assistant is docked in the panel on the right. */
  assistantOpen: boolean
  /**
   * Docks the assistant on a tab (the last one shown, without one), switches to that tab when it
   * shows another, and closes it when it already shows it. On the assistant's own pages it docks
   * the same conversation beside the page the person came from (contract 9.8).
   */
  toggleAssistant: (tab?: AssistantTab) => void
  /**
   * Asks a question typed outside the assistant (Home's search field): docks the assistant on Ask,
   * starts a new chat and sends the question in it, whatever the chat so far was doing.
   */
  askAssistant: (question: string) => void
  /** The element in the header where a page puts its own actions, such as previous and next. */
  headerActions: HTMLElement | null
  /**
   * The element between the sidebar and the page where an area puts a sidebar of its own: the
   * docs' tree in docs mode (contract 8.11). Empty, it takes no room.
   */
  sideRegion: HTMLElement | null
  /** The last page outside the docs, where the docs' Back goes: Home when there is none. */
  appReturnHref: () => string
}

const noop = () => undefined

export const ShellActionsContext = createContext<ShellActions>({
  openPalette: noop,
  openShortcuts: noop,
  addContext: noop,
  toggleFavorite: noop,
  isFavorite: () => false,
  copyLinks: noop,
  assistantOpen: false,
  toggleAssistant: noop,
  askAssistant: noop,
  headerActions: null,
  sideRegion: null,
  appReturnHref: () => '/',
})

export function useShellActions() {
  return useContext(ShellActionsContext)
}
