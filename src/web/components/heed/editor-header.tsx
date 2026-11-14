import * as React from 'react'
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

// An editor's header keeps to what matters: the way back, the title, whether the draft is saved,
// one Write / Try it toggle and the one primary action. Everything else sits in one More menu.

/**
 * Whether what is written is saved, said only when it is true: Saving while a save is on its way,
 * Not saved yet while words wait for Save, Not saved when the last try failed, and Saved when the
 * page holds nothing that is not saved. Offline, nothing is kept anywhere, and it says so.
 */
export function SaveStatus({
  saving,
  offline,
  unsaved,
  failed,
}: {
  saving: boolean
  offline?: boolean
  unsaved?: boolean
  failed?: boolean
}) {
  const waiting = !saving && !!unsaved
  const Icon = failed
    ? CircleAlertIcon
    : offline && unsaved
      ? CloudOffIcon
      : saving
        ? Loader2Icon
        : waiting
          ? CircleDashedIcon
          : CheckIcon
  // Just saved: the check grows in once, so the change is seen; it is simply there on first show.
  const [was, setWas] = React.useState(saving)
  const [justSaved, setJustSaved] = React.useState(false)
  if (was !== saving) {
    setWas(saving)
    setJustSaved(!saving)
  }
  const words = failed
    ? 'Not saved'
    : offline && unsaved
      ? 'Offline, not saved yet'
      : saving
        ? 'Saving'
        : waiting
          ? 'Not saved yet'
          : 'Saved'
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums',
        failed && 'text-destructive',
      )}
      aria-live="polite"
    >
      <Icon
        key={saving ? 'saving' : 'saved'}
        className={cn(
          'size-3.5',
          saving && 'animate-spin',
          justSaved && !unsaved && 'animate-in duration-(--dur-2) fade-in-0 zoom-in-60',
        )}
        aria-hidden
      />
      <span className="max-sm:sr-only">{words}</span>
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
