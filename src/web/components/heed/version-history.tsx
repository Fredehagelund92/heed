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
  SplitIcon,
} from '@/components/icons'
import { toast } from 'sonner'
import { FieldDiff, PersonAvatar } from '@/components/heed/bits'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
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
} from '@/model/history'
import { useShowMore } from '@/hooks/use-show-more'
import { publishedUnderLine } from '@/lib/policies'

// A history that stays small however long it gets: one line until opened ("12 changes - last
// edited by Jon Abara, 3 Oct"), then compact rows grouped by month, the newest five first and
// "Show earlier" for more, so the page grows and nothing scrolls inside it. A row's tooltip says
// what changed; a click opens that version's read-only diff in a sheet, with Restore for owners.
// A version published under an owner's policy, without a review round (FR-421), says so on its row
// and in its sheet, which has Undo for an owner of the domain or an admin.

/** What a row says of who did it: "Jon published a suggestion", or under a policy, who sent it. */
const rowWords = (v: Version) =>
  v.policy && v.sentBy
    ? { who: '', what: publishedUnderLine(v.sentBy, v.who) }
    : { who: v.who.split(' ')[0], what: VERB[v.kind] }

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
  conflict: SplitIcon,
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
            {rowWords(version).who && (
              <>
                <span className="font-medium">{rowWords(version).who}</span>{' '}
              </>
            )}
            <span className="text-muted-foreground">{rowWords(version).what}</span>
          </span>
          <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
            {relativeDate(version.on)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-64">
          Version {version.v}:{' '}
          {version.policy && version.sentBy
            ? `${publishedUnderLine(version.sentBy, version.who)}, without a review round.`
            : version.summary}
          {!version.policy && version.sentBy && ` Sent by ${version.sentBy}.`}
          {version.policy?.undone && ' Undone since.'}
        </TooltipContent>
      </Tooltip>
    </li>
  )
}

/**
 * The versions of an item, newest first. `current` says which one agents get. `onRestore` brings
 * a version's words back as a draft; without it, Restore only says so.
 */
export function VersionHistory({
  versions,
  canRestore,
  onRestore,
  onUndo,
}: {
  versions: Version[]
  canRestore: boolean
  onRestore?: (version: Version) => Promise<unknown>
  /** Takes back a publish made under an owner's policy, by its token (FR-421, FR-227). */
  onUndo?: (token: string) => Promise<unknown>
}) {
  const [open, setOpen] = React.useState(false)
  const [viewing, setViewing] = React.useState<Version | null>(null)
  const { shown, more, next, showMore, showFewer } = useShowMore(versions, 5, 10)
  const latest = versions[0]
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
    <Collapsible open={open} onOpenChange={setOpen} render={<div className="flex flex-col" />}>
      <CollapsibleTrigger className="group/history -mx-1.5 flex min-h-8 items-center gap-2 rounded-md px-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50">
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
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 flex flex-col">
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
      </CollapsibleContent>
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
                  {viewing.policy && viewing.sentBy ? (
                    <>
                      {publishedUnderLine(viewing.sentBy, viewing.who)}, {relativeDate(viewing.on)}.
                      Nobody reviewed it first: it was {viewing.who}'s decision, made in advance.
                      {viewing.policy.undone && ' It was undone since.'}
                    </>
                  ) : (
                    <>
                      {viewing.who} {VERB[viewing.kind]}, {relativeDate(viewing.on)}.
                      {viewing.sentBy && ` Sent by ${viewing.sentBy}.`} {viewing.summary}
                    </>
                  )}
                </SheetDescription>
              </SheetHeader>
              <div className="@container flex flex-col gap-4 p-4">
                <FieldDiff label={viewing.field} before={viewing.before} after={viewing.after} />
                {viewing.policy?.undo && onUndo && (
                  <div className="flex flex-col gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-fit"
                      onClick={() => {
                        const token = viewing.policy!.undo!
                        setViewing(null)
                        void onUndo(token).then(
                          () =>
                            toast('Publish undone', {
                              description:
                                'Agents stop getting it. The suggestion waits for review.',
                            }),
                          (e: unknown) =>
                            toast("Couldn't undo it", {
                              description:
                                e instanceof Error ? e.message : 'Nothing changed. Try again.',
                            }),
                        )
                      }}
                    >
                      <CornerUpLeftIcon data-icon="inline-start" />
                      Undo this publish
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Agents stop getting it, and the suggestion waits for an owner.
                    </span>
                  </div>
                )}
                {canRestore && viewing.v !== latest.v && restorable(viewing) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => {
                      const restored = viewing
                      setViewing(null)
                      void Promise.resolve(onRestore?.(restored)).then(
                        () =>
                          toast(`Version ${restored.v} restored as a draft`, {
                            description: 'Publish it to make it what agents get.',
                          }),
                        () =>
                          toast(`Couldn't restore version ${restored.v}`, {
                            description: 'Nothing changed. Try again in a moment.',
                          }),
                      )
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
    </Collapsible>
  )
}
