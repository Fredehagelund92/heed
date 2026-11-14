import type { ReactNode } from 'react'
import {
  CheckIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  CloudOffIcon,
  EllipsisIcon,
  Loader2Icon,
  SearchIcon,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ThemeChoices } from '@/components/site-header'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { open } from '@/lib/events'
import type { SaveState } from '@/lib/autosave'

// An editor's header keeps to what matters: the way back, the title, whether the draft is saved,
// one Write / Try it toggle and the one primary action. Everything else sits in one More menu.

const words: Record<SaveState, string> = {
  clean: 'Saved',
  dirty: 'Not saved yet',
  saving: 'Saving',
  saved: 'Saved',
  failed: 'Not saved',
  offline: 'Offline, not saved yet',
}
const icons = {
  clean: CheckIcon,
  dirty: CircleDashedIcon,
  saving: Loader2Icon,
  saved: CheckIcon,
  failed: CircleAlertIcon,
  offline: CloudOffIcon,
} satisfies Record<SaveState, unknown>

/**
 * Whether what is written is saved, said only when it is true: Saved when the page holds nothing
 * that is not stored (`saved` just now, `clean` as it opened), Not saved yet while words wait,
 * Saving while a save is on its way, and Not saved when the last try failed, with Try again when
 * the page can try. Offline, nothing is kept anywhere, and it says so.
 */
export function SaveStatus({ status, retry }: { status: SaveState; retry?: () => void }) {
  const Icon = icons[status]
  const failed = status === 'failed'
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums',
        failed && 'text-destructive',
      )}
      aria-live="polite"
    >
      <Icon
        // Just saved: the check grows in once, so the change is seen; it is simply there on first show.
        key={status}
        className={cn(
          'size-3.5',
          status === 'saving' && 'animate-spin',
          status === 'saved' && 'animate-in duration-(--dur-2) fade-in-0 zoom-in-60',
        )}
        aria-hidden
      />
      <span className="max-sm:sr-only">{words[status]}</span>
      {failed && retry && (
        <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={retry}>
          Try again
        </Button>
      )}
    </span>
  )
}

/** One More menu: the page's own items, then search on a phone and the theme. */
export function HeaderMore({ children }: { children?: ReactNode }) {
  const mobile = useIsMobile()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" aria-label="More" />}>
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {children && (
          <>
            <DropdownMenuGroup>{children}</DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        {mobile && (
          <>
            <DropdownMenuItem onClick={() => open('palette')}>
              <SearchIcon />
              Search
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <ThemeChoices />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
