import { useId, useState, type ReactNode } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import type { Area } from '@domain/item'
import { InboxIcon, SearchIcon, XIcon } from '@/components/icons'
import { GapFilters } from '@/components/gaps/gap-filters'
import { CountBadge } from '@/components/item/item-marks'
import {
  ListError,
  ListMessage,
  ListNoResults,
  useDelayedFlag,
} from '@/components/library/list-state'
import {
  WorkbenchListBar,
  WorkbenchListBody,
  WorkbenchListFoot,
  WorkbenchListGroupHeading,
  WorkbenchListNote,
  WorkbenchListPane,
  workbenchRowClass,
  workbenchSearchClass,
  workbenchViewClass,
} from '@/components/page/workbench'
import { buttonVariants } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Kbd } from '@/components/ui/kbd'
import { Skeleton } from '@/components/ui/skeleton'
import { privacyNote } from '@/lib/gaps'
import type { WorkbenchSearch } from '@/lib/search-params'
import { cn } from '@/lib/utils'
import { workViews, type WorkViewId } from '@/lib/workbench'
import type { WorkListState } from './use-work-list'
import { WorkRow } from './work-row'

/*
  The Workbench's work list (Workbench plan, 3.2 and slice W5), the left pane: the views (All,
  Got worse, Gaps, Upkeep, Test questions, Runs) with their counts, the Gaps view's filters, the
  search, then the rows grouped by why they need the person, and the totals at its foot. The
  bar and the totals stay put while the rows scroll on their own; on a phone the page scrolls
  and the group headers stick under the shell's header.
*/

/** A view: ghost, the current one filled and bold, 28 high (44 on a phone). */
const viewClass = cn(
  buttonVariants({ variant: 'ghost', size: 'toolbar' }),
  'gap-1 px-2 font-normal text-muted-foreground aria-[current=page]:bg-muted aria-[current=page]:font-bold aria-[current=page]:text-foreground',
  workbenchViewClass,
)

/** What each view says when it has nothing, before any search. */
const emptyWords: Record<WorkViewId, { title: string; text: string }> = {
  all: {
    title: 'Nothing needs you right now',
    text: 'Every test question passes, every gap is closed, and every fact has a test question and is within its check date.',
  },
  worse: {
    title: 'Nothing got worse',
    text: 'Every test question that passed in the earlier run still passes in the newest one.',
  },
  gaps: {
    title: 'No gaps',
    text: 'When AI apps ask about a topic in your domains and find nothing, or report that something is missing, it shows here.',
  },
  upkeep: {
    title: 'No upkeep due',
    text: 'Every fact is within its check date and a test question covers it.',
  },
  questions: {
    title: 'No test questions yet',
    text: 'A test question asks what an AI app would be asked, and says what a good answer needs.',
  },
  runs: {
    title: 'No runs yet',
    text: 'A weekly run tests each domain every Monday morning. An owner can also start a full run of a domain at any time.',
  },
}

/** The note under the rows: how All is ranked, and the privacy rule wherever gaps show. */
function listNote(view: WorkViewId, minimum: number | null, gaps: boolean) {
  const notes = [
    view === 'all'
      ? 'Ranked like Fix next: what got worse first, then failing tests, open gaps, facts past their check date and facts no test question covers.'
      : null,
    gaps ? privacyNote(minimum) : null,
  ]
  return notes.filter(Boolean).join(' ')
}

export function WorkList({
  list,
  search,
  areas,
  hidden,
}: {
  list: WorkListState
  search: WorkbenchSearch
  /** The domains the person looks after, for the Gaps view's filters and the rows' domain names. */
  areas: readonly Area[]
  /** On a phone an open record takes the list's place. */
  hidden: boolean
}) {
  const navigate = useNavigate({ from: '/health' })
  const titleId = useId()
  const countId = useId()
  const { view, rows, entries, viewCounts, totals, state, setRegion, searchRef } = list
  const recordOpen = search.open !== undefined
  // Rows say their domain when the list spans more than one.
  const manyAreas = search.area === undefined && areas.length > 1
  const areaName = (id: string | null) =>
    manyAreas && id ? (areas.find((area) => area.id === id)?.name ?? null) : null

  const [query, setQuery] = useState(search.q ?? '')
  const [lastQ, setLastQ] = useState(search.q)
  if (lastQ !== search.q) {
    setLastQ(search.q)
    setQuery(search.q ?? '')
  }
  // A filter is a new entry; typing in the search replaces it (contract 9.11).
  const update = (patch: Partial<WorkbenchSearch>, replace = false) =>
    void navigate({
      to: '/health',
      search: (previous) => ({ ...previous, ...patch }),
      replace,
      resetScroll: false,
    })
  const changeQuery = (value: string) => {
    setQuery(value)
    update({ q: value.trim() ? value : undefined }, true)
  }
  const filtersOn =
    view === 'gaps' ? [search.status, search.type, search.origin].filter(Boolean) : []
  const clearAll = () => {
    setQuery('')
    update({ q: undefined, status: undefined, type: undefined, origin: undefined })
  }

  const showLoading = useDelayedFlag(state.state === 'pending')
  const gapsShown = view === 'gaps' || rows.some((row) => row.subject === 'gap')
  const note =
    state.state === 'ready' && rows.length > 0 ? listNote(view, list.minimum, gapsShown) : ''

  let body
  if (state.state === 'failed')
    body = (
      <ListError
        title="We couldn't load the work list"
        safe="Nothing is lost."
        error={state.error}
        onRetry={state.retry}
      />
    )
  else if (state.state === 'pending') body = showLoading ? <WorkListLoading /> : null
  else if (totals.total === 0)
    body = (
      <ListMessage icon={InboxIcon} title={emptyWords[view].title}>
        {emptyWords[view].text}
      </ListMessage>
    )
  else if (rows.length === 0)
    body = (
      <ListNoResults
        title="Nothing matches"
        description={
          query.trim()
            ? `Nothing in this view matches "${query.trim()}".`
            : 'Nothing in this view matches the filters.'
        }
        onClear={clearAll}
      />
    )
  else {
    const groups: { title: string | null; count: number; rows: typeof rows }[] = []
    for (const entry of entries)
      if (entry.type === 'group') groups.push({ title: entry.title, count: entry.count, rows: [] })
      else {
        if (groups.length === 0) groups.push({ title: null, count: 0, rows: [] })
        groups.at(-1)!.rows.push(entry.row)
      }
    body = groups.map((group, index) => (
      <WorkGroup key={group.title ?? index} title={group.title} count={group.count}>
        {group.rows.map((row) => (
          <WorkRow
            key={row.key}
            row={row}
            areaName={areaName(row.area)}
            search={row.open ? list.openSearch(row.open) : null}
            open={row.open !== null && row.open === search.open}
            replace={recordOpen}
          />
        ))}
      </WorkGroup>
    ))
  }

  return (
    <WorkbenchListPane
      aria-labelledby={titleId}
      hidden={hidden || undefined}
      inert={hidden || undefined}
    >
      <h2 id={titleId} className="sr-only">
        Work list
      </h2>
      <WorkbenchListBar>
        <nav aria-label="Work list views" className="flex flex-wrap gap-1">
          {workViews.map((candidate) => (
            <Link
              key={candidate.id}
              from="/health"
              to="/health"
              search={(previous) => ({
                ...previous,
                view: candidate.id === 'all' ? undefined : candidate.id,
                ...(candidate.id === 'gaps'
                  ? {}
                  : { status: undefined, type: undefined, origin: undefined }),
              })}
              resetScroll={false}
              // All has no `view`: without this, TanStack would also call it current on the
              // other views, whose address holds everything All's holds.
              activeOptions={{ explicitUndefined: true }}
              aria-current={candidate.id === view ? 'page' : undefined}
              className={viewClass}
            >
              {candidate.title}
              {viewCounts ? (
                <CountBadge
                  count={viewCounts[candidate.id]}
                  tone={candidate.id === 'worse' && viewCounts.worse > 0 ? 'attention' : 'quiet'}
                />
              ) : null}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {view === 'gaps' ? (
            <GapFilters
              search={{ status: search.status, type: search.type, origin: search.origin }}
              areas={areas}
              fields={['status', 'type', 'origin']}
              count={list.countGaps}
              activeCount={filtersOn.length}
              onSearch={(patch) =>
                update({
                  ...('status' in patch ? { status: patch.status } : {}),
                  ...('type' in patch ? { type: patch.type } : {}),
                  ...('origin' in patch ? { origin: patch.origin } : {}),
                })
              }
            />
          ) : null}
          <InputGroup className={workbenchSearchClass}>
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              ref={searchRef}
              type="text"
              value={query}
              onChange={(event) => changeQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && query) {
                  event.preventDefault()
                  event.stopPropagation()
                  changeQuery('')
                }
              }}
              // Beside the Gaps view's filter the list is narrower, so its word is shorter.
              placeholder={view === 'gaps' ? 'Search gaps' : 'Search the work list'}
              aria-label="Search the work list"
              aria-describedby={countId}
            />
            <InputGroupAddon align="inline-end">
              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    changeQuery('')
                    searchRef.current?.focus()
                  }}
                  aria-label="Clear the search"
                  className="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="size-4" />
                </button>
              ) : (
                <Kbd className="hidden font-mono @lg:inline-flex">/</Kbd>
              )}
            </InputGroupAddon>
          </InputGroup>
        </div>
      </WorkbenchListBar>
      <WorkbenchListBody ref={setRegion} aria-busy={state.state === 'pending' || undefined}>
        {body}
        {note || view === 'gaps' ? (
          <WorkbenchListNote data-slot="work-list-note">
            {note}
            {view === 'gaps' ? (
              <>
                {note ? ' ' : null}
                {/* The topic counts stay on the Gaps page (Workbench plan, section 9, Q6). */}
                <Link
                  to="/gaps"
                  search={{ view: 'topics' }}
                  className="text-brand-ink underline underline-offset-3"
                >
                  See what AI apps ask about, per week
                </Link>
              </>
            ) : null}
          </WorkbenchListNote>
        ) : null}
      </WorkbenchListBody>
      <WorkbenchListFoot id={countId} aria-live="polite" data-slot="work-list-totals">
        {state.state === 'ready' ? (
          <>
            <span>
              <span className="font-bold text-foreground">{totals.shown.toLocaleString('en')}</span>{' '}
              of {totals.total.toLocaleString('en')} shown
            </span>
            <span>{totals.worse.toLocaleString('en')} got worse</span>
            <span>
              {totals.openGaps.toLocaleString('en')} open {totals.openGaps === 1 ? 'gap' : 'gaps'}
            </span>
          </>
        ) : null}
      </WorkbenchListFoot>
    </WorkbenchListPane>
  )
}

/** A group of rows under its header ("Got worse", 3); a view without groups has no header. */
function WorkGroup({
  title,
  count,
  children,
}: {
  title: string | null
  count: number
  children: ReactNode
}) {
  const headingId = useId()
  if (title === null) return <ul className="flex flex-col">{children}</ul>
  return (
    <section aria-labelledby={headingId} data-slot="work-group">
      <WorkbenchListGroupHeading id={headingId}>
        <span className="min-w-0 truncate font-bold text-foreground">{title}</span>
        <span className="tabular-nums">{count.toLocaleString('en')}</span>
      </WorkbenchListGroupHeading>
      <ul className="flex flex-col">{children}</ul>
    </section>
  )
}

/** Rows that pulse while the list loads: the rows' own height, lines and glyph. */
function WorkListLoading() {
  return (
    <div role="status" aria-label="Loading the work list" className="flex flex-col">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className={workbenchRowClass}>
          <span className="flex h-5 shrink-0 items-center">
            <Skeleton className="size-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="flex h-5 items-center">
              <Skeleton className="h-4 w-3/4" />
            </span>
            <span className="flex h-4 items-center">
              <Skeleton className="h-3 w-1/2" />
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
