import { useContext, useEffect, useLayoutEffect } from 'react'
import {
  DockScopeContext,
  PanelCoveredContext,
  PanelOpenedContext,
  SidebarFoldContext,
} from './dock-scope'

/**
 * A docked panel tells the shell it is docked (design round 3, direction A): while it is, the
 * shell keeps the panel's width free on the right and folds the sidebar to its rail, so the grid
 * beside the panel keeps its columns. An overlaid or full-screen panel does not register.
 */
export function useDockedPanel(docked: boolean) {
  const setDocked = useContext(DockScopeContext)
  useLayoutEffect(() => {
    if (!setDocked || !docked) return
    setDocked(true)
    return () => setDocked(false)
  }, [setDocked, docked])
}

/**
 * A page that needs the width while a record is open in its own flow (the Workbench) folds the
 * sidebar to its rail, as a docked panel does, but keeps no room free on the right: the record is
 * part of the page. A person may expand the sidebar again; that holds until the record closes.
 */
export function useFoldedSidebar(folded: boolean) {
  const setFolded = useContext(SidebarFoldContext)
  useLayoutEffect(() => {
    if (!setFolded || !folded) return
    setFolded(true)
    return () => setFolded(false)
  }, [setFolded, folded])
}

/**
 * A record opened from a grid takes the place on the right: the assistant, which shares it,
 * closes, so the record a person just opened is the panel they see. The next record in the
 * same panel (`key`) counts as opened too.
 */
export function usePanelOpened(key?: string) {
  const opened = useContext(PanelOpenedContext)
  useEffect(() => {
    opened?.()
  }, [opened, key])
}

/** Whether the assistant's panel covers a record's panel (PanelCoveredContext). */
export function usePanelCovered() {
  return useContext(PanelCoveredContext)
}
