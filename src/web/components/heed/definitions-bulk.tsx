import * as React from 'react'
import {
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  FolderInputIcon,
  Trash2Icon,
} from '@/components/icons'
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
import { TODAY } from '@/model/history'
import type { DomainId } from '@/model/items'
import type { Domains } from '@/model/people'
import type { RowSelection } from '@/hooks/use-selection'
import { useDeleteConfirmation } from '@/hooks/use-delete-confirmation'
import { APP_URL } from '@/lib/brand'
import { count, download, heldRows, movableTo, planTerms, skippedLine, type Me } from '@/lib/bulk'
import { useWrite } from '@/api/queries'
import { leaveAllThen } from '@/lib/presence'
import { kindName, toolOf, useGlossary, type Definition } from '@/lib/definitions'
import { useOnline } from '@/lib/send'
import { useDomains, useMe } from '@/lib/workspace'
import type { LogEntry } from '@/model/items'

// What a person can do to many definitions at once. Only terms change here: synced metrics and
// dimensions are read-only and are left alone, with the tool that owns them. Deleting a term takes
// its synonyms with it, said in the confirmation before it happens.

const OFFLINE = "Off while you're offline. Nothing is lost."
let entries = 0

export function DefinitionsBulk({ sel, defs }: { sel: RowSelection; defs: Definition[] }) {
  const write = useWrite()
  const glossary = useGlossary()
  const domains = useDomains()
  const me = useMe()
  const online = useOnline()
  const [note, setNote] = React.useState<BulkNote>()
  const picked = defs.filter((d) => sel.isSelected(d.name))
  const who: Me = { name: me.name, admin: me.admin }
  // The tool the synced ones picked come from, or neutral words when none or several.
  const tool = toolOf(picked) ?? 'each tool'

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

  // What Delete would act on now: it decides whether the button and the key may open the confirmation.
  const deletePlan = planTerms('delete', picked, who, domains)
  const off = online ? undefined : OFFLINE
  const deleteReason = off ?? (deletePlan.act.length ? undefined : deletePlan.skipped[0]?.reason)
  const { confirming, ask, close } = useDeleteConfirmation(sel, deleteReason, (text) =>
    setNote({ text }),
  )
  // What the confirmation holds: the terms it was opened with, not the ticks as they are now.
  const held = planTerms(
    'delete',
    heldRows(defs, confirming, (d) => d.name),
    who,
    domains,
  )
  const others = glossary.goesWith(held.act.map((d) => d.name))
  // It shuts, and stays shut, when the terms are gone from under it or the connection is: it never
  // says "Delete 0 terms?" and never opens by itself when the connection returns.
  const stale = !!confirming && (!held.act.length || !online)
  React.useEffect(() => {
    if (stale) close()
  })

  async function remove() {
    const names = held.act.map((d) => d.name)
    const gone = [...held.act, ...others]
    const entry: LogEntry = {
      id: `log-term-${++entries}`,
      on: TODAY,
      who: me.name,
      what: 'deleted',
      summary: 'Deleted: a term, and the other names that pointed at it.',
      items: gone.map((d) => ({ id: `term:${d.name}`, title: d.name, domain: d.domain })),
    }
    // The rows that go (the terms and the names that pointed at them) fade out first, and stay
    // gone while the list refreshes.
    const { undo } = await new Promise<{ undo: string }>((done, fail) => {
      leaveAllThen(
        gone.map((d) => d.name),
        () => write('deleteTerms', { names, entry }).then(done),
      ).catch(fail)
    })
    settle(held.act, held.skipped)
    toast(`${count(names.length, 'term')} deleted`, {
      description: others.length ? `With ${count(others.length, 'other name')}.` : undefined,
      duration: 10_000,
      action: { label: 'Undo', onClick: () => void write('undo', { token: undo }) },
    })
  }

  async function move(d: DomainId) {
    const plan = planTerms('domain', picked, who, domains, { domain: d })
    if (!plan.act.length) return setNote({ text: skippedLine(plan.skipped), skipped: plan.skipped })
    const { undo } = await write('moveTerms', { names: plan.act.map((x) => x.name), domain: d })
    settle(plan.act, plan.skipped)
    toast(`${count(plan.act.length, 'term')} moved to ${domains[d]?.name}`, {
      action: { label: 'Undo', onClick: () => void write('undo', { token: undo }) },
    })
  }

  const domainChoices = movableTo(who, domains)

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
        <BulkButton reason={deleteReason} onClick={ask}>
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
                  <DropdownMenuItem key={d} onClick={() => void move(d)}>
                    {domains[d]?.name}
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
                    download('definitions.md', defsMarkdown(picked, domains), 'text/markdown')
                    toast(`Exported ${count(picked.length, 'definition')} as Markdown`)
                  }}
                >
                  As Markdown
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    download('definitions.csv', defsCsv(picked, domains), 'text/csv')
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
        open={!!confirming && !stale}
        onOpenChange={(open) => !open && close()}
        noun="term"
        titles={held.act.map((d) => d.name)}
        consequence="Agents stop reading these words from the next question. They are removed for good; you can undo it for a few seconds."
        also={
          others.length
            ? `Their other names go too: ${others.map((d) => d.name).join(', ')}.`
            : undefined
        }
        skipped={held.skipped}
        onDelete={() => void remove()}
      />
    </>
  )
}

function defsMarkdown(defs: Definition[], domains: Domains) {
  return (
    `# Definitions\n\n` +
    defs
      .map(
        (d) =>
          `## ${d.name}\n\n${d.definition || `Another name for ${d.sameAs}.`}\n\n- Type: ${kindName(d)}\n` +
          (d.domain ? `- Domain: ${domains[d.domain]?.name}\n` : ''),
      )
      .join('\n')
  )
}

function defsCsv(defs: Definition[], domains: Domains) {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const rows = [
    ['Name', 'Type', 'Domain', 'Meaning'],
    ...defs.map((d) => [
      d.name,
      kindName(d),
      d.domain ? (domains[d.domain]?.name ?? '') : '',
      d.definition || `Another name for ${d.sameAs}`,
    ]),
  ]
  return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n'
}
