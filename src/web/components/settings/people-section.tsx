import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import type { PeopleSearchInput, PersonRow } from '@/api'
import { areasQuery, peoplePagesQuery } from '@/api/queries'
import {
  BadgeCheckIcon,
  ClockIcon,
  ListFilterIcon,
  LoaderCircleIcon,
  PlusIcon,
  UserRoundIcon,
  UsersIcon,
  XIcon,
} from '@/components/icons'
import { Owner } from '@/components/item/item-marks'
import { openRowClass, useDockMode } from '@/components/page/dock-panel'
import { gridCell, gridRowControl } from '@/components/page/grid'
import {
  GridFailed,
  GridHeaderCells,
  GridLoading,
  GridMessage,
  GridTable,
  gridRowClass,
  type GridColumn,
} from '@/components/page/grid-table'
import { PageContent } from '@/components/page/page'
import { SelectionBar, SelectionBarButton } from '@/components/page/selection-bar'
import { useDockList } from '@/components/page/use-dock-list'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { TruncatedText } from '@/components/ui/truncated-text'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { panelRowHistory } from '@/lib/history'
import {
  heldRoleName,
  lastSignInWords,
  personStatusWords,
  roleFilterWords,
  signInFilterWords,
  statusFilterWords,
} from '@/lib/roles'
import type { AdminSearch } from '@/lib/search-params'
import { cn } from '@/lib/utils'
import { GiveRolesDialog, RemoveFromPeopleDialog } from './role-dialogs'
import { PersonPanel } from './person-panel'
import { SettingsBlock } from './settings-parts'

const SLOT = 'settings-people'
const optional = '@max-3xl:hidden'

/** The columns after Person, whose header also holds the select-all box. */
const columns: GridColumn[] = [
  { icon: BadgeCheckIcon, title: 'Roles', className: 'w-column-about' },
  { icon: ClockIcon, title: 'Last sign-in', className: cn('w-column-until', optional) },
]

/** The address's filters as the search's own. */
function filtersOf(search: AdminSearch): Omit<PeopleSearchInput, 'offset' | 'limit'> {
  return {
    ...(search.q?.trim() ? { q: search.q.trim() } : {}),
    ...(search.role ? { role: search.role } : {}),
    ...(search.area ? { areaId: search.area } : {}),
    ...(search.status ? { status: search.status } : {}),
    ...(search.signedIn ? { signedIn: search.signedIn } : {}),
  }
}

/**
 * People (people and roles decision, option C, slice 1, 13 October 2026): everyone Heed knows,
 * found on the server by any part of the name or the email, a page at a time, filtered by role,
 * domain, whether they are still here and when they last signed in. Each row shows the roles the
 * person holds; it opens their sheet in the docked panel, with every role, its history, and the
 * way to give or remove one. Everyone signed in is a contributor and an analyst; the roles add to
 * that. The filters are in the address, so a list is linkable.
 */
export function PeopleSection({ search }: { search: AdminSearch }) {
  const navigate = useNavigate()
  const filters = useMemo(() => filtersOf(search), [search])
  const pages = useInfiniteQuery(peoplePagesQuery(filters))
  const { data: areas = [] } = useQuery(areasQuery())
  const [giving, setGiving] = useState<{ people: PersonRow[] } | null>(null)
  const [removing, setRemoving] = useState(false)
  // The people selected, as they were read: a selection outlives a new search or filter.
  const [selected, setSelected] = useState<ReadonlyMap<string, PersonRow>>(new Map())
  const chosen = [...selected.values()]
  const toggle = (rows: readonly PersonRow[], on: boolean) => {
    const next = new Map(selected)
    for (const row of rows) {
      if (on) next.set(row.id, row)
      else next.delete(row.id)
    }
    setSelected(next)
  }
  const clearSelection = () => setSelected(new Map())
  const people = useMemo(() => pages.data?.pages.flatMap((page) => page.people) ?? [], [pages.data])
  const first = pages.data?.pages[0]
  const total = first?.total ?? 0
  const readAt = first?.readAt ?? new Date().toISOString()
  const [region, setRegion] = useState<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const list: AdminSearch = { ...search, person: undefined }
  const ids = useMemo(() => people.map((person) => person.id), [people])
  const openId = search.person ?? null
  const dock = useDockList({
    region,
    ids,
    panelId: openId,
    open: (id) =>
      void navigate({
        to: '/admin',
        search: { ...list, person: id },
        replace: true,
        state: true,
        resetScroll: false,
      }),
    close: () => void navigate({ to: '/admin', search: list, replace: true, resetScroll: false }),
    searchRef,
    enabled: !pages.isPending,
  })
  const mode = useDockMode()
  // Escape clears the selection, once the panel and any dialog have had theirs.
  const busy = Boolean(giving || removing) || openId !== null
  useEffect(() => {
    if (selected.size === 0 || busy) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setSelected(new Map())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected.size, busy])
  // A filter is a new entry; the words typed replace the entry, so Back skips each key.
  const update = (patch: Partial<AdminSearch>, replace = false) =>
    void navigate({ to: '/admin', search: { ...search, ...patch }, replace, resetScroll: false })

  // The words go to the address once typing rests, so the search runs on words, not each key.
  const [text, setText] = useState(search.q ?? '')
  const words = useDebouncedValue(text)
  const typedRef = useRef(search.q ?? '')
  useEffect(() => {
    if (words === typedRef.current) return
    typedRef.current = words
    update({ q: words.trim() ? words : undefined }, true)
    // Only when the words settle; `update` reads the address it was made with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words])

  const filtered = Object.keys(filters).length > 0
  const areaName = (id: string) => areas.find((area) => area.id === id)?.name
  const go = (id: string | undefined) =>
    id
      ? () =>
          void navigate({
            to: '/admin',
            search: { ...list, person: id },
            replace: true,
            state: true,
            resetScroll: false,
          })
      : undefined
  const clear = () => {
    setText('')
    typedRef.current = ''
    update({
      q: undefined,
      role: undefined,
      area: undefined,
      status: undefined,
      signedIn: undefined,
    })
  }

  let body
  if (pages.isPending) body = <GridLoading slot={SLOT} label="Loading the people" />
  else if (pages.isError)
    body = <GridFailed slot={SLOT} what="the people" retry={() => void pages.refetch()} />
  else if (people.length === 0)
    body = (
      <GridMessage
        slot={SLOT}
        icon={filtered ? ListFilterIcon : UsersIcon}
        title={filtered ? 'Nobody matches' : 'Nobody has signed in yet'}
        action={
          filtered ? (
            <Button variant="outline" onClick={clear}>
              <XIcon aria-hidden />
              Clear filters
            </Button>
          ) : undefined
        }
      >
        {filtered
          ? 'Try part of the name or the email, or another role, domain or time.'
          : 'A person is listed here once they sign in for the first time.'}
      </GridMessage>
    )
  else
    body = (
      <div
        ref={setRegion}
        hidden={openId !== null && mode === 'full'}
        className="flex flex-col gap-3"
      >
        <GridTable
          slot={SLOT}
          label="People"
          header={
            <>
              <PersonHeader
                shown={people}
                selected={selected}
                selecting={selected.size > 0}
                onToggle={toggle}
              />
              <GridHeaderCells columns={columns} />
            </>
          }
        >
          {people.map((person) => (
            <PersonGridRow
              key={person.id}
              selected={selected.has(person.id)}
              selecting={selected.size > 0}
              onSelect={(on) => toggle([person], on)}
              person={person}
              open={person.id === openId}
              link={{ ...list, person: person.id }}
              panelOpen={openId !== null}
              roles={person.roles.map((held) => heldRoleName(held, areaName))}
              lastSignIn={lastSignInWords(person.lastSignedInAt, readAt)}
            />
          ))}
        </GridTable>
        {pages.hasNextPage ? (
          <Button
            variant="outline"
            className="w-fit"
            aria-disabled={pages.isFetchingNextPage || undefined}
            onClick={() => {
              if (!pages.isFetchingNextPage) void pages.fetchNextPage()
            }}
          >
            {pages.isFetchingNextPage ? (
              <LoaderCircleIcon aria-hidden className="motion-safe:animate-spin" />
            ) : null}
            Show more people
          </Button>
        ) : null}
        <p className="text-dense text-muted-foreground" role="status" data-slot="people-count">
          {people.length < total
            ? `${people.length.toLocaleString('en')} of ${total.toLocaleString('en')} people`
            : `${total.toLocaleString('en')} ${total === 1 ? 'person' : 'people'}`}
        </p>
      </div>
    )

  return (
    // While people are selected the page keeps room below its last row for the selection bar.
    <PageContent width="overview" className={cn('gap-8', selected.size > 0 && 'pb-16')}>
      <SettingsBlock
        title="People"
        slot="people-block"
        description="Everyone who has signed in. They can all read facts and suggest changes, and a role adds to that. Open a person to see their roles and history."
        action={
          <Button variant="outline" onClick={() => setGiving({ people: [] })}>
            <PlusIcon aria-hidden />
            Give a role
          </Button>
        }
      >
        {/* Every filter is 40 high, as the history log's are, so their labels share one line. */}
        <div
          className="grid grid-cols-2 items-end gap-3 @2xl:grid-cols-3 @5xl:flex @5xl:flex-wrap"
          data-slot="people-filters"
        >
          <Field
            name="q"
            className="col-span-2 min-w-0 @2xl:col-span-3 @5xl:min-w-column-about @5xl:flex-1"
          >
            <FieldLabel>Find a person</FieldLabel>
            <Input
              ref={searchRef}
              type="search"
              size="lg"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && text) {
                  event.stopPropagation()
                  setText('')
                }
              }}
              placeholder="Name or email"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field name="role" className="min-w-0 @5xl:w-column-owner">
            <FieldLabel>Role</FieldLabel>
            <NativeSelect
              size="lg"
              value={search.role ?? ''}
              onChange={(event) =>
                update({ role: (event.target.value || undefined) as AdminSearch['role'] })
              }
            >
              <NativeSelectOption value="">Any role</NativeSelectOption>
              {Object.entries(roleFilterWords).map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field name="area" className="min-w-0 @5xl:w-column-owner">
            <FieldLabel>Domain</FieldLabel>
            <NativeSelect
              size="lg"
              value={search.area ?? ''}
              onChange={(event) => update({ area: event.target.value || undefined })}
            >
              <NativeSelectOption value="">Every domain</NativeSelectOption>
              {[...areas]
                .sort((a, b) => a.name.localeCompare(b.name, 'en'))
                .map((area) => (
                  <NativeSelectOption key={area.id} value={area.id}>
                    {area.name}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          </Field>
          <Field name="status" className="min-w-0 @5xl:w-column-owner">
            <FieldLabel>Status</FieldLabel>
            <NativeSelect
              size="lg"
              value={search.status ?? 'active'}
              onChange={(event) =>
                update({
                  status:
                    event.target.value === 'active'
                      ? undefined
                      : (event.target.value as AdminSearch['status']),
                })
              }
            >
              {Object.entries(statusFilterWords).map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field name="signedIn" className="min-w-0 @5xl:w-column-owner">
            <FieldLabel>Last sign-in</FieldLabel>
            <NativeSelect
              size="lg"
              value={search.signedIn ?? ''}
              onChange={(event) =>
                update({
                  signedIn: (event.target.value || undefined) as AdminSearch['signedIn'],
                })
              }
            >
              <NativeSelectOption value="">Any time</NativeSelectOption>
              {Object.entries(signInFilterWords).map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </div>
        {body}
      </SettingsBlock>
      {chosen.length ? (
        <SelectionBar count={chosen.length} label="Selected people" onClear={clearSelection}>
          <SelectionBarButton onClick={() => setGiving({ people: chosen })}>
            <PlusIcon />
            Give a role
          </SelectionBarButton>
          <SelectionBarButton onClick={() => setRemoving(true)}>
            <XIcon />
            Remove a role
          </SelectionBarButton>
        </SelectionBar>
      ) : null}
      {giving ? (
        <GiveRolesDialog
          open
          onOpenChange={(open) => {
            if (!open) setGiving(null)
          }}
          initial={{
            people: giving.people,
            role: giving.people.length > 1 ? 'approver' : 'owner',
          }}
          // Giving the selected people a role is done with them: the selection goes.
          onGiven={giving.people.length ? clearSelection : undefined}
        />
      ) : null}
      {removing ? (
        <RemoveFromPeopleDialog
          open
          onOpenChange={setRemoving}
          people={chosen}
          onRemoved={clearSelection}
        />
      ) : null}
      {openId !== null ? (
        <PersonPanel
          key={openId}
          id={openId}
          loaded={people.find((person) => person.id === openId)}
          position={dock.position}
          onPrevious={go(dock.previousId)}
          onNext={go(dock.nextId)}
          onClose={dock.closePanel}
        />
      ) : null}
    </PageContent>
  )
}

/** One person in the list: the name and the address, the roles they hold and their last sign-in. */
function PersonGridRow({
  person,
  selected,
  selecting,
  onSelect,
  open,
  link,
  panelOpen,
  roles,
  lastSignIn,
}: {
  person: PersonRow
  selected: boolean
  /** Whether anyone is selected: the boxes then show on every row. */
  selecting: boolean
  onSelect: (on: boolean) => void
  open: boolean
  link: AdminSearch
  panelOpen: boolean
  roles: string[]
  lastSignIn: string
}) {
  const roleText = roles.length ? roles.join(', ') : 'No role'
  return (
    <div
      role="row"
      data-row-id={person.id}
      data-person={person.id}
      data-open={open || undefined}
      aria-selected={selected}
      className={cn(gridRowClass, openRowClass, 'group/row')}
    >
      {/* The box sits in the person's cell, so on a phone, where the first cell is the row's
          title, the person still is. It lies over the row's link, which covers the row. */}
      <div role="cell" className={cn(gridCell, 'min-w-0 flex-1 gap-2')}>
        <Checkbox
          checked={selected}
          onCheckedChange={(on) => onSelect(on)}
          aria-label={`Select ${person.name}`}
          className={cn('z-raised', !selected && !selecting && gridRowControl)}
        />
        <Link
          to="/admin"
          search={link}
          {...panelRowHistory(panelOpen)}
          resetScroll={false}
          data-row-link
          className="flex min-w-0 shrink-0 items-center gap-2 text-body outline-none after:absolute after:inset-0"
        >
          <Owner name={person.name} initials={person.initials} size="md" />
        </Link>
        {person.email ? (
          <TruncatedText text={person.email} className="text-muted-foreground" />
        ) : null}
        {person.status !== 'active' ? (
          <Badge form="outline" size="sm" icon={XIcon} quiet>
            {personStatusWords[person.status]}
          </Badge>
        ) : null}
      </div>
      <div role="cell" className={cn(gridCell, 'w-column-about')}>
        <TruncatedText text={roleText} className={cn(!roles.length && 'text-muted-foreground')} />
      </div>
      <div role="cell" className={cn(gridCell, 'w-column-until tabular-nums', optional)}>
        <span className={cn('truncate', person.lastSignedInAt ? '' : 'text-muted-foreground')}>
          {lastSignIn}
        </span>
      </div>
    </div>
  )
}

/** The Person column's header: the box that selects every person shown, or clears them. */
function PersonHeader({
  shown,
  selected,
  selecting,
  onToggle,
}: {
  shown: readonly PersonRow[]
  selected: ReadonlyMap<string, PersonRow>
  selecting: boolean
  onToggle: (rows: readonly PersonRow[], on: boolean) => void
}) {
  const on = shown.filter((person) => selected.has(person.id)).length
  const all = on > 0 && on === shown.length
  return (
    <div role="columnheader" className={cn(gridCell, 'min-w-0 flex-1 gap-2')}>
      <Checkbox
        checked={all}
        indeterminate={on > 0 && !all}
        onCheckedChange={() => onToggle(shown, on === 0)}
        aria-label={on ? 'Clear the selection of the people shown' : 'Select every person shown'}
        className={cn(!selecting && gridRowControl)}
      />
      <UserRoundIcon aria-hidden="true" className="size-icon-sm shrink-0" />
      <span className="truncate">Person</span>
    </div>
  )
}
