import * as React from 'react'
import {
  ArchiveIcon,
  CircleCheckIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  FolderInputIcon,
  ShapesIcon,
  Trash2Icon,
  UserPlusIcon,
  UsersIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { BulkBar, BulkButton, type BulkNote } from '@/components/heed/bulk-bar'
import { DeleteDialog } from '@/components/heed/delete-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TODAY } from '@/data/history'
import { leaveAllThen } from '@/lib/presence'
import { APP_URL } from '@/lib/brand'
import {
  domains,
  kindLabel,
  ownersOf,
  people,
  type DomainId,
  type Fact,
  type Kind,
} from '@/data/world'
import type { RowSelection } from '@/hooks/use-selection'
import {
  attempt,
  canChange,
  count,
  doneLine,
  download,
  movableTo,
  planFacts,
  skippedLine,
  toCsv,
  toMarkdown,
  type FactAction,
  type Me,
} from '@/lib/bulk'
import { useRoute } from '@/lib/router'
import { useOnline } from '@/lib/scenario'
import { useMe, useStore, type LogEntry } from '@/lib/store'

// What a person can do to many context items at once, from the bar: Archive (the safe default, with
// Undo), Delete (drafts only, after a confirmation, with Undo for a short while), and under More:
// change the domain, the kind or the owners, mark as checked, and export. Each change acts on the
// rows it may change and says what it left alone; the rows left alone stay ticked, with the reasons.
// Every change is written to the items' History, and a deletion to Settings, Advanced.

const KINDS = Object.keys(kindLabel) as Kind[]
/** How long a deletion can be undone. */
const UNDO_DELETE_MS = 10_000
const OFFLINE = "Off while you're offline. Nothing is lost."
let entries = 0

export function ContextBulk({
  sel,
  facts,
  matching,
  deleting,
  setDeleting,
}: {
  sel: RowSelection
  facts: Fact[]
  /** Every row the search and filters match, folded groups too. */
  matching: string[]
  deleting: boolean
  setDeleting: (open: boolean) => void
}) {
  const { state, dispatch } = useStore()
  const me = useMe()
  const online = useOnline()
  const { query } = useRoute()
  // ?bulk=fail: the first change made here fails on its last row, so a partial failure can be seen.
  const failOnce = React.useRef(query.get('bulk') === 'fail')
  const [note, setNote] = React.useState<BulkNote>()
  const picked = facts.filter((f) => sel.isSelected(f.id))
  const who: Me = { name: me.name, admin: me.admin }

  // A new selection starts without the last change's line.
  const key = sel.ids.join('|')
  const noted = React.useRef(key)
  React.useEffect(() => {
    if (noted.current !== key) setNote(undefined)
  }, [key])

  /** One change to the picked rows: it acts on what it may, keeps the rest ticked, and can be undone. */
  function change(
    action: FactAction,
    verb: string,
    what: LogEntry['what'],
    summary: string,
    patch: (f: Fact) => Partial<Fact>,
    opts: Parameters<typeof planFacts>[3] = {},
    rows: Fact[] = picked,
  ) {
    const plan = planFacts(action, rows, who, { ...opts, viewed: state.viewed })
    if (!plan.act.length) {
      setNote({ text: skippedLine(plan.skipped), skipped: plan.skipped })
      return
    }
    const { ok, failed } = attempt(plan.act, failOnce.current)
    failOnce.current = false
    const before = state
    const entry: LogEntry = {
      id: `log-${++entries}`,
      on: TODAY,
      who: me.name,
      what,
      summary,
      items: ok.map((f) => ({ id: f.id, title: f.title, domain: f.domain })),
    }
    const remove = action === 'delete' ? ok.map((f) => f.id) : []
    const commit = () =>
      dispatch({
        type: 'bulk',
        patches: action === 'delete' ? {} : Object.fromEntries(ok.map((f) => [f.id, patch(f)])),
        remove,
        entry,
      })
    // What leaves the list (archived or deleted) goes as rows leaving; other changes are made at once.
    if (action === 'delete' || action === 'archive')
      leaveAllThen(
        ok.map((f) => f.id),
        commit,
      )
    else commit()
    // What is done leaves the selection; what failed or was left alone stays, with its line.
    const stay = [...failed.map((f) => f.id), ...plan.skipped.map((s) => s.id)]
    if (stay.length) sel.select(stay)
    else sel.clear()
    const line = doneLine(verb, ok.length, failed.length)
    if (failed.length)
      setNote({
        text: [line, skippedLine(plan.skipped)].filter(Boolean).join('. '),
        skipped: plan.skipped,
        action: {
          label: 'Retry',
          onClick: () => change(action, verb, what, summary, patch, opts, failed),
        },
      })
    else
      setNote(
        plan.skipped.length
          ? { text: skippedLine(plan.skipped), skipped: plan.skipped }
          : undefined,
      )
    noted.current = stay.join('|')
    toast(line, {
      description:
        action === 'delete'
          ? 'You can undo it for 10 seconds; then they are gone for good.'
          : action === 'archive'
            ? 'Agents stop getting them from the next question.'
            : undefined,
      duration: action === 'delete' ? UNDO_DELETE_MS : undefined,
      action: {
        label: 'Undo',
        onClick: () => {
          dispatch({
            type: 'revert',
            before,
            cards: [],
            facts: ok.map((f) => f.id),
            entry: entry.id,
          })
          toast(`Undone: ${count(ok.length, 'item')} as before`)
        },
      },
    })
  }

  const archive = (rows = picked) =>
    change(
      'archive',
      'archived',
      'archived',
      'Archived: agents stop getting it.',
      () => ({ status: 'Archived' }),
      {},
      rows,
    )
  const remove = () =>
    change('delete', 'deleted', 'deleted', 'Deleted: a draft nobody published.', () => ({}))

  // What each button would do now, so one that can't act says why before it is pressed.
  const archivePlan = planFacts('archive', picked, who)
  const deletePlan = planFacts('delete', picked, who)
  const publishedPlan = planFacts(
    'archive',
    picked.filter((f) => f.status !== 'Draft'),
    who,
  )
  const cannot = picked.length > 0 && picked.every((f) => !canChange(f, who))
  const ownedBy = [...new Set(picked.map((f) => domains[f.domain].name))].join(' and ')
  const noRights = cannot ? `Only owners of ${ownedBy} and admins can change these.` : undefined
  const off = online ? noRights : OFFLINE
  const archiveReason = off ?? (archivePlan.act.length ? undefined : archivePlan.skipped[0]?.reason)
  // Delete opens its confirmation whenever there is a draft to delete or a published item to archive instead.
  const deleteReason =
    off ??
    (deletePlan.act.length || publishedPlan.act.length ? undefined : deletePlan.skipped[0]?.reason)

  const owners = people.filter((p) => !p.invited && (p.admin || p.owns.length))
  const domainChoices = movableTo(who)

  return (
    <>
      <BulkBar
        label="Selected context"
        count={sel.count}
        onClear={sel.clear}
        matching={
          sel.allShown
            ? { count: matching.length, onSelect: () => sel.select(matching) }
            : undefined
        }
        note={
          online
            ? note
            : { text: "You're offline. Changes are off until you're back; nothing is lost." }
        }
      >
        <BulkButton reason={archiveReason} onClick={() => archive()}>
          <ArchiveIcon />
          <span className="max-sm:sr-only">Archive</span>
        </BulkButton>
        <BulkButton reason={deleteReason} onClick={() => setDeleting(true)}>
          <Trash2Icon />
          <span className="max-sm:sr-only">Delete</span>
        </BulkButton>
        <DropdownMenu>
          <DropdownMenuTrigger render={<BulkButton />}>
            <EllipsisIcon />
            <span className="max-sm:sr-only">More</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-60">
            {off && <p className="px-2 py-1.5 text-xs text-muted-foreground">{off}</p>}
            <DropdownMenuGroup>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={!!off}>
                  <FolderInputIcon />
                  Change domain
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-52">
                  {domainChoices.map((d: DomainId) => (
                    <DropdownMenuItem
                      key={d}
                      onClick={() =>
                        change(
                          'domain',
                          'moved',
                          'moved',
                          `Moved to ${domains[d].name}.`,
                          () => ({ domain: d }),
                          { domain: d },
                        )
                      }
                    >
                      {domains[d].name}
                    </DropdownMenuItem>
                  ))}
                  {!who.admin && (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">
                      Only domains you own are listed.
                    </p>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={!!off}>
                  <ShapesIcon />
                  Change kind
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-44">
                  {KINDS.map((k) => (
                    <DropdownMenuItem
                      key={k}
                      onClick={() =>
                        change(
                          'kind',
                          'changed',
                          'kind',
                          `Now a ${kindLabel[k]}.`,
                          () => ({ kind: k }),
                          { kind: k },
                        )
                      }
                    >
                      {kindLabel[k]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={!!off}>
                  <UserPlusIcon />
                  Add owner
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  {owners.map((p) => (
                    <DropdownMenuItem
                      key={p.name}
                      onClick={() =>
                        change(
                          'owner-add',
                          'changed',
                          'owners',
                          `${p.name} added as an owner.`,
                          (f) => ({ owners: [...ownersOf(f), p.name] }),
                          { person: p },
                        )
                      }
                    >
                      {p.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={!!off}>
                  <UsersIcon />
                  Change owner
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  {owners.map((p) => (
                    <DropdownMenuItem
                      key={p.name}
                      onClick={() =>
                        change(
                          'owner-set',
                          'changed',
                          'owners',
                          `Owner changed to ${p.name}.`,
                          () => ({ owners: [p.name] }),
                          { person: p },
                        )
                      }
                    >
                      {p.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem
                disabled={!!off}
                onClick={() =>
                  change(
                    'check',
                    'checked',
                    'checked',
                    'Checked: still true.',
                    (f) => ({
                      status: f.status === 'Needs checking' ? 'Live' : f.status,
                      outOfDate: undefined,
                      checkedBy: me.name,
                      checkedOn: '22 Oct 2026',
                    }),
                    {},
                  )
                }
              >
                <CircleCheckIcon />
                <span className="flex flex-col">
                  Mark as checked
                  <span className="text-xs text-muted-foreground">Only the ones you opened</span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                navigator.clipboard
                  ?.writeText(picked.map((f) => `${APP_URL}/context/${f.id}`).join('\n'))
                  .catch(() => undefined)
                toast(`Copied ${count(picked.length, 'link')}`)
              }}
            >
              <CopyIcon />
              Copy links
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <DownloadIcon />
                Export
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52">
                <DropdownMenuItem
                  onClick={() => {
                    download('context.md', toMarkdown(picked), 'text/markdown')
                    toast(`Exported ${count(picked.length, 'item')} as Markdown`)
                  }}
                >
                  As Markdown
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    download('context.csv', toCsv(picked), 'text/csv')
                    toast(`Exported ${count(picked.length, 'item')} as a spreadsheet`)
                  }}
                >
                  As a spreadsheet (CSV)
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </BulkBar>
      <DeleteDialog
        open={deleting && !deleteReason}
        onOpenChange={setDeleting}
        noun="draft"
        titles={deletePlan.act.map((f) => f.title)}
        consequence="Nobody published them, so agents never got them. They are removed for good; you can undo it for a few seconds."
        skipped={deletePlan.skipped}
        archive={
          publishedPlan.act.length
            ? { count: publishedPlan.act.length, onArchive: () => archive(publishedPlan.act) }
            : undefined
        }
        onDelete={remove}
      />
    </>
  )
}
