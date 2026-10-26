import * as React from 'react'
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  EyeIcon,
  ListChecksIcon,
  ListFilterIcon,
  ListTreeIcon,
  NotebookTextIcon,
  PlusIcon,
} from '@/components/icons'
import { cn } from '@/lib/utils'
import { ToolLogo } from '@/components/heed/tool-logo'
import { connectorById } from '@/model/integrations'
import {
  AddRow,
  BarSpacer,
  barButton,
  Count,
  FilterChip,
  FilterRow,
  FilterValue,
  GroupRow,
  Highlight,
  ListBar,
  RowMenu,
  SearchField,
  StatusDot,
  Th,
  thClass,
} from '@/components/heed/list'
import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  kindLabel,
  servedToAgents,
  type DomainId,
  type Fact,
  type Kind,
  type Status,
} from '@/model/items'
import { closeDock, openDock, useDock } from '@/lib/dock'
import { matches, usePublishOrder, useRowKeys, words } from '@/lib/list'
import { inForce, parseWhen, timeShort, trustOf } from '@/lib/timeframe'
import { FreshDot, KindIcon, StatusIcon, TimeGlyph } from '@/components/heed/columns'
import { href, navigate } from '@/lib/router'
import { useQuery } from '@tanstack/react-query'
import { contextPageQuery, useVocabulary } from '@/api/queries'
import { useDomainList, useDomains } from '@/lib/workspace'
import { APP_URL } from '@/lib/brand'
import { TruncatedText } from '@/components/heed/truncated'
import { plainText } from '@/lib/mentions'
import { Loadable, TableSkeleton } from '@/components/heed/load-state'
import { useLeavingRows } from '@/lib/presence'
import { WhereChip } from '@/components/heed/tag-chip'
import { useRoute } from '@/lib/router'
import { useSelection } from '@/hooks/use-selection'
import { ContextBulk } from '@/components/heed/context-bulk'

// Context: what agents should know, as a compact list like the Heed app's. One quiet bar (Filter,
// Sort, Group, the archived note, search, count), the filters that are on as sentences under it, a
// thin header, and rows of one line at one density, in the list columns' design B: the kind
// as an icon before the title, the scope in its own column at wide widths, the status as a circle
// icon, the time frame as a glyph and a short date, and how fresh the check is as one dot.

const STATUSES: Status[] = ['Draft', 'Live', 'Needs checking', 'Archived']
const KINDS = Object.keys(kindLabel) as Kind[]
const toggle = <T,>(list: T[], v: T) =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v]

/** The sorts, each with its direction in words, as the Heed app says them. */
const SORTS = {
  checked: { label: 'Last checked', way: 'Newest first' },
  title: { label: 'Title', way: 'A to Z' },
  domain: { label: 'Domain', way: 'A to Z' },
  best: { label: 'Best match', way: 'Closest first' },
} as const
type Sort = keyof typeof SORTS
type Group = 'none' | 'domain' | 'metric'
const GROUPS: Record<Group, string> = { none: 'No grouping', domain: 'Domain', metric: 'Metric' }

/** When it was last checked; a draft was never checked, so it sorts last. */
const checked = (f: Fact) => (f.checkedOn ? Date.parse(f.checkedOn) : 0)
const items = (n: number) => `${n.toLocaleString('en-GB')} context ${n === 1 ? 'item' : 'items'}`
/** The first metric an item applies to, for grouping by metric. */
const metricOf = (f: Fact, metrics: Set<string>) =>
  f.where.find((w) => metrics.has(w)) ?? 'No metric'
const NO_FACTS: Fact[] = []
const COLS = 8

export function ContextPage() {
  const load = useQuery(contextPageQuery())
  const facts = load.data ?? NO_FACTS
  const domains = useDomains()
  const domainIds = useDomainList().map((d) => d.id)
  const { metrics } = useVocabulary()
  const metricNames = React.useMemo(() => new Set(metrics.map((m) => m.name)), [metrics])
  const dock = useDock()
  const [text, setText] = React.useState('')
  // A domain page links here filtered to its domain (and to what is due for a check).
  const { query } = useRoute()
  const [domain, setDomain] = React.useState<DomainId[]>(() =>
    query.get('domain') ? [query.get('domain') as DomainId] : [],
  )
  const [status, setStatus] = React.useState<Status[]>(() =>
    query.get('due') ? ['Needs checking'] : [],
  )
  const [kind, setKind] = React.useState<Kind[]>([])
  const [chosenSort, setSort] = React.useState<Sort | null>(null)
  const [group, setGroup] = React.useState<Group>('none')
  const [folded, setFolded] = React.useState<string[]>([])
  const [showArchived, setShowArchived] = React.useState(false)

  // While a search runs and no sort was chosen, the closest matches come first.
  const sort: Sort = chosenSort ?? (text.trim() ? 'best' : 'checked')
  const archived = facts.filter((f) => f.status === 'Archived').length
  const haystack = (f: Fact) =>
    `${f.title} ${plainText(f.summary)} ${f.where.join(' ')} ${domains[f.domain]?.name} ${f.checkedBy}`
  // The rows a value would show if it were ticked: everything the other filters and the search let through.
  const pass = (f: Fact, skip?: 'domain' | 'status' | 'kind') =>
    (showArchived || status.includes('Archived') || skip === 'status' || f.status !== 'Archived') &&
    (skip === 'domain' || !domain.length || domain.includes(f.domain)) &&
    (skip === 'status' || !status.length || status.includes(f.status)) &&
    (skip === 'kind' || !kind.length || kind.includes(f.kind)) &&
    matches(text, haystack(f))
  const titleHits = (f: Fact) => words(text).filter((w) => f.title.toLowerCase().includes(w)).length
  const filtered = facts
    .filter((f) => pass(f))
    .sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title)
        : sort === 'domain'
          ? domains[a.domain]!.name.localeCompare(domains[b.domain]!.name)
          : sort === 'best'
            ? titleHits(b) - titleHits(a) || checked(b) - checked(a)
            : checked(b) - checked(a),
    )
  const groups: { key: string; rows: Fact[] }[] =
    group === 'domain'
      ? domainIds
          .map((d) => ({ key: domains[d]!.name, rows: filtered.filter((f) => f.domain === d) }))
          .filter((g) => g.rows.length)
      : group === 'metric'
        ? [...new Set(filtered.map((f) => metricOf(f, metricNames)))]
            .sort((a, b) => (a === 'No metric' ? 1 : b === 'No metric' ? -1 : a.localeCompare(b)))
            .map((m) => ({ key: m, rows: filtered.filter((f) => metricOf(f, metricNames) === m) }))
        : [{ key: '', rows: filtered }]
  const visible = groups.flatMap((g) => (folded.includes(g.key) ? [] : g.rows))
  const order = visible.map((f) => f.id)
  usePublishOrder('context', order)
  const table = React.useRef<HTMLTableElement>(null)
  const [deleting, setDeleting] = React.useState(false)
  const sel = useSelection(order, { scope: table, onDeleteKey: () => setDeleting(true) })
  // On a phone the checkboxes come with Select, or once a row is ticked.
  const boxes = sel.picking || sel.count > 0

  const filters = domain.length + status.length + kind.length
  const peeked = dock?.kind === 'context' ? dock.id : undefined
  const rowKeys = useRowKeys({
    onMove: (id) => peeked && openDock('context', id),
    // Escape closes the peek first, then clears the selection, as in the Heed app.
    onEscape: () => {
      if (peeked) closeDock()
      else if (sel.count) sel.clear()
      else return false
      return true
    },
  })

  const clearAll = () => {
    setDomain([])
    setStatus([])
    setKind([])
    setText('')
  }
  const on = [
    domain.length && `Domain is ${domain.map((d) => domains[d]?.name).join(' or ')}`,
    status.length && `Status is ${status.join(' or ')}`,
    kind.length && `Kind is ${kind.map((k) => kindLabel[k]).join(' or ')}`,
  ].filter(Boolean)

  // Rows that leave (archived or deleted in bulk) fade out first.
  const leaving = useLeavingRows()
  const row = (f: Fact) => {
    const isSel = sel.isSelected(f.id)
    const where =
      f.where.length > 2
        ? `${f.where.slice(0, 2).join(', ')} +${f.where.length - 2}`
        : f.where.join(', ')
    const time = parseWhen(f.when)
    return (
      <tr
        key={f.id}
        aria-selected={isSel}
        data-state={isSel ? 'selected' : undefined}
        data-peeked={peeked === f.id || undefined}
        data-leaving={leaving.has(f.id) || undefined}
        className="group/row h-9 cursor-pointer border-b text-sm row-fade hover:bg-muted/50 has-[[data-row-open]:focus-visible]:bg-muted data-peeked:bg-muted data-peeked:shadow-peeked data-[state=selected]:bg-muted @max-xl/main:h-auto"
        onMouseDown={sel.onMouseDown}
        onClick={(e) => sel.rowClick(f.id, e) || openDock('context', f.id)}
      >
        <td
          className={cn(
            'hidden w-9.5 pr-0 pl-4 align-middle md:w-11.5 md:pl-6 @xl/main:table-cell',
            boxes && 'table-cell',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox
            aria-label={`Select ${f.title}`}
            {...sel.checkbox(f.id)}
            className={cn(
              'transition-opacity group-hover/row:opacity-100',
              !sel.count && !isSel && 'opacity-0 focus-visible:opacity-100',
            )}
          />
        </td>
        {/* The kind leads the row; on a phone the status takes its place, as the board draws it. */}
        <td
          className={cn(
            'w-8 px-1.5 align-middle @max-xl/main:w-9 @max-xl/main:pt-2.5 @max-xl/main:pr-0 @max-xl/main:pl-4 @max-xl/main:align-top',
            boxes && '@max-xl/main:pl-2',
          )}
        >
          <KindIcon kind={f.kind} className="@max-xl/main:hidden" />
          <StatusIcon status={f.status} className="@xl/main:hidden" />
        </td>
        <td className="max-w-0 px-1.5 align-middle @max-xl/main:px-3 @max-xl/main:py-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              data-row-open={f.id}
              className={cn(
                'flex min-w-0 text-left outline-none hover:underline',
                f.status === 'Archived' && 'text-muted-foreground',
              )}
              onClick={(e) => {
                e.stopPropagation()
                if (!sel.titleClick(f.id, e)) openDock('context', f.id)
              }}
            >
              <TruncatedText
                text={f.title}
                className="@max-xl/main:line-clamp-2 @max-xl/main:whitespace-normal"
              >
                <Highlight text={f.title} query={text} />
              </TruncatedText>
            </button>
            {f.origin && (
              <span
                title={`From ${f.origin.tool}: ${f.origin.doc}`}
                className="inline-flex shrink-0"
              >
                <ToolLogo
                  c={connectorById('google-drive')!}
                  size="sm"
                  className="size-4 rounded p-0.5"
                />
                <span className="sr-only">From {f.origin.tool}</span>
              </span>
            )}
          </span>
          {/* On a phone the columns fold into a second line: the time frame in words, then the scope. */}
          <span className="mt-0.5 hidden min-w-0 items-center gap-2 text-dense text-muted-foreground @max-xl/main:flex">
            <span className="shrink-0">{timeShort(time)}</span>
            <span className="min-w-0 truncate">
              <Highlight text={where} query={text} />
            </span>
          </span>
        </td>
        <td className="hidden w-50.5 max-w-50.5 min-w-50.5 px-1.5 align-middle text-dense text-muted-foreground @min-[60rem]/main:table-cell">
          {/* The scope as the same tag chips as everywhere: two, then how many more. */}
          <span className="flex min-w-0 items-center gap-1 overflow-hidden">
            {f.where.slice(0, 2).map((w) => (
              <WhereChip key={w} w={w} label={<Highlight text={w} query={text} />} />
            ))}
            {f.where.length > 2 && (
              <span className="shrink-0 text-xs tabular-nums">+{f.where.length - 2}</span>
            )}
          </span>
        </td>
        <td className="hidden w-18 min-w-18 px-1.5 align-middle @xl/main:table-cell">
          <StatusIcon status={f.status} />
        </td>
        <td className="hidden w-39 min-w-39 px-1.5 align-middle @xl/main:table-cell">
          <TimeGlyph time={time} />
        </td>
        <td className="w-19 min-w-19 px-1.5 text-center align-middle @max-xl/main:w-10 @max-xl/main:min-w-10 @max-xl/main:pr-4 @max-xl/main:pl-0">
          <FreshDot fact={f} />
        </td>
        <td
          className="w-10 pr-2 align-middle md:pr-4 @max-xl/main:hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <RowMenu
            title={f.title}
            page={href(`/context/${f.id}`)}
            link={`${APP_URL}/context/${f.id}`}
          />
        </td>
      </tr>
    )
  }

  /** A header that sorts: the arrow shows on the column the list is sorted by, as the board draws it. */
  const sortTh = (key: 'title' | 'checked', label: string, className: string, tip?: string) => {
    const on = sort === key
    const Arrow = key === 'title' ? ArrowUpIcon : ArrowDownIcon
    return (
      <th
        className={cn(thClass, className)}
        aria-sort={on ? (key === 'title' ? 'ascending' : 'descending') : undefined}
      >
        <button
          type="button"
          title={tip}
          onClick={() => setSort(key)}
          className={cn(
            'group/sort -mx-1.5 inline-flex h-6 items-center gap-1 rounded-md px-1.5 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
            on && 'text-foreground',
          )}
        >
          {label}
          <Arrow
            aria-hidden
            className={cn(
              'size-3',
              on
                ? 'opacity-90'
                : 'opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60',
            )}
          />
        </button>
      </th>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SiteHeader title="Context" icon={<NotebookTextIcon />}>
        <Button size="sm" onClick={() => navigate('/context/new')}>
          <PlusIcon data-icon="inline-start" />
          New context
        </Button>
      </SiteHeader>
      {/* One scroller; what it holds (the bar, the table, the totals) sits in the 80rem frame, centred. */}
      <div className="@container/main flex min-h-0 flex-1 flex-col overflow-y-auto *:mx-auto *:w-full *:max-w-wide @min-[80rem]/main:*:border-x">
        <Loadable
          what="the context"
          skeleton={<TableSkeleton />}
          errorClassName="border-b"
          query={load}
        >
          {facts.length === 0 ? (
            <div className="p-4 md:p-6">
              <Empty className="border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <NotebookTextIcon />
                  </EmptyMedia>
                  <EmptyTitle>No context yet</EmptyTitle>
                  <EmptyDescription>
                    Until there is some, agents hear “Nothing is written down for this.” That is the
                    honest answer, not an error.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant="outline" onClick={() => navigate('/context/new')}>
                    Write the first context item
                  </Button>
                </EmptyContent>
              </Empty>
            </div>
          ) : (
            <>
              <ListBar>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(barButton, filters > 0 && 'bg-muted text-foreground')}
                      />
                    }
                  >
                    <ListFilterIcon />
                    Filter
                    {filters > 0 && <span className="tabular-nums">{filters}</span>}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-60">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Domain</DropdownMenuLabel>
                      {domainIds.map((d) => (
                        <DropdownMenuCheckboxItem
                          key={d}
                          checked={domain.includes(d)}
                          onCheckedChange={() => setDomain((x) => toggle(x, d))}
                        >
                          <FilterValue
                            count={facts.filter((f) => f.domain === d && pass(f, 'domain')).length}
                          >
                            {domains[d]?.name}
                          </FilterValue>
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Status</DropdownMenuLabel>
                      {STATUSES.map((st) => (
                        <DropdownMenuCheckboxItem
                          key={st}
                          checked={status.includes(st)}
                          onCheckedChange={() => setStatus((x) => toggle(x, st))}
                        >
                          <FilterValue
                            count={facts.filter((f) => f.status === st && pass(f, 'status')).length}
                          >
                            <StatusDot status={st} label />
                          </FilterValue>
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Kind</DropdownMenuLabel>
                      {KINDS.map((k) => (
                        <DropdownMenuCheckboxItem
                          key={k}
                          checked={kind.includes(k)}
                          onCheckedChange={() => setKind((x) => toggle(x, k))}
                        >
                          <FilterValue
                            count={facts.filter((f) => f.kind === k && pass(f, 'kind')).length}
                          >
                            {kindLabel[k]}
                          </FilterValue>
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="ghost" size="sm" className={barButton} />}
                  >
                    <ArrowUpDownIcon />
                    <span className="@max-3xl/main:sr-only">Sort</span>
                    <span className="text-foreground @max-3xl/main:sr-only">
                      {SORTS[sort].label}
                    </span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-60">
                    <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as Sort)}>
                      {(Object.keys(SORTS) as Sort[])
                        .filter((k) => k !== 'best' || text.trim())
                        .map((k) => (
                          <DropdownMenuRadioItem key={k} value={k}>
                            <span className="flex w-full justify-between gap-3">
                              {SORTS[k].label}
                              <span className="text-xs text-muted-foreground">{SORTS[k].way}</span>
                            </span>
                          </DropdownMenuRadioItem>
                        ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(barButton, group !== 'none' && 'bg-muted text-foreground')}
                      />
                    }
                  >
                    <ListTreeIcon />
                    <span className={cn(group === 'none' ? 'sr-only' : '@max-3xl/main:sr-only')}>
                      {group === 'none' ? 'Group' : GROUPS[group]}
                    </span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-44">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Group by</DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={group}
                        onValueChange={(v) => {
                          setGroup(v as Group)
                          setFolded([])
                        }}
                      >
                        {(Object.keys(GROUPS) as Group[]).map((g) => (
                          <DropdownMenuRadioItem key={g} value={g}>
                            {GROUPS[g]}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                {/* On a phone, where there is no hover or Shift, Select starts picking rows. */}
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(barButton, '@xl/main:hidden', boxes && 'bg-muted text-foreground')}
                  onClick={() => (boxes ? sel.clear() : sel.setPicking(true))}
                >
                  <ListChecksIcon />
                  {boxes ? 'Done' : 'Select'}
                </Button>
                <BarSpacer>
                  {archived > 0 && !status.includes('Archived') && (
                    <span className="flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground @max-5xl/main:hidden">
                      <EyeIcon className="size-3.5" aria-hidden />
                      {archived} archived {showArchived ? 'shown' : 'hidden'}
                      <button
                        type="button"
                        className="font-medium text-foreground underline underline-offset-4"
                        onClick={() => setShowArchived((s) => !s)}
                      >
                        {showArchived ? 'Hide' : 'Show'}
                      </button>
                    </span>
                  )}
                  <SearchField value={text} onChange={setText} placeholder="Search context" />
                </BarSpacer>
                <Count>
                  {filtered.length === facts.length ? (
                    items(facts.length)
                  ) : (
                    <>
                      <span className="font-semibold text-foreground">{filtered.length}</span> of{' '}
                      {items(facts.length)}
                    </>
                  )}
                </Count>
              </ListBar>
              <FilterRow
                count={filters}
                onClear={() => (setDomain([]), setStatus([]), setKind([]))}
              >
                {domain.length > 0 && (
                  <FilterChip
                    field="Domain"
                    values={domain.map((d) => domains[d]!.name)}
                    onRemove={() => setDomain([])}
                  />
                )}
                {status.length > 0 && (
                  <FilterChip field="Status" values={status} onRemove={() => setStatus([])} />
                )}
                {kind.length > 0 && (
                  <FilterChip
                    field="Kind"
                    values={kind.map((k) => kindLabel[k])}
                    onRemove={() => setKind([])}
                  />
                )}
              </FilterRow>
              <div className="min-w-0 shrink-0">
                <table ref={table} className="w-full border-collapse">
                  <thead className="sticky top-0 z-raised">
                    <tr>
                      <th
                        className={cn(
                          thClass,
                          'hidden w-9.5 min-w-9.5 pr-0 pl-4 md:w-11.5 md:min-w-11.5 md:pl-6 @xl/main:table-cell',
                          boxes && 'table-cell',
                        )}
                      >
                        <Checkbox
                          aria-label="Select all context shown"
                          checked={sel.allShown}
                          indeterminate={sel.count > 0 && !sel.allShown}
                          onCheckedChange={sel.toggleAll}
                        />
                      </th>
                      <Th className="w-8 min-w-8 px-1.5 @max-xl/main:w-9 @max-xl/main:min-w-9 @max-xl/main:pr-0 @max-xl/main:pl-4">
                        <span className="sr-only">Kind</span>
                      </Th>
                      {sortTh('title', 'Context', 'w-full px-1.5 @max-xl/main:px-3')}
                      <Th className="hidden w-50.5 min-w-50.5 px-1.5 @min-[60rem]/main:table-cell">
                        Scope
                      </Th>
                      <Th className="hidden w-18 min-w-18 px-1.5 @xl/main:table-cell">Status</Th>
                      <Th className="hidden w-39 min-w-39 px-1.5 @xl/main:table-cell">When</Th>
                      {sortTh(
                        'checked',
                        'Checked',
                        'w-19 min-w-19 px-1.5 text-center @max-xl/main:hidden',
                        'Checked: fresh up to 30 days, ageing up to 90, then overdue',
                      )}
                      <Th className="hidden w-10 @max-xl/main:table-cell @max-xl/main:pr-4">
                        <span className="sr-only">Checked</span>
                      </Th>
                      <Th className="w-10 pr-2 md:pr-4 @max-xl/main:hidden">
                        <span className="sr-only">Actions</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody
                    onKeyDown={(e) => {
                      sel.onKeyDown(e)
                      rowKeys(e)
                    }}
                  >
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={COLS} className="px-6 py-10 text-center text-sm">
                          <p className="font-medium">No context matches</p>
                          <p className="mt-1 text-muted-foreground">
                            {[text.trim() && `Searching for “${text.trim()}”`, ...on]
                              .filter(Boolean)
                              .join(', ')}
                            .
                          </p>
                          <Button variant="outline" size="sm" className="mt-3" onClick={clearAll}>
                            Clear search and filters
                          </Button>
                        </td>
                      </tr>
                    )}
                    {groups.map((g) => {
                      const open = !folded.includes(g.key)
                      return (
                        <React.Fragment key={g.key || 'all'}>
                          {g.key && (
                            <GroupRow
                              label={g.key}
                              detail={String(g.rows.length)}
                              open={open}
                              colSpan={COLS}
                              onToggle={() => setFolded((x) => toggle(x, g.key))}
                            />
                          )}
                          {open && g.rows.map(row)}
                        </React.Fragment>
                      )
                    })}
                    <AddRow
                      label="Write context"
                      colSpan={COLS}
                      onClick={() => navigate('/context/new')}
                    />
                  </tbody>
                  {/* While rows are picked the bar's band holds the foot, so the totals stop sticking over the last rows. */}
                  <tfoot className={cn('z-raised bg-background', !sel.count && 'sticky bottom-0')}>
                    <tr className="text-xs whitespace-nowrap text-muted-foreground tabular-nums shadow-hairline-top">
                      <td className={cn('hidden @xl/main:table-cell', boxes && 'table-cell')} />
                      <td />
                      <td className="h-bar px-1.5 @max-xl/main:px-3">{items(filtered.length)}</td>
                      <td className="hidden px-1.5 @min-[60rem]/main:table-cell" />
                      <td colSpan={2} className="hidden px-1.5 @xl/main:table-cell">
                        {
                          filtered.filter((f) => servedToAgents(f) && inForce(parseWhen(f.when)))
                            .length
                        }{' '}
                        in force now
                      </td>
                      <td colSpan={2} className="px-1.5 @max-xl/main:pr-4 @max-xl/main:text-right">
                        {filtered.filter((f) => trustOf(f) === 'due').length} to check
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </Loadable>
      </div>
      {/* Picked rows get their bar in a band of its own under the list, never over a row. */}
      <ContextBulk
        sel={sel}
        facts={facts}
        matching={filtered.map((f) => f.id)}
        deleting={deleting}
        setDeleting={setDeleting}
      />
    </div>
  )
}
