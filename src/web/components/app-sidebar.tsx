import * as React from 'react'
import { Changed } from '@/components/heed/changed'
import { cn } from '@/lib/utils'
import {
  ActivityIcon,
  BookAIcon,
  InboxIcon,
  MessageSquareIcon,
  NotebookTextIcon,
  SearchIcon,
  SettingsIcon,
} from '@/components/icons'
import { Logo, LogoSymbol } from '@/components/heed/logo'
import { NavUser } from '@/components/nav-user'
import { SettingsNav } from '@/components/settings-nav'
import { ObservabilityNav } from '@/components/obs/obs-nav'
import { seesObservability } from '@/lib/obs'
import { Kbd } from '@/components/ui/kbd'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { open } from '@/lib/events'
import { useRoute } from '@/lib/router'
import { useInboxRows } from '@/lib/inbox-rows'
import { useSession } from '@/api/queries'
import { useMe } from '@/lib/workspace'
import { PRODUCT } from '@/lib/brand'
import { HelpMenu } from '@/components/help-menu'

// The sidebar-07 block (collapsible to icons), with Heed's three places, Settings for admins,
// and the user menu in the footer. Dressed as Efferd's app shell: the page background with a
// hairline, a 48px header row that lines up with the page header, quieter item labels, and a faint
// light at the top in dark mode.
/**
 * shadcn's sidebar rail, made draggable: drag it to set the sidebar's width (it follows the pointer
 * 1:1), or click it to collapse and expand as before. Dragging a collapsed rail outward opens it.
 */
function ResizeRail({ onWidth }: { onWidth: (width: number, done: boolean) => void }) {
  const { state, setOpen, toggleSidebar } = useSidebar()
  const drag = React.useRef<{ x: number; width: number; moved: boolean } | null>(null)
  const end = () => delete document.documentElement.dataset.resizing
  return (
    <SidebarRail
      aria-label={state === 'expanded' ? 'Resize or collapse the sidebar' : 'Expand the sidebar'}
      title={state === 'expanded' ? 'Drag to resize, click to collapse' : 'Click or drag to expand'}
      className="touch-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        const width =
          document.querySelector('[data-slot="sidebar-container"]')?.getBoundingClientRect()
            .width ?? 256
        drag.current = { x: e.clientX, width, moved: false }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.x
        if (!d.moved && Math.abs(dx) < 4) return
        d.moved = true
        if (state === 'collapsed') {
          if (dx > 48) setOpen(true)
          return
        }
        document.documentElement.dataset.resizing = '1'
        onWidth(d.width + dx, false)
      }}
      onPointerUp={(e) => {
        const d = drag.current
        if (d?.moved && state === 'expanded') onWidth(d.width + (e.clientX - d.x), true)
        end()
      }}
      onPointerCancel={() => {
        drag.current = null
        end()
      }}
      onClick={() => {
        // A drag ends in a click too; only a click without movement collapses or expands.
        if (!drag.current?.moved) toggleSidebar()
        drag.current = null
      }}
    />
  )
}

export function AppSidebar({
  onWidth,
  ...props
}: React.ComponentProps<typeof Sidebar> & { onWidth: (width: number, done: boolean) => void }) {
  const route = useRoute()
  const me = useMe()
  const { install } = useSession()
  const { isMobile, setOpenMobile } = useSidebar()
  const place = route.parts[0] ?? 'inbox'
  const { needing } = useInboxRows()
  const count = install === 'new' ? 0 : needing.length
  const close = () => isMobile && setOpenMobile(false)

  const items = [
    { id: 'inbox', title: 'Inbox', icon: InboxIcon, badge: count || undefined },
    { id: 'ask', title: 'Ask', icon: MessageSquareIcon },
    { id: 'context', title: 'Context', icon: NotebookTextIcon },
    { id: 'definitions', title: 'Definitions', icon: BookAIcon },
  ]

  return (
    <Sidebar
      collapsible="icon"
      className={cn(
        '*:data-[slot=sidebar-inner]:bg-background',
        '*:data-[slot=sidebar-inner]:dark:bg-(image:--glow-top)',
        '**:data-[slot=sidebar-menu-button]:[&>span]:text-foreground/75',
      )}
      {...props}
    >
      {place === 'settings' ? (
        <SettingsNav section={route.parts[1] ?? 'general'} close={close} />
      ) : place === 'observability' && seesObservability(me) ? (
        <ObservabilityNav section={route.parts[1] ?? 'summary'} close={close} />
      ) : (
        <>
          <SidebarHeader className="h-bar justify-center border-b px-2">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<a href="/inbox" aria-label={PRODUCT} onClick={close} />}
                >
                  <Logo className="h-5! w-auto! group-data-[collapsible=icon]:hidden" aria-hidden />
                  <LogoSymbol className="mx-auto hidden h-5! w-auto! group-data-[collapsible=icon]:block" />
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            {/* Search is a field, not a page: set apart above the list. In the icon rail it is one
                magnifier with a gap under it. Both open the search palette. */}
            <SidebarGroup className="pb-1">
              <button
                type="button"
                onClick={() => {
                  close()
                  open('palette')
                }}
                className="flex h-8 w-full items-center gap-2 rounded-md border border-input bg-background px-2.5 text-sm text-muted-foreground transition-colors outline-none group-data-[collapsible=icon]:hidden hover:border-foreground/40 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <SearchIcon className="size-4 shrink-0" aria-hidden />
                <span className="flex-1 text-left">Search</span>
                <Kbd>⌘K</Kbd>
              </button>
              <SidebarMenu className="hidden group-data-[collapsible=icon]:flex">
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="Search"
                    onClick={() => {
                      close()
                      open('palette')
                    }}
                  >
                    <SearchIcon />
                    <span>Search</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
            <SidebarGroup className="pt-2 group-data-[collapsible=icon]:pt-3">
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        tooltip={item.title}
                        isActive={place === item.id}
                        render={<a href={`/${item.id}`} onClick={close} />}
                      >
                        <item.icon />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                      {item.badge && (
                        <SidebarMenuBadge>
                          <Changed value={item.badge}>{item.badge}</Changed>
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            {/* Quiet links at the foot, as Efferd's sidebar has them: Help first, then Observability and
                Settings for admins and owners. */}
            <SidebarGroup className="mt-auto">
              <SidebarGroupContent>
                <SidebarMenu className="**:data-[slot=sidebar-menu-button]:text-dense **:data-[slot=sidebar-menu-button]:[&>span]:text-muted-foreground">
                  {/* One Help row: its menu holds the Help page, the keys, Documentation and the ways to reach a person. */}
                  <HelpMenu place={place} />
                  {/* What agents asked and got, for the same people as Settings. */}
                  {seesObservability(me) && (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        tooltip="Observability"
                        isActive={place === 'observability'}
                        render={<a href="/observability" onClick={close} />}
                      >
                        <ActivityIcon />
                        <span>Observability</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                  {/* Admins, and owners for their domains and the people in the workspace. */}
                  {(me.admin || me.owns.length > 0) && (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        tooltip="Settings"
                        isActive={place === 'settings'}
                        render={
                          <a href={me.admin ? '/settings' : '/settings/domains'} onClick={close} />
                        }
                      >
                        <SettingsIcon />
                        <span>Settings</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </>
      )}
      <SidebarFooter className="h-bar justify-center border-t py-0">
        <NavUser />
      </SidebarFooter>
      <ResizeRail onWidth={onWidth} />
    </Sidebar>
  )
}
