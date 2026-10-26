import { ChevronsUpDownIcon, LogOutIcon, PlugIcon } from '@/components/icons'
import { PersonAvatar } from '@/components/heed/bits'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { open } from '@/lib/events'
import { navigate } from '@/lib/router'
import { useMe, useStore } from '@/lib/store'

// The sidebar block's user menu: Connect an agent and Sign out. Help sits in the sidebar's foot, the theme in the header.
export function NavUser() {
  const { isMobile, setOpenMobile } = useSidebar()
  const me = useMe()
  const { dispatch } = useStore()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" className="aria-expanded:bg-muted" />}
          >
            <PersonAvatar name={me.name} size={32} />
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{me.name}</span>
              <span className="truncate text-xs text-muted-foreground">{me.role}</span>
            </div>
            <ChevronsUpDownIcon className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-60"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <PersonAvatar name={me.name} size={32} />
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium text-foreground">{me.name}</span>
                    <span className="truncate text-xs">{me.role}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => {
                  setOpenMobile(false)
                  open('connect')
                }}
              >
                <PlugIcon />
                Connect an agent
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                dispatch({ type: 'signOut' })
                navigate('/signin')
              }}
            >
              <LogOutIcon />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
