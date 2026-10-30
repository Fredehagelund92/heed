import {
  ArrowUpRightIcon,
  BookOpenIcon,
  BugIcon,
  CircleHelpIcon,
  KeyboardIcon,
  LifeBuoyIcon,
  ListChecksIcon,
  SparklesIcon,
  TextQuoteIcon,
} from '@/components/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Kbd } from '@/components/ui/kbd'
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'
import { CHANGELOG_SLUG, DOCS_HOME, docHref } from '@/lib/doc-links'
import { supportMail } from '@/lib/help-content'
import { open } from '@/lib/events'
import { navigate, useRoute } from '@/lib/router'
import { useSession, useWorkspace } from '@/api/queries'
import { setupSteps } from '@/lib/setup'

const note = 'ml-auto text-xs text-muted-foreground'

/**
 * Help as a small menu, not a page: a few links, set apart. It opens beside the sidebar's foot, from the row
 * that opened it, and every row is one step from what it names.
 */
export function HelpMenu({ place }: { place: string }) {
  const { isMobile, setOpenMobile } = useSidebar()
  const { install } = useSession()
  const { setup } = useWorkspace()
  const { query } = useRoute()
  const done = Number(query.get('done') ?? setupSteps.filter((s) => setup.done[s.id]).length)
  const start = install === 'new' && done < setupSteps.length
  const close = () => setOpenMobile(false)
  return (
    <SidebarMenuItem>
      <DropdownMenu defaultOpen={query.get('menu') === 'help'}>
        <DropdownMenuTrigger
          render={<SidebarMenuButton tooltip="Help" isActive={place === 'help'} />}
        >
          <CircleHelpIcon />
          <span>Help</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-72"
          side={isMobile ? 'top' : 'right'}
          align="end"
          sideOffset={8}
        >
          {start && (
            <>
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() => {
                    close()
                    navigate('/inbox')
                  }}
                >
                  <ListChecksIcon />
                  Get started
                  <span className={note}>
                    {done} of {setupSteps.length}
                  </span>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={() => {
                close()
                navigate('/help')
              }}
            >
              <TextQuoteIcon />
              Answer lines and words
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                close()
                open('shortcuts')
              }}
            >
              <KeyboardIcon />
              Keyboard shortcuts
              <Kbd className="ml-auto">?</Kbd>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem render={<a href={DOCS_HOME} target="_blank" rel="noreferrer" />}>
              <BookOpenIcon />
              Documentation
              <ArrowUpRightIcon className="ml-auto text-muted-foreground" />
            </DropdownMenuItem>
            <DropdownMenuItem
              render={<a href={docHref(CHANGELOG_SLUG)} target="_blank" rel="noreferrer" />}
            >
              <SparklesIcon />
              What's new
              <ArrowUpRightIcon className="ml-auto text-muted-foreground" />
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem render={<a href={supportMail()} />}>
              <LifeBuoyIcon />
              Contact support
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                close()
                open('report')
              }}
            >
              <BugIcon />
              Report a problem
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}
