import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useListScope } from '@/components/app-shell/command-scope'
import type { BulkAction, ListScope } from '@/lib/commands'
import { panelOpenedHere } from '@/lib/history'

/*
  A list whose rows open in the docked panel (design round 3, direction A), as the Proposals
  page, the catalogue and Gaps have it; the library keeps its own, richer model (cursor and
  selection). The surface keeps the open row in the address (`?panel=`); this hook adds what
  every such list does around it:

  - closing goes Back when the entry behind is the list the panel was opened over (the row's
    link marks the entry, lib/history.ts), so the history has no closed panel in it, and
    otherwise takes the panel out of the address;
  - a link that opens a panel puts focus on its row once the rows are there, and focus returns
    to the row when the panel closes (Escape, its close button or Back);
  - where the open row is in the list, and the rows before and after it;
  - the list's keys (contract 9.2): j and k move between the rows and, while a panel is open,
    open the row they land on; Escape closes the panel first; / searches;
  - on a list that has them, the open record's own keys: 1, 2 and 3 for its tabs, and a focus
    mode over the list (the Workbench's compare), during which the list rests and Escape leaves
    the mode before it closes the record.
*/

/** The row with this id, and the link that opens it, inside a list region. */
export function rowLink(region: HTMLElement | null, id: string) {
  const row = region?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`)
  return row?.querySelector<HTMLElement>('[data-row-link]') ?? null
}

/** A length token of tokens.css (in rem) in CSS pixels. */
function tokenPixels(name: string) {
  const root = getComputedStyle(document.documentElement)
  return parseFloat(root.getPropertyValue(name)) * (parseFloat(root.fontSize) || 16)
}

/**
 * The width a list fits its columns to. Beside a docked panel it is the width the list has once
 * the sidebar has folded to its rail: the shell frees the panel's width at once and the sidebar
 * folds with a transition, so the measured width dips on the way and would flip the grid to the
 * narrow rows and back (losing the row's focus). Closing the panel only widens the list.
 */
export function dockFitWidth(measured: number, docked: boolean) {
  if (!docked || measured === 0) return measured
  const folded =
    document.documentElement.clientWidth -
    tokenPixels('--sidebar-width-rail') -
    tokenPixels('--dock-width')
  return Math.max(measured, folded)
}

export function useDockList({
  region,
  ids,
  panelId,
  open,
  close,
  searchRef,
  enabled = true,
  toggleViewed,
  focusMode,
  showTab,
  selection,
  bulk,
  discard,
}: {
  /** The page region that holds the rows (`[data-row-id]` with a `[data-row-link]` in each). */
  region: HTMLElement | null
  /** The rows' ids in the order they show. */
  ids: readonly string[]
  /** The row open in the panel, from the address. */
  panelId: string | null
  /** Opens a row in the panel, replacing the address and keeping its entry's state. */
  open: (id: string) => void
  /** Takes the panel out of the address, replacing it. */
  close: () => void
  searchRef: RefObject<HTMLInputElement | null>
  /** False while the list loads or failed: the keys are not the list's yet. */
  enabled?: boolean
  /** Marks a row as viewed or not (`v`), on a list that keeps a viewed mark. */
  toggleViewed?: (id: string) => void
  /**
   * A focus mode the open record can take over the list (the Workbench's compare): whether it is
   * on, and turning it on or off (Shift C). Absent while the open record has none.
   */
  focusMode?: { on: boolean; toggle: () => void }
  /** Shows the open record's tab by its place (1, 2, 3); absent while no record has tabs. */
  showTab?: (index: number) => void
  /**
   * The rows' selection, on a list with bulk actions (the review queue): `x` selects the focused
   * row, Shift with `j` or `k` extends from the anchor, and Escape clears it after the panel.
   */
  selection?: {
    size: number
    toggle: (id: string) => void
    extend: (from: string, to: string) => void
    clear: () => void
  }
  /** The bulk actions on the selection, for the palette (FR-223). */
  bulk?: ListScope['bulk']
  /**
   * Discarding drafts (Proposals > Mine): `targets` are the drafts the key would discard, given
   * the focused or open row; `run` asks to discard them.
   */
  discard?: {
    targets: (focused: string | null) => readonly string[]
    run: (ids: readonly string[]) => void
  }
}) {
  const router = useRouter()

  const focusRow = (id: string) => rowLink(region, id)?.focus()

  // A link that opens a panel: once the rows are there, focus (and so scroll to) its row.
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current || !region || ids.length === 0) return
    restored.current = true
    const opened = panelId
    if (opened && ids.includes(opened))
      requestAnimationFrame(() => rowLink(region, opened)?.focus())
    // Only the first rows: later lists keep the person's own focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, region])

  // When the panel closes, focus returns to its row.
  const previous = useRef(panelId)
  useEffect(() => {
    const closed = previous.current
    previous.current = panelId
    if (panelId || !closed) return
    requestAnimationFrame(() => rowLink(region, closed)?.focus())
  }, [panelId, region])

  const closePanel = () => {
    if (panelOpenedHere(router.history.location.state)) {
      router.history.back()
      return
    }
    close()
  }

  const index = panelId ? ids.indexOf(panelId) : -1
  const previousId = index > 0 ? ids[index - 1] : undefined
  const nextId = index >= 0 ? ids[index + 1] : undefined

  // ---- the list's keys ----
  const latest = useRef<ListScope | null>(null)
  useLayoutEffect(() => {
    const focused = () => {
      const active = document.activeElement
      if (!(active instanceof HTMLElement) || !region?.contains(active)) return null
      return active.closest('[data-row-id]')?.getAttribute('data-row-id') ?? null
    }
    const moveTo = (id: string | undefined) => {
      if (!id) return
      focusRow(id)
      if (panelId && id !== panelId) open(id)
    }
    // While a focus mode covers the list, the list rests: its rows are inert.
    const resting = focusMode?.on === true
    latest.current = {
      move: (delta, extend) => {
        if (ids.length === 0 || resting) return
        const from = focused() ?? panelId
        const at = from ? ids.indexOf(from) : -1
        const to =
          at === -1
            ? ids[delta > 0 ? 0 : ids.length - 1]
            : ids[Math.min(ids.length - 1, Math.max(0, at + delta))]
        // Shift with j or k selects as it moves, from the row it leaves.
        if (extend && selection && to) {
          selection.extend(from ?? to, to)
          focusRow(to)
          return
        }
        moveTo(to)
      },
      moveTo: (edge) => {
        if (!resting) moveTo(edge === 'first' ? ids[0] : ids.at(-1))
      },
      toggleSelected: () => {
        const id = focused() ?? panelId
        if (id && selection) selection.toggle(id)
      },
      clear: () => {
        // Escape leaves a focus mode first, then closes the panel, then clears the selection,
        // then leaves the rows.
        if (resting) {
          focusMode?.toggle()
          return true
        }
        if (panelId) {
          closePanel()
          return true
        }
        if (selection && selection.size > 0) {
          selection.clear()
          return true
        }
        if (focused() === null) return false
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        return true
      },
      focusSearch: () => searchRef.current?.focus(),
      cursorItemId: () => null,
      ...(toggleViewed
        ? {
            toggleViewed: () => {
              const id = focused() ?? panelId
              if (id) toggleViewed(id)
            },
          }
        : {}),
      ...(focusMode ? { toggleCompare: focusMode.toggle } : {}),
      ...(showTab
        ? {
            showTab: (index: number) => {
              if (!resting) showTab(index)
            },
          }
        : {}),
      ...(bulk ? { bulk } : {}),
      ...(discard
        ? {
            discard: {
              count: () => discard.targets(focused() ?? panelId).length,
              run: () => {
                const ids = discard.targets(focused() ?? panelId)
                if (ids.length) discard.run(ids)
              },
            },
          }
        : {}),
    }
  })
  // One stable scope for the command registry; it reads the latest state through the ref, and
  // changes only with the keys the list has.
  const viewed = toggleViewed !== undefined
  const focusable = focusMode !== undefined
  const tabbed = showTab !== undefined
  const bulky = bulk !== undefined
  const discards = discard !== undefined
  const scope = useMemo<ListScope>(
    () => ({
      move: (delta, extend) => latest.current?.move(delta, extend),
      moveTo: (edge) => latest.current?.moveTo(edge),
      toggleSelected: () => latest.current?.toggleSelected(),
      clear: () => latest.current?.clear() ?? false,
      focusSearch: () => latest.current?.focusSearch(),
      cursorItemId: () => null,
      ...(viewed ? { toggleViewed: () => latest.current?.toggleViewed?.() } : {}),
      ...(focusable ? { toggleCompare: () => latest.current?.toggleCompare?.() } : {}),
      ...(tabbed ? { showTab: (index: number) => latest.current?.showTab?.(index) } : {}),
      ...(bulky
        ? {
            bulk: {
              count: () => latest.current?.bulk?.count() ?? 0,
              can: (action: BulkAction) => latest.current?.bulk?.can(action) ?? false,
              run: (action: BulkAction) => latest.current?.bulk?.run(action),
              selectAll: () => latest.current?.bulk?.selectAll(),
            },
          }
        : {}),
      ...(discards
        ? {
            discard: {
              count: () => latest.current?.discard?.count() ?? 0,
              run: () => latest.current?.discard?.run(),
            },
          }
        : {}),
    }),
    [viewed, focusable, tabbed, bulky, discards],
  )
  useListScope(enabled ? scope : null)

  return {
    /** Where the open row is in the list, when it is in it. */
    position: index >= 0 ? { index, total: ids.length } : null,
    previousId,
    nextId,
    closePanel,
  }
}
