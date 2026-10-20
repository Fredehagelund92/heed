import { useMemo, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { Area } from '@domain/item'
import { itemKinds } from '@domain/item'
import { itemDisplayStatuses } from '@domain/status'
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  EllipsisIcon,
  EyeIcon,
  ListTreeIcon,
  PlusIcon,
  Rows3Icon,
  SearchIcon,
  SigmaIcon,
  SplitIcon,
  Table2Icon,
  XIcon,
  type Icon,
} from '@/components/icons'
import { DomainBadge, KindMark, KindIcon, StatusMark } from '@/components/item/item-marks'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { FilterMenu, type FilterMenuField } from '@/components/page/filter-menu'
import { PageToolbar } from '@/components/page/page'
import { PageToolbarDivider, toolbarCount, toolbarSearchSlot } from '@/components/page/toolbar'
import {
  aboutChoices,
  aboutKeys,
  attentionInMyDomains,
  filtersOf,
  groupOptions,
  kindNames,
  libraryViews,
  sortOptions,
  statusNames,
  toggleIn,
  type LibraryGroup,
  type LibraryRow,
  type LibrarySort,
  type LibraryViewer,
  type SortState,
} from '@/lib/library'
import { filterCounter, filterChoicePatch } from '@/lib/library-search'
import { draftsLink } from '@/lib/my-drafts'
import { isDensity, type Density } from '@/lib/preferences'
import type { LibrarySearch } from '@/lib/search-params'
import { useMyDrafts } from '@/lib/use-my-drafts'
import { usePermissions } from '@/lib/use-session'
import { cn } from '@/lib/utils'
import { columnIds, columnSpecs, type ColumnId } from './columns'
import { fieldIcons } from './item-list'

/*
  The library's action bar (the Reference bar, direction A of design round 2). Every control that
  shapes the list is a visible button, so nothing about the list's state is hidden:

    View | Filter (count)  Sort: field  Group  Display        search   57 of 1,404 items

  Filter, Sort, Group and Display each open their own menu. Filters, sort and grouping live in
  the URL; density and columns are personal and kept in this browser. While a filter is on, a
  second row shows each one as a removable chip. On a phone, Sort, Group and density fold into
  one menu and the search field opens from a button. Under the views, the View menu goes to the
  places beside the list: Drafts while the person has some, and for an administrator Deleted
  items, the items moved out of the library (the Bin page).
*/

const sortDirections: Record<LibrarySort, { asc: string; desc: string }> = {
  updated: { desc: 'Newest first', asc: 'Oldest first' },
  title: { asc: 'A to Z', desc: 'Z to A' },
  start: { desc: 'Latest first', asc: 'Earliest first' },
  until: { asc: 'Soonest first', desc: 'Latest first' },
  status: { asc: 'Most urgent first', desc: 'Least urgent first' },
  domain: { asc: 'A to Z', desc: 'Z to A' },
  owner: { asc: 'A to Z', desc: 'Z to A' },
}

const densities: { id: Density; title: string }[] = [
  { id: 'compact', title: 'Compact' },
  { id: 'comfortable', title: 'Comfortable' },
  { id: 'scope', title: 'Where it applies' },
]

/** A field's own direction first: newest first for dates, A to Z for names. */
function directionOrder(sort: LibrarySort): ('asc' | 'desc')[] {
  const first = sortOptions.find((option) => option.id === sort)?.defaultDir ?? 'asc'
  return first === 'asc' ? ['asc', 'desc'] : ['desc', 'asc']
}

/** What a sort reads as: "Last checked, newest first", or the best match while searching. */
function describeSort(sortState: SortState) {
  if (sortState.sort === 'relevance') return { field: 'Best match', direction: null }
  const field = sortOptions.find((option) => option.id === sortState.sort)?.title ?? 'Last checked'
  return { field, direction: sortDirections[sortState.sort][sortState.dir] }
}

/** The sort choices as menu groups: the field, then its direction. Shared by Sort and the phone menu. */
function SortItems({
  search,
  sortState,
  onSearch,
}: {
  search: LibrarySearch
  sortState: SortState
  onSearch: (patch: Partial<LibrarySearch>) => void
}) {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={sortState.sort}
          onValueChange={(value: LibrarySort) =>
            onSearch({ sort: value === 'updated' && !search.q ? undefined : value, dir: undefined })
          }
        >
          {sortOptions.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.id}>
              {option.title}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      {sortState.sort === 'relevance' ? (
        <p className="px-2 py-1 text-caption text-muted-foreground">
          Best match first while you search
        </p>
      ) : (
        <DropdownMenuGroup>
          <DropdownMenuLabel className="sr-only">Order</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={sortState.dir}
            onValueChange={(value: 'asc' | 'desc') => onSearch({ dir: value })}
          >
            {directionOrder(sortState.sort).map((dir) => (
              <DropdownMenuRadioItem key={dir} value={dir}>
                {dir === 'asc' ? <ArrowUpIcon /> : <ArrowDownIcon />}
                {sortDirections[sortState.sort][dir]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      )}
    </>
  )
}

function GroupItems({
  search,
  onSearch,
}: {
  search: LibrarySearch
  onSearch: (patch: Partial<LibrarySearch>) => void
}) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>Group by</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={search.group ?? 'none'}
        onValueChange={(value: string) =>
          onSearch({ group: value === 'none' ? undefined : (value as LibraryGroup) })
        }
      >
        <DropdownMenuRadioItem value="none">None</DropdownMenuRadioItem>
        {groupOptions.map((option) => (
          <DropdownMenuRadioItem key={option.id} value={option.id}>
            {option.title}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  )
}

/**
 * The view switch: All items, Mine, Needs a look (the same views the sidebar lists). For an
 * owner or deputy, Needs a look starts with their own domains, and the menu's Domains group
 * widens it to every domain; the button says which (A8). While the person has drafts they have
 * not submitted, which the library does not list, the menu ends with Drafts, as the sidebar does:
 * it opens Proposals > Mine on the drafts.
 */
function ViewMenu({
  search,
  viewer,
  onSearch,
}: {
  search: LibrarySearch
  viewer: LibraryViewer
  onSearch: (patch: Partial<LibrarySearch>) => void
}) {
  const view = search.view ?? 'all'
  const scoped = view === 'attention' && viewer.areaIds.length > 0
  const domains = attentionInMyDomains(viewer, search.domains === 'all') ? 'mine' : 'all'
  const viewTitle = libraryViews.find((candidate) => candidate.id === view)?.title ?? 'All facts'
  const scope = scoped ? (domains === 'mine' ? 'My domains' : 'All domains') : null
  const title = scope ? `${viewTitle} · ${scope}` : viewTitle
  const drafts = useMyDrafts()?.length ?? 0
  // The facts moved out of the library: an admin's, one step away (not a sidebar place).
  const { isAdmin } = usePermissions()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="toolbar"
            aria-label={`View: ${title}`}
            className="min-w-0 shrink @max-2xl:h-control-touch"
          />
        }
      >
        <Table2Icon aria-hidden="true" className="@max-2xl:hidden" />
        <span className="truncate">
          {viewTitle}
          {/* On a phone the bar keeps one row: the menu says which domains. */}
          {scope ? <span className="@max-2xl:hidden"> · {scope}</span> : null}
        </span>
        <ChevronDownIcon aria-hidden="true" className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-menu">
        <DropdownMenuGroup>
          <DropdownMenuLabel>View</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={view}
            onValueChange={(value: string) =>
              onSearch({
                view: value === 'all' ? undefined : (value as LibrarySearch['view']),
                domains: undefined,
              })
            }
          >
            {libraryViews.map((candidate) => (
              <DropdownMenuRadioItem key={candidate.id} value={candidate.id} closeOnClick>
                {candidate.title}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {scoped ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Domains</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={domains}
                onValueChange={(value: string) =>
                  onSearch({ domains: value === 'all' ? 'all' : undefined })
                }
              >
                <DropdownMenuRadioItem value="mine" closeOnClick>
                  My domains
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="all" closeOnClick>
                  All domains
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </>
        ) : null}
        {drafts || isAdmin ? <DropdownMenuSeparator /> : null}
        {drafts ? (
          <DropdownMenuItem
            render={<Link {...draftsLink} />}
            data-slot="library-drafts"
            title="Drafts you haven't sent yet"
          >
            Drafts
            <span className="ml-auto text-caption text-muted-foreground tabular-nums">
              {drafts.toLocaleString('en')}
            </span>
          </DropdownMenuItem>
        ) : null}
        {isAdmin ? (
          <DropdownMenuItem
            render={<Link to="/library/bin" />}
            data-slot="library-deleted-items"
            title="Facts moved out of the library, to restore"
          >
            Deleted facts
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The library's Filter menu (the list pages' one menu, `components/page/filter-menu.tsx`): kind,
 * domain, about, status and ended issues, each value drawn as it reads in the table, with the
 * number of items the list would show after clicking it. Domain and About take one value each (the
 * list follows one domain, and one metric or value, at a time; FR-128).
 */
function LibraryFilterMenu({
  search,
  areas,
  rows,
  viewer,
  activeCount,
  open,
  onOpenChange,
  onSearch,
}: {
  search: LibrarySearch
  areas: Area[]
  rows: LibraryRow[]
  viewer: LibraryViewer
  activeCount: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onSearch: (patch: Partial<LibrarySearch>) => void
}) {
  const filters = filtersOf(search)
  // Counted only while the menu is open: one filter pass per value.
  const count = useMemo(
    () => (open ? filterCounter(rows, search, viewer) : () => 0),
    [open, rows, search, viewer],
  )
  const about = useMemo(() => aboutChoices(rows), [rows])
  const fields: FilterMenuField[] = [
    {
      id: 'kind',
      title: 'Kind',
      icon: fieldIcons.kind,
      on: filters.kinds.length,
      options: itemKinds.map((kind) => ({
        key: kind,
        name: kindNames[kind],
        checked: filters.kinds.includes(kind),
        count: count({ facet: 'kind', value: kind }),
        onChange: () => onSearch(filterChoicePatch(search, { facet: 'kind', value: kind })),
        children: <KindMark kind={kind} className="text-foreground" />,
      })),
    },
    ...(areas.length < 2
      ? []
      : [
          {
            id: 'area',
            title: 'Domain',
            icon: fieldIcons.domain,
            on: filters.area ? 1 : 0,
            options: areas.map((area) => ({
              key: area.id,
              name: area.name,
              checked: filters.area === area.id,
              count: count({ facet: 'area', value: area.id }),
              onChange: () =>
                onSearch(filterChoicePatch(search, { facet: 'area', value: area.id })),
              children: <DomainBadge name={area.name} label={area.label} size="sm" />,
            })),
          },
        ]),
    {
      id: 'about',
      title: 'About',
      icon: fieldIcons.about,
      on: filters.about ? 1 : 0,
      options: about.map((choice) => ({
        key: choice.key,
        name: choice.name,
        checked: filters.about === choice.key,
        count: count({ facet: 'about', value: choice.key }),
        onChange: () => onSearch(filterChoicePatch(search, { facet: 'about', value: choice.key })),
        children: (
          <span className="inline-flex min-w-0 items-center gap-2">
            {choice.kind === 'metric' ? (
              <SigmaIcon aria-hidden className="size-icon-sm shrink-0 text-muted-foreground" />
            ) : choice.kind === 'dimension' ? (
              <SplitIcon aria-hidden className="size-icon-sm shrink-0 text-muted-foreground" />
            ) : (
              // A value has no mark (as in its chip); the space keeps the names in one column.
              <span aria-hidden className="size-icon-sm shrink-0" />
            )}
            <span className="truncate">{choice.name}</span>
          </span>
        ),
      })),
      note: 'A metric, a market or another name the facts are about. One at a time.',
    },
    {
      id: 'status',
      title: 'Status',
      icon: fieldIcons.status,
      on: filters.statuses.length,
      options: itemDisplayStatuses.map((status) => ({
        key: status,
        name: statusNames[status],
        checked: filters.statuses.includes(status),
        count: count({ facet: 'status', value: status }),
        onChange: () => onSearch(filterChoicePatch(search, { facet: 'status', value: status })),
        children: <StatusMark status={status} className="text-foreground" />,
      })),
    },
    {
      id: 'ended',
      title: 'Ended issues',
      icon: EyeIcon,
      on: filters.endedIssues ? 1 : 0,
      options: [
        {
          key: 'ended',
          name: 'Show ended issues',
          checked: filters.endedIssues,
          count: count({ facet: 'ended' }),
          onChange: () => onSearch(filterChoicePatch(search, { facet: 'ended' })),
          children: (
            <span className="inline-flex min-w-0 items-center gap-2">
              <KindIcon kind="issue" decorative />
              <span className="truncate">Show ended issues</span>
            </span>
          ),
        },
      ],
      note: 'An issue whose last day has passed is history, so the list leaves it out.',
    },
  ]
  return (
    <FilterMenu fields={fields} activeCount={activeCount} open={open} onOpenChange={onOpenChange} />
  )
}

function SortMenu({
  search,
  sortState,
  onSearch,
}: {
  search: LibrarySearch
  sortState: SortState
  onSearch: (patch: Partial<LibrarySearch>) => void
}) {
  const { field, direction } = describeSort(sortState)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="toolbar"
            aria-label={`Sort: ${field}${direction ? `, ${direction.toLowerCase()}` : ''}`}
            className="min-w-0 shrink @max-2xl:hidden"
          />
        }
      >
        <ArrowUpDownIcon aria-hidden="true" />
        Sort
        <span className="truncate font-normal text-muted-foreground @max-4xl:hidden">{field}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-menu">
        <SortItems search={search} sortState={sortState} onSearch={onSearch} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function GroupMenu({
  search,
  onSearch,
}: {
  search: LibrarySearch
  onSearch: (patch: Partial<LibrarySearch>) => void
}) {
  const group = groupOptions.find((option) => option.id === search.group)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size={group ? 'toolbar' : 'icon-toolbar'}
            aria-label={group ? `Grouped by ${group.title}` : 'Group by'}
            title={group ? undefined : 'Group by'}
            className={cn('shrink-0 @max-2xl:hidden', group && 'border-ring bg-selected')}
          />
        }
      >
        <ListTreeIcon aria-hidden="true" />
        {group ? <span className="@max-4xl:hidden">{group.title}</span> : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-menu">
        <GroupItems search={search} onSearch={onSearch} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={label}>
      <span className="text-caption font-bold text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

/** Display: how the rows look (density) and which columns show, with what does not fit. */
function DisplayMenu({
  density,
  chosenColumns,
  droppedColumns,
  onDensity,
  onColumns,
}: {
  density: Density
  chosenColumns: ColumnId[]
  droppedColumns: ColumnId[]
  onDensity: (density: Density) => void
  onColumns: (columns: ColumnId[]) => void
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-toolbar"
            aria-label="Density and columns"
            title="Density and columns"
            className="shrink-0 @max-2xl:hidden"
          />
        }
      >
        <Rows3Icon aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionAvoidance={{ side: 'none', align: 'shift', fallbackAxisSide: 'none' }}
        collisionPadding={16}
        className="w-dialog gap-4 p-4"
      >
        <h2 className="text-dense font-bold">Display</h2>
        <Section label="Density">
          <ToggleGroup
            value={[density]}
            onValueChange={(value: string[]) => {
              const next = value[0]
              if (next && isDensity(next)) onDensity(next)
            }}
          >
            {densities.map((option) => (
              <ToggleGroupItem key={option.id} value={option.id} size="sm">
                {option.title}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Section>
        <Section label="Columns">
          {columnIds.map((column) => {
            const Glyph = fieldIcons[column]
            return (
              <Toggle
                key={column}
                size="sm"
                pressed={chosenColumns.includes(column)}
                onPressedChange={() => onColumns(toggleIn(chosenColumns, column))}
                title={
                  droppedColumns.includes(column) ? 'Not enough room at this width' : undefined
                }
              >
                <Glyph aria-hidden="true" className="size-icon-sm" />
                {columnSpecs[column].title}
              </Toggle>
            )
          })}
        </Section>
        {droppedColumns.length > 0 ? (
          <p className="text-caption text-muted-foreground">
            Some columns don't fit at this width:{' '}
            {droppedColumns.map((column) => columnSpecs[column].title).join(', ')}. You can still
            sort and filter by them, and the fact's page shows everything.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

/** On a phone, Sort, Group and density fold into one menu (the narrow rows have no columns). */
function PhoneMenu({
  search,
  sortState,
  density,
  onSearch,
  onDensity,
}: {
  search: LibrarySearch
  sortState: SortState
  density: Density
  onSearch: (patch: Partial<LibrarySearch>) => void
  onDensity: (density: Density) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-touch"
            aria-label="Sort, group and density"
            className="shrink-0 @2xl:hidden"
          />
        }
      >
        <EllipsisIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-menu">
        <SortItems search={search} sortState={sortState} onSearch={onSearch} />
        <DropdownMenuSeparator />
        <GroupItems search={search} onSearch={onSearch} />
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Density</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={density}
            onValueChange={(value: string) => {
              if (isDensity(value)) onDensity(value)
            }}
          >
            {densities.map((option) => (
              <DropdownMenuRadioItem key={option.id} value={option.id}>
                {option.title}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type Chip = {
  key: string
  /** Names the chip for assistive technology: "Kind: Event, Note". */
  text: string
  field: string
  icon: Icon
  values: ReactNode[]
  clear: Partial<LibrarySearch>
}

/** Up to two values as they read in the table, then "+2" for the rest. */
function ChipValues({ values }: { values: ReactNode[] }) {
  const shown = values.slice(0, 2)
  return (
    <>
      {shown.map((value, index) => (
        <span key={index} className="inline-flex min-w-0 items-center">
          {value}
        </span>
      ))}
      {values.length > 2 ? (
        <span className="text-muted-foreground tabular-nums">+{values.length - 2}</span>
      ) : null}
    </>
  )
}

/**
 * The filters that are on, as removable chips ("Domain is Commercial"), then Add filter and Clear
 * all. In a narrow bar the quiet line on the right says how many ended issues the list leaves out,
 * with Show them one click away (requirements 4.4); a wider bar says it in the toolbar. The row
 * shows when either has something to say.
 */
function AppliedFilters({
  search,
  rows,
  areas,
  hiddenIssues,
  onSearch,
  onAddFilter,
}: {
  search: LibrarySearch
  rows: LibraryRow[]
  areas: Area[]
  /** Ended issues that match the list but are left out of it. */
  hiddenIssues: number
  onSearch: (patch: Partial<LibrarySearch>) => void
  onAddFilter: () => void
}) {
  const filters = filtersOf(search)
  const aboutName = useMemo(() => {
    if (!filters.about) return null
    for (const row of rows) {
      const index = aboutKeys(row.scope).indexOf(filters.about)
      if (index !== -1) return row.about[index] ?? filters.about
    }
    return filters.about
  }, [filters.about, rows])
  const chips: Chip[] = []
  if (filters.kinds.length)
    chips.push({
      key: 'kind',
      text: `Kind: ${filters.kinds.map((kind) => kindNames[kind]).join(', ')}`,
      field: 'Kind',
      icon: fieldIcons.kind,
      values: filters.kinds.map((kind) => (
        <KindMark key={kind} kind={kind} className="text-foreground" />
      )),
      clear: { kind: undefined },
    })
  const area = filters.area ? areas.find((candidate) => candidate.id === filters.area) : undefined
  if (filters.area)
    chips.push({
      key: 'area',
      text: `Domain: ${area?.name ?? 'Unknown domain'}`,
      field: 'Domain',
      icon: fieldIcons.domain,
      values: [
        area ? (
          <DomainBadge key="area" name={area.name} label={area.label} form="bare" />
        ) : (
          'Unknown domain'
        ),
      ],
      clear: { area: undefined },
    })
  if (filters.statuses.length)
    chips.push({
      key: 'status',
      text: `Status: ${filters.statuses.map((status) => statusNames[status]).join(', ')}`,
      field: 'Status',
      icon: fieldIcons.status,
      values: filters.statuses.map((status) => (
        <StatusMark key={status} status={status} className="text-foreground" />
      )),
      clear: { status: undefined },
    })
  if (filters.about && aboutName)
    chips.push({
      key: 'about',
      text: `About: ${aboutName}`,
      field: 'About',
      icon: fieldIcons.about,
      values: [aboutName],
      clear: { about: undefined },
    })
  if (filters.endedIssues)
    chips.push({
      key: 'ended',
      text: 'Ended issues shown',
      field: 'Ended issues',
      icon: EyeIcon,
      values: ['shown'],
      clear: { ended: undefined },
    })
  if (chips.length === 0 && hiddenIssues === 0) return null
  return (
    <div
      role="group"
      aria-label={chips.length > 0 ? 'Filters on' : 'Hidden facts'}
      className={cn(
        'flex flex-wrap items-center gap-2 border-b px-gutter py-2',
        chips.length === 0 && '@2xl:hidden',
      )}
    >
      {chips.map((chip) => (
        <Button
          key={chip.key}
          variant="outline"
          size="sm"
          data-slot="filter-chip"
          onClick={() => onSearch(chip.clear)}
          aria-label={`Remove filter ${chip.text}`}
          className="max-w-full min-w-0 gap-2 font-normal pointer-coarse:h-control-touch"
        >
          <chip.icon aria-hidden="true" className="size-icon-sm text-muted-foreground" />
          <span className="font-bold">{chip.field}</span>
          <span className="text-muted-foreground">
            {chip.values.length > 1 ? 'is any of' : 'is'}
          </span>
          <ChipValues values={chip.values} />
          <XIcon aria-hidden="true" className="size-icon-sm text-muted-foreground" />
        </Button>
      ))}
      {chips.length > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={onAddFilter}
          className="pointer-coarse:h-control-touch"
        >
          <PlusIcon aria-hidden="true" />
          Add filter
        </Button>
      ) : null}
      {chips.length > 1 ? (
        <Button
          variant="ghost"
          size="sm"
          className="pointer-coarse:h-control-touch"
          onClick={() =>
            onSearch({
              kind: undefined,
              status: undefined,
              area: undefined,
              about: undefined,
              ended: undefined,
            })
          }
        >
          Clear all
        </Button>
      ) : null}
      {hiddenIssues > 0 ? (
        <p
          data-slot="hidden-ended-issues-narrow"
          className="ml-auto flex min-h-control-sm items-center gap-2 text-caption text-muted-foreground @2xl:hidden"
        >
          <EyeIcon aria-hidden="true" className="size-icon-sm shrink-0" />
          {hiddenIssues === 1
            ? '1 ended issue is hidden.'
            : `${hiddenIssues.toLocaleString('en')} ended issues are hidden.`}
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0 text-caption text-foreground underline"
            onClick={() => onSearch({ ended: 'show' })}
          >
            Show {hiddenIssues === 1 ? 'it' : 'them'}
          </Button>
        </p>
      ) : null}
    </div>
  )
}

/**
 * The bar above the library table and its applied filters row. `searchField` is the page's
 * search input: inline on a wide screen, behind a button on a phone (open while it holds a query).
 */
export function LibraryBar({
  search,
  areas,
  rows,
  viewer,
  sortState,
  density,
  chosenColumns,
  droppedColumns,
  activeCount,
  shown,
  total,
  pending,
  hiddenIssues,
  searchField,
  searchOpen,
  onSearchOpen,
  onSearch,
  onDensity,
  onColumns,
}: {
  search: LibrarySearch
  areas: Area[]
  /** Every row of the library, for the counts in the Filter menu and the About chip's name. */
  rows: LibraryRow[]
  /** Who reads the list, for Mine and for Needs a look in the person's domains. */
  viewer: LibraryViewer
  sortState: SortState
  density: Density
  chosenColumns: ColumnId[]
  droppedColumns: ColumnId[]
  activeCount: number
  /** Rows the list shows, and rows in the view before the search and the filters. */
  shown: number
  total: number
  pending: boolean
  hiddenIssues: number
  searchField: ReactNode
  searchOpen: boolean
  onSearchOpen: (open: boolean) => void
  onSearch: (patch: Partial<LibrarySearch>) => void
  onDensity: (density: Density) => void
  onColumns: (columns: ColumnId[]) => void
}) {
  const [filterOpen, setFilterOpen] = useState(false)
  const narrowed = activeCount > 0 || Boolean(search.q?.trim())
  return (
    <>
      <PageToolbar role="search" aria-label="Library" className="flex-wrap gap-y-2">
        <ViewMenu search={search} viewer={viewer} onSearch={onSearch} />
        <PageToolbarDivider />
        <LibraryFilterMenu
          search={search}
          areas={areas}
          rows={rows}
          viewer={viewer}
          activeCount={activeCount}
          open={filterOpen}
          onOpenChange={setFilterOpen}
          onSearch={onSearch}
        />
        <SortMenu search={search} sortState={sortState} onSearch={onSearch} />
        <GroupMenu search={search} onSearch={onSearch} />
        <DisplayMenu
          density={density}
          chosenColumns={chosenColumns}
          droppedColumns={droppedColumns}
          onDensity={onDensity}
          onColumns={onColumns}
        />
        <PhoneMenu
          search={search}
          sortState={sortState}
          density={density}
          onSearch={onSearch}
          onDensity={onDensity}
        />
        <Button
          variant="ghost"
          size="icon-touch"
          aria-label="Search the library"
          aria-expanded={searchOpen}
          onClick={() => onSearchOpen(!searchOpen)}
          className={cn('ml-auto @2xl:hidden', searchOpen && 'bg-muted')}
        >
          <SearchIcon aria-hidden="true" />
        </Button>
        <div className={cn(toolbarSearchSlot, !searchOpen && '@max-2xl:hidden')}>
          {hiddenIssues > 0 ? (
            // A note goes into the toolbar, never a band of its own (the professional pass, rule
            // 6). On a phone the line under the bar says it (AppliedFilters).
            <Button
              variant="ghost"
              size="toolbar"
              data-slot="hidden-ended-issues"
              onClick={() => onSearch({ ended: 'show' })}
              title={
                hiddenIssues === 1
                  ? '1 ended issue is hidden. Show it'
                  : `${hiddenIssues.toLocaleString('en')} ended issues are hidden. Show them`
              }
              className="text-caption font-normal text-muted-foreground @max-2xl:hidden"
            >
              <EyeIcon aria-hidden="true" className="size-icon-sm" />
              {/* Beside a docked panel or on a tablet the bar is tighter: the number says it. */}
              <span className="@max-5xl:hidden">
                {hiddenIssues === 1
                  ? '1 ended issue hidden'
                  : `${hiddenIssues.toLocaleString('en')} ended issues hidden`}
              </span>
              <span className="@5xl:hidden">{hiddenIssues.toLocaleString('en')} hidden</span>
              <span className="font-bold text-foreground underline underline-offset-4">Show</span>
            </Button>
          ) : null}
          {searchField}
        </div>
        <span id="library-count" aria-live="polite" className={toolbarCount}>
          {pending ? (
            ''
          ) : narrowed ? (
            <>
              <span className="font-bold text-foreground">{shown.toLocaleString('en')}</span> of{' '}
              {total.toLocaleString('en')} {total === 1 ? 'fact' : 'facts'}
            </>
          ) : (
            `${shown.toLocaleString('en')} ${shown === 1 ? 'fact' : 'facts'}`
          )}
        </span>
      </PageToolbar>
      <AppliedFilters
        search={search}
        rows={rows}
        areas={areas}
        hiddenIssues={hiddenIssues}
        onSearch={onSearch}
        onAddFilter={() => setFilterOpen(true)}
      />
    </>
  )
}
