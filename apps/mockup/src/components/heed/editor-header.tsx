import * as React from "react"
import type { ReactNode } from "react"
import { CheckIcon, CloudOffIcon, EllipsisIcon, Loader2Icon, SearchIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ThemeChoices } from "@/components/site-header"
import { cn } from "cn"
import { useIsMobile } from "@/hooks/use-mobile"
import { open } from "@/lib/events"

// An editor's header keeps to what matters: the way back, the title, whether the draft is saved,
// one Write / Try it toggle and the one primary action. Everything else sits in one More menu.

/** Whether the draft is saved: an icon, with the word from sm up (always read out). Offline, it is kept on this device. */
export function SaveStatus({ saving, offline }: { saving: boolean; offline?: boolean }) {
  const Icon = offline ? CloudOffIcon : saving ? Loader2Icon : CheckIcon
  // Just saved: the check grows in once, so the change is seen; it is simply there on first show.
  const [was, setWas] = React.useState(saving)
  const [justSaved, setJustSaved] = React.useState(false)
  if (was !== saving) {
    setWas(saving)
    setJustSaved(!saving)
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums" aria-live="polite">
      <Icon
        key={saving ? "saving" : "saved"}
        className={cn("size-3.5", saving && !offline && "animate-spin", justSaved && !offline && "animate-in duration-(--dur-2) fade-in-0 zoom-in-60")}
        aria-hidden
      />
      <span className="max-sm:sr-only">{offline ? "Saved on this device" : saving ? "Saving" : "Saved"}</span>
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
            <DropdownMenuItem onClick={() => open("palette")}>
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
