import { useCallback, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { itemQuery } from '@/api/queries'
import { useCheckScope } from '@/components/app-shell/command-scope'
import { useShellActions } from '@/components/app-shell/shell-actions'
import {
  ArchiveIcon,
  CalendarIcon,
  CheckIcon,
  CopyIcon,
  EllipsisIcon,
  LinkIcon,
  PencilIcon,
  SendIcon,
  Trash2Icon,
} from '@/components/icons'
import {
  ProposeRetirementDialog,
  RecheckItemDialog,
  RetireItemDialog,
} from '@/components/item/item-release-dialogs'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoveToBinDialog } from '@/components/library/bin-dialogs'
import { Kbd } from '@/components/ui/kbd'
import { formatHotkey } from '@/lib/commands'
import { usePermissions } from '@/lib/use-session'

/*
  What a person can do with an item (FR-111, FR-112, FR-218, CON-211): the slot the item page
  mounts beside the title. Suggest a change opens the change form; the owner's check, Retire
  and Propose retirement open their confirmation dialogs (release and editions slice). The item
  itself is read from the cache the page already filled.
*/

/**
 * The item's one action group, beside the title: the owner's check while something asks for a
 * look (the one solid button), Suggest a change for everyone (FR-111), and a More menu with, by
 * permission, Retire (an owner, deputy or administrator) or Propose retirement (everyone else),
 * and for an administrator Move to Bin, which takes the item out of the library and leaves the
 * page or the panel for the list. On the page, Copy link is a button of its own; in a panel, the
 * menu has the copy actions.
 */
export function ItemActions({
  itemId,
  canRetire,
  retired,
  check,
  onChecked,
  page = false,
}: {
  page?: boolean
  itemId: string
  canRetire: boolean
  retired: boolean
  /** The owner's check, only while something asks for a look. */
  check: { stillGoingOn: boolean; highRisk: boolean } | null
  /** Runs once the check is recorded: the next item, so an upkeep run goes on with one key. */
  onChecked?: () => void
}) {
  const { copyLinks } = useShellActions()
  const { data: item } = useQuery(itemQuery(itemId))
  const [dialog, setDialog] = useState<'retire' | 'propose' | 'check' | 'bin' | null>(null)
  const { isAdmin } = usePermissions()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // Moved to the Bin, the item is gone: the page goes back to the list, a panel closes.
  const leave = () =>
    pathname === '/library'
      ? void navigate({
          from: '/library/',
          to: '/library',
          search: (previous) => ({ ...previous, panel: undefined, tab: undefined }),
          replace: true,
          resetScroll: false,
        })
      : void navigate({ to: '/library' })
  const copyId = () => {
    void navigator.clipboard?.writeText(itemId).catch(() => undefined)
  }
  const openCheck = useCallback(() => setDialog('check'), [])
  const close = (open: boolean) => {
    if (!open) setDialog(null)
  }
  return (
    <div data-slot="item-actions" className="flex flex-wrap items-center gap-2 @5xl:shrink-0">
      {check ? (
        <CheckActions
          itemId={itemId}
          stillGoingOn={check.stillGoingOn}
          quiet={page}
          onCheck={openCheck}
        />
      ) : null}
      {retired ? null : (
        <Button
          variant={page ? (check ? 'ghost' : 'default') : 'outline'}
          render={<Link to="/library/$itemId/suggest" params={{ itemId }} />}
        >
          <PencilIcon />
          Suggest a change
        </Button>
      )}
      {page ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Copy link"
          onClick={() => copyLinks([itemId])}
        >
          <LinkIcon />
        </Button>
      ) : null}
      {/* On the page, Copy link is the button beside it: the menu does not repeat it. */}
      {page && retired && !isAdmin ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant={page ? 'ghost' : 'outline'} size="icon" aria-label="More actions" />
            }
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-popover">
            {page ? null : (
              <>
                <DropdownMenuItem onClick={() => copyLinks([itemId])}>
                  <LinkIcon />
                  Copy link
                </DropdownMenuItem>
                <DropdownMenuItem onClick={copyId}>
                  <CopyIcon />
                  Copy fact ID
                </DropdownMenuItem>
              </>
            )}
            {retired ? null : (
              <>
                {page ? null : <DropdownMenuSeparator />}
                <DropdownMenuItem
                  disabled={!item}
                  onClick={() => setDialog(canRetire ? 'retire' : 'propose')}
                >
                  {canRetire ? <ArchiveIcon /> : <SendIcon />}
                  {canRetire ? 'Archive fact' : 'Suggest archiving'}
                </DropdownMenuItem>
              </>
            )}
            {isAdmin ? (
              <>
                {page && retired ? null : <DropdownMenuSeparator />}
                <DropdownMenuItem
                  variant="destructive"
                  disabled={!item}
                  onClick={() => setDialog('bin')}
                >
                  <Trash2Icon />
                  Move to Bin
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {item ? (
        <>
          {/* One set per item: moving on starts each dialog afresh, with the last reason. */}
          <RetireItemDialog
            key={`retire-${item.id}`}
            item={item}
            open={dialog === 'retire'}
            onOpenChange={close}
          />
          <ProposeRetirementDialog
            key={`propose-${item.id}`}
            item={item}
            open={dialog === 'propose'}
            onOpenChange={close}
          />
          <RecheckItemDialog
            key={`check-${item.id}`}
            item={item}
            stillGoingOn={check?.stillGoingOn ?? false}
            open={dialog === 'check'}
            onOpenChange={close}
            onChecked={onChecked}
          />
          {isAdmin ? (
            <MoveToBinDialog
              key={`bin-${item.id}`}
              subjects={[item]}
              open={dialog === 'bin'}
              onOpenChange={close}
              onMoved={leave}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}

/** The check's key (contract 9.2): it opens the check's dialog, never records it alone. */
const CHECK_KEY = 'y'

/**
 * The owner's check: record it, or answer "Is this still going on?". Solid, the page's main
 * action, and a full row on a phone, where the group does not fit one row. While it is shown,
 * Y opens it, so an upkeep run is Y, the reason (kept from the last check) and Command Enter.
 */
function CheckActions({
  itemId,
  stillGoingOn,
  onCheck,
  quiet,
}: {
  itemId: string
  stillGoingOn: boolean
  onCheck: () => void
  quiet: boolean
}) {
  const title = stillGoingOn ? 'Yes, still going on' : 'Mark as checked'
  const scope = useMemo(() => ({ title, open: onCheck }), [title, onCheck])
  useCheckScope(scope)
  const key = (
    <Kbd aria-hidden="true" className="hidden @md:inline-flex">
      {formatHotkey(CHECK_KEY).join('')}
    </Kbd>
  )
  const button = (
    <Button className="@max-md:w-full" onClick={onCheck} aria-keyshortcuts="Y">
      <CheckIcon />
      {title}
      {key}
    </Button>
  )
  if (stillGoingOn)
    return (
      <>
        {button}
        <Button
          variant={quiet ? 'ghost' : 'outline'}
          render={<Link to="/library/$itemId/suggest" params={{ itemId }} />}
        >
          <CalendarIcon />
          It ended: set the end date
        </Button>
      </>
    )
  return button
}
