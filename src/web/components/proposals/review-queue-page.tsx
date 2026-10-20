import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { areasQuery, peopleQuery, proposalListQuery } from '@/api/queries'
import { HelpLink } from '@/components/help/help-link'
import { SearchIcon, XIcon } from '@/components/icons'
import { RiskBadge } from '@/components/item/fact-badges'
import { DomainBadge } from '@/components/item/item-marks'
import {
  ListEmpty,
  ListError,
  ListLoading,
  ListNoResults,
  ListStale,
  useDelayedFlag,
} from '@/components/library/list-state'
import { useDockMode } from '@/components/page/dock-panel'
import { Page, PageToolbar } from '@/components/page/page'
import {
  PageToolbarDivider,
  toolbarCount,
  toolbarSearchField,
  toolbarSearchSlot,
} from '@/components/page/toolbar'
import { dockFitWidth } from '@/components/page/use-dock-list'
import { useProposalViews } from './use-proposal-views'
import { ViewChips } from './view-chips'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Kbd } from '@/components/ui/kbd'
import { useElementHeight, useElementWidth } from '@/hooks/use-element-size'
import { useMediaQuery } from '@/hooks/use-media-query'
import { queryTerms } from '@/lib/library'
import { listDecisionWords, undecidableSummary } from '@/lib/permissions'
import { formatCount } from '@/lib/library'
import { MINE, mineProposals } from '@/lib/my-drafts'
import {
  claimFilterNames,
  groupQueueRows,
  listedOf,
  queueFilterCount,
  visibleQueueRows,
} from '@/lib/review'
import { usePermissions } from '@/lib/use-session'
import type { ProposalsSearch } from '@/lib/search-params'
import { useReviewQueue } from '@/lib/use-review-queue'
import { cn } from '@/lib/utils'
import { useProposalPanel } from './use-proposal-panel'
import { fitQueueColumns, queueColumnSpecs } from './queue-columns'
import { QueueFilters } from './queue-filters'
import { QueueHeaderRow, QueueList } from './queue-list'
import { QueueSelectionBar, useBulkSteps } from './queue-bulk'
import { useQueueSelection } from './use-queue-selection'
import { DecideNote, useSwitchPerson } from './decide-note'

/**
 * To review (frame C1 of the front end plan, slice W5): the proposals the person may decide, on
 * the grid, grouped by domain, highest risk first and then the one that has waited longest
 * (FR-208). Search, view and filters are in the address.
 */
export function ReviewQueuePage({ search }: { search: ProposalsSearch }) {
  const navigate = useNavigate({ from: '/proposals/' })
  const views = useProposalViews()
  const { queue, rows: queueRows, today, viewerId } = useReviewQueue()
  const { data: areas = [] } = useQuery(areasQuery())
  const { data: people = [] } = useQuery(peopleQuery())
  const permissions = usePermissions()
  const switchTo = useSwitchPerson()
  // A held or sent bulk step has taken its rows out already (lib/deciding.ts): Undo, or a refusal,
  // brings them back (FR-223).
  const rows = useMemo(
    () => visibleQueueRows(queueRows, search, viewerId),
    [queueRows, search, viewerId],
  )
  const entries = useMemo(() => groupQueueRows(rows), [rows])
  const filterCount = queueFilterCount(search)
  const terms = queryTerms(search.q)

  const [region, setRegion] = useState<HTMLDivElement | null>(null)
  const [stickyBlock, setStickyBlock] = useState<HTMLDivElement | null>(null)
  // Beside a docked panel the list fits the width it has once the sidebar has folded.
  const fitMode = useDockMode()
  const width = dockFitWidth(useElementWidth(region), Boolean(search.panel) && fitMode === 'docked')
  const stickyHeight = useElementHeight(stickyBlock)
  const gutter = useMediaQuery('(min-width: 48rem)') ? 24 : 16
  // Rows are selected with a pointer and the keyboard; a phone or a touch screen opens one.
  const coarse = useMediaQuery('(pointer: coarse)')
  const fit = fitQueueColumns(width || 1200, gutter, { selectable: !coarse })
  const narrow = width > 0 && fit.narrow
  const selectable = !narrow && !coarse

  const updateSearch = (patch: Partial<ProposalsSearch>, replace = false) =>
    void navigate({
      to: '/proposals',
      search: (previous) => ({ ...previous, ...patch }),
      replace,
    })

  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState(search.q ?? '')
  const [lastQ, setLastQ] = useState(search.q)
  if (lastQ !== search.q) {
    setLastQ(search.q)
    setQuery(search.q ?? '')
  }
  const changeQuery = (value: string) => {
    setQuery(value)
    updateSearch({ q: value.trim() ? value : undefined }, true)
  }

  // ---- the proposal open in the docked panel, and the list's keys (contract 9.2) ----
  const ids = useMemo(
    () => entries.flatMap((entry) => (entry.type === 'row' ? [entry.row.id] : [])),
    [entries],
  )
  // Whether the person may decide each row from here (FR-223): one rule, `canDecideInList`.
  const decisions = useMemo(
    () => new Map(rows.map((row) => [row.id, permissions.canDecideInList(listedOf(row))])),
    [rows, permissions],
  )
  const blockedOf = (row: (typeof rows)[number]) => {
    const decision = decisions.get(row.id)
    return !decision || decision.allowed
      ? null
      : listDecisionWords(decision, row.areaName, permissions.permissions)
  }
  const decidable = useMemo(() => ids.filter((id) => decisions.get(id)?.allowed), [ids, decisions])
  const note = undecidableSummary(
    rows.flatMap((row) => {
      const decision = decisions.get(row.id)
      return decision ? [{ decision, areaName: row.areaName }] : []
    }),
    permissions.permissions,
  )
  // An empty queue for someone whose own proposals wait and who may not decide their own (neither
  // an administrator nor an owner of their domain): others decide them (FR-206).
  const mine = useQuery(proposalListQuery(MINE))
  const ownWaiting = useMemo(
    () =>
      mineProposals(mine.data?.rows ?? [])
        .filter((record) => record.state === 'submitted' || record.state === 'in_review')
        .map((record) => ({
          decision: permissions.canDecideInList({
            subject: record.subject,
            areaId: record.areaId,
            proposerId: record.proposerId,
            state: record.state,
            riskLevel: record.draft.riskLevel ?? null,
          }),
          areaName:
            areas.find((area) => area.id === record.areaId)?.name ??
            (record.areaId ? 'Unknown domain' : 'No domain'),
        })),
    [mine.data, permissions, areas],
  )
  const ownNote = undecidableSummary(ownWaiting, permissions.permissions)
  const selection = useQueueSelection(ids, decidable)
  const selectedRows = rows.filter((row) => selection.selected.has(row.id))
  const bulk = useBulkSteps({
    rows: selectedRows,
    nameOf: (id) => people.find((person) => person.id === id)?.name ?? null,
    onHold: (taken) => {
      // What the step left out stays selected, to open or decide on its own.
      selection.restore([...selection.selected].filter((id) => !taken.includes(id)))
    },
    onUndo: (taken) => selection.add(taken),
  })
  const dock = useProposalPanel({
    search,
    region,
    ids,
    searchRef,
    enabled: !queue.isPending && !(queue.isError && !queue.data),
    ...(selectable
      ? {
          selection: {
            size: selection.size,
            toggle: (id: string) => selection.toggle(id),
            extend: selection.extend,
            clear: selection.clear,
          },
          bulk: {
            count: () => selection.size,
            can: () => selection.size > 0,
            run: bulk.open,
            selectAll: selection.selectAll,
          },
        }
      : {}),
  })

  const clearAll = () =>
    updateSearch({ q: undefined, area: undefined, risk: undefined, claimed: undefined })
  const showLoading = useDelayedFlag(queue.isPending)
  const columnWidths = fit.columns.map((id) => ({
    id,
    widthClass: queueColumnSpecs[id].widthClass,
  }))
  const areaName = (id: string) => areas.find((area) => area.id === id)?.name ?? 'Unknown domain'
  let body
  if (queue.isError && !queue.data) {
    body = (
      <ListError
        title="We couldn't load the proposals to review"
        safe="Nothing was decided."
        error={queue.error}
        onRetry={() => void queue.refetch()}
      />
    )
  } else if (queue.isPending) {
    body = showLoading ? (
      <ListLoading
        label="Loading the proposals to review"
        columns={columnWidths}
        header={<QueueHeaderRow columns={fit.columns} />}
        narrow={narrow}
        selectable={false}
        rowButton={false}
      />
    ) : null
  } else if (queueRows.length === 0 && ownNote) {
    body = (
      <ListEmpty
        title="Nothing for you to review"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {switchTo ? (
              <Button variant="outline" render={<Link {...switchTo} />} nativeButton={false}>
                Switch person
              </Button>
            ) : null}
            <Button
              variant="ghost"
              render={<Link to="/proposals" search={{ view: 'mine' }} />}
              nativeButton={false}
            >
              Show yours
            </Button>
          </div>
        }
      >
        {formatCount(ownWaiting.length, 'proposal')} you made{' '}
        {ownWaiting.length === 1 ? 'waits' : 'wait'} for a decision. {ownNote}
      </ListEmpty>
    )
  } else if (queueRows.length === 0) {
    body = (
      <ListEmpty title="Nothing to review">
        When someone sends a proposal in a domain you own, it shows here.{' '}
        <HelpLink to="review-a-proposal">How to review a proposal</HelpLink>
      </ListEmpty>
    )
  } else if (rows.length === 0) {
    const on = [
      search.area ? `Domain: ${areaName(search.area)}` : null,
      search.risk ? `Risk: ${search.risk}` : null,
      search.claimed ? `Claimed by: ${claimFilterNames[search.claimed]}` : null,
    ].filter(Boolean)
    const q = search.q?.trim()
    body = (
      <ListNoResults
        title="No proposals match"
        description={
          q && on.length
            ? `Nothing matches “${q}” with ${on.join('; ')}.`
            : q
              ? `Nothing matches “${q}”. Try fewer or shorter words.`
              : `Nothing matches ${on.join('; ')}.`
        }
        onClear={clearAll}
      />
    )
  } else {
    body = (
      <QueueList
        note={note ? <DecideNote text={note} narrow={narrow} /> : null}
        entries={entries}
        rows={rows}
        columns={fit.columns}
        narrow={narrow}
        today={today}
        terms={terms}
        viewerId={viewerId}
        panel={dock.panel}
        selection={
          selectable
            ? {
                selected: selection.selected,
                onToggle: selection.toggle,
                onToggleAll: selection.toggleAll,
                blocked: blockedOf,
              }
            : undefined
        }
      />
    )
  }

  const area = search.area ? areas.find((candidate) => candidate.id === search.area) : undefined
  const chips = [
    search.area
      ? {
          key: 'area',
          text: `Domain: ${area?.name ?? 'Unknown domain'}`,
          label: area ? (
            <>
              Domain:
              <DomainBadge name={area.name} label={area.label} form="bare" />
            </>
          ) : null,
          clear: { area: undefined },
        }
      : null,
    search.risk
      ? {
          key: 'risk',
          text: `Risk: ${search.risk}`,
          label: <RiskBadge level={search.risk} form="bare" />,
          clear: { risk: undefined },
        }
      : null,
    search.claimed
      ? {
          key: 'claimed',
          text: `Claimed by: ${claimFilterNames[search.claimed]}`,
          label: null,
          clear: { claimed: undefined },
        }
      : null,
  ].filter((chip) => chip !== null)

  return (
    <Page
      title="Proposals"
      data-template="list"
      data-view="review"
      ref={setRegion}
      style={
        { '--list-sticky-top': `calc(var(--header-height) + ${stickyHeight}px)` } as CSSProperties
      }
    >
      <div
        ref={setStickyBlock}
        inert={dock.listHidden || undefined}
        className="sticky top-header z-sticky bg-background"
      >
        {queue.isError && queue.data ? (
          <ListStale
            loadedAt={new Date(queue.dataUpdatedAt).toISOString()}
            onRetry={() => void queue.refetch()}
          />
        ) : null}
        <PageToolbar role="search" aria-label="Proposals" className="flex-wrap gap-y-2">
          <ViewChips views={views} active="review" />
          <PageToolbarDivider />
          <QueueFilters
            search={search}
            areas={areas}
            rows={queueRows}
            viewerId={viewerId}
            activeCount={filterCount}
            onSearch={(patch) => updateSearch(patch)}
          />
          <div className={toolbarSearchSlot}>
            <InputGroup className={toolbarSearchField}>
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
                    changeQuery('')
                  }
                }}
                placeholder="Search proposals"
                aria-label="Search proposals"
                aria-describedby="queue-count"
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
          <span id="queue-count" aria-live="polite" className={toolbarCount}>
            {queue.isPending ? (
              ''
            ) : filterCount > 0 || search.q?.trim() ? (
              <>
                <span className="font-bold text-foreground">
                  {rows.length.toLocaleString('en')}
                </span>{' '}
                of {queueRows.length.toLocaleString('en')} waiting
              </>
            ) : (
              `${rows.length.toLocaleString('en')} waiting`
            )}
          </span>
        </PageToolbar>
        {chips.length ? (
          <div
            role="group"
            aria-label="Filters on"
            className="flex flex-wrap items-center gap-2 border-b px-gutter py-2"
          >
            {chips.map((chip) => (
              <Button
                key={chip.key}
                variant="outline"
                size="sm"
                onClick={() => updateSearch(chip.clear)}
                aria-label={`Remove filter ${chip.text}`}
                className={cn('rounded-full', chip.label && 'gap-2')}
              >
                {chip.label ?? chip.text}
                <XIcon className="text-muted-foreground" />
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex flex-col" inert={dock.listHidden || undefined}>
        {rows.length > 0 && !queue.isPending ? body : <div className="flex flex-col">{body}</div>}
      </div>
      {selectable && selectedRows.length > 0 && !dock.listHidden ? (
        <QueueSelectionBar rows={selectedRows} onRun={bulk.open} onClear={selection.clear} />
      ) : null}
      {bulk.dialogs({ areas, viewerId })}
      {dock.element}
    </Page>
  )
}
