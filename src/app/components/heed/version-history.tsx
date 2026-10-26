import * as React from 'react'
import {
  ArchiveIcon,
  CalendarIcon,
  CheckIcon,
  ChevronRightIcon,
  CornerUpLeftIcon,
  FolderInputIcon,
  GitMergeIcon,
  LinkIcon,
  RefreshCwIcon,
  ShapesIcon,
  TextIcon,
  TypeIcon,
  UsersIcon,
  type LucideIcon,
} from '@/components/icons'
import { toast } from 'sonner'
import { FieldDiff, PersonAvatar } from '@/components/heed/bits'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  monthOf,
  relativeDate,
  restorable,
  VERB,
  type Version,
  type VersionKind,
} from '@/data/history'
import { useShowMore } from '@/hooks/use-show-more'

// A history that stays small however long it gets: one line until opened ("12 changes - last
// edited by Jon Abara, 3 Oct"), then compact rows grouped by month, the newest five first and
// "Show earlier" for more, so the page grows and nothing scrolls inside it. A row's tooltip says
// what changed; a click opens that version's read-only diff in a sheet, with Restore for owners.

const KIND_ICON: Record<VersionKind, LucideIcon> = {
  wording: TypeIcon,
  link: LinkIcon,
  formatting: TextIcon,
  dates: CalendarIcon,
  published: GitMergeIcon,
  returned: CornerUpLeftIcon,
  archived: ArchiveIcon,
  moved: FolderInputIcon,
  retyped: ShapesIcon,
  owners: UsersIcon,
  checked: CheckIcon,
  synced: RefreshCwIcon,
}

function Row({ version, onOpen }: { version: Version; onOpen: () => void }) {
  const Icon = KIND_ICON[version.kind]
  return (
    <li>
      <Tooltip>
        <TooltipTrigger
          delay={300}
          render={
            <button
              type="button"
              onClick={onOpen}
              className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-dense outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          }
        >
          <PersonAvatar name={version.who} size={20} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{version.who.split(' ')[0]}</span>{' '}
            <span className="text-muted-foreground">{VERB[version.kind]}</span>
          </span>
          <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
            {relativeDate(version.on)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-64">
          Version {version.v}: {version.summary}
        </TooltipContent>
      </Tooltip>
    </li>
  )
}

/** The versions of an item, newest first. `current` says which one agents get. */
export function VersionHistory({
  versions,
  canRestore,
}: {
  versions: Version[]
  canRestore: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [viewing, setViewing] = React.useState<Version | null>(null)
  const { shown, more, next, showMore, showFewer } = useShowMore(versions, 5, 10)
  const latest = versions[0]
  const listId = React.useId()
  if (!latest) return null

  // Shown rows by month, in order: "October 2026", then the rows of that month.
  const months = shown.reduce<{ month: string; rows: Version[] }[]>((acc, v) => {
    const month = monthOf(v.on)
    const last = acc[acc.length - 1]
    if (last?.month === month) last.rows.push(v)
    else acc.push({ month, rows: [v] })
    return acc
  }, [])

  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className="group/history -mx-1.5 flex min-h-8 items-center gap-2 rounded-md px-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronRightIcon
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-aria-expanded/history:rotate-90"
        />
        <span className="min-w-0 flex-1">
          <span className="font-medium tabular-nums">
            {versions.length} {versions.length === 1 ? 'change' : 'changes'}
          </span>
          <span className="text-muted-foreground">
            {' '}
            - last {latest.kind === 'checked' ? 'checked' : 'edited'} by {latest.who},{' '}
            {relativeDate(latest.on)}
          </span>
        </span>
      </button>
      {open && (
        <div
          id={listId}
          className="mt-1 flex animate-in flex-col duration-(--dur-3) fade-in-0 slide-in-from-top-1"
        >
          {months.map((m) => (
            <section key={m.month} aria-label={m.month}>
              <h3 className="px-1.5 pt-2 pb-1 text-xs text-muted-foreground">{m.month}</h3>
              <ul className="-mx-1.5 flex flex-col">
                {m.rows.map((v) => (
                  <Row key={v.v} version={v} onOpen={() => setViewing(v)} />
                ))}
              </ul>
            </section>
          ))}
          <div className="mt-1 flex items-center gap-2">
            {more > 0 && (
              <Button variant="ghost" size="sm" className="-ml-2 h-7 text-xs" onClick={showMore}>
                Show {next} earlier
                <span className="text-muted-foreground tabular-nums">({more} more)</span>
              </Button>
            )}
            {showFewer && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={showFewer}
              >
                Show fewer
              </Button>
            )}
          </div>
        </div>
      )}
      <Sheet open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <SheetContent side="right" className="w-history-panel gap-0 p-0">
          {viewing && (
            <>
              <SheetHeader className="border-b">
                <SheetTitle>
                  Version {viewing.v}
                  {viewing.v === latest.v && (
                    <span className="font-normal text-muted-foreground">
                      {' '}
                      (what agents get now)
                    </span>
                  )}
                </SheetTitle>
                <SheetDescription>
                  {viewing.who} {VERB[viewing.kind]}, {relativeDate(viewing.on)}. {viewing.summary}
                </SheetDescription>
              </SheetHeader>
              <div className="@container flex flex-col gap-4 p-4">
                <FieldDiff label={viewing.field} before={viewing.before} after={viewing.after} />
                {canRestore && viewing.v !== latest.v && restorable(viewing) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => {
                      toast(`Version ${viewing.v} restored as a draft`, {
                        description: 'Publish it to make it what agents get.',
                      })
                      setViewing(null)
                    }}
                  >
                    <ArchiveIcon data-icon="inline-start" />
                    Restore as a draft
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      <span className="sr-only" aria-live="polite">
        {open ? `${shown.length} of ${versions.length} versions shown` : ''}
      </span>
    </div>
  )
}
