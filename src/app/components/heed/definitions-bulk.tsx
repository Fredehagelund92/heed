import * as React from 'react'
import { CopyIcon, DownloadIcon, EllipsisIcon, FolderInputIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { BulkBar, BulkButton, type BulkNote } from '@/components/heed/bulk-bar'
import { DeleteDialog } from '@/components/heed/delete-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TODAY } from '@/data/history'
import { DEFINITIONS_TOOL } from '@/data/integrations'
import { domains, type DomainId } from '@/data/world'
import type { RowSelection } from '@/hooks/use-selection'
import { APP_URL } from '@/lib/brand'
import { count, download, movableTo, planTerms, skippedLine, type Me } from '@/lib/bulk'
import {
  deleteTerms,
  goesWith,
  kindName,
  moveTerms,
  restoreDefinitions,
  type Definition,
} from '@/lib/definitions'
import { useOnline } from '@/lib/scenario'
import { useMe, useStore, type LogEntry } from '@/lib/store'

// What a person can do to many definitions at once. Only terms change here: synced metrics and
// dimensions are read-only and are left alone, with the tool that owns them. Deleting a term takes
// its synonyms with it, said in the confirmation before it happens.

const OFFLINE = "Off while you're offline. Nothing is lost."
let entries = 0

export function DefinitionsBulk({
  sel,
  defs,
  deleting,
  setDeleting,
}: {
  sel: RowSelection
  defs: Definition[]
  deleting: boolean
  setDeleting: (open: boolean) => void
}) {
  const { dispatch } = useStore()
  const me = useMe()
  const online = useOnline()
  const [note, setNote] = React.useState<BulkNote>()
  const picked = defs.filter((d) => sel.isSelected(d.name))
  const who: Me = { name: me.name, admin: me.admin }
  const tool = DEFINITIONS_TOOL

  const key = sel.ids.join('|')
  const noted = React.useRef(key)
  React.useEffect(() => {
    if (noted.current !== key) setNote(undefined)
  }, [key])

  /** What a change acted on leaves the selection; what it left alone stays, with the reasons. */
  function settle(done: Definition[], skipped: ReturnType<typeof planTerms>['skipped']) {
    if (skipped.length) sel.select(skipped.map((s) => s.id))
    else sel.clear()
    setNote(skipped.length ? { text: skippedLine(skipped), skipped } : undefined)
    noted.current = skipped.map((s) => s.id).join('|')
    return done
  }

  const deletePlan = planTerms('delete', picked, who, { tool })
  const others = goesWith(deletePlan.act.map((d) => d.name))

  function remove() {
    const names = deletePlan.act.map((d) => d.name)
    const gone = [...deletePlan.act, ...others]
    const snapshot = deleteTerms(names)
    const entry: LogEntry = {
      id: `log-term-${++entries}`,
      on: TODAY,
      who: me.name,
      what: 'deleted',
      summary: 'Deleted: a term, and the other names that pointed at it.',
      items: gone.map((d) => ({ id: `term:${d.name}`, title: d.name, domain: d.domain })),
    }
    dispatch({ type: 'bulk', patches: {}, remove: [], entry })
    settle(deletePlan.act, deletePlan.skipped)
    toast(`${count(names.length, 'term')} deleted`, {
      description: others.length ? `With ${count(others.length, 'other name')}.` : undefined,
      duration: 10_000,
      action: {
        label: 'Undo',
        onClick: () => {
          restoreDefinitions(snapshot)
          dispatch({ type: 'unlog', entry: entry.id })
        },
      },
    })
  }

  function move(d: DomainId) {
    const plan = planTerms('domain', picked, who, { tool, domain: d })
    if (!plan.act.length) return setNote({ text: skippedLine(plan.skipped), skipped: plan.skipped })
    const snapshot = moveTerms(
      plan.act.map((x) => x.name),
      d,
    )
    settle(plan.act, plan.skipped)
    toast(`${count(plan.act.length, 'term')} moved to ${domains[d].name}`, {
      action: { label: 'Undo', onClick: () => restoreDefinitions(snapshot) },
    })
  }

  const off = online ? undefined : OFFLINE
  const deleteReason = off ?? (deletePlan.act.length ? undefined : deletePlan.skipped[0]?.reason)
  const domainChoices = movableTo(who)

  return (
    <>
      <BulkBar
        label="Selected definitions"
        count={sel.count}
        onClear={sel.clear}
        note={
          online
            ? note
            : { text: "You're offline. Changes are off until you're back; nothing is lost." }
        }
      >
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
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!!off}>
                <FolderInputIcon />
                Change domain
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52">
                {domainChoices.map((d) => (
                  <DropdownMenuItem key={d} onClick={() => move(d)}>
                    {domains[d].name}
                  </DropdownMenuItem>
                ))}
                <p className="px-2 py-1.5 text-xs text-muted-foreground">
                  Terms only: {tool} keeps its own.
                </p>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                navigator.clipboard
                  ?.writeText(
                    picked
                      .map((d) => `${APP_URL}/definitions/${encodeURIComponent(d.name)}`)
                      .join('\n'),
                  )
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
                    download('definitions.md', defsMarkdown(picked), 'text/markdown')
                    toast(`Exported ${count(picked.length, 'definition')} as Markdown`)
                  }}
                >
                  As Markdown
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    download('definitions.csv', defsCsv(picked), 'text/csv')
                    toast(`Exported ${count(picked.length, 'definition')} as a spreadsheet`)
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
        noun="term"
        titles={deletePlan.act.map((d) => d.name)}
        consequence="Agents stop reading these words from the next question. They are removed for good; you can undo it for a few seconds."
        also={
          others.length
            ? `Their other names go too: ${others.map((d) => d.name).join(', ')}.`
            : undefined
        }
        skipped={deletePlan.skipped}
        onDelete={remove}
      />
    </>
  )
}

function defsMarkdown(defs: Definition[]) {
  return (
    `# Definitions\n\n` +
    defs
      .map(
        (d) =>
          `## ${d.name}\n\n${d.definition || `Another name for ${d.sameAs}.`}\n\n- Type: ${kindName(d)}\n` +
          (d.domain ? `- Domain: ${domains[d.domain].name}\n` : ''),
      )
      .join('\n')
  )
}

function defsCsv(defs: Definition[]) {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const rows = [
    ['Name', 'Type', 'Domain', 'Meaning'],
    ...defs.map((d) => [
      d.name,
      kindName(d),
      d.domain ? domains[d.domain].name : '',
      d.definition || `Another name for ${d.sameAs}`,
    ]),
  ]
  return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n'
}
