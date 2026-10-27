import { useEffect } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { describeApiError, isSignedOut } from '@/api'
import { currentUserQuery, signInPeopleQuery, useSignOut } from '@/api/queries'
import {
  ArrowRightLeftIcon,
  BookOpenIcon,
  KeyboardIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  PlugIcon,
  SunIcon,
  UserRoundCogIcon,
} from '@/components/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu'
import { useSidebar } from '@/components/ui/sidebar'
import { appearances, setAppearance, useAppearance, type Appearance } from '@/lib/appearance'
import { formatHotkey } from '@/lib/commands'
import { showToast } from '@/lib/toast'
import { usePermissions } from '@/lib/use-session'
import { useShellActions } from './shell-actions'
import type { UserMenuHandle } from './user-menu'

const appearanceLabels: Record<Appearance, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
}
const appearanceIcons = { light: SunIcon, dark: MoonIcon, system: MonitorIcon }

/**
 * The user menu itself (contract 8.11), a chunk of its own that the shell fetches after the first
 * load: the sidebar's button is its detached trigger (user-menu.tsx). A press on the button
 * before this chunk arrived opens the menu as soon as it mounts.
 */
export function UserMenuPopup({
  handle,
  triggerId,
  openAtOnce,
  onMount,
}: {
  handle: UserMenuHandle
  triggerId: string
  /** The button was pressed before this chunk arrived. Read once, when the menu mounts. */
  openAtOnce: boolean
  /** Called once the menu is attached to the handle, which then opens it from the button. */
  onMount: () => void
}) {
  useEffect(onMount, [onMount])
  const { isMobile } = useSidebar()
  const { data: user } = useQuery(currentUserQuery())
  const { roleLines } = usePermissions()
  const appearance = useAppearance()
  const { openShortcuts } = useShellActions()
  const navigate = useNavigate()
  const href = useRouterState({ select: (state) => state.location.href })
  const signOut = useSignOut(() => navigate({ to: '/signed-out', search: { from: href } }))
  // Only where the local sign-in offers demo people: never in production (dev-sign-in.ts).
  const demoPeople = useQuery(signInPeopleQuery()).data?.length ?? 0
  return (
    <DropdownMenu handle={handle} defaultOpen={openAtOnce} defaultTriggerId={triggerId}>
      <DropdownMenuContent
        className="w-auto max-w-popover"
        side={isMobile ? 'top' : 'right'}
        align="end"
        sideOffset={8}
      >
        {user ? (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex flex-col gap-1 text-dense font-normal">
                <span className="font-bold text-foreground">{user.name}</span>
                {roleLines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Appearance</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={appearance}
            onValueChange={(value) => setAppearance(value as Appearance)}
          >
            {appearances.map((mode) => {
              const Glyph = appearanceIcons[mode]
              return (
                <DropdownMenuRadioItem key={mode} value={mode}>
                  <Glyph />
                  {appearanceLabels[mode]}
                </DropdownMenuRadioItem>
              )
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {/* The person's own Settings, two sections, each one click from here. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Settings</DropdownMenuLabel>
          <DropdownMenuItem render={<Link to="/settings" search={{ section: 'profile' }} />}>
            <UserRoundCogIcon />
            Profile and appearance
            <DropdownMenuShortcut>{formatHotkey('g>s').join(' ')}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link to="/settings" search={{ section: 'connect' }} />}>
            <PlugIcon />
            Connect an agent
            <DropdownMenuShortcut>{formatHotkey('g>y').join(' ')}</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {/* Heed's help pages, also in the sidebar (docs/old-help). */}
        <DropdownMenuGroup>
          <DropdownMenuItem render={<Link to="/docs" />}>
            <BookOpenIcon />
            Docs and help
            <DropdownMenuShortcut>{formatHotkey('g>b').join(' ')}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={openShortcuts}>
            <KeyboardIcon />
            Keyboard shortcuts
            <DropdownMenuShortcut>{formatHotkey('shift+slash').join('')}</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {demoPeople > 1 ? (
          <DropdownMenuItem render={<Link to="/signed-out" search={{ from: href }} />}>
            <ArrowRightLeftIcon />
            Switch demo person
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          disabled={signOut.isPending}
          onClick={() =>
            signOut.mutate(undefined, {
              onError: (error) => {
                if (isSignedOut(error)) return
                const { title, description } = describeApiError(error)
                showToast(title, description)
              },
            })
          }
        >
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
