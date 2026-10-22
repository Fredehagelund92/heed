import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { Area } from '@domain/item'
import { api, type AreaDetail } from '@/api'
import { areasQuery, peopleQuery, queryKeys } from '@/api/queries'
import {
  LayersIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UserRoundCheckIcon,
  UsersIcon,
} from '@/components/icons'
import { HelpLink } from '@/components/help/help-link'
import { DomainBadge, Owner } from '@/components/item/item-marks'
import { PageContent } from '@/components/page/page'
import { gridCell } from '@/components/page/grid'
import {
  GridFailed,
  GridHeaderCells,
  GridLoading,
  GridMessage,
  GridTable,
  gridRowClass,
  type GridColumn,
} from '@/components/page/grid-table'
import { Button } from '@/components/ui/button'
import { showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { AreaEditor } from './area-editor'
import { ArchivedDomains, RemoveDomainDialog } from './remove-domain'
import { SettingsBlock } from './settings-parts'

const SLOT = 'settings-domains'
const optional = '@max-3xl:hidden'

const columns: GridColumn[] = [
  { icon: LayersIcon, title: 'Domain', className: 'min-w-0 flex-1' },
  { icon: UserRoundCheckIcon, title: 'Owners', className: cn('w-column-owner', optional) },
]

type Editing = { area: AreaDetail | null } | null

/**
 * The domains (the specification's areas; FR-801), in Administration: an administrator creates
 * one, with its team if they like, and changes its name, colour, review time, channel, owner team
 * and what it is (FR-813), each with a reason. Who looks after a domain changes on its Team tab in
 * Health (or on the People page). Every domain's items reach agents as soon as they are accepted.
 * Delete takes a domain and everything under it in one step (FR-814); Deleted domains, below,
 * restores one at any time.
 */
export function DomainsSection() {
  const areas = useQuery(areasQuery())
  const { data: people = [] } = useQuery(peopleQuery())
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Editing>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Area | null>(null)
  const shown = areas.data ?? []
  const person = (id: string | null) => people.find((candidate) => candidate.id === id)

  // The editor needs the area as settings edits it, with the revision it was read at.
  const edit = async (area: Area) => {
    setOpening(area.id)
    try {
      const detail = await queryClient.fetchQuery({
        queryKey: queryKeys.areaDetail(area.id),
        queryFn: () => api.getArea(area.id),
        staleTime: 0,
      })
      if (detail) setEditing({ area: detail })
      else showToast(`Couldn't find ${area.name}`, 'Another admin may have deleted it.')
    } catch (error) {
      showToast(`Couldn't open ${area.name}`, error instanceof Error ? error.message : 'Try again.')
    } finally {
      setOpening(null)
    }
  }

  let body
  if (areas.isPending) body = <GridLoading slot={SLOT} label="Loading the domains" />
  else if (areas.isError)
    body = <GridFailed slot={SLOT} what="the domains" retry={() => void areas.refetch()} />
  else if (shown.length === 0)
    body = (
      <GridMessage slot={SLOT} icon={LayersIcon} title="No domains yet">
        Create the first domain. Every fact, proposal and owner belongs to one.
      </GridMessage>
    )
  else
    body = (
      <GridTable
        slot={SLOT}
        label="Domains"
        header={
          <>
            <GridHeaderCells columns={columns} />
            <div role="columnheader" className={cn(gridCell, 'w-column-actions')}>
              <span className="sr-only">Actions</span>
            </div>
          </>
        }
      >
        {shown.map((area) => {
          const owner = person(area.ownerIds[0] ?? null)
          const others = area.ownerIds.length - 1
          // "and Maria Lindqvist" beside the first owner, or "and 3 more" past two.
          const besides =
            others === 1
              ? `and ${person(area.ownerIds[1]!)?.name ?? '1 more'}`
              : others > 1
                ? `and ${others.toLocaleString('en')} more`
                : undefined
          return (
            <div key={area.id} role="row" data-row-id={area.id} className={gridRowClass}>
              <div role="cell" className={cn(gridCell, 'min-w-0 flex-1 shrink py-2')}>
                <span className="flex min-w-0 flex-col gap-1">
                  {/* The name is the row's title: the owner wraps under it before it is cut. */}
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <DomainBadge name={area.name} label={area.label} />
                    <span className="max-w-full truncate text-muted-foreground @3xl:hidden">
                      {owner ? `Owner ${owner.name}${besides ? ` ${besides}` : ''}` : 'No owner'}
                    </span>
                  </span>
                  <span className="truncate text-dense text-muted-foreground">
                    {area.summary || 'Not described yet'}
                  </span>
                </span>
              </div>
              <div role="cell" className={cn(gridCell, 'w-column-owner', optional)}>
                <Owner
                  name={owner?.name ?? null}
                  personId={owner?.id}
                  initials={owner?.initials}
                  role={besides}
                  empty="No owner"
                />
              </div>
              <div role="cell" className={cn(gridCell, 'w-column-actions justify-end gap-1')}>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`${area.name} team in Health`}
                  render={<Link to="/health" search={{ open: `domain:${area.id}`, tab: 'team' }} />}
                >
                  <UsersIcon aria-hidden />
                  Team
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Edit ${area.name}`}
                  onClick={() => void edit(area)}
                >
                  {opening === area.id ? (
                    <LoaderCircleIcon aria-hidden className="motion-safe:animate-spin" />
                  ) : (
                    <PencilIcon aria-hidden />
                  )}
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${area.name}`}
                  onClick={() => setRemoving(area)}
                >
                  <Trash2Icon aria-hidden />
                  Delete
                </Button>
              </div>
            </div>
          )
        })}
      </GridTable>
    )

  return (
    <PageContent width="overview" className="gap-8">
      <SettingsBlock
        title="Domains"
        slot="domains-block"
        description={
          <>
            Each domain has its own owners, review time and a description of what it holds. Agents
            get its facts as soon as they&apos;re accepted. Name its team now or later.{' '}
            <HelpLink to="glossary#domain">What is a domain?</HelpLink>
          </>
        }
        action={
          <Button variant="outline" onClick={() => setEditing({ area: null })}>
            <PlusIcon aria-hidden />
            Create a domain
          </Button>
        }
      >
        {body}
        <p className="text-dense text-muted-foreground">
          Change a domain&apos;s owners and approvers on its Team tab in{' '}
          <Link
            to="/health"
            className="text-brand-ink underline underline-offset-4 hover:no-underline"
          >
            Health
          </Link>
          , or many at once in{' '}
          <Link
            to="/admin"
            search={{ section: 'people' }}
            className="text-brand-ink underline underline-offset-4 hover:no-underline"
          >
            People
          </Link>
          . Its owners describe it on its record in Health too.
        </p>
      </SettingsBlock>
      <ArchivedDomains />
      {removing ? (
        <RemoveDomainDialog
          areaId={removing.id}
          name={removing.name}
          open
          onOpenChange={(open) => {
            if (!open) setRemoving(null)
          }}
        />
      ) : null}
      {editing ? (
        <AreaEditor
          area={editing.area}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
        />
      ) : null}
    </PageContent>
  )
}
