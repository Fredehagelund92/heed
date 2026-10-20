import { useRouterState } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { useSidebar } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MenuIcon, PlusIcon, SearchIcon } from '@/components/icons'
import { formatHotkey } from '@/lib/commands'
import { AppBreadcrumbs } from './app-breadcrumbs'
import { NotificationBell } from './notification-bell'
import { useShellActions } from './shell-actions'

/**
 * The shell header (contract 8.11): 48 high (56 on a phone), one row, a bottom hairline, ghost
 * controls of 28 beside the one filled button. Left: the breadcrumb,
 * with the menu button first on phones. Right: the page's own actions, Search, the notifications
 * bell, and Add a fact, the same filled (ink) button on every page, hidden on the new fact form.
 * The assistant is not here: it opens from the launcher in the bottom-right corner.
 * The bell stays in the header on phones too, as the front end plan's frames draw it, so an
 * unread notification shows without opening the menu.
 */
export function AppHeader({
  onOpenPalette,
  actionsRef,
}: {
  onOpenPalette: () => void
  actionsRef: (element: HTMLDivElement | null) => void
}) {
  const { isMobile, toggleSidebar } = useSidebar()
  const { addContext } = useShellActions()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const hideAdd = pathname === '/library/new' || /^\/library\/[^/]+\/suggest$/.test(pathname)
  return (
    <header
      data-layout="header"
      className="sticky top-0 z-sticky flex h-header shrink-0 items-center gap-2 border-b bg-background px-gutter"
    >
      {isMobile ? (
        <Button
          variant="ghost"
          size="icon-touch"
          onClick={toggleSidebar}
          aria-label="Open navigation"
          data-edge="start"
        >
          <MenuIcon />
        </Button>
      ) : null}
      <AppBreadcrumbs />
      <div className="ml-auto flex shrink-0 items-center gap-2" data-edge="end">
        <div ref={actionsRef} className="flex items-center gap-2 empty:hidden" />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="toolbar"
                onClick={onOpenPalette}
                aria-label="Search"
                className="max-xl:size-control-sm max-xl:px-0 max-md:size-control-touch max-md:px-0"
              />
            }
          >
            <SearchIcon />
            <span className="hidden xl:inline">Search</span>
            <Kbd className="hidden font-mono tabular-nums xl:inline-flex">
              {formatHotkey('mod+k').join('')}
            </Kbd>
          </TooltipTrigger>
          <TooltipContent className="xl:hidden">
            Search ({formatHotkey('mod+k').join('')})
          </TooltipContent>
        </Tooltip>
        <NotificationBell />
        {hideAdd ? null : (
          <Button
            size="toolbar"
            onClick={addContext}
            aria-label={isMobile ? 'Add a fact' : undefined}
            className="max-md:size-control-touch max-md:px-0"
          >
            <PlusIcon />
            <span className="max-md:sr-only">Add a fact</span>
          </Button>
        )}
      </div>
    </header>
  )
}
