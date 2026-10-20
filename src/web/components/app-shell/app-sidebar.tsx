import { Fragment, useMemo } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { favoritesQuery, REVIEW_QUEUE_PAGE, reviewQueueQuery } from '@/api/queries'
import { useDeciding, waitingRows } from '@/lib/deciding'
import { CountBadge } from '@/components/item/count-badge'
import { KindIcon } from '@/components/item/kind-icon'
import { PanelLeftIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  useSidebar,
  SidebarMenuBadge,
} from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatHotkey } from '@/lib/commands'
import {
  isLiveIssueRow,
  libraryViews,
  needsALookCount,
  type LibraryViewId,
} from '@/lib/library-core'
import { draftsLink } from '@/lib/my-drafts'
import { navGroupLabels, navGroups, navItemsFor, type NavItem } from '@/lib/nav'
import { useLibrary } from '@/lib/use-library'
import { useMyDrafts } from '@/lib/use-my-drafts'
import { reviewsAnything } from '@/lib/permissions'
import { usePermissions } from '@/lib/use-session'
import { LogoSymbol, LogoWordmark } from './logo'
import { UserMenu } from './user-menu'
import { productName } from '@/lib/brand'

function useLocation() {
  return useRouterState({
    select: (state) => ({
      pathname: state.location.pathname,
      search: state.location.search,
    }),
  })
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <SidebarMenuButton
      isActive={active}
      tooltip={item.title}
      render={
        <Link
          to={item.to}
          search={item.search}
          // The router marks a link current on a prefix of the address too; only the entry the
          // sidebar picks out is the current page (a view or section under it may be instead).
          activeOptions={{ exact: true }}
          aria-current={active ? 'page' : undefined}
        />
      }
    >
      {/* The selected place's icon is in the accent; its label stays ink (contract 6.1). */}
      <item.icon className={active ? 'text-brand-ink' : undefined} />
      <span>{item.title}</span>
    </SidebarMenuButton>
  )
}

/** Whether the address is the list of the person's drafts (Proposals > Mine, drafts only). */
function onDraftsList(pathname: string, search: Record<string, unknown>): boolean {
  return (
    pathname === draftsLink.to &&
    search.view === draftsLink.search.view &&
    search.state === draftsLink.search.state
  )
}

/**
 * The library's built-in views as quiet sub-items, the way Linear lists a team's views. Only
 * "Needs checking" shows a count: it is the one that asks for action. While the person has drafts
 * they have not submitted, Drafts follows with their number (as Gmail and Linear keep drafts a
 * place of their own); it opens Proposals > Mine on the drafts. The items moved out of the
 * library are an administrator's Deleted items, in the library's View menu, not a place here.
 */
function LibraryViews({
  attentionCount,
  drafts,
}: {
  attentionCount: number | null
  drafts: number
}) {
  const { pathname, search } = useLocation()
  const onList = pathname === '/library'
  const onDrafts = onDraftsList(pathname, search)
  return (
    <SidebarMenuSub aria-label="Library views">
      {libraryViews.map((view) => {
        const id: LibraryViewId = view.id
        const active = onList && (search.view ?? 'all') === id
        return (
          <SidebarMenuSubItem key={id}>
            <SidebarMenuSubButton
              isActive={active}
              title={view.hint}
              render={
                <Link
                  to="/library"
                  search={id === 'all' ? {} : { view: id }}
                  // All items is not current on another view's address (NavLink).
                  activeOptions={{ exact: true }}
                  aria-current={active ? 'page' : undefined}
                />
              }
            >
              <span>{view.title}</span>
              {id === 'attention' && attentionCount ? (
                <span className="ml-auto text-caption text-muted-foreground tabular-nums">
                  {attentionCount.toLocaleString('en')}
                </span>
              ) : null}
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        )
      })}
      {drafts ? (
        <SidebarMenuSubItem>
          <SidebarMenuSubButton
            isActive={onDrafts}
            title="Drafts you haven't sent yet"
            render={
              <Link
                {...draftsLink}
                data-slot="sidebar-drafts"
                activeOptions={{ exact: true, includeSearch: true }}
                aria-current={onDrafts ? 'page' : undefined}
              />
            }
          >
            <span>Drafts</span>
            <span className="ml-auto text-caption text-muted-foreground tabular-nums">
              {drafts.toLocaleString('en')}
            </span>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      ) : null}
    </SidebarMenuSub>
  )
}

/**
 * The number of proposals waiting for this person's decision, as an ink count beside Proposals
 * (frame C1): it is the one count in the sidebar that waits for the person. Hidden at zero and
 * for someone who reviews nothing. On the rail it becomes a corner count on the icon (table
 * design, "Sidebar and counts"); live updates keep it current.
 */
function ReviewCount() {
  const { ready, permissions } = usePermissions()
  const queue = useQuery({
    ...reviewQueueQuery(REVIEW_QUEUE_PAGE),
    enabled: ready && reviewsAnything(permissions),
  })
  const deciding = useDeciding()
  // A proposal whose decision is on its way no longer waits (lib/deciding.ts).
  const count = waitingRows(queue.data ?? [], deciding).length
  if (!count) return null
  // The queue is read a page at a time (at most 100), so a full page shows as 99+ on the rail.
  return (
    <>
      <SidebarMenuBadge aria-label={`${count} to review`}>
        <CountBadge count={count} tone="ink" />
      </SidebarMenuBadge>
      <span
        aria-hidden="true"
        data-slot="rail-count"
        className="pointer-events-none absolute -top-1 -right-1 hidden h-4 min-w-4 items-center justify-center rounded-badge bg-ink px-1 text-caption font-bold text-ink-foreground tabular-nums ring-2 ring-sidebar group-data-[collapsible=icon]:flex"
      >
        {count > 99 ? '99+' : count}
      </span>
    </>
  )
}

/** Favourite items, one click away, like Notion's and Linear's favourites. Hidden until there is one. */
function Favorites() {
  const { data: favorites } = useQuery(favoritesQuery())
  const { rows } = useLibrary()
  const { pathname } = useLocation()
  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows])
  const items = (favorites ?? []).flatMap((id) => byId.get(id) ?? [])
  if (items.length === 0) return null
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Favourites</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((row) => {
          const active = pathname === `/library/${row.id}`
          return (
            <SidebarMenuItem key={row.id}>
              <SidebarMenuButton
                isActive={active}
                render={
                  <Link
                    to="/library/$itemId"
                    params={{ itemId: row.id }}
                    aria-current={active ? 'page' : undefined}
                  />
                }
              >
                <KindIcon kind={row.kind} active={isLiveIssueRow(row)} />
                <span>{row.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}

/**
 * The top row: the Heed lockup as the link home, and the collapse button (docs/design/logo.md). The
 * symbol sits in the 32 pixel slot of the nav icons' column, which leaves the lockup's 7 pixel gap,
 * so the wordmark starts on the labels' edge. In the rail the symbol alone stays in the same place
 * and expands the sidebar.
 */
function SidebarTop() {
  const { state, toggleSidebar, isMobile } = useSidebar()
  const collapsed = state === 'collapsed' && !isMobile
  const shortcut = formatHotkey('mod+b').join('')
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label="Expand the sidebar"
              className="flex size-control-md shrink-0 items-center justify-center rounded-md text-sidebar-foreground -outline-offset-2 hover:bg-sidebar-accent"
            />
          }
        >
          <LogoSymbol />
        </TooltipTrigger>
        <TooltipContent side="right">Expand the sidebar ({shortcut})</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <div className="flex w-full items-center gap-2">
      <Link
        to="/"
        aria-label={productName}
        data-slot="logo"
        className="flex h-control-md items-center rounded-md pr-2 text-sidebar-foreground -outline-offset-2 max-md:min-h-control-touch"
      >
        <span className="flex size-control-md shrink-0 items-center justify-center">
          <LogoSymbol />
        </span>
        <LogoWordmark />
      </Link>
      {isMobile ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
                aria-label="Collapse the sidebar"
                className="ml-auto text-muted-foreground"
              />
            }
          >
            <PanelLeftIcon />
          </TooltipTrigger>
          <TooltipContent side="right">Collapse the sidebar ({shortcut})</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

/**
 * The app sidebar (contract 8.11): the places you go to. The main places with the library's views
 * under it, then favourites, and Editions, Health and Administration as the last group behind a quiet
 * divider, then Docs behind one more, each with only what the person may use, and the user menu
 * at the bottom, which holds the person's own Settings. The Assistant opens the assistant full
 * screen; the launcher docks it instead. Expanded (256) from 1280 wide, a 48 rail below that, a
 * sheet on phones. The docs fold it to its rail and show their own tree beside it (docs mode).
 */
export function AppSidebar({ peek = false }: { peek?: boolean }) {
  const { pathname, search } = useLocation()
  const { rows, viewer } = useLibrary()
  // Counted for the people who can act on it, in their own domains (A8).
  const attentionCount = useMemo(() => needsALookCount(rows, viewer), [rows, viewer])
  const drafts = useMyDrafts()?.length ?? 0
  // Each entry is for an audience (Quality design, section 0): a group with nothing the person
  // may use is not shown.
  const { ready, permissions } = usePermissions()
  const isActive = (item: NavItem) =>
    item.to === '/' ? pathname === '/' : pathname === item.to || pathname.startsWith(`${item.to}/`)
  // A view under a place is picked out instead of the place, as Linear does. Docs stays picked
  // out on every page of the docs: their own sidebar shows the page (docs mode, contract 8.11).
  // The library's Deleted items has no row of its own, so the library is picked out there.
  const picksOutPlace = (item: NavItem) =>
    isActive(item) &&
    (item.id !== 'library' || pathname !== '/library') &&
    (item.id !== 'proposals' || !(drafts && onDraftsList(pathname, search)))

  return (
    <Sidebar collapsible="icon" peek={peek} role="navigation" aria-label="Main navigation">
      <SidebarHeader className="h-header flex-row items-center border-b px-2 py-0">
        <SidebarTop />
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => {
          const label = navGroupLabels[group]
          const items = navItemsFor(group, ready ? permissions : undefined)
          if (items.length === 0) return null
          return (
            <Fragment key={group}>
              {group !== 'main' ? <SidebarSeparator /> : null}
              <SidebarGroup>
                {label ? <SidebarGroupLabel>{label}</SidebarGroupLabel> : null}
                <SidebarMenu>
                  {items.map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <NavLink item={item} active={picksOutPlace(item)} />
                      {item.id === 'library' ? (
                        <LibraryViews attentionCount={attentionCount} drafts={drafts} />
                      ) : null}
                      {item.id === 'proposals' ? <ReviewCount /> : null}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroup>
              {group === 'main' ? <Favorites /> : null}
            </Fragment>
          )
        })}
      </SidebarContent>
      <SidebarFooter>
        <UserMenu />
      </SidebarFooter>
    </Sidebar>
  )
}
