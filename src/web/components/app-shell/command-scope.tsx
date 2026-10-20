import { createContext, useContext, useLayoutEffect } from 'react'
import type { CheckScope, DocumentScope, ListScope, MainAction, ReviewScope } from '@/lib/commands'

type ScopeSetters = {
  setList: (scope: ListScope | null) => void
  setDocument: (scope: DocumentScope | null) => void
  setReview: (scope: ReviewScope | null) => void
  setCheck: (scope: CheckScope | null) => void
  setMainAction: (action: MainAction | null) => void
}

export const CommandScopeContext = createContext<ScopeSetters | null>(null)

/**
 * A screen registers what its scoped commands act on while it is shown: the library registers
 * its list (cursor, selection, search), an item page its document (next, previous, back). The
 * shell puts the scope into the command context, so `j` means "next row" on the list and "next
 * item" on an item page, from one registry.
 */
export function useListScope(scope: ListScope | null) {
  const setters = useContext(CommandScopeContext)
  useLayoutEffect(() => {
    if (!setters) return
    setters.setList(scope)
    return () => setters.setList(null)
  }, [setters, scope])
}

export function useDocumentScope(scope: DocumentScope | null) {
  const setters = useContext(CommandScopeContext)
  useLayoutEffect(() => {
    if (!setters) return
    setters.setDocument(scope)
    return () => setters.setDocument(null)
  }, [setters, scope])
}

/** The review screen registers its decisions and the queue around it (a, r, Shift r, j, k). */
export function useReviewScope(scope: ReviewScope | null) {
  const setters = useContext(CommandScopeContext)
  useLayoutEffect(() => {
    if (!setters) return
    setters.setReview(scope)
    return () => setters.setReview(null)
  }, [setters, scope])
}

/** The item shown in a panel or on its page registers the owner's check while it asks for one (y). */
export function useCheckScope(scope: CheckScope | null) {
  const setters = useContext(CommandScopeContext)
  useLayoutEffect(() => {
    if (!setters) return
    setters.setCheck(scope)
    return () => setters.setCheck(null)
  }, [setters, scope])
}

/** A page registers what Command or Control Enter does while it is shown (contract 9.2). */
export function useMainAction(action: MainAction | null) {
  const setters = useContext(CommandScopeContext)
  useLayoutEffect(() => {
    if (!setters) return
    setters.setMainAction(action)
    return () => setters.setMainAction(null)
  }, [setters, action])
}
