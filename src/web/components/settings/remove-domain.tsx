import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { DELETE_DOMAIN_PHRASE } from '@domain/area-removal'
import { toApiError, type AreaRemoved, type AreaRestored, type ArchivedArea } from '@/api'
import { archivedAreasQuery, areaRemovalQuery, useApiWrite } from '@/api/queries'
import {
  ArchiveIcon,
  ChevronDownIcon,
  FileTextIcon,
  GitPullRequestIcon,
  HistoryIcon,
  LayersIcon,
  NotebookPenIcon,
  RotateCcwIcon,
  TagIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UsersIcon,
  type Icon,
} from '@/components/icons'
import { DomainBadge } from '@/components/item/item-marks'
import { ConfirmDialog, type ConfirmDone } from '@/components/form/confirm-dialog'
import { gridCell } from '@/components/page/grid'
import {
  GridHeaderCells,
  GridTable,
  gridRowClass,
  type GridColumn,
} from '@/components/page/grid-table'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import { deletedSummary, deletionEffect, deletionLines, type DeletionLine } from '@/lib/areas'
import { formatDay } from '@/lib/library'
import { showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { SettingsBlock } from './settings-parts'

/*
  Deleting a domain (FR-814), from Administration › Domains, in one step, as AWS deletes: the
  dialog lists what goes with the domain and what happens to each kind, with every one named, and
  the Delete domain button stays disabled until the person types `permanently delete`. Nothing
  has to be moved first. A domain that held nothing is deleted for good, and the last step offers
  to create it again; otherwise it can be restored at any time, here or from Deleted domains below
  the domains, which brings back its team's roles and its terms; its items come back from the Bin.
*/

const lineIcons: Record<DeletionLine['kind'], Icon> = {
  items: FileTextIcon,
  terms: TagIcon,
  openProposals: GitPullRequestIcon,
  drafts: NotebookPenIcon,
  team: UsersIcon,
  sourceMembers: LayersIcon,
  history: HistoryIcon,
}

/** What the list of a line is called on its toggle. */
const lineNouns: Record<DeletionLine['kind'], string> = {
  items: 'facts',
  terms: 'names',
  openProposals: 'proposals',
  drafts: 'drafts',
  team: 'people',
  sourceMembers: 'names',
  history: 'history',
}

const inlineLink = 'text-brand-ink underline underline-offset-4 hover:no-underline'

/** One kind of thing under the domain: what happens to it, and which ones, behind a toggle. */
function DeletionLineRow({ line }: { line: DeletionLine }) {
  const LineIcon = lineIcons[line.kind]
  return (
    <li data-kind={line.kind} className="flex items-start gap-3 px-3 py-2">
      <LineIcon aria-hidden className="size-4 shrink-0 translate-y-px text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-dense font-bold">{line.title}</span>
        <span className="text-dense text-muted-foreground">{line.detail}</span>
        {line.entries.length ? (
          <Collapsible>
            <CollapsibleTrigger
              render={
                <Button
                  variant="link"
                  size="sm"
                  className="group/entries h-auto justify-start px-0 text-dense"
                />
              }
            >
              <ChevronDownIcon
                aria-hidden
                className="size-icon-sm shrink-0 -rotate-90 transition-transform group-data-panel-open/entries:rotate-0"
              />
              See the {lineNouns[line.kind]}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul
                aria-label={line.title}
                className="flex flex-col divide-y divide-border-subtle rounded-sm border"
              >
                {line.entries.map((entry) => (
                  <li key={entry.key} className="flex min-w-0 flex-col px-3 py-2">
                    <span className="text-dense break-words">{entry.label}</span>
                    <span className="text-caption text-muted-foreground">{entry.detail}</span>
                  </li>
                ))}
                {line.more ? (
                  <li className="px-3 py-2 text-caption text-muted-foreground">
                    and {line.more.toLocaleString('en')} more
                  </li>
                ) : null}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </span>
    </li>
  )
}

/**
 * Delete a domain: what goes with it, with every one named, then `permanently delete` typed to
 * unlock the button. Ends on what happened and the way back: restore it, or create it again.
 */
export function RemoveDomainDialog({
  areaId,
  name,
  open,
  onOpenChange,
}: {
  areaId: string
  name: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [removed, setRemoved] = useState<AreaRemoved | null>(null)
  const [undone, setUndone] = useState<AreaRestored | 'created' | null>(null)
  const removal = useQuery({ ...areaRemovalQuery(areaId), enabled: open && removed === null })
  const remove = useApiWrite('removeArea')
  const create = useApiWrite('createArea')
  const restore = useApiWrite('restoreArea')
  const restoreItems = useApiWrite('restoreFromBin')
  const data = removal.data
  const hold =
    removal.isError || data === null || data?.demo ? 'refused' : data ? undefined : 'waiting'

  // Undo is its own change: a domain kept as history is restored, with its team and its terms,
  // and the items deleting moved to the Bin come back with it; a deleted one is created again.
  const undo = async (gone: AreaRemoved) => {
    const { area } = gone
    try {
      if (gone.outcome === 'archived') {
        const back = await restore.mutateAsync({ id: area.id, reason: 'Undid the deletion' })
        if (back.binnedItems.length)
          await restoreItems
            .mutateAsync({ ids: back.binnedItems.map((item) => item.id) })
            .catch((error: unknown) =>
              showToast(
                'Its facts stayed in the Bin',
                toApiError(error).message || 'Restore them from the Bin.',
              ),
            )
        setUndone(back)
      } else {
        const staffed = Boolean(area.ownerIds.length || area.approverIds.length)
        await create.mutateAsync({
          id: area.id,
          name: area.name,
          label: area.label,
          reviewDays: area.reviewDays,
          chatChannel: area.chatChannel,
          ownerTeam: area.ownerTeam,
          summary: area.summary,
          description: area.description,
          reason: 'Undid the deletion',
          ...(staffed
            ? {
                team: { ownerIds: area.ownerIds, approverIds: area.approverIds },
              }
            : {}),
        })
        setUndone('created')
      }
    } catch (error) {
      showToast(`Couldn't bring back ${area.name}`, toApiError(error).message || 'Try again.')
    }
  }

  const busy = create.isPending || restore.isPending || restoreItems.isPending
  const done: ConfirmDone | null = removed
    ? undone
      ? {
          title: `${removed.area.name} is back`,
          content: (
            <p className="text-body">
              {undone === 'created'
                ? "It's listed again, with its team. The history log keeps both changes."
                : "It's listed again, with its team, its names and its facts. The history log keeps both changes."}
            </p>
          ),
        }
      : {
          title: `${removed.area.name} deleted`,
          content: (
            <div className="flex flex-col gap-2 text-body" data-slot="domain-deleted">
              {deletedSummary(removed).map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ),
          actions: (
            <Button
              variant="outline"
              size="lg"
              aria-disabled={busy || undefined}
              onClick={() => void (busy ? undefined : undo(removed))}
            >
              <RotateCcwIcon aria-hidden />
              {removed.outcome === 'deleted' ? 'Undo: create it again' : 'Undo: restore it'}
            </Button>
          ),
        }
    : null

  let content
  if (removal.isError)
    content = (
      <Alert variant="danger" role="alert">
        <TriangleAlertIcon aria-hidden />
        <AlertContent>
          <AlertTitle>We couldn&apos;t load what deleting does</AlertTitle>
          <AlertDescription>
            <p>
              Nothing has changed. You can delete the domain once we can show you what that does.
            </p>
            <div>
              <Button variant="outline" onClick={() => void removal.refetch()}>
                Try again
              </Button>
            </div>
          </AlertDescription>
        </AlertContent>
      </Alert>
    )
  else if (data === undefined)
    content = (
      <div role="status" aria-label="Reading what deleting does" className="flex flex-col gap-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-row w-full" />
        <Skeleton className="h-row w-full" />
      </div>
    )
  else if (data && !data.demo) {
    const lines = deletionLines(data)
    content = lines.length ? (
      <ul
        aria-label={`What deleting ${data.name} does`}
        data-slot="domain-deletion"
        data-outcome={data.outcome}
        className="flex flex-col divide-y divide-border-subtle rounded-sm border"
      >
        {lines.map((line) => (
          <DeletionLineRow key={line.kind} line={line} />
        ))}
      </ul>
    ) : null
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setRemoved(null)
          setUndone(null)
        }
      }}
      title={`Delete ${name}?`}
      effect={
        data
          ? deletionEffect(data)
          : data === null
            ? `We couldn't find ${name}. Another admin may have deleted it.`
            : `Reading what deleting ${name} does.`
      }
      done={done}
      action="Delete domain"
      actionIcon={Trash2Icon}
      tone="destructive"
      reason={{ label: 'Why', hint: 'Kept in the history log.' }}
      confirmText={DELETE_DOMAIN_PHRASE}
      lockUntilTyped
      wide
      {...(hold ? { hold } : {})}
      onConfirm={async ({ reason }) => {
        if (!data) return
        setRemoved(
          await remove.mutateAsync({
            id: areaId,
            revision: data.revision,
            confirm: DELETE_DOMAIN_PHRASE,
            ...(reason ? { reason } : {}),
          }),
        )
      }}
    >
      {content}
    </ConfirmDialog>
  )
}

/**
 * Restore a deleted domain: it is listed again, its team gets their roles back and its terms
 * are served again, in one edition. Its items wait in the Bin: the last step lists them and
 * restores them too.
 */
function RestoreDomainDialog({
  area,
  open,
  onOpenChange,
}: {
  area: ArchivedArea
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const restore = useApiWrite('restoreArea')
  const restoreItems = useApiWrite('restoreFromBin')
  const [restored, setRestored] = useState<AreaRestored | null>(null)
  const [itemsBack, setItemsBack] = useState(false)
  const gives = [
    area.team ? `its team gets ${area.team === 1 ? 'its role' : 'their roles'} back` : null,
    area.terms
      ? `Agents get ${area.terms === 1 ? 'its name' : `its ${area.terms.toLocaleString('en')} names`} again`
      : null,
  ].filter(Boolean)
  const items = restored?.binnedItems ?? []
  const bringItems = async () => {
    try {
      await restoreItems.mutateAsync({ ids: items.map((item) => item.id) })
      setItemsBack(true)
    } catch (error) {
      showToast('The facts stayed in the Bin', toApiError(error).message || 'Try again.')
    }
  }
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setRestored(null)
          setItemsBack(false)
        }
      }}
      title={`Restore ${area.name}?`}
      effect={`It's listed again${gives.length ? `, ${gives.join(', and ')}` : ''}.${
        area.binnedItems
          ? ` Its ${area.binnedItems === 1 ? 'fact waits' : `${area.binnedItems.toLocaleString('en')} facts wait`} in the Bin, and you can restore ${area.binnedItems === 1 ? 'it' : 'them'} next.`
          : ''
      }`}
      action="Restore domain"
      actionIcon={RotateCcwIcon}
      reason={{ label: 'Why', hint: 'Kept in the history log.' }}
      done={
        restored
          ? {
              title: `${restored.area.name} restored`,
              content: (
                <div className="flex flex-col gap-3 text-body" data-slot="domain-restored">
                  <p>
                    It&apos;s listed again
                    {restored.team
                      ? `, and ${restored.team === 1 ? 'one person has their role' : `${restored.team} people have their roles`} back`
                      : ''}
                    {restored.edition ? '. Agents get its names again' : ''}.
                  </p>
                  {items.length ? (
                    itemsBack ? (
                      <p>
                        {items.length === 1
                          ? 'Its fact is back in the library.'
                          : `Its ${items.length.toLocaleString('en')} facts are back in the library.`}
                      </p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <p>
                          {items.length === 1
                            ? 'Its fact waits in the Bin:'
                            : `Its ${items.length.toLocaleString('en')} facts wait in the Bin:`}
                        </p>
                        <ul
                          aria-label="Its facts in the Bin"
                          className="flex flex-col divide-y divide-border-subtle rounded-sm border"
                        >
                          {items.map((item) => (
                            <li key={item.id} className="px-3 py-2 text-dense break-words">
                              {item.title}
                            </li>
                          ))}
                        </ul>
                        <p className="text-dense text-muted-foreground">
                          Restore them here, or one by one from the{' '}
                          <Link to="/library/bin" className={inlineLink}>
                            Bin
                          </Link>
                          .
                        </p>
                      </div>
                    )
                  ) : null}
                </div>
              ),
              actions:
                items.length && !itemsBack ? (
                  <Button
                    variant="outline"
                    size="lg"
                    aria-disabled={restoreItems.isPending || undefined}
                    onClick={() => void (restoreItems.isPending ? undefined : bringItems())}
                  >
                    <RotateCcwIcon aria-hidden />
                    {items.length === 1 ? 'Restore the fact' : `Restore the ${items.length} facts`}
                  </Button>
                ) : undefined,
            }
          : null
      }
      onConfirm={async ({ reason }) => {
        setRestored(await restore.mutateAsync({ id: area.id, ...(reason ? { reason } : {}) }))
      }}
    />
  )
}

const deletedColumns: GridColumn[] = [
  { icon: LayersIcon, title: 'Domain', className: 'min-w-0 flex-1' },
  { icon: ArchiveIcon, title: 'Deleted', className: 'w-column-owner @max-3xl:hidden' },
]

/** What restoring a deleted domain gives back. */
function restoreLine(area: ArchivedArea): string {
  const gives = [
    area.team ? `${area.team === 1 ? 'one role' : `${area.team} roles`}` : null,
    area.terms ? `${area.terms === 1 ? 'one name' : `${area.terms} names`}` : null,
  ].filter(Boolean)
  const waiting = area.binnedItems
    ? ` ${area.binnedItems === 1 ? 'One fact waits' : `${area.binnedItems} facts wait`} in the Bin.`
    : ''
  return `${gives.length ? `Restoring gives back ${gives.join(' and ')}.` : 'Restoring lists it again.'}${waiting}`
}

/**
 * The deleted domains history keeps, below the domains, once there is one: each with Restore,
 * which lists it again with its team's roles and its terms.
 */
export function ArchivedDomains() {
  const archived = useQuery(archivedAreasQuery())
  const [restoring, setRestoring] = useState<ArchivedArea | null>(null)
  // The dialog outlives the row: once restored, the domain leaves this list while the dialog
  // still shows what came back.
  const dialog = restoring ? (
    <RestoreDomainDialog
      area={restoring}
      open
      onOpenChange={(open) => {
        if (!open) setRestoring(null)
      }}
    />
  ) : null
  return (
    <>
      {archived.data?.length ? (
        <DeletedDomainsBlock areas={archived.data} onRestore={setRestoring} />
      ) : null}
      {dialog}
    </>
  )
}

function DeletedDomainsBlock({
  areas,
  onRestore,
}: {
  areas: readonly ArchivedArea[]
  onRestore: (area: ArchivedArea) => void
}) {
  return (
    <SettingsBlock
      title="Deleted domains"
      slot="archived-domains"
      description="Deleted domains that their history still names. Restoring one lists it again, with its team's roles and its names. Its facts come back from the Bin."
    >
      <GridTable
        slot="settings-archived-domains"
        label="Deleted domains"
        header={
          <>
            <GridHeaderCells columns={deletedColumns} />
            <div role="columnheader" className={cn(gridCell, 'w-column-actions')}>
              <span className="sr-only">Actions</span>
            </div>
          </>
        }
      >
        {areas.map((area) => (
          <div key={area.id} role="row" data-row-id={area.id} className={gridRowClass}>
            <div role="cell" className={cn(gridCell, 'min-w-0 flex-1 shrink py-2')}>
              <span className="flex min-w-0 flex-col gap-1">
                <DomainBadge name={area.name} label={area.label} />
                <span className="text-dense text-muted-foreground">{restoreLine(area)}</span>
              </span>
            </div>
            <div role="cell" className={cn(gridCell, 'w-column-owner @max-3xl:hidden')}>
              {formatDay(area.archivedAt.slice(0, 10))}
            </div>
            <div role="cell" className={cn(gridCell, 'w-column-actions justify-end')}>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Restore ${area.name}`}
                onClick={() => onRestore(area)}
              >
                <RotateCcwIcon aria-hidden />
                Restore
              </Button>
            </div>
          </div>
        ))}
      </GridTable>
    </SettingsBlock>
  )
}
