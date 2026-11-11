import * as React from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar'
import { Frame, FramePage } from '@/components/heed/frame'
import { RowsSkeleton } from '@/components/heed/load-state'
import { DEFINITIONS_LEAD, TableSkeleton } from '@/components/heed/list-skeleton'
import { useDock } from '@/lib/dock'
import { clamp, readWidth } from '@/lib/pane-width'
import { useRoute } from '@/lib/router'
import { cn } from '@/lib/utils'

// The app's skeletons in each page's own shape, for a lazy page's fallback (Loading in App.tsx) and
// for the whole app while its shared reads load (ShellShape). They come with their own code,
// fetched as the app starts, so the first load stays small; App.tsx waits 150ms before it shows
// one, by which time this code is in.

// The skeleton draws no text, so the app's font would only load once the page arrives, and the
// page would draw in a fallback font and then re-wrap. Load it while the skeleton shows.
void document.fonts.load('1em "Nunito Sans Variable"')

/** The shapes: a review, an editor, Definitions' list, any other page, the documentation's home or a page. */
export type Shape = 'review' | 'editor' | 'page' | 'definitions' | 'docs-home' | 'docs-page'

/** The header every page in the shell starts with: the sidebar's toggle, its rule, the title, on a phone search, and the theme. */
function HeaderShape() {
  return (
    <div className="flex h-bar shrink-0 items-center gap-3 border-b px-4 md:px-6">
      <Skeleton className="size-7" />
      <div className="mr-2 h-4 w-px bg-border" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="ml-auto size-7 md:hidden" />
      <Skeleton className="size-7 md:ml-auto" />
    </div>
  )
}

/** A page's skeleton without its own status: Loading and the shell's skeleton each say Loading once. */
export function PageShape({ shape }: { shape: Shape }) {
  if (shape === 'page')
    return (
      <>
        <HeaderShape />
        <FramePage>
          <Frame>
            <div className="flex flex-col gap-2 px-4 py-4 md:px-5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
            <RowsSkeleton rows={8} />
          </Frame>
        </FramePage>
      </>
    )
  if (shape === 'definitions')
    return (
      <>
        <HeaderShape />
        {/* The list's own scroller and its 80rem frame, so the bars and rows land where the list's do. */}
        <div className="@container/main flex min-h-0 flex-1 flex-col overflow-clip *:mx-auto *:w-full *:max-w-wide @min-[80rem]/main:*:border-x">
          <TableSkeleton lead={DEFINITIONS_LEAD} announce={false} />
        </div>
      </>
    )
  if (shape === 'docs-home' || shape === 'docs-page')
    return (
      <>
        <div className="border-b">
          <div className="mx-auto flex h-12 max-w-352 items-center gap-4 px-4 md:px-6">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="ml-auto h-7 w-40" />
          </div>
        </div>
        {/* The site's column. A page: the pages on the left from lg, the article in its reading
            width and the column for its headings. The home: its title, line and search. */}
        <div
          className={cn(
            'mx-auto grid max-w-352 border-x',
            shape === 'docs-page' && 'lg:grid-cols-(--cols-lead-62)',
          )}
          style={{ minHeight: 'calc(100svh - 3rem)' }}
        >
          {shape === 'docs-home' ? (
            <div className="flex max-w-2xl flex-col gap-4 px-4 py-10 md:px-10 md:py-14 lg:px-14">
              <Skeleton className="h-11 w-2/3" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="mt-4 h-11 w-md max-w-full" />
            </div>
          ) : (
            <>
              <div className="hidden flex-col gap-3 border-r px-6 py-8 lg:flex">
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton
                    key={i}
                    className="h-3.5"
                    style={{ width: `${45 + ((i * 17) % 40)}%` }}
                  />
                ))}
              </div>
              <div className="grid min-w-0 lg:grid-cols-(--cols-docs-page)">
                <div className="min-w-0 px-4 py-8 md:px-10 md:py-10 lg:px-14">
                  <div className="mx-auto flex max-w-176 flex-col gap-4">
                    <Skeleton className="h-3.5 w-24" />
                    <Skeleton className="h-8 w-1/2" />
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="mt-4 h-4 w-full" />
                    <Skeleton className="h-4 w-11/12" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                </div>
                <div className="hidden border-l lg:block" />
              </div>
            </>
          )}
        </div>
      </>
    )
  if (shape === 'review')
    return (
      <>
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
      </>
    )
  return (
    <>
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
    </>
  )
}

/** The skeleton a place shows while it loads, as its route's own fallback draws it. */
function shapeOf(parts: string[]): Shape {
  const [place, id, step] = parts
  if (place === 'docs') return id ? 'docs-page' : 'docs-home'
  if (place === 'inbox' && step === 'review') return 'review'
  if (
    (place === 'context' || place === 'definitions') &&
    (id === 'new' || step === 'edit' || step === 'suggest')
  )
    return 'editor'
  if (place === 'definitions' && !id) return 'definitions'
  return 'page'
}

/** A row of the sidebar's list while it loads: its icon and its label, the label gone in the rail. */
function NavRowShape({ width }: { width: number }) {
  return (
    <SidebarMenuItem className="flex h-8 items-center gap-2 px-2">
      <Skeleton className="size-4 shrink-0 rounded-sm" />
      <Skeleton
        className="h-3.5 group-data-[collapsible=icon]:hidden"
        style={{ width: `${width}%` }}
      />
    </SidebarMenuItem>
  )
}

/**
 * The app while its shared reads load (a big workspace, a slow network): the sidebar where it will
 * be, folded as the shell folds it for a dock or a review, and the page's own skeleton beside it,
 * so what arrives lands in place.
 */
export function ShellShape() {
  const { parts } = useRoute()
  const dock = useDock()
  const shape = shapeOf(parts)
  // The documentation is outside the shell: its own header and column.
  if (shape === 'docs-home' || shape === 'docs-page')
    return (
      <div role="status" aria-busy="true" aria-label="Loading" className="min-h-svh bg-background">
        <PageShape shape={shape} />
      </div>
    )
  const folded = !!dock || (parts[0] === 'inbox' && parts[2] === 'review')
  return (
    <SidebarProvider
      role="status"
      aria-busy="true"
      aria-label="Loading"
      open={!folded}
      className="h-svh overflow-clip"
      style={
        {
          '--sidebar-width': `${clamp(readWidth('sidebar', 256), 200, 360)}px`,
        } as React.CSSProperties
      }
    >
      <Sidebar collapsible="icon" className="*:data-[slot=sidebar-inner]:bg-background">
        <SidebarHeader className="h-bar justify-center border-b px-2">
          <div className="flex h-8 items-center px-2">
            <Skeleton className="h-5 w-20 group-data-[collapsible=icon]:w-4" />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup className="pb-1">
            <Skeleton className="h-8 w-full group-data-[collapsible=icon]:hidden" />
            <SidebarMenu className="hidden group-data-[collapsible=icon]:flex">
              <NavRowShape width={40} />
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup className="pt-2 group-data-[collapsible=icon]:pt-3">
            <SidebarMenu>
              {[34, 20, 38, 50].map((w, i) => (
                <NavRowShape key={i} width={w} />
              ))}
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup className="mt-auto">
            <SidebarMenu>
              {[24, 50, 36].map((w, i) => (
                <NavRowShape key={i} width={w} />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="h-bar justify-center border-t py-0">
          <div className="flex h-12 items-center gap-2 p-2 group-data-[collapsible=icon]:p-0">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5 group-data-[collapsible=icon]:hidden">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-h-0 min-w-0 overflow-clip">
        <div className="flex h-full min-h-0 flex-col">
          <PageShape shape={shape} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
