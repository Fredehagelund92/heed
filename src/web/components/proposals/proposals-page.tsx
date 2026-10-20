import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { areasQuery, libraryQuery, peopleQuery, proposalListQuery } from '@/api/queries'
import { HelpLink } from '@/components/help/help-link'
import { SearchIcon, Trash2Icon, XIcon } from '@/components/icons'
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
import { gridRowControl } from '@/components/page/grid'
import { Page, PageToolbar } from '@/components/page/page'
import { SelectionBar, SelectionBarButton } from '@/components/page/selection-bar'
import {
  PageToolbarDivider,
  toolbarCount,
  toolbarSearchField,
  toolbarSearchSlot,
} from '@/components/page/toolbar'
import { dockFitWidth, rowLink } from '@/components/page/use-dock-list'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Kbd } from '@/components/ui/kbd'
import { useElementHeight, useElementWidth } from '@/hooks/use-element-size'
import { useMediaQuery } from '@/hooks/use-media-query'
import { formatCount, queryTerms } from '@/lib/library'
import {
  describeProposalFilters,
  groupProposalRows,
  proposalFilterCount,
  proposalStateNames,
  proposalViewOf,
  toProposalRow,
  visibleProposalRows,
} from '@/lib/proposals'
import { keptRows, useDiscarding } from '@/lib/discarding'
import { draftsLink, isUnsubmittedDraft, MINE, mineProposals } from '@/lib/my-drafts'
import { listDecisionWords, undecidableSummary } from '@/lib/permissions'
import { recordQueueRow, reviewsAnything } from '@/lib/review'
import type { ProposalsSearch } from '@/lib/search-params'
import { usePermissions } from '@/lib/use-session'
import { cn } from '@/lib/utils'
import { useProposalPanel } from './use-proposal-panel'
import { ReviewQueuePage } from './review-queue-page'
import { fitProposalColumns, proposalColumnSpecs } from './proposal-columns'
import { ProposalFilters } from './proposal-filters'
import { ProposalHeaderRow, ProposalList } from './proposal-list'
import { useProposalViews } from './use-proposal-views'
import { DecideNote } from './decide-note'
import { discardKeyHint, DraftRowMenu, useDiscardDrafts } from './discard-drafts'
import { QueueBulkButtons, useBulkSteps } from './queue-bulk'
import { useQueueSelection } from './use-queue-selection'
import { ViewChips } from './view-chips'

/**
 * The Proposals page (screen 2 of the front end plan): To review for an owner, deputy or
 * approver (slice W5), and Mine, the person's own proposals (slice W4). The view is in the
 * address; someone who reviews opens on To review.
 */
export function ProposalsPage({ search }: { search: ProposalsSearch }) {
  const permissions = usePermissions()
  const view = proposalViewOf(search, { reviews: reviewsAnything(permissions.permissions) })
  // Which view opens depends on the person's roles: wait for them rather than show the wrong one.
  if (!permissions.ready && search.view !== 'mine')
    return <Page title="Proposals" data-template="list" aria-busy="true" />
  return view === 'review' ? <ReviewQueuePage search={search} /> : <MinePage search={search} />
}

/** The drafts view of Mine, where the Drafts entries go: Status is Draft, and nothing else. */
const onlyDrafts = (search: ProposalsSearch) =>
  search.state === draftsLink.search.state && !search.area && !search.q?.trim()

/**
 * Mine: the person's own proposals on the grid, grouped by where each stands. Their drafts can be
 * discarded from here: from a draft row's menu, with Command or Control Backspace on the focused
 * row, or many at once from the selection bar; someone who decides proposals selects those too.
 */
function MinePage({ search }: { search: ProposalsSearch }) {
  const navigate = useNavigate({ from: '/proposals/' })
  const mine = useQuery(proposalListQuery(MINE))
  const views = useProposalViews()
  const { data: areas = [] } = useQuery(areasQuery())
  const { data: people = [] } = useQuery(peopleQuery())
  const { data: library } = useQuery(libraryQuery())
  const today = library?.today ?? null
  const permissions = usePermissions()
  // Someone who decides proposals selects them here too, as in To review (FR-223).
  const reviews = reviewsAnything(permissions.permissions)
  // A draft on its way out (discarded, waiting for Undo) has left the list already.
  const gone = useDiscarding()
  const own = useMemo(() => keptRows(mineProposals(mine.data?.rows ?? []), gone), [mine.data, gone])
  // Everyone selects their own drafts, to discard many at once.
  const hasDrafts = own.some(isUnsubmittedDraft)

  const allRows = useMemo(() => own.map((proposal) => toProposalRow(proposal, areas)), [own, areas])
  const rows = useMemo(() => visibleProposalRows(allRows, search), [allRows, search])
  const entries = useMemo(() => groupProposalRows(rows), [rows])
  const filterCount = proposalFilterCount(search)
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
  const fit = fitProposalColumns(width || 1200, gutter, {
    oneDomain: Boolean(search.area) || new Set(allRows.map((row) => row.areaId)).size === 1,
    selectable: (reviews || hasDrafts) && !coarse,
  })
  const narrow = width > 0 && fit.narrow
  const selectable = (reviews || hasDrafts) && !narrow && !coarse

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
  // Whether the person may decide each of their proposals from here: one rule, `canDecideInList`.
  const records = useMemo(() => new Map(own.map((record) => [record.id, record])), [own])
  const isDraft = (id: string) => {
    const record = records.get(id)
    return record !== undefined && isUnsubmittedDraft(record)
  }
  const decisions = useMemo(
    () =>
      new Map(
        [...records.values()].map((record) => [
          record.id,
          permissions.canDecideInList({
            subject: record.subject,
            areaId: record.areaId,
            proposerId: record.proposerId,
            state: record.state,
            riskLevel: record.draft.riskLevel ?? null,
          }),
        ]),
      ),
    [records, permissions],
  )
  const blockedOf = (row: (typeof rows)[number]) => {
    if (row.state === 'draft') return null
    const decision = decisions.get(row.id)
    if (decision?.allowed) return null
    return reviews && decision
      ? listDecisionWords(decision, row.areaName, permissions.permissions)
      : 'Only a draft can be selected here. To take back a sent proposal, withdraw it from its page.'
  }
  const decidable = useMemo(() => ids.filter((id) => decisions.get(id)?.allowed), [ids, decisions])
  const draftIds = useMemo(
    () => ids.filter((id) => records.get(id)?.state === 'draft'),
    [ids, records],
  )
  const note = reviews
    ? undecidableSummary(
        rows.flatMap((row) => {
          const decision = decisions.get(row.id)
          return decision ? [{ decision, areaName: row.areaName }] : []
        }),
        permissions.permissions,
      )
    : null
  const selection = useQueueSelection(
    ids,
    useMemo(
      () => ids.filter((id) => draftIds.includes(id) || decidable.includes(id)),
      [ids, draftIds, decidable],
    ),
  )
  // The selection holds drafts to discard and proposals to decide; each step takes its own.
  const selectedDrafts = [...selection.selected].filter(isDraft)
  const selectedRows = useMemo(
    () =>
      [...selection.selected].flatMap((id) => {
        const record = records.get(id)
        return record && !isUnsubmittedDraft(record)
          ? [recordQueueRow(record, { areas, people, proposals: [], items: library?.items ?? [] })]
          : []
      }),
    [selection.selected, records, areas, people, library],
  )
  const bulk = useBulkSteps({
    rows: selectedRows,
    nameOf: (id) => people.find((person) => person.id === id)?.name ?? null,
    // A decided proposal stays in Mine, under where it now stands.
    onHold: (taken) =>
      selection.restore([...selection.selected].filter((id) => !taken.includes(id))),
    onUndo: (taken) => selection.add(taken),
  })
  // After a discard the focus goes to the row that took the first discarded one's place; with no
  // draft left, to All your proposals, or else the search field.
  const focusAfter = useRef<string | null>(null)
  const noDraftsAction = useRef<HTMLButtonElement>(null)
  const discard = useDiscardDrafts({
    onHold: (taken) => {
      selection.restore([...selection.selected].filter((id) => !taken.includes(id)))
      if (search.panel && taken.includes(search.panel)) dock.closePanel()
    },
    onUndo: (taken) => selection.add(taken),
    finalFocus: () =>
      (focusAfter.current ? rowLink(region, focusAfter.current) : null) ??
      noDraftsAction.current ??
      searchRef.current,
  })
  const askDiscard = (targets: readonly string[]) => {
    const taken = new Set(targets)
    const first = ids.findIndex((id) => taken.has(id))
    focusAfter.current =
      ids.slice(first).find((id) => !taken.has(id)) ??
      ids
        .slice(0, Math.max(first, 0))
        .reverse()
        .find((id) => !taken.has(id)) ??
      null
    discard.ask(targets.flatMap((id) => records.get(id) ?? []))
  }
  const dock = useProposalPanel({
    search,
    region,
    ids,
    searchRef,
    enabled: !mine.isPending && !(mine.isError && !mine.data),
    // The selected drafts, or else the focused row when it is one (Command or Control Backspace).
    discard: {
      targets: (focused) =>
        selectedDrafts.length ? selectedDrafts : focused && isDraft(focused) ? [focused] : [],
      run: askDiscard,
    },
    ...(selectable
      ? {
          selection: {
            size: selection.size,
            toggle: (id: string) => selection.toggle(id),
            extend: selection.extend,
            clear: selection.clear,
          },
          ...(reviews
            ? {
                bulk: {
                  count: () => selectedRows.length,
                  can: () => selectedRows.length > 0,
                  run: bulk.open,
                  selectAll: selection.selectAll,
                },
              }
            : {}),
        }
      : {}),
  })

  const areaName = (id: string) => areas.find((area) => area.id === id)?.name ?? 'Unknown domain'
  const clearAll = () => updateSearch({ q: undefined, state: undefined, area: undefined })

  const showLoading = useDelayedFlag(mine.isPending)
  const columnWidths = fit.columns.map((id) => ({
    id,
    widthClass: proposalColumnSpecs[id].widthClass,
  }))
  let body
  if (mine.isError && !mine.data) {
    body = (
      <ListError
        title="We couldn't load your proposals"
        safe="Your proposals are safe."
        error={mine.error}
        onRetry={() => void mine.refetch()}
      />
    )
  } else if (mine.isPending) {
    body = showLoading ? (
      <ListLoading
        label="Loading your proposals"
        columns={columnWidths}
        header={<ProposalHeaderRow columns={fit.columns} />}
        narrow={narrow}
        selectable={false}
        rowButton={false}
      />
    ) : null
  } else if (allRows.length === 0) {
    body = (
      <ListEmpty
        title="No proposals yet"
        action={
          <Button variant="outline" render={<Link to="/library/new" />} nativeButton={false}>
            Add a fact
          </Button>
        }
      >
        When you add a fact or suggest a change to one, it shows here with where it stands.{' '}
        <HelpLink to="add-your-first-context">How to add a fact</HelpLink>
      </ListEmpty>
    )
  } else if (rows.length === 0 && onlyDrafts(search)) {
    // The drafts view with none left: every draft was submitted or discarded.
    body = (
      <ListEmpty
        title="No drafts"
        action={
          <Button ref={noDraftsAction} variant="outline" onClick={clearAll}>
            All your proposals
          </Button>
        }
      >
        Every draft you started was sent for review or discarded. A new draft stays here until you
        send it.
      </ListEmpty>
    )
  } else if (rows.length === 0) {
    body = (
      <ListNoResults
        title="No proposals match"
        description={describeProposalFilters(search, areaName)}
        onClear={clearAll}
      />
    )
  } else {
    body = (
      <ProposalList
        label="Your proposals"
        note={note ? <DecideNote text={note} narrow={narrow} /> : null}
        entries={entries}
        rows={rows}
        columns={fit.columns}
        narrow={narrow}
        today={today}
        terms={terms}
        panel={dock.panel}
        selection={
          selectable
            ? {
                selected: selection.selected,
                onToggle: selection.toggle,
                onToggleAll: selection.toggleAll,
                blocked: blockedOf,
                allLabel: !reviews
                  ? 'Select every draft'
                  : draftIds.length
                    ? 'Select every draft and every proposal you can decide'
                    : undefined,
              }
            : undefined
        }
        rowMenu={
          hasDrafts
            ? (row) => {
                const record = records.get(row.id)
                return record && isUnsubmittedDraft(record) ? (
                  <DraftRowMenu
                    record={record}
                    onDiscard={() => askDiscard([row.id])}
                    className={gridRowControl}
                  />
                ) : null
              }
            : undefined
        }
      />
    )
  }

  const area = search.area ? areas.find((candidate) => candidate.id === search.area) : undefined
  const chips = [
    search.state
      ? {
          key: 'state',
          text: `Status: ${proposalStateNames[search.state]}`,
          label: null,
          clear: { state: undefined },
        }
      : null,
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
  ].filter((chip) => chip !== null)

  return (
    <Page
      title="Proposals"
      data-template="list"
      ref={setRegion}
      // The column header sticks under the shell header and this block (custom property only).
      style={
        { '--list-sticky-top': `calc(var(--header-height) + ${stickyHeight}px)` } as CSSProperties
      }
    >
      <div
        ref={setStickyBlock}
        inert={dock.listHidden || undefined}
        className="sticky top-header z-sticky bg-background"
      >
        {mine.isError && mine.data ? (
          <ListStale
            loadedAt={new Date(mine.dataUpdatedAt).toISOString()}
            onRetry={() => void mine.refetch()}
          />
        ) : null}
        <PageToolbar role="search" aria-label="Proposals" className="flex-wrap gap-y-2">
          <ViewChips views={views} active="mine" />
          <PageToolbarDivider />
          <ProposalFilters
            search={search}
            areas={areas}
            rows={allRows}
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
                aria-describedby="proposals-count"
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
          <span id="proposals-count" aria-live="polite" className={toolbarCount}>
            {mine.isPending ? (
              ''
            ) : filterCount > 0 || search.q?.trim() ? (
              <>
                <span className="font-bold text-foreground">
                  {rows.length.toLocaleString('en')}
                </span>{' '}
                of {formatCount(allRows.length, 'proposal')}
              </>
            ) : (
              formatCount(rows.length, 'proposal')
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
        {rows.length > 0 && !mine.isPending ? body : <div className="flex flex-col">{body}</div>}
      </div>
      {selectable && selection.size > 0 && !dock.listHidden ? (
        <SelectionBar
          count={selection.size}
          label={selectedRows.length ? 'Selected proposals' : 'Selected drafts'}
          onClear={selection.clear}
        >
          {selectedDrafts.length ? (
            <SelectionBarButton onClick={() => askDiscard(selectedDrafts)}>
              <Trash2Icon />
              {/* Beside the decisions it says which of the selected it takes. */}
              {selectedRows.length
                ? `Discard ${selectedDrafts.length === 1 ? 'draft' : `${selectedDrafts.length} drafts`}`
                : 'Discard'}
              <Kbd className="bg-ink-hover text-ink-foreground">{discardKeyHint()}</Kbd>
            </SelectionBarButton>
          ) : null}
          {selectedRows.length ? <QueueBulkButtons rows={selectedRows} onRun={bulk.open} /> : null}
        </SelectionBar>
      ) : null}
      {bulk.dialogs({ areas, viewerId: permissions.personId })}
      {discard.dialog}
      {dock.element}
    </Page>
  )
}
