import { lazy, Suspense, useCallback, useId, useState } from 'react'
import { Menu } from '@base-ui/react/menu'
import { useQuery } from '@tanstack/react-query'
import { currentUserQuery } from '@/api/queries'
import { PersonAvatar } from '@/components/person-avatar'
import { ChevronsUpDownIcon } from '@/components/icons'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { usePermissions } from '@/lib/use-session'

// The menu and its items are a chunk of their own, fetched after the first load: Base UI's menu
// brings its popup, positioning, focus and scroll lock code, which no page needs before it opens.
// The button here is the menu's detached trigger, so it is the same element before and after.
const UserMenuPopup = lazy(() =>
  import('./user-menu-popup').then((module) => ({ default: module.UserMenuPopup })),
)

export type UserMenuHandle = Menu.Handle<unknown>

/**
 * The user menu at the bottom of the sidebar (contract 8.11): who you are, Appearance, the
 * person's own Settings (Profile and appearance, Connect your AI), Keyboard shortcuts and Sign
 * out. The shortcut sheet and a person's settings live in the same place on every page.
 * The role under the name comes from the session, so an owner reads "Owner of Commercial".
 */
export function UserMenu() {
  const [handle] = useState(() => Menu.createHandle())
  const triggerId = useId()
  const [ready, setReady] = useState(false)
  const [pressedEarly, setPressedEarly] = useState(false)
  const markReady = useCallback(() => setReady(true), [])
  const { data: user } = useQuery(currentUserQuery())
  // The rail's 32 pixel button holds the 28 pixel row avatar; the open sidebar's card, the 36.
  const { state, isMobile } = useSidebar()
  const rail = state === 'collapsed' && !isMobile
  const { roleLines } = usePermissions()
  const roles = roleLines.join(', ')
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {/* The data-slot of components/ui/dropdown-menu's trigger, which this one stands in for. */}
        <Menu.Trigger
          handle={handle}
          id={triggerId}
          data-slot="dropdown-menu-trigger"
          // Until the menu has mounted, the handle ignores the press; the menu opens on arrival.
          onClick={() => {
            if (!ready) setPressedEarly(true)
          }}
          render={<SidebarMenuButton size="lg" className="pr-1 aria-expanded:bg-sidebar-accent" />}
        >
          {user ? (
            <PersonAvatar
              person={user}
              size={rail ? 'sm' : 'md'}
              // The rail button's 24 pixel content box is 4 short of the avatar: 2 out on each side.
              className={rail ? '-left-0.5' : undefined}
            />
          ) : (
            <Skeleton
              className={rail ? 'size-avatar-row rounded-full' : 'size-avatar-card rounded-full'}
            />
          )}
          <div className="grid flex-1 text-left">
            <span className="truncate font-bold">{user?.name ?? 'Signed in'}</span>
            {roles ? (
              <span
                data-testid="user-role"
                title={roles}
                className="truncate text-caption text-muted-foreground"
              >
                {roles}
              </span>
            ) : (
              <Skeleton className="h-4 w-full" />
            )}
          </div>
          <ChevronsUpDownIcon className="ml-auto text-muted-foreground" />
        </Menu.Trigger>
        <Suspense fallback={null}>
          <UserMenuPopup
            handle={handle}
            triggerId={triggerId}
            openAtOnce={pressedEarly}
            onMount={markReady}
          />
        </Suspense>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
