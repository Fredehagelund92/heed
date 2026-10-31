import * as React from 'react'
import type { ReactNode } from 'react'
import { ArrowLeftIcon, MonitorIcon, MoonIcon, SearchIcon, SunIcon } from '@/components/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTheme, type Theme } from '@/lib/theme-context'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Kbd } from '@/components/ui/kbd'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { open } from '@/lib/events'
import { TruncatedText } from '@/components/heed/truncated'
import { OfflineBanner } from '@/components/heed/load-state'
import { pageTitle } from '@/lib/page-title'

/** The nav's toggle, always in the same spot, saying what it will do and its shortcut. */
function NavToggle() {
  const { state, isMobile } = useSidebar()
  const label = isMobile
    ? 'Open the menu'
    : state === 'expanded'
      ? 'Collapse the sidebar'
      : 'Expand the sidebar'
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarTrigger
            aria-label={label}
            aria-expanded={isMobile ? undefined : state === 'expanded'}
            className="aria-expanded:bg-transparent aria-expanded:hover:bg-muted"
          />
        }
      />
      <TooltipContent>
        {label} <Kbd>⌘B</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}

const themeIcon = { light: SunIcon, dark: MoonIcon, system: MonitorIcon }

/** The three themes as a radio group, for a menu that already exists (an editor's More menu). */
export function ThemeChoices() {
  const { theme, setTheme } = useTheme()
  return (
    <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
      {(['light', 'dark', 'system'] as Theme[]).map((t) => {
        const I = themeIcon[t]
        return (
          <DropdownMenuRadioItem key={t} value={t}>
            <I />
            {t[0]!.toUpperCase() + t.slice(1)}
          </DropdownMenuRadioItem>
        )
      })}
    </DropdownMenuRadioGroup>
  )
}

/**
 * The theme, as a small bordered icon button at the right end of every header: its glyph shows the
 * current choice; a tiny menu offers all three with a check, so nothing is hidden behind a cycle.
 */
function ThemeMenu() {
  const { theme, setTheme } = useTheme()
  const Icon = themeIcon[theme]
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={`Theme: ${theme[0]!.toUpperCase()}${theme.slice(1)}`}
                />
              }
            />
          }
        >
          <Icon />
        </TooltipTrigger>
        <TooltipContent>Light / Dark / System</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          {(['light', 'dark', 'system'] as Theme[]).map((t) => {
            const I = themeIcon[t]
            return (
              <DropdownMenuRadioItem key={t} value={t}>
                <I />
                {t[0]!.toUpperCase() + t.slice(1)}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// The page header, as Efferd's app shell has it: a 48px row that lines up with the sidebar's
// header, the sidebar trigger, a separator, the page as a quiet 14px title with its icon, actions
// as small outline buttons on the right, and a translucent background that content scrolls under.
export function SiteHeader({
  title,
  icon,
  children,
  className,
  back,
  bare,
}: {
  /**
   * The page's name, or a breadcrumb that leads to it. A breadcrumb's current page is the page's
   * `h1`, or the page has its own below, so the heading is the name alone and never the trail's
   * words run together.
   */
  title: ReactNode
  icon?: ReactNode
  children?: ReactNode
  className?: string
  /** A way back, left of the title (an editor goes back to what it edits). */
  back?: { href: string; label: string }
  /** Leaves out search and the theme: the page's own More menu has them, so the title keeps its room. */
  bare?: boolean
}) {
  const { isMobile } = useSidebar()
  // The tab says the page's heading: the header's, or the page's own under it (an item's title).
  const ref = React.useRef<HTMLElement>(null)
  React.useEffect(() => {
    const h1 = ref.current?.querySelector('h1') ?? ref.current?.parentElement?.querySelector('h1')
    const next = pageTitle(h1?.textContent)
    if (document.title !== next) document.title = next
  })
  return (
    <>
      <header
        ref={ref}
        className={cn(
          'relative z-header flex h-bar shrink-0 items-center justify-between gap-2 border-b px-4 md:px-6',
          'bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/50',
          className,
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <NavToggle />
          <Separator
            orientation="vertical"
            className={cn('h-4 data-vertical:self-center', back ? 'max-sm:hidden' : 'mr-2')}
          />
          {back && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={back.label}
                    nativeButton={false}
                    render={<a href={back.href} />}
                  />
                }
              >
                <ArrowLeftIcon />
              </TooltipTrigger>
              <TooltipContent>{back.label}</TooltipContent>
            </Tooltip>
          )}
          {typeof title === 'string' ? (
            <h1 className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground/75 [&>svg]:size-3.5 [&>svg]:shrink-0">
              {icon}
              {/* A long title is cut with an ellipsis and shown in full on hover or focus. */}
              <TruncatedText text={title} className="min-w-0" />
            </h1>
          ) : (
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground/75 [&>svg]:size-3.5 [&>svg]:shrink-0">
              {icon}
              <span className="min-w-0 truncate">{title}</span>
            </div>
          )}
        </div>
        <div data-header-actions className="flex shrink-0 items-center gap-2 sm:gap-3">
          {/* On a phone the sidebar is a sheet, so search lives here, as a magnifier. */}
          {isMobile && !bare && (
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Search"
              onClick={() => open('palette')}
            >
              <SearchIcon />
            </Button>
          )}
          {children}
          {!bare && <ThemeMenu />}
        </div>
      </header>
      {/* Offline, one quiet line right under the header, so the header keeps its line with the sidebar. */}
      <OfflineBanner />
    </>
  )
}

/** A page: the header, then a body that scrolls on its own. */
export function Page({
  title,
  icon,
  actions,
  children,
  className,
  bodyRef,
}: {
  title: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  /** The scrolling body, for a page that measures its own width. */
  bodyRef?: (el: HTMLDivElement | null) => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SiteHeader title={title} icon={icon}>
        {actions}
      </SiteHeader>
      <div
        ref={bodyRef}
        className={cn('@container/main min-h-0 flex-1 overflow-y-auto', className)}
      >
        {children}
      </div>
    </div>
  )
}
