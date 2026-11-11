import { ChevronsUpDownIcon } from '@/components/icons'
import { PersonAvatar } from '@/components/heed/bits'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useApiWrite, useDemoProfiles } from '@/api/queries'
import { navigate } from '@/lib/router'
import { useMe } from '@/lib/workspace'

/**
 * The demo's "View as" switch, in the corner of every page header: the admin, a domain owner and
 * a plain reader, each with a line saying what they can do, so a visitor sees the same company as
 * each of them without signing out. Only the demo shows it (nothing for company sign-in, or an
 * install with its own data).
 */
export function ViewAs() {
  const profiles = useDemoProfiles()
  const me = useMe()
  const signIn = useApiWrite('signIn')
  if (!profiles.length) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label={`View as: ${me.name}`}
            className="max-sm:size-8 max-sm:px-0"
          />
        }
      >
        <PersonAvatar name={me.name} size={16} />
        <span className="max-sm:hidden">View as</span>
        <span className="max-w-32 truncate font-normal text-muted-foreground max-md:hidden">
          {me.name}
        </span>
        <ChevronsUpDownIcon className="max-sm:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel>View the demo as</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={me.name}
            onValueChange={(value: string) => {
              const name = value
              if (name === me.name) return
              // The page may be one the next person can't open, so they start in their Inbox.
              void signIn.mutateAsync({ name }).then(() => navigate('/inbox'))
            }}
          >
            {profiles.map((p) => (
              <DropdownMenuRadioItem
                key={p.name}
                value={p.name}
                closeOnClick
                className="items-start gap-2 py-2"
              >
                <PersonAvatar name={p.name} size={28} />
                <span className="grid min-w-0 gap-0.5">
                  <span className="truncate font-medium">
                    {p.name}
                    <span className="font-normal text-muted-foreground"> · {p.part}</span>
                  </span>
                  <span className="text-xs text-pretty text-muted-foreground">{p.line}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
