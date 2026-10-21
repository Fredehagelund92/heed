import { useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { api, type AuditEntry, type AuditSearchParams } from '@/api'
import { areasQuery, auditEntryQuery, auditPagesQuery } from '@/api/queries'
import { DateField } from '@/components/form/date-field'
import { PersonPicker, type PickedPerson } from '@/components/form/person-picker'
import {
  CalendarIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  ClockIcon,
  CodeIcon,
  DownloadIcon,
  HashIcon,
  HistoryIcon,
  LayersIcon,
  LinkIcon,
  ListChecksIcon,
  ListFilterIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  ShieldCheckIcon,
  TagIcon,
  TriangleAlertIcon,
  UserRoundCheckIcon,
  UserRoundIcon,
  XIcon,
} from '@/components/icons'
import { FieldRow, FieldTable } from '@/components/item/field-table'
import { DomainBadge } from '@/components/item/item-marks'
import { DockPanel, openRowClass, useDockMode } from '@/components/page/dock-panel'
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
import { PageContent } from '@/components/page/page'
import { useDockList } from '@/components/page/use-dock-list'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldLabel } from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { usePendingIndicator } from '@/hooks/use-pending-indicator'
import { panelRowHistory } from '@/lib/history'
import { formatMoment } from '@/lib/library'
import type { AdminSearch } from '@/lib/search-params'
import { toolName } from '@/lib/gateway'
import {
  auditActionFamilies,
  auditActionWords,
  auditByHeed,
  auditRows,
  auditFileName,
  auditSourceWords,
  isSettingKey,
  settingMeta,
} from '@/lib/settings'
import { showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { SettingsBlock, usePeople } from './settings-parts'
import { productName } from '@/lib/brand'

const SLOT = 'settings-audit'
const optional = '@max-3xl:hidden'

const columns: GridColumn[] = [
  { icon: ClockIcon, title: 'When', className: 'w-column-changed' },
  { icon: HistoryIcon, title: 'What', className: 'min-w-0 flex-1' },
  { icon: UserRoundIcon, title: 'Who', className: cn('w-column-owner', optional) },
  { icon: LayersIcon, title: 'Domain', className: cn('w-column-domain', optional) },
]

/** The search's filters as the history log's own. */
function filtersOf(search: AdminSearch): AuditSearchParams {
  return {
    ...(search.action ? { action: search.action } : {}),
    ...(search.actor ? { actorId: search.actor } : {}),
    ...(search.area ? { areaId: search.area } : {}),
    ...(search.from ? { from: search.from } : {}),
    ...(search.to ? { to: search.to } : {}),
    ...(search.batch ? { batchId: search.batch } : {}),
  }
}

/** What an entry is about: its words, and where it opens when it is a proposal or an item. */
type Subject = {
  words: string
  link?:
    | { to: '/proposals/$proposalId'; proposalId: string }
    | { to: '/library/$itemId'; itemId: string }
}

/**
 * What an entry is about, in words a person reads: a proposal by its number and title and an
 * item by its title (each a link, while the reader may see it), a setting by its title, an area,
 * a person or a tool by name, a client by its label, an agent by its name and its person. Other
 * ids stay in the panel.
 */
function useSubjects() {
  const { data: areas = [] } = useQuery(areasQuery())
  const { nameOf } = usePeople()
  return (entry: AuditEntry): Subject | null => {
    const id = entry.subjectId
    if (!id) return null
    switch (entry.subjectType) {
      case 'proposal': {
        const words = proposalWords(entry)
        if (!words) return null
        return entry.subjectNumber == null
          ? { words }
          : { words, link: { to: '/proposals/$proposalId', proposalId: id } }
      }
      case 'item':
        return entry.subjectTitle
          ? { words: entry.subjectTitle, link: { to: '/library/$itemId', itemId: id } }
          : null
      case 'setting':
        return { words: isSettingKey(id) ? settingMeta[id].title : id }
      case 'area': {
        const name = areas.find((area) => area.id === id)?.name
        return name ? { words: name } : null
      }
      case 'person':
        return { words: nameOf(id) }
      case 'tool':
        return { words: toolName(id) }
      case 'client':
        return { words: id }
      case 'ai_connection': {
        // The app as it named itself, and for whom when someone else ended it.
        const { client, person } = entry.details
        if (typeof client !== 'string') return null
        return {
          words:
            typeof person === 'string' && person !== entry.actorId
              ? `${client} for ${nameOf(person)}`
              : client,
        }
      }
      default:
        return null
    }
  }
}

/** A proposal as the log names it: "#2141 Spain net revenue ...", or what of it is known. */
function proposalWords(entry: AuditEntry): string | null {
  const number = entry.subjectNumber == null ? null : `#${entry.subjectNumber}`
  return [number, entry.subjectTitle].filter(Boolean).join(' ') || null
}

/**
 * A subject, as a link when it opens. In a row it is quiet and out of the tab order, as the
 * library's row links are: the row's own link covers the rest of the row.
 */
function SubjectLink({
  subject,
  inRow = false,
  className,
}: {
  subject: Subject
  inRow?: boolean
  className?: string
}) {
  const props = {
    className,
    ...(inRow ? { tabIndex: -1, title: subject.words } : {}),
  }
  const link = subject.link
  if (!link) return <span {...props}>{subject.words}</span>
  return link.to === '/proposals/$proposalId' ? (
    <Link to={link.to} params={{ proposalId: link.proposalId }} {...props}>
      {subject.words}
    </Link>
  ) : (
    <Link to={link.to} params={{ itemId: link.itemId }} {...props}>
      {subject.words}
    </Link>
  )
}

/**
 * The history log (FR-806, FR-808): every change an administrator, an owner or Heed itself
 * made, newest first, for administrators and auditors. It filters by kind of change, person,
 * area and days, reads older entries a page at a time, exports what the filters match as CSV or
 * JSON Lines, and checks that no entry was altered: each entry's hash follows from its content
 * and the entry before. An entry opens in the docked panel with everything it recorded.
 */
export function AuditSection({ search }: { search: AdminSearch }) {
  const navigate = useNavigate()
  const filters = useMemo(() => filtersOf(search), [search])
  const pages = useInfiniteQuery(auditPagesQuery(filters))
  const { data: areas = [] } = useQuery(areasQuery())
  const { nameOf, person } = usePeople()
  // The person chosen in the filter, with their address, until the address names another.
  const [chosen, setActor] = useState<PickedPerson | null>(null)
  const actor = chosen?.id === search.actor ? chosen : null
  const entries = useMemo(
    () => pages.data?.pages.flatMap((page) => page.entries) ?? [],
    [pages.data],
  )
  const [region, setRegion] = useState<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const list: AdminSearch = { ...search, entry: undefined }
  const rows = useMemo(() => auditRows(entries), [entries])
  const ids = useMemo(() => rows.map((row) => String(row.entry.seq)), [rows])
  const openSeq = search.entry ?? null
  const dock = useDockList({
    region,
    ids,
    panelId: openSeq === null ? null : String(openSeq),
    open: (id) =>
      void navigate({
        to: '/admin',
        search: { ...list, entry: Number(id) },
        replace: true,
        state: true,
        resetScroll: false,
      }),
    close: () => void navigate({ to: '/admin', search: list, replace: true, resetScroll: false }),
    searchRef,
    enabled: !pages.isPending,
  })
  const mode = useDockMode()
  // A filter is a new entry, and keeps the entry open in the panel: it reads it on its own.
  const update = (patch: Partial<AdminSearch>) =>
    void navigate({ to: '/admin', search: { ...search, ...patch }, resetScroll: false })
  const filtered = Object.keys(filters).length > 0
  const areaOf = (id: string | null) => areas.find((area) => area.id === id)
  const subjectOf = useSubjects()
  const go = (id: string | undefined) =>
    id
      ? () =>
          void navigate({
            to: '/admin',
            search: { ...list, entry: Number(id) },
            replace: true,
            state: true,
            resetScroll: false,
          })
      : undefined

  let body
  if (pages.isPending) body = <GridLoading slot={SLOT} label="Loading the history log" />
  else if (pages.isError)
    body = <GridFailed slot={SLOT} what="the history log" retry={() => void pages.refetch()} />
  else if (entries.length === 0)
    body = (
      <GridMessage
        slot={SLOT}
        icon={filtered ? ListFilterIcon : HistoryIcon}
        title={filtered ? 'No entries match' : 'Nothing is recorded yet'}
        action={
          filtered ? (
            <Button
              variant="outline"
              onClick={() =>
                update({
                  action: undefined,
                  actor: undefined,
                  area: undefined,
                  from: undefined,
                  to: undefined,
                  batch: undefined,
                })
              }
            >
              <XIcon aria-hidden />
              Clear filters
            </Button>
          ) : undefined
        }
      >
        {filtered
          ? 'Try another kind of change, person, domain or days.'
          : 'Every change to settings, roles, domains, proposals and what agents get shows here.'}
      </GridMessage>
    )
  else
    body = (
      <div
        ref={setRegion}
        hidden={openSeq !== null && mode === 'full'}
        className="flex flex-col gap-3"
      >
        <GridTable slot={SLOT} label="History log" header={<GridHeaderCells columns={columns} />}>
          {rows.map(({ entry, entries: grouped }) => {
            const area = areaOf(entry.areaId)
            const subject = subjectOf(entry)
            const who = auditByHeed(entry)
              ? productName
              : (entry.actorName ?? nameOf(entry.actorId))
            const times = grouped.length
            const open = openSeq !== null && grouped.some((one) => one.seq === openSeq)
            return (
              <div
                key={entry.seq}
                role="row"
                data-row-id={String(entry.seq)}
                data-entry={entry.seq}
                data-open={open || undefined}
                className={cn(gridRowClass, openRowClass)}
              >
                <div role="cell" className={cn(gridCell, 'w-column-changed tabular-nums')}>
                  <span
                    className="truncate text-muted-foreground"
                    title={formatMoment(entry.at, 'long')}
                  >
                    {formatMoment(entry.at)}
                  </span>
                </div>
                <div role="cell" className={cn(gridCell, 'min-w-0 flex-1 gap-2')}>
                  <Link
                    to="/admin"
                    search={{ ...list, entry: entry.seq }}
                    {...panelRowHistory(openSeq !== null)}
                    resetScroll={false}
                    data-row-link
                    className="shrink-0 truncate text-body outline-none after:absolute after:inset-0"
                  >
                    {auditActionWords(entry.action)}
                    {times > 1 ? ` ${times.toLocaleString('en')} times` : null}
                  </Link>
                  {subject ? (
                    <SubjectLink
                      subject={subject}
                      inRow
                      className={cn(
                        'min-w-0 truncate text-muted-foreground',
                        subject.link &&
                          'relative z-raised hover:text-foreground hover:underline hover:underline-offset-4',
                      )}
                    />
                  ) : null}
                </div>
                <div role="cell" className={cn(gridCell, 'w-column-owner', optional)}>
                  <span className="truncate">{who}</span>
                </div>
                <div role="cell" className={cn(gridCell, 'w-column-domain', optional)}>
                  {area ? <DomainBadge name={area.name} label={area.label} size="sm" /> : null}
                </div>
              </div>
            )
          })}
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
            Show older entries
          </Button>
        ) : (
          <p className="text-dense text-muted-foreground">
            {entries.length.toLocaleString('en')} {entries.length === 1 ? 'entry' : 'entries'}, back
            to the first.
          </p>
        )}
      </div>
    )

  const openEntry = entries.find((entry) => entry.seq === openSeq)

  return (
    <PageContent width="overview" className="gap-8">
      <SettingsBlock
        title="History log"
        slot="audit-block"
        description="Every change and decision, newest first, with who made it and why. Each entry is linked to the one before, so a changed entry shows."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ChainCheck />
            <ExportMenu filters={filters} />
          </div>
        }
      >
        {/* Every filter is 40 high, as the date fields are, so their labels share one line. */}
        <div
          className="grid grid-cols-2 items-end gap-3 @2xl:grid-cols-3 @5xl:flex @5xl:flex-wrap"
          data-slot="audit-filters"
        >
          <Field name="action" className="min-w-0 @5xl:w-column-owner">
            <FieldLabel>Kind of change</FieldLabel>
            <NativeSelect
              size="lg"
              value={search.action ?? ''}
              onChange={(event) => update({ action: event.target.value || undefined })}
            >
              <NativeSelectOption value="">Every kind</NativeSelectOption>
              {auditActionFamilies.map((family) => (
                <NativeSelectOption key={family.value} value={family.value}>
                  {family.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field name="actor" className="min-w-0 @5xl:w-column-about">
            <FieldLabel>Person</FieldLabel>
            {/* Leavers too, marked: what someone did stays in the log after they leave. */}
            <PersonPicker
              value={
                search.actor
                  ? (actor ?? {
                      id: search.actor,
                      name: nameOf(search.actor),
                      initials: person(search.actor)?.initials ?? '',
                    })
                  : null
              }
              onValueChange={(next) => {
                setActor(next)
                update({ actor: next?.id })
              }}
              everyone
              showClear
              placeholder="Anyone"
            />
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
          <Field name="from" className="min-w-0 @5xl:w-column-owner">
            <FieldLabel>From</FieldLabel>
            <DateField
              value={search.from ?? null}
              onValueChange={(value) => update({ from: value ?? undefined })}
              calendarLabel="Choose the first day"
              clearLabel="Remove the first day"
              placeholder="First day"
            />
          </Field>
          <Field name="to" className="min-w-0 @5xl:w-column-owner">
            <FieldLabel>To</FieldLabel>
            <DateField
              value={search.to ?? null}
              onValueChange={(value) => update({ to: value ?? undefined })}
              calendarLabel="Choose the last day"
              clearLabel="Remove the last day"
              placeholder="Last day"
            />
          </Field>
        </div>
        {search.batch ? (
          <div className="flex flex-wrap items-center gap-3" data-slot="audit-step">
            <p className="text-dense text-muted-foreground">
              Showing the role changes made in one step, with the reason given for them.
            </p>
            <Button variant="outline" size="sm" onClick={() => update({ batch: undefined })}>
              <XIcon aria-hidden />
              Show every change
            </Button>
          </div>
        ) : null}
        {body}
      </SettingsBlock>
      {openSeq !== null ? (
        <AuditEntryPanel
          key={openSeq}
          seq={openSeq}
          loaded={openEntry}
          saves={rows.find((row) => row.entry.seq === openSeq)?.entries ?? []}
          position={dock.position}
          onPrevious={go(dock.previousId)}
          onNext={go(dock.nextId)}
          onClose={dock.closePanel}
        />
      ) : null}
    </PageContent>
  )
}

/** Checks the whole chain on demand and says what it found, in words. */
function ChainCheck() {
  const [state, setState] = useState<
    'idle' | 'busy' | { verified: boolean; firstBadSeq: number | null } | 'failed'
  >('idle')
  const busy = state === 'busy'
  const spinning = usePendingIndicator(busy)
  return (
    <>
      <Button
        variant="outline"
        aria-disabled={busy || undefined}
        onClick={() => {
          if (busy) return
          setState('busy')
          api.verifyAudit().then(setState, () => setState('failed'))
        }}
      >
        {spinning ? (
          <LoaderCircleIcon aria-hidden className="motion-safe:animate-spin" />
        ) : (
          <ShieldCheckIcon aria-hidden />
        )}
        Check the chain
      </Button>
      {typeof state === 'object' || state === 'failed' ? (
        <div className="basis-full" role="status" data-slot="chain-result">
          {state === 'failed' ? (
            <Alert variant="danger">
              <TriangleAlertIcon aria-hidden />
              <AlertContent>
                <AlertTitle>We couldn&apos;t check the chain</AlertTitle>
                <AlertDescription>Check your connection, then try again.</AlertDescription>
              </AlertContent>
            </Alert>
          ) : state.verified ? (
            <Alert>
              <CircleCheckIcon aria-hidden />
              <AlertContent>
                <AlertTitle>Every entry checks out</AlertTitle>
                <AlertDescription>
                  Each entry&apos;s hash follows from its content and the entry before, so no entry
                  was changed or removed.
                </AlertDescription>
              </AlertContent>
            </Alert>
          ) : (
            <Alert variant="danger">
              <TriangleAlertIcon aria-hidden />
              <AlertContent>
                <AlertTitle>
                  Entry {state.firstBadSeq?.toLocaleString('en')} doesn&apos;t check out
                </AlertTitle>
                <AlertDescription>
                  Its hash doesn&apos;t follow from its content and the entry before, so it or an
                  earlier entry was changed. Keep an export of the log and tell the data team.
                </AlertDescription>
              </AlertContent>
            </Alert>
          )}
        </div>
      ) : null}
    </>
  )
}

/** Exports what the filters match, oldest first, as CSV or JSON Lines, every page of it. */
function ExportMenu({ filters }: { filters: AuditSearchParams }) {
  const [busy, setBusy] = useState(false)
  const spinning = usePendingIndicator(busy)
  const download = async (format: 'jsonl' | 'csv') => {
    setBusy(true)
    try {
      let after: number | undefined
      let content = ''
      let count = 0
      let verified = true
      for (;;) {
        const page = await api.exportAudit({
          ...filters,
          format,
          ...(after === undefined ? {} : { after }),
        })
        // A CSV page starts with its header; the pages after the first drop it.
        content +=
          after !== undefined && format === 'csv'
            ? page.content.slice(page.content.indexOf('\n') + 1)
            : page.content
        count += page.count
        verified = page.chain.verified
        if (page.next === null) break
        after = page.next
      }
      const blob = new Blob([content], {
        type: format === 'csv' ? 'text/csv' : 'application/x-ndjson',
      })
      const url = URL.createObjectURL(blob)
      const link = Object.assign(document.createElement('a'), {
        href: url,
        download: auditFileName(format, new Date().toISOString().slice(0, 10)),
      })
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      showToast(
        `${count.toLocaleString('en')} ${count === 1 ? 'entry' : 'entries'} exported`,
        verified
          ? 'The chain checked out when we read them.'
          : "The chain didn't check out. Someone changed an entry.",
      )
    } catch (error) {
      showToast("The export didn't download", error instanceof Error ? error.message : 'Try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" aria-disabled={busy || undefined} />}>
        {spinning ? (
          <LoaderCircleIcon aria-hidden className="motion-safe:animate-spin" />
        ) : (
          <DownloadIcon aria-hidden />
        )}
        Export
        <ChevronDownIcon aria-hidden className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void download('csv')}>
          CSV, for a spreadsheet
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void download('jsonl')}>
          JSON Lines, with every detail
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A detail's value in words: text as it is, anything else as JSON. */
const detailText = (value: unknown) =>
  value === null ? 'None' : typeof value === 'string' ? value : JSON.stringify(value)

/** One entry of the log in the docked panel, with every field it recorded. */
function AuditEntryPanel({
  seq,
  loaded,
  saves,
  position,
  onPrevious,
  onNext,
  onClose,
}: {
  seq: number
  /** The entry when a loaded page holds it; otherwise it is read on its own. */
  loaded: AuditEntry | undefined
  /** The entries of its row, newest first, when the row stands for several autosaves. */
  saves: readonly AuditEntry[]
  position: { index: number; total: number } | null
  onPrevious?: () => void
  onNext?: () => void
  onClose: () => void
}) {
  const single = useQuery({ ...auditEntryQuery(seq), enabled: loaded === undefined })
  const { data: areas = [] } = useQuery(areasQuery())
  const { nameOf } = usePeople()
  const subjectOf = useSubjects()
  const entry = loaded ?? single.data
  const shared = {
    meta: (
      <>
        <span className="truncate">Entry {seq.toLocaleString('en')}</span>
        {position ? (
          <span className="shrink-0">
            · {(position.index + 1).toLocaleString('en')} of {position.total.toLocaleString('en')}
          </span>
        ) : null}
      </>
    ),
    onPrevious,
    onNext,
    onClose,
  }
  if (entry === null || (entry === undefined && single.isError))
    return (
      <DockPanel
        title={single.isError ? "This entry didn't load" : 'No entry has this number'}
        {...shared}
      >
        <p className="text-body text-muted-foreground">
          Close this and choose an entry from the log.
        </p>
      </DockPanel>
    )
  if (entry === undefined) return <DockPanel title={null} {...shared} />
  const area = areas.find((candidate) => candidate.id === entry.areaId)
  const person = entry.actorKind === 'person' ? (entry.actorName ?? nameOf(entry.actorId)) : null
  const who =
    person && auditByHeed(entry)
      ? productName
      : (person ??
        (entry.actorKind === 'service' ? `A ${productName} service` : `${productName}, on its own`))
  const subject = subjectOf(entry)
  const details = Object.entries(entry.details)
  return (
    <DockPanel
      title={auditActionWords(entry.action)}
      contentKey={String(entry.seq)}
      note={
        <p className="text-body text-muted-foreground">
          {formatMoment(entry.at, 'long')} · {who}
        </p>
      }
      {...shared}
    >
      <div className="flex flex-col gap-6" data-slot="audit-entry">
        {saves.length > 1 ? (
          <p className="text-body text-muted-foreground" data-slot="audit-saves">
            The last of {saves.length.toLocaleString('en')} saves in a row, from{' '}
            {formatMoment(saves.at(-1)!.at)} to {formatMoment(entry.at)}. The log keeps each one,
            and the export lists them all.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            render={
              <Link to="/admin" search={{ section: 'audit', action: entry.action.split('.')[0] }} />
            }
          >
            <ListFilterIcon aria-hidden />
            More of this kind
          </Button>
          {entry.actorId && person ? (
            <Button
              variant="outline"
              size="sm"
              render={<Link to="/admin" search={{ section: 'audit', actor: entry.actorId }} />}
            >
              <UserRoundIcon aria-hidden />
              More by {person}
            </Button>
          ) : null}
          {entry.batchId ? (
            <Button
              variant="outline"
              size="sm"
              render={<Link to="/admin" search={{ section: 'audit', batch: entry.batchId }} />}
            >
              <ListChecksIcon aria-hidden />
              Same step
            </Button>
          ) : null}
        </div>
        <FieldTable label="What was recorded">
          <FieldRow icon={CalendarIcon} label="When">
            {formatMoment(entry.at, 'long')}
          </FieldRow>
          <FieldRow
            icon={UserRoundIcon}
            label="Who"
            {...(person && who === productName ? { hint: `Ran for ${person}.` } : {})}
          >
            {who}
          </FieldRow>
          <FieldRow icon={TagIcon} label="Action">
            <span className="font-mono text-dense" translate="no">
              {entry.action}
            </span>
          </FieldRow>
          {area ? (
            <FieldRow icon={LayersIcon} label="Domain">
              <DomainBadge name={area.name} label={area.label} size="sm" />
            </FieldRow>
          ) : null}
          {entry.subjectType ? (
            <FieldRow icon={CodeIcon} label="Subject">
              <span className="flex min-w-0 flex-col gap-1">
                {subject?.link ? (
                  <SubjectLink
                    subject={subject}
                    className="w-fit text-brand-ink underline underline-offset-4 hover:no-underline"
                  />
                ) : null}
                <span className="font-mono text-dense break-all" translate="no">
                  {entry.subjectType} {entry.subjectId}
                </span>
              </span>
            </FieldRow>
          ) : null}
          {entry.reason ? (
            <FieldRow icon={MessageSquareIcon} label="Why">
              <span className="text-dense break-words whitespace-pre-wrap">{entry.reason}</span>
            </FieldRow>
          ) : null}
          {entry.source ? (
            <FieldRow
              icon={UserRoundCheckIcon}
              label="Source"
              hint="Where the role change came from."
            >
              {auditSourceWords[entry.source]}
            </FieldRow>
          ) : null}
          {entry.requestId ? (
            <FieldRow
              icon={LinkIcon}
              label="Request"
              hint="The id our logs carry for this request."
            >
              <span className="font-mono text-dense break-all" translate="no">
                {entry.requestId}
              </span>
            </FieldRow>
          ) : null}
          <FieldRow
            icon={HashIcon}
            label="Hash"
            hint="Follows from this entry and the one before it."
          >
            <span className="font-mono text-dense break-all" translate="no">
              {entry.hash}
            </span>
          </FieldRow>
        </FieldTable>
        <div className="flex flex-col gap-3">
          <h3 className="text-body font-bold">Details</h3>
          {details.length ? (
            <FieldTable label="Details of the entry" wideLabels>
              {details.map(([key, value]) => (
                <FieldRow key={key} icon={CodeIcon} label={key}>
                  {/* A long value, such as a source's settings as JSON, wraps anywhere. */}
                  <span className="text-dense wrap-anywhere whitespace-pre-wrap">
                    {detailText(value)}
                  </span>
                </FieldRow>
              ))}
            </FieldTable>
          ) : (
            <p className="text-body text-muted-foreground">This entry has no details.</p>
          )}
        </div>
      </div>
    </DockPanel>
  )
}
