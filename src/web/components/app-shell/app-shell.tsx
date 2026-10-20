import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { hasHeldAction, subscribeHeld, undoHeldAction } from '@/lib/held-action'
import { useHotkeys } from 'react-hotkeys-hook'
import { favoritesQuery, stopsQuery, useSetFavorite } from '@/api/queries'
import { SidebarInset, SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useExit } from '@/hooks/use-exit'
import { useLiveUpdates } from '@/hooks/use-live-updates'
import { useMediaQuery } from '@/hooks/use-media-query'
import { setAppearance } from '@/lib/appearance'
import { showToast, useToastsWanted } from '@/lib/toast'
import { usePermissions } from '@/lib/use-session'
import type {
  AssistantState,
  CheckScope,
  CommandContext,
  DocumentScope,
  ListScope,
  MainAction,
  ReviewScope,
} from '@/lib/commands'
import { AppHeader } from './app-header'
import { AppSidebar } from './app-sidebar'
import { UpdateBanner } from './update-banner'
import { CommandHotkeys } from './command-hotkeys'
import { AssistantLauncher } from './assistant-launcher'
import { CommandScopeContext } from './command-scope'
import {
  DockScopeContext,
  PanelCoveredContext,
  PanelOpenedContext,
  SidebarFoldContext,
} from './dock-scope'
import { ShellActionsContext, type AssistantTab, type ShellActions } from './shell-actions'
import { goToOrigin, goUp, useOriginOfPage, useTrailOfPage } from './trail'
import { OriginContext, TrailContext } from './trail-context'

// The palette and the shortcut sheet are not part of the first load. The palette is fetched as
// soon as the browser is idle, so Command K opens it at once and no keystroke is lost.
const loadPalette = () => import('./command-palette')
const CommandPalette = lazy(() =>
  loadPalette().then((module) => ({ default: module.CommandPalette })),
)
const Toaster = lazy(() =>
  import('@/components/ui/toast').then((module) => ({ default: module.Toaster })),
)
const ShortcutsDialog = lazy(() =>
  import('./shortcuts-dialog').then((module) => ({ default: module.ShortcutsDialog })),
)

// The assistant's panel loads the first time it opens.
const AssistantPanel = lazy(() =>
  import('./assistant-panel').then((module) => ({ default: module.AssistantPanel })),
)

// The one chip preview card and sheet (components/preview): a chunk of its own, fetched after the
// first load; the chips themselves only carry their trigger.
const PreviewHost = lazy(() =>
  import('@/components/preview/preview-host').then((module) => ({ default: module.PreviewHost })),
)

const DeliveryBanner = lazy(() =>
  import('./delivery-banner').then((module) => ({ default: module.DeliveryBanner })),
)

/**
 * The stops are read on every page, so everyone signed in sees the banner while one is on; the
 * banner itself loads only then, so it is not part of the first load.
 */
function DeliveryStopped() {
  const { data: stops } = useQuery(stopsQuery())
  if (!stops?.length) return null
  return (
    <Suspense fallback={null}>
      <DeliveryBanner />
    </Suspense>
  )
}

/** The sidebar is expanded from the Tailwind `xl` breakpoint (80rem = 1280px) and a rail below it. */
const EXPANDED_QUERY = '(min-width: 80rem)'

/**
 * The pages that are the assistant expanded: Ask (`/assistant`) and What an agent would get
 * (`/try-it`). On them the assistant is not docked as well, and the launcher is not shown
 * (contract 9.8): Command or Control backslash docks the same conversation instead.
 */
const assistantPages: Record<string, AssistantTab> = { '/assistant': 'ask', '/try-it': 'agent' }

/** An overlay that loads on first open and stays mounted, so closing it still plays its exit. */
function useOverlay() {
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const change = (next: boolean) => {
    setOpen(next)
    if (next) setLoaded(true)
  }
  return { open, mounted: open || loaded, change }
}

/** Starts the assistant's conversation afresh, from its chunk, which is loaded while it shows. */
function newChat() {
  void import('@/lib/assistant-chat').then((module) => module.requestNewChat())
}

/** The composer of the assistant's page takes the focus, as G then A does there. */
function focusComposer() {
  document.querySelector<HTMLElement>('[data-question]')?.focus()
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function ShellFrame({
  peek,
  docked,
  children,
}: {
  peek: boolean
  docked: boolean
  children: ReactNode
}) {
  const navigate = useNavigate()
  const { toggleSidebar, setOpenMobile } = useSidebar()
  const palette = useOverlay()
  const shortcuts = useOverlay()
  const [list, setList] = useState<ListScope | null>(null)
  const [documentScope, setDocument] = useState<DocumentScope | null>(null)
  const [reviewScope, setReview] = useState<ReviewScope | null>(null)
  const [checkScope, setCheck] = useState<CheckScope | null>(null)
  const [mainAction, setMainAction] = useState<MainAction | null>(null)
  const [headerActions, setHeaderActions] = useState<HTMLElement | null>(null)
  const [sideRegion, setSideRegion] = useState<HTMLElement | null>(null)
  const { data: favorites } = useQuery(favoritesQuery())
  const setFavorite = useSetFavorite()
  const { ready: rolesRead, permissions } = usePermissions()
  useLiveUpdates()

  // One assistant in one of three states, never two at once (contract 9.8): closed, docked
  // beside the page, or expanded to its own page. Docked, it opens on the tab last shown and
  // stays open from page to page. It covers a record's panel while it is open (one panel at a
  // time). Closed from inside the panel, focus goes back to the covered record where it was, or
  // else to what opened it.
  const router = useRouter()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  // The phone's sidebar sheet closes when a place in it opens, so the place is what shows.
  useEffect(() => setOpenMobile(false), [pathname, setOpenMobile])
  const expandedTab: AssistantTab | undefined = assistantPages[pathname]
  const expanded = expandedTab !== undefined
  const [assistantTab, setAssistantTab] = useState<AssistantTab | null>(null)
  // Expanding the assistant closes its panel, so going on from its page shows no panel.
  const [wasExpanded, setWasExpanded] = useState(expanded)
  if (wasExpanded !== expanded) {
    setWasExpanded(expanded)
    if (expanded) setAssistantTab(null)
  }
  const assistantOpen = assistantTab !== null && !expanded
  // Closed, the panel stays for its 100 ms exit, inert, while the page already has the focus.
  const assistantPanel = useExit(assistantOpen ? assistantTab : null)
  const assistant: AssistantState = expanded ? 'expanded' : assistantOpen ? 'docked' : 'closed'
  const lastTab = useRef<AssistantTab>('ask')
  const assistantOpener = useRef<HTMLElement | null>(null)
  const returnFocus = useRef(false)
  // The page the person came to the assistant's page from, read without a render per address:
  // docking returns there, or Home.
  const returnTo = useRef('/')
  // The last page outside the docs, where the docs' Back goes (docs mode, contract 8.11).
  const appReturn = useRef('/')
  useEffect(() => {
    const keep = ({ pathname: path, href }: { pathname: string; href: string }) => {
      if (!(path in assistantPages)) returnTo.current = href
      if (path !== '/docs' && !path.startsWith('/docs/')) appReturn.current = href
    }
    keep(router.state.location)
    return router.subscribe('onResolved', ({ toLocation }) => keep(toLocation))
  }, [router])
  const toggleAssistant = useCallback(
    (tab?: AssistantTab) => {
      if (expandedTab) {
        // Docks the same conversation beside the page the person came from.
        const docked = tab ?? expandedTab
        lastTab.current = docked
        assistantOpener.current = null
        setAssistantTab(docked)
        void navigate({ href: returnTo.current })
        return
      }
      setAssistantTab((shown) => {
        const wanted = tab ?? (shown === null ? lastTab.current : null)
        const next = wanted === shown ? null : wanted
        if (next !== null) lastTab.current = next
        // Closed from the keyboard with the focus in it, the panel gives the focus back.
        if (next === null) returnFocus.current = true
        if (next !== null && shown === null)
          assistantOpener.current = openerOf(document.activeElement)
        return next
      })
    },
    [expandedTab, navigate],
  )
  const askAssistant = useCallback((question: string) => {
    const opener = openerOf(document.activeElement)
    // The new chat starts before the panel shows, so it never shows the old one for a moment.
    void import('@/lib/assistant-chat').then((module) => {
      module.askInNewChat(question)
      setAssistantTab((shown) => {
        if (shown === null) assistantOpener.current = opener
        lastTab.current = 'ask'
        return 'ask'
      })
    })
  }, [])
  const changeAssistantTab = (tab: AssistantTab) => {
    lastTab.current = tab
    setAssistantTab(tab)
  }
  const closeAssistant = useCallback(() => setAssistantTab(null), [])
  const closeAssistantHere = () => {
    returnFocus.current = true
    setAssistantTab(null)
  }
  // After the panel has gone (and a covered record is shown again and took focus back), focus
  // goes to what opened the assistant if it is still there, or else to the page.
  useEffect(() => {
    if (assistantTab !== null || !returnFocus.current) return
    returnFocus.current = false
    const active = document.activeElement
    if (active && active !== document.body) return
    const opener = assistantOpener.current
    if (opener?.isConnected && opener !== document.body) opener.focus()
    else document.getElementById('main')?.focus()
  }, [assistantTab])

  const actions: ShellActions = useMemo(() => {
    const isFavorite = (id: string) => favorites?.includes(id) ?? false
    return {
      openPalette: () => palette.change(true),
      openShortcuts: () => shortcuts.change(true),
      addContext: () => void navigate({ to: '/library/new' }),
      isFavorite,
      toggleFavorite: (id) => {
        const favorite = !isFavorite(id)
        setFavorite.mutate({ id, favorite })
        showToast(favorite ? 'Added to favourites' : 'Removed from favourites')
      },
      assistantOpen,
      toggleAssistant,
      askAssistant,
      copyLinks: (ids) => {
        const links = ids.map((id) => `${window.location.origin}/library/${id}`).join('\n')
        void copyText(links).then((copied) =>
          showToast(
            copied
              ? ids.length === 1
                ? 'Link copied'
                : `${ids.length.toLocaleString('en')} links copied`
              : "Couldn't copy. Your browser blocked it.",
          ),
        )
      },
      headerActions,
      sideRegion,
      appReturnHref: () => appReturn.current,
    }
    // palette.change and shortcuts.change only set state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    favorites,
    navigate,
    setFavorite.mutate,
    headerActions,
    sideRegion,
    assistantOpen,
    toggleAssistant,
    askAssistant,
  ])

  // On a record page, Escape with nothing open goes back to where it was opened from, or else
  // up to the parent crumb (contract 9.11).
  const trail = useTrailOfPage()
  const origin = useOriginOfPage(trail)
  const parent = trail.at(-2)
  const record = trail.at(-1)?.record === true
  // A bulk step held for Undo (lib/held-action.ts): Command or Control Z takes it back.
  const held = useSyncExternalStore(subscribeHeld, hasHeldAction, () => false)
  const context: CommandContext = {
    navigate: (to, search) => void navigate({ to, search }),
    up:
      record && origin
        ? () => goToOrigin(router, origin)
        : record && parent
          ? () => goUp(router, parent)
          : null,
    backTo: record ? origin?.label : undefined,
    permissions: rolesRead ? permissions : undefined,
    toggleAssistant,
    assistant,
    focusAssistant: expandedTab === 'ask' ? focusComposer : undefined,
    // The assistant's chunk is loaded while it is docked or expanded, and its panel or page shows
    // the question New chat may ask first.
    newChat: assistant === 'closed' ? undefined : newChat,
    setAppearance,
    toggleSidebar,
    openPalette: actions.openPalette,
    openShortcuts: actions.openShortcuts,
    addContext: actions.addContext,
    toggleFavorite: actions.toggleFavorite,
    isFavorite: actions.isFavorite,
    copyLink: (id) => actions.copyLinks([id]),
    list,
    document: documentScope,
    review: reviewScope,
    check: checkScope,
    mainAction,
    undo: held ? undoHeldAction : null,
  }
  useHotkeys('mod+k', () => palette.change(!palette.open), {
    preventDefault: true,
    enableOnFormTags: true,
  })
  const scopeSetters = useMemo(
    () => ({ setList, setDocument, setReview, setCheck, setMainAction }),
    [],
  )
  useEffect(() => {
    const preload = () => void loadPalette()
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(preload, { timeout: 2000 })
      return () => window.cancelIdleCallback(id)
    }
    const timer = setTimeout(preload, 1000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <ShellActionsContext value={actions}>
      <TrailContext value={trail}>
        <CommandScopeContext value={scopeSetters}>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-skip focus:rounded-md focus:bg-foreground focus:px-3 focus:py-2 focus:text-background"
          >
            Skip to content
          </a>
          <CommandHotkeys context={context} />
          <AppSidebar peek={peek} />
          {/*
            Where an area puts a sidebar of its own beside the app's (the docs' tree in docs
            mode): a box-less slot, so what it holds sits in the row between the sidebar and the
            page, and it takes no room while it is empty.
          */}
          <div ref={setSideRegion} data-slot="side-region" className="contents" />
          {/* A docked panel is fixed to the window's right edge; the page keeps its width free. */}
          <PanelOpenedContext value={closeAssistant}>
            <PanelCoveredContext value={assistantOpen}>
              <SidebarInset data-docked={docked || undefined} className="data-docked:pr-dock">
                <OriginContext value={origin}>
                  <AppHeader onOpenPalette={actions.openPalette} actionsRef={setHeaderActions} />
                </OriginContext>
                <main id="main" tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
                  <UpdateBanner />
                  <DeliveryStopped />
                  {children}
                </main>
              </SidebarInset>
            </PanelCoveredContext>
          </PanelOpenedContext>
          {expanded ? null : (
            <AssistantLauncher open={assistantOpen} onToggle={() => toggleAssistant()} />
          )}
          <Suspense fallback={null}>
            <PreviewHost />
          </Suspense>
          {assistantPanel.shown !== null ? (
            <Suspense fallback={null}>
              <AssistantPanel
                tab={assistantPanel.shown}
                leaving={assistantPanel.leaving}
                onTabChange={changeAssistantTab}
                onClose={closeAssistantHere}
                onLeave={closeAssistant}
              />
            </Suspense>
          ) : null}
          {palette.mounted ? (
            <Suspense fallback={null}>
              <CommandPalette open={palette.open} onOpenChange={palette.change} context={context} />
            </Suspense>
          ) : null}
          {shortcuts.mounted ? (
            <Suspense fallback={null}>
              <ShortcutsDialog open={shortcuts.open} onOpenChange={shortcuts.change} />
            </Suspense>
          ) : null}
        </CommandScopeContext>
      </TrailContext>
    </ShellActionsContext>
  )
}

/**
 * The app shell: sidebar, header, breadcrumb, command palette, shortcut sheet, toasts and the
 * page outlet. The sidebar follows the viewport (expanded from 1280, a rail below, a sheet on
 * phones) until the person toggles it. Below 1280 an expanded sidebar overlays the page (peek)
 * and closes on navigation, Escape and an outside click (contract 4.2). While a panel is docked
 * on the right, or a record is open in a page's own flow (the Workbench), it folds to the rail; a
 * toggle then holds until the panel or the record closes.
 */
/**
 * What opened the assistant, for the focus to go back to: the focused element, or, from an item
 * of a menu (which is gone once the menu closes), the menu's button.
 */
function openerOf(active: Element | null): HTMLElement | null {
  if (!(active instanceof HTMLElement)) return null
  if (!active.closest('[role="menu"]')) return active
  return document.querySelector<HTMLElement>('[aria-haspopup="menu"][aria-expanded="true"]')
}

export function AppShell({ children }: { children: ReactNode }) {
  const expanded = useMediaQuery(EXPANDED_QUERY)
  // Two panels can be docked at once (a record, and the assistant over it): the width stays
  // free until the last one closes.
  const [dockedPanels, setDockedPanels] = useState(0)
  const docked = dockedPanels > 0
  const setDocked = useCallback(
    (on: boolean) => setDockedPanels((count) => count + (on ? 1 : -1)),
    [],
  )
  // A record open in a page's own flow folds the sidebar too, without the room on the right.
  const [foldingPages, setFoldingPages] = useState(0)
  const setFolded = useCallback(
    (on: boolean) => setFoldingPages((count) => count + (on ? 1 : -1)),
    [],
  )
  const folds = docked || foldingPages > 0
  const [override, setOverride] = useState<{
    forExpanded: boolean
    forFolded: boolean
    open: boolean
  } | null>(null)
  const open =
    override && override.forExpanded === expanded && override.forFolded === folds
      ? override.open
      : expanded && !folds
  const peek = !expanded && open
  const toastsWanted = useToastsWanted()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const close = () => setOverride({ forExpanded: expanded, forFolded: folds, open: false })

  // A peeking sidebar closes when the page changes.
  const [lastPath, setLastPath] = useState(pathname)
  if (lastPath !== pathname) {
    setLastPath(pathname)
    if (peek) close()
  }

  useEffect(() => {
    if (!peek) return
    const onPointer = (event: PointerEvent) => {
      const sidebar = document.querySelector('[data-slot="sidebar-container"]')
      const target = event.target
      if (target instanceof Node && sidebar?.contains(target)) return
      if (target instanceof Element && target.closest('[role="menu"], [role="dialog"]')) return
      setOverride({ forExpanded: false, forFolded: folds, open: false })
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOverride({ forExpanded: false, forFolded: folds, open: false })
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [peek, folds])

  return (
    <TooltipProvider>
      <SidebarProvider
        open={open}
        onOpenChange={(next) =>
          setOverride({ forExpanded: expanded, forFolded: folds, open: next })
        }
      >
        <DockScopeContext value={setDocked}>
          <SidebarFoldContext value={setFolded}>
            <ShellFrame peek={peek} docked={docked}>
              {children}
            </ShellFrame>
          </SidebarFoldContext>
        </DockScopeContext>
      </SidebarProvider>
      {toastsWanted ? (
        <Suspense fallback={null}>
          <Toaster />
        </Suspense>
      ) : null}
    </TooltipProvider>
  )
}
