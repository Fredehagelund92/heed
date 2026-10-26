import * as React from 'react'
import { Outlet } from '@tanstack/react-router'
import { QueryClientProvider, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { mockControls } from '@/api'
import { createQueryClient } from '@/api/query-client'
import { isPageQuery, sessionQuery, sharedQueries, useSession } from '@/api/queries'
import { AppSidebar } from '@/components/app-sidebar'
import { CommandPalette } from '@/components/command-palette'
import { ConnectAgentDialog } from '@/components/connect-agent'
import { ShortcutsDialog } from '@/components/shortcuts-dialog'
import { ReportDialog } from '@/components/report-dialog'
import { ErrorBoundary } from '@/components/error-boundary'
import { useDock } from '@/lib/dock'
import { useAfter } from '@/lib/loading'
import { FactPeek } from '@/components/heed/fact-peek'
import { DefinitionPeek } from '@/components/heed/definition-peek'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { AnswerPanel } from '@/components/obs/answer-panel'
import { SharePanel } from '@/components/heed/share-answer'
import { WherePanel } from '@/components/heed/where-panel'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import { open } from '@/lib/events'
import { clamp, readWidth, saveWidth } from '@/lib/pane-width'
import { navigate, useInAppLinks, useRoute } from '@/lib/router'
import { ThemeProvider } from '@/lib/theme'
import { AskDock, TryIt } from '@/pages/ask'
import { ReviewSheet } from '@/pages/review'
import { SignInPage } from '@/pages/signin'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * A lazy page's fallback, in the page's own shape: nothing for 150ms, so a chunk already fetched never
 * flashes a skeleton. The review: its list, the document and the side panel. An editor: the
 * toolbar row and the sheet on its canvas.
 */
export function Loading({ shape }: { shape: 'review' | 'editor' }) {
  const shown = useAfter(true)
  if (!shown) return null
  if (shape === 'review')
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading"
        className="flex h-full min-h-0 flex-col"
      >
        <div className="flex h-bar shrink-0 items-center gap-3 border-b px-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="ml-auto h-7 w-24" />
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="hidden w-72 shrink-0 flex-col border-r lg:flex">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex h-14 flex-col justify-center gap-1.5 border-b px-4">
                <Skeleton className="h-3.5" style={{ width: `${50 + ((i * 13) % 35)}%` }} />
                <Skeleton className="h-3 w-24" />
              </div>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-4 px-6 py-8 sm:px-10">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="mt-4 h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
          <div className="hidden w-80 shrink-0 flex-col gap-3 border-l p-4 xl:flex">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
      </div>
    )
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex h-bar shrink-0 items-center gap-3 border-b px-4">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="ml-auto h-7 w-20" />
      </div>
      <div className="flex h-tool shrink-0 items-center gap-2 border-b px-4">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="size-6" />
        ))}
      </div>
      <div className="min-h-0 flex-1 bg-muted/40 px-4 py-6">
        <div className="mx-auto flex max-w-sheet flex-col gap-4 border bg-background p-8">
          <Skeleton className="h-8 w-2/3" />
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-4" />
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-6 w-40" />
            </div>
          ))}
          <Skeleton className="mt-2 h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    </div>
  )
}

/** A screen behind its own error boundary, reset on every navigation, so one failure never blanks the app. */
function SafeScreen() {
  const { path } = useRoute()
  return (
    <ErrorBoundary key={path}>
      <Outlet />
    </ErrorBoundary>
  )
}

function SafeDock() {
  const dock = useDock()
  return (
    <ErrorBoundary key={`${dock?.kind}.${dock?.id}`}>
      <div className="h-full dock-swap">
        <DockContent />
      </div>
    </ErrorBoundary>
  )
}

function DockContent() {
  const dock = useDock()
  if (!dock) return null
  switch (dock.kind) {
    case 'review':
      return <ReviewSheet cardId={dock.id!} />
    case 'context':
      return <FactPeek id={dock.id!} />
    case 'def':
      return <DefinitionPeek name={dock.id!} />
    case 'ask':
      return <AskDock />
    case 'try':
      return <TryIt cardId={dock.id} />
    case 'topic':
      return <AnswerPanel id={dock.id!} />
    case 'share':
      return <SharePanel id={dock.id!} />
    case 'where':
      return <WherePanel id={dock.id!} />
  }
}

/** The app inside its shell: the sidebar, the page and the dock. Signed out, the sign-in page. */
export function AppShell() {
  const { user } = useSession()
  if (!user) return <SignInPage />
  return <Shell />
}

function Shell() {
  const dock = useDock()
  const isMobile = useIsMobile()
  const { parts } = useRoute()
  // The sidebar folds to its rail while the dock is open or a review is on screen, and comes back
  // when they close. A page that loads that way starts folded, so nothing jumps after the first paint.
  const hasDock = !!dock || (parts[0] === 'inbox' && parts[2] === 'review')
  const [open, setOpen] = React.useState(!hasDock)
  // The left navigation's width, dragged on its rail, kept for the session.
  const [sidebarWidth, setSidebarWidth] = React.useState(() =>
    clamp(readWidth('sidebar', 256), 200, 360),
  )
  // The fold follows the dock in the same render as the dock itself, so the page reflows once, in one
  // frame, and that fold is instant (data-fold="auto"). Only a person's own fold animates.
  const [had, setHad] = React.useState(hasDock)
  const [before, setBefore] = React.useState<boolean | null>(hasDock ? true : null)
  const [auto, setAuto] = React.useState(false)
  if (had !== hasDock) {
    setHad(hasDock)
    setAuto(true)
    if (hasDock && before === null) {
      setBefore(open)
      setOpen(false)
    }
    if (!hasDock && before !== null) {
      setOpen(before)
      setBefore(null)
    }
  }

  return (
    <SidebarProvider
      open={open}
      onOpenChange={(o) => {
        setAuto(false)
        setOpen(o)
      }}
      data-fold={auto ? 'auto' : undefined}
      className="h-svh overflow-hidden"
      style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
    >
      {/* The first stop for the keyboard: past the sidebar, straight to the page. A button, since a #link would change the address. */}
      <button
        type="button"
        className="sr-only fixed top-3 left-3 z-skip rounded-md bg-background px-3 py-2 text-sm font-medium shadow-md ring-3 ring-ring/50 focus-visible:not-sr-only"
        onClick={() => {
          // A page can name where it starts (Ask: the box to ask in); otherwise the page itself.
          const target = document.querySelector<HTMLElement>('[data-skip-target]')
          if (target) return target.focus()
          const main = document.querySelector<HTMLElement>('[data-slot=sidebar-inset]')
          main?.setAttribute('tabindex', '-1')
          main?.focus()
        }}
      >
        Skip to the content
      </button>
      <AppSidebar
        onWidth={(w, done) => {
          const next = clamp(w, 200, 360)
          setSidebarWidth(next)
          if (done) saveWidth('sidebar', next)
        }}
      />
      <SidebarInset className="min-w-0 overflow-hidden">
        {isMobile ? (
          <div className="h-full min-h-0">
            <SafeScreen />
          </div>
        ) : (
          // One group whether the dock is open or not: the page keeps its place, so opening a peek
          // keeps its search, filters, ticked rows and scroll.
          <ResizablePanelGroup orientation="horizontal" id="shell">
            <ResizablePanel id="page" minSize={360}>
              <SafeScreen />
            </ResizablePanel>
            {dock && <ResizableHandle withHandle />}
            {dock && (
              <ResizablePanel
                id={`dock-${dock.width}`}
                key={dock.width}
                defaultSize={clamp(readWidth(`dock-${dock.width}`, dock.width), 400, 960)}
                minSize={400}
                maxSize={960}
                groupResizeBehavior="preserve-pixel-size"
                onResize={(size) => saveWidth(`dock-${dock.width}`, size.inPixels)}
              >
                {/* The dock arrives: a 16px slide and a fade in 220ms; its content changing (peek to peek) only fades. */}
                <div className="h-full dock-enter">
                  <SafeDock />
                </div>
              </ResizablePanel>
            )}
          </ResizablePanelGroup>
        )}
        {isMobile && dock && (
          <div className="fixed inset-0 z-dock dock-enter bg-background">
            <SafeDock />
          </div>
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}

/**
 * The mock binding plays the review flags in the address (?demo=, ?state=, ?slow=1 and the rest):
 * every move tells it where the app is. A flag that sets a fault starts the page's own load again;
 * one that changes the demo's world refreshes everything. The http binding has no flags.
 */
function ScenarioSync() {
  const { path, query } = useRoute()
  const queryClient = useQueryClient()
  const search = query.toString()
  React.useLayoutEffect(() => {
    if (!mockControls) return
    const changed = mockControls.setAddress({
      path,
      query: Object.fromEntries(new URLSearchParams(search)),
    })
    if (changed.fault) void queryClient.resetQueries({ predicate: (q) => isPageQuery(q.queryKey) })
    if (changed.data) void queryClient.invalidateQueries()
  }, [path, search, queryClient])
  return null
}

function Gate() {
  const { user } = useSession()
  const route = useRoute()
  useInAppLinks()
  React.useEffect(() => {
    // The documentation is a public site: it needs nobody signed in.
    if (!user && route.parts[0] !== 'signin' && route.parts[0] !== 'docs') navigate('/signin')
  }, [user, route.parts])
  // ?open=palette, connect, shortcuts or report opens that overlay, so every state has a link.
  const overlay = route.query.get('open')
  React.useEffect(() => {
    if (
      overlay === 'palette' ||
      overlay === 'connect' ||
      overlay === 'shortcuts' ||
      overlay === 'report'
    )
      setTimeout(() => open(overlay), 0)
  }, [overlay])
  // The documentation, sign-in or the app in its shell (routes/).
  return <Outlet />
}

/**
 * The shared reads every screen uses (the session, the workspace, the library), loaded once before
 * anything is drawn, so a screen reads them from the cache and never waits. Signed out, only the
 * session: the sign-in page and the documentation need nothing else.
 */
function Loaded({ children }: { children: React.ReactNode }) {
  const session = useQuery(sessionQuery())
  const signedIn = !!session.data?.user
  const rest = useQueries({
    queries: sharedQueries().map((q) => ({ ...q, enabled: signedIn })),
  })
  if (!session.data) return null
  if (signedIn && rest.some((q) => q.data === undefined)) return null
  return children
}

/**
 * Toasts never cover a primary action: clear of the Ask box wherever Ask is open, above the
 * 48px action bars at the foot of panes, and in the review at the bottom right above the decision
 * panel, so it covers neither the change nor its buttons; on a phone above the decision bar.
 */
function AppToaster() {
  const { parts, query } = useRoute()
  const ask = parts[0] === 'ask' || /^(ask|try)/.test(query.get('dock') ?? '')
  const review = parts[0] === 'inbox' && parts[2] === 'review'
  // A list's selection bar sits in a band at its foot: a toast about what the bar did sits above it and its line.
  const list = ['context', 'definitions', 'inbox'].includes(parts[0] ?? '') && !parts[1]
  return (
    <Toaster
      position="bottom-right"
      offset={{ bottom: ask ? 152 : list ? 112 : review ? 300 : 64, right: 24 }}
      // In the review a narrower toast stays inside the decision's column, clear of the change.
      style={review ? ({ '--width': '300px' } as React.CSSProperties) : undefined}
      mobileOffset={{ bottom: ask ? 168 : review ? 148 : list ? 124 : 64 }}
    />
  )
}

const queryClient = createQueryClient({
  // A session that ended: everything cached was the person's, and the sign-in page comes next.
  onSignedOut: () => void queryClient.invalidateQueries({ queryKey: sessionQuery().queryKey }),
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <ScenarioSync />
          <Loaded>
            <Gate />
            <SignedIn>
              <CommandPalette />
              <ConnectAgentDialog />
              <ShortcutsDialog />
              <ReportDialog />
            </SignedIn>
          </Loaded>
          <AppToaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

/** What only someone signed in sees: the overlays over the app. */
function SignedIn({ children }: { children: React.ReactNode }) {
  const { user } = useSession()
  return user ? children : null
}
