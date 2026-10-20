import { Fragment, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import type { Area } from '@domain/item'
import type { ConnectorManifest, ManifestField } from '@domain/connector-manifest'
import { modelFileAddress } from '@domain/catalogue'
import type { OperationsOverviewView, Setting } from '@/api'
import { areasQuery, operationsQuery, settingsQuery, useApiWrite } from '@/api/queries'
import { sourceSettingsQuery, sourceTypesQuery } from '@/api/source-queries'
import type { SourceSettings } from '@/api'
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  ClockIcon,
  DatabaseIcon,
  FileTextIcon,
  FlagIcon,
  GitCommitHorizontalIcon,
  HeedDomainIcon,
  InfoIcon,
  LayersIcon,
  LinkIcon,
  LoaderCircleIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SigmaIcon,
  TableIcon,
  TagIcon,
  TimerIcon,
  TriangleAlertIcon,
  type Icon,
} from '@/components/icons'
import { DomainBadge } from '@/components/item/item-marks'
import { FieldRow, FieldTable } from '@/components/item/field-table'
import { useDockMode } from '@/components/page/dock-panel'
import { gridCell } from '@/components/page/grid'
import {
  GridFailed,
  GridHeaderCells,
  GridMessage,
  GridTable,
  gridRowClass,
  gridRowLink,
  type GridColumn,
} from '@/components/page/grid-table'
import { PageContent } from '@/components/page/page'
import { useDockList } from '@/components/page/use-dock-list'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { BlockedButton } from '@/components/ui/blocked-button'
import { Button } from '@/components/ui/button'
import { CutTooltip } from '@/components/ui/truncated-text'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { panelRowHistory } from '@/lib/history'
import { formatMoment } from '@/lib/library'
import type { AdminSearch } from '@/lib/search-params'
import { ageWords, isSettingKey, jobNames, settingMeta, settingWords } from '@/lib/settings'
import {
  addSourceSearch,
  editSourceSearch,
  holdsWords,
  issueSummary,
  membersWords,
  needsALookWords,
  nextHourly,
  readResultWords,
  serverSettingWords,
  sourceIssues,
  sourceKindWords,
  sourceSearch,
  versionWords,
  type Source,
  type SourceIssue,
} from '@/lib/sources'
import { showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { SettingPanel } from './setting-panel'
import { AddConnectorPage, EditSourcePage, fieldIcon } from './source-form'
import { ProposeTermsPage, TermsBlock } from './propose-terms'
import { SettingsBlock } from './settings-parts'
import { SourceStatus } from './source-status'
import { SourcesLoading } from './sources-loading'

type Job = OperationsOverviewView['jobs'][number]

/** The job that reads every definition source. */
const SYNC_JOB = 'connectors.sync'
const optional = '@max-3xl:hidden'
const inlineLink = 'text-brand-ink underline underline-offset-4 hover:decoration-2'

/**
 * Sources (integrations decision, 12 October 2026): the tools Heed reads from, beside MCP and
 * gateway, which is how AI apps read from Heed. The list shows each source with its status, its
 * last read, what it holds and what needs a look; a source's page (`source=` in the address)
 * shows its status, its issues, what it holds by view, its settings and its recent reads, and
 * reads it again. Everything comes from the operations view (FR-810), so the service's rules for
 * the age of data and its warnings hold here unchanged. Administrators only.
 */
export function SourcesSection({ search }: { search: AdminSearch }) {
  if (search.source)
    return search.edit ? (
      <EditSource key={search.source} id={search.source} />
    ) : (
      <SourcePage key={search.source} id={search.source} search={search} />
    )
  return search.add ? <AddConnectorPage connector={search.connector} /> : <SourceList />
}

/** An added source's settings' form, once its settings are read. */
function EditSource({ id }: { id: string }) {
  const settings = useQuery(sourceSettingsQuery(id))
  if (settings.isPending) return <SourcesLoading />
  if (settings.isError)
    return (
      <PageContent width="reading">
        <GridFailed
          slot="source-form"
          what="the source's settings"
          retry={() => void settings.refetch()}
        />
      </PageContent>
    )
  return settings.data ? <EditSourcePage settings={settings.data} /> : <UnknownSource />
}

// ---- the list ----

const listColumns: GridColumn[] = [
  { icon: DatabaseIcon, title: 'Source', className: 'min-w-0 flex-1' },
  { icon: CircleCheckIcon, title: 'Status', className: 'w-column-status' },
  { icon: ClockIcon, title: 'Last read', className: cn('w-column-changed', optional) },
  { icon: LayersIcon, title: 'Holds', className: cn('w-column-about', optional) },
  { icon: FlagIcon, title: 'Issues', className: cn('w-column-about', optional) },
]

function SourceList() {
  const overview = useQuery(operationsQuery())
  if (overview.isPending) return <SourcesLoading />
  // By kind, in the order the overview lists them: definition sources today.
  const groups = new Map<string, Source[]>()
  for (const source of overview.data?.connectors ?? [])
    groups.set(source.kind, [...(groups.get(source.kind) ?? []), source])
  return (
    <PageContent width="overview" className="gap-8">
      <SettingsBlock
        title="Connected sources"
        slot="sources-block"
        description="Where we read from. A definition source says which metrics and dimensions exist. We check facts against it and never change it."
        action={
          <Button variant="outline" render={<Link to="/admin" search={addSourceSearch} />}>
            <PlusIcon aria-hidden />
            Add a connector
          </Button>
        }
      >
        {overview.isError ? (
          <GridFailed
            slot="settings-source-list"
            what="the sources"
            retry={() => void overview.refetch()}
          />
        ) : groups.size === 0 ? (
          <GridMessage slot="settings-source-list" icon={DatabaseIcon} title="No source read yet">
            We read the definition source within an hour of starting, and a source you add here at
            once. It shows here after its first read.
          </GridMessage>
        ) : (
          <GridTable
            slot="settings-source-list"
            label="Sources"
            header={<GridHeaderCells columns={listColumns} />}
          >
            {[...groups].map(([kind, sources]) => (
              <Fragment key={kind}>
                <div role="row" className="flex min-h-row items-center bg-sidebar px-3 py-2">
                  <div role="rowheader" className="flex min-w-0 flex-wrap gap-x-2 text-dense">
                    <span className="font-bold">{sourceKindWords[kind]?.title ?? kind}</span>
                    {sourceKindWords[kind] ? (
                      <span className="text-muted-foreground">
                        {sourceKindWords[kind].description}
                      </span>
                    ) : null}
                  </div>
                </div>
                {sources.map((source) => (
                  <SourceRow key={source.id} source={source} />
                ))}
              </Fragment>
            ))}
          </GridTable>
        )}
      </SettingsBlock>
      <p className="max-w-reading text-dense text-muted-foreground" data-slot="sources-elsewhere">
        AI apps that read these facts are in{' '}
        <Link to="/admin" search={{ section: 'gateway' }} className={inlineLink}>
          MCP and gateway
        </Link>
        . The hourly read is a job in{' '}
        <Link to="/admin" search={{ section: 'operations' }} className={inlineLink}>
          Operations
        </Link>
        .
      </p>
    </PageContent>
  )
}

function SourceRow({ source }: { source: Source }) {
  const issues = issueSummary(sourceIssues(source))
  return (
    <div role="row" data-source={source.id} className={gridRowClass}>
      <div
        role="cell"
        className={cn(
          gridCell,
          'min-w-0 flex-1 shrink flex-col items-start justify-center gap-1 py-2',
        )}
      >
        <Link
          to="/admin"
          search={sourceSearch(source.id)}
          className={cn(gridRowLink, 'max-w-full truncate')}
        >
          {source.name}
        </Link>
        <span className="max-w-full truncate text-dense text-muted-foreground">
          {source.tool}
          {/* Where the columns are gone, the line says what they would. */}
          <span className="@3xl:hidden">
            {issues === 'Nothing' ? `, ${holdsWords(source)}` : `: ${issues}`}
          </span>
        </span>
      </div>
      <div role="cell" className={cn(gridCell, 'w-column-status')}>
        <SourceStatus status={source.status} />
      </div>
      <div role="cell" className={cn(gridCell, 'w-column-changed tabular-nums', optional)}>
        <span className="truncate text-muted-foreground">
          {source.lastRead ? formatMoment(source.lastRead.at) : 'Never'}
        </span>
      </div>
      <div role="cell" className={cn(gridCell, 'w-column-about tabular-nums', optional)}>
        <span className="truncate">{holdsWords(source)}</span>
      </div>
      <div role="cell" className={cn(gridCell, 'w-column-about', optional)}>
        <span className="truncate" title={issues}>
          {issues}
        </span>
      </div>
    </div>
  )
}

// ---- a source's page ----

function SourcePage({ id, search }: { id: string; search: AdminSearch }) {
  const overview = useQuery(operationsQuery())
  if (overview.isPending) return <SourcesLoading />
  if (overview.isError)
    return (
      <PageContent width="overview">
        <GridFailed slot="source-page" what="the source" retry={() => void overview.refetch()} />
      </PageContent>
    )
  const source = overview.data.connectors.find((candidate) => candidate.id === id)
  if (!source) return <UnknownSource />
  if (search.terms) return <ProposeTermsPage source={source} values={search.values} />
  return <SourceDetail source={source} overview={overview.data} search={search} />
}

/**
 * A source's page. Its settings open in the docked panel as Limits' do: the open one is in the
 * address (`setting=`), Escape closes it, and focus returns to its Change link.
 */
function SourceDetail({
  source,
  overview,
  search,
}: {
  source: Source
  overview: OperationsOverviewView
  search: AdminSearch
}) {
  const settings = useQuery(settingsQuery())
  const added = useQuery({
    ...sourceSettingsQuery(source.id),
    enabled: source.origin === 'workspace',
  })
  const { data: areas = [] } = useQuery(areasQuery())
  const navigate = useNavigate()
  const mode = useDockMode()
  const [region, setRegion] = useState<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const job = overview.jobs.find((candidate) => candidate.name === SYNC_JOB)
  const running = overview.runner === 'running'
  const open = search.setting && source.settingKeys.includes(search.setting) ? search.setting : null
  const page = sourceSearch(source.id)
  const dock = useDockList({
    region,
    ids: source.settingKeys,
    panelId: open,
    open: (key) =>
      void navigate({
        to: '/admin',
        search: { ...page, setting: key },
        replace: true,
        state: true,
        resetScroll: false,
      }),
    close: () => void navigate({ to: '/admin', search: page, replace: true, resetScroll: false }),
    searchRef,
    enabled: !settings.isPending,
  })
  const openSetting: Setting | null | undefined = open
    ? settings.data
      ? (settings.data.find((setting) => setting.key === open) ?? null)
      : undefined
    : undefined

  return (
    <PageContent width="overview" className="gap-8" data-slot="source-page">
      <div hidden={open !== null && mode === 'full'} className="flex flex-col gap-8">
        <SourceHeader source={source} job={job} running={running} />
        <SourceStatusBlock source={source} job={job} checkedAt={overview.checkedAt} />
        <IssuesBlock issues={sourceIssues(source)} read={source.lastRead !== null} />
        <TermsBlock source={source} />
        {source.views.length ? (
          <ViewsBlock
            source={source}
            areas={areas}
            folderUrl={folderUrl(source, settings.data, added.data)}
          />
        ) : null}
        <div ref={setRegion}>
          {source.origin === 'workspace' ? (
            <AddedSettingsBlock
              source={source}
              settings={added.data}
              failed={added.isError}
              areas={areas}
            />
          ) : (
            <SourceSettingsBlock source={source} settings={settings.data} open={open} />
          )}
        </div>
        <RecentReadsBlock source={source} />
      </div>
      {open !== null ? (
        <SettingPanel key={open} setting={openSetting} position={null} onClose={dock.closePanel} />
      ) : null}
    </PageContent>
  )
}

/**
 * The model folder's web address, for links to model files: the administrator setting of the
 * server's source, or an added source's own setting.
 */
function folderUrl(
  source: Source,
  settings: readonly Setting[] | undefined,
  added: SourceSettings | null | undefined,
): string | null {
  if (source.origin === 'workspace')
    return typeof added?.config.modelUrl === 'string' ? added.config.modelUrl : null
  const setting = settings?.find((candidate) => source.settingKeys.includes(candidate.key))
  return typeof setting?.value === 'string' ? setting.value : null
}

function UnknownSource() {
  return (
    <PageContent width="overview">
      <Empty className="flex-none border" data-slot="source-not-found">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <DatabaseIcon />
          </EmptyMedia>
          <EmptyTitle>No source has this name</EmptyTitle>
          <EmptyDescription>
            It may have been removed. The list shows every source we read.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" render={<Link to="/admin" search={{ section: 'sources' }} />}>
            Open the sources
          </Button>
        </EmptyContent>
      </Empty>
    </PageContent>
  )
}

function SourceHeader({
  source,
  job,
  running,
}: {
  source: Source
  job: Job | undefined
  running: boolean
}) {
  const hourly = job ? nextHourly(job.cron, new Date()) !== null : false
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-title font-bold tracking-title">{source.name}</h1>
          <SourceStatus status={source.status} />
        </div>
        <p className="max-w-reading text-dense text-muted-foreground">
          {source.kind === 'definition_source'
            ? `Says which metrics and dimensions exist. We read ${source.tool} ${hourly ? 'every hour' : 'on a schedule'}, offline. We keep names, short descriptions and change marks, never a calculation or data.`
            : `We read ${source.tool} on a schedule.`}
        </p>
      </div>
      <ReadAgain source={source} job={job} running={running} />
    </div>
  )
}

/** Reads every definition source now: the hourly job, run at once (FR-810). */
function ReadAgain({
  source,
  job,
  running,
}: {
  source: Source
  job: Job | undefined
  running: boolean
}) {
  const run = useApiWrite('runJob')
  const [busy, setBusy] = useState(false)
  if (!job) return null
  if (!running)
    return (
      <BlockedButton
        reason="The job runner isn't running, so no read can start. We read on schedule once it runs."
        title="You can't read it now"
      >
        <RefreshCwIcon aria-hidden />
        Read again
      </BlockedButton>
    )
  if ((job.queue?.queued ?? 0) + (job.queue?.active ?? 0) > 0)
    return (
      <span className="flex h-control-md items-center gap-2 text-dense text-muted-foreground">
        <LoaderCircleIcon aria-hidden className="size-4 motion-safe:animate-spin" />
        Reading again
      </span>
    )
  return (
    <Button
      variant="outline"
      aria-disabled={busy || undefined}
      onClick={() => {
        if (busy) return
        setBusy(true)
        run
          .mutateAsync({ job: job.name })
          .then(
            () =>
              showToast(
                `Reading ${source.name} again`,
                'This page shows the new read within a minute.',
              ),
            (error: unknown) =>
              showToast(
                `${jobNames[job.name] ?? job.name} didn't start`,
                error instanceof Error ? error.message : 'Try again.',
              ),
          )
          .finally(() => setBusy(false))
      }}
    >
      {busy ? (
        <LoaderCircleIcon aria-hidden className="motion-safe:animate-spin" />
      ) : (
        <RefreshCwIcon aria-hidden />
      )}
      Read again
    </Button>
  )
}

function SourceStatusBlock({
  source,
  job,
  checkedAt,
}: {
  source: Source
  job: Job | undefined
  checkedAt: string
}) {
  const newest = source.recentReads[0]
  const next = job ? nextHourly(job.cron, new Date(checkedAt)) : null
  const looks = needsALookWords(source)
  return (
    <SettingsBlock title="Status" slot="source-status">
      <FieldTable label="Status" wideLabels>
        <FieldRow icon={ClockIcon} label="Last read">
          {newest ? (
            <span>
              <span className="tabular-nums">{formatMoment(newest.at)}</span>:{' '}
              {readResultWords(newest).toLowerCase()}
            </span>
          ) : (
            'Not read yet'
          )}
        </FieldRow>
        <FieldRow
          icon={TimerIcon}
          label="Next read"
          hint={
            source.status === 'disabled' ? "It's switched off, so the job skips it." : undefined
          }
        >
          {!job ? (
            'Not on a schedule'
          ) : next ? (
            <span>
              <span className="tabular-nums">{formatMoment(next.toISOString())}</span>, then every
              hour
            </span>
          ) : (
            <span>
              On the schedule <code className="font-mono text-caption">{job.cron}</code>
            </span>
          )}
        </FieldRow>
        <FieldRow
          icon={GitCommitHorizontalIcon}
          label="Model version"
          hint={
            source.lastSuccessAt
              ? `As of the last good read, ${formatMoment(source.lastSuccessAt)}.`
              : undefined
          }
        >
          {source.sourceVersion ? (
            <span className="font-mono text-caption" title={source.sourceVersion} translate="no">
              {versionWords(source.sourceVersion)}
            </span>
          ) : (
            'Not known yet'
          )}
        </FieldRow>
        <FieldRow icon={LayersIcon} label="Holds">
          <span className="tabular-nums">
            {source.lastRead ? membersWords(source) : 'Nothing yet'}
          </span>
        </FieldRow>
        <FieldRow
          icon={FlagIcon}
          label="Needs checking"
          hint="Facts that refer to a definition that changed or is gone, and mentions of one."
        >
          {source.flaggedItems ? (
            <Link
              to="/library"
              search={{ status: 'needs_check,source_missing' }}
              className={cn(inlineLink, 'tabular-nums')}
            >
              {looks}
            </Link>
          ) : (
            <span className="tabular-nums">{looks}</span>
          )}
        </FieldRow>
      </FieldTable>
    </SettingsBlock>
  )
}

const issueIcons: Record<SourceIssue['tone'], Icon> = {
  danger: CircleAlertIcon,
  warning: TriangleAlertIcon,
  info: InfoIcon,
}

function IssuesBlock({ issues, read }: { issues: readonly SourceIssue[]; read: boolean }) {
  return (
    <SettingsBlock
      title="Issues"
      slot="source-issues"
      description="What the last read couldn't settle. AI apps still get every accepted fact."
    >
      {!read ? (
        <p className="flex items-center gap-2 text-dense text-muted-foreground">
          <CircleDashedIcon aria-hidden="true" className="size-icon-sm shrink-0" />
          Not read yet. What its first read can&apos;t settle shows here.
        </p>
      ) : issues.length === 0 ? (
        <p className="flex items-center gap-2 text-dense text-muted-foreground">
          <CircleCheckIcon aria-hidden="true" className="size-icon-sm shrink-0" />
          Nothing to settle. The last read was complete, with no warnings.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {issues.map((issue) => {
            const Glyph = issueIcons[issue.tone]
            return (
              <Alert key={issue.id} variant={issue.tone} data-issue={issue.id}>
                <Glyph aria-hidden />
                <AlertContent>
                  <AlertTitle>{issue.title}</AlertTitle>
                  <AlertDescription>{issue.description}</AlertDescription>
                </AlertContent>
              </Alert>
            )
          })}
        </div>
      )}
    </SettingsBlock>
  )
}

const viewColumns: GridColumn[] = [
  { icon: TableIcon, title: 'View', className: 'min-w-0 flex-1' },
  { icon: HeedDomainIcon, title: 'Domain', className: 'w-column-domain' },
  { icon: SigmaIcon, title: 'Metrics', className: cn('w-column-count', optional) },
  { icon: TagIcon, title: 'Dimensions', className: cn('w-column-count-wide', optional) },
  { icon: FileTextIcon, title: 'File', className: cn('w-column-about', optional) },
]

function ViewsBlock({
  source,
  areas,
  folderUrl,
}: {
  source: Source
  areas: readonly Area[]
  folderUrl: string | null
}) {
  const missing = new Set(
    source.lastRead?.warnings
      .filter((warning) => warning.code === 'missing_domain')
      .map((warning) => warning.target),
  )
  return (
    <SettingsBlock
      title={`What ${source.tool} holds`}
      slot="source-views"
      description="Each view, the domain it belongs to, and the file that defines it."
    >
      <GridTable
        slot="source-view-list"
        label="Views"
        header={<GridHeaderCells columns={viewColumns} />}
      >
        {source.views.map((view) => {
          const file = modelFileAddress(folderUrl, view.modelFile)
          return (
            <div key={view.name} role="row" data-view={view.name} className={gridRowClass}>
              <div
                role="cell"
                className={cn(
                  gridCell,
                  'min-w-0 flex-1 shrink flex-col items-start justify-center gap-1 py-2',
                )}
              >
                <span className="max-w-full truncate font-mono text-caption" translate="no">
                  {view.name}
                </span>
                <span className="max-w-full truncate text-caption text-muted-foreground @3xl:hidden">
                  {viewCountWords(view)}
                </span>
              </div>
              <div role="cell" className={cn(gridCell, 'w-column-domain gap-1')}>
                <ViewDomain domains={view.domains} areas={areas} missing={missing.has(view.name)} />
              </div>
              <div role="cell" className={cn(gridCell, 'w-column-count tabular-nums', optional)}>
                {view.metrics.toLocaleString('en')}
              </div>
              <div
                role="cell"
                className={cn(gridCell, 'w-column-count-wide tabular-nums', optional)}
              >
                {view.dimensions.toLocaleString('en')}
              </div>
              <div role="cell" className={cn(gridCell, 'w-column-about', optional)}>
                {file?.url ? (
                  <a
                    href={file.url}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(inlineLink, 'truncate')}
                    title={file.path}
                  >
                    {file.path}
                  </a>
                ) : file ? (
                  <span className="truncate font-mono text-caption" title={file.path}>
                    {file.path}
                  </span>
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </div>
            </div>
          )
        })}
      </GridTable>
    </SettingsBlock>
  )
}

function viewCountWords(view: Source['views'][number]): string {
  const part = (n: number, noun: string) =>
    `${n.toLocaleString('en')} ${n === 1 ? noun : `${noun}s`}`
  return `${part(view.metrics, 'metric')}, ${part(view.dimensions, 'dimension')}`
}

/** A view's domain: the first one its members name, with how many more; or that it has none. */
function ViewDomain({
  domains,
  areas,
  missing,
}: {
  domains: readonly string[]
  areas: readonly Area[]
  missing: boolean
}) {
  const [first, ...rest] = domains
  if (first === undefined)
    return missing ? (
      <Badge form="soft" tone="warning" icon={TriangleAlertIcon} size="sm">
        No domain
      </Badge>
    ) : (
      <Badge form="bare" tone="neutral" quiet icon={CircleDashedIcon}>
        None
      </Badge>
    )
  const area = areas.find((candidate) => candidate.id === first)
  return (
    <>
      {area ? (
        <DomainBadge name={area.name} label={area.label} size="sm" className="min-w-0" />
      ) : (
        <Badge form="bare" tone="neutral" icon={HeedDomainIcon} fullText={first}>
          <span className="truncate font-mono text-caption">{first}</span>
        </Badge>
      )}
      {rest.length ? <MoreDomains ids={rest} areas={areas} /> : null}
    </>
  )
}

/** "+2": the domains a cell had no room for, named in its tooltip and to a screen reader. */
function MoreDomains({ ids, areas }: { ids: readonly string[]; areas: readonly Area[] }) {
  const names = ids
    .map((id) => areas.find((candidate) => candidate.id === id)?.name ?? id)
    .join(', ')
  return (
    <CutTooltip cut text={names}>
      <span className="relative z-raised shrink-0 text-caption text-muted-foreground">
        +{ids.length}
        <span className="sr-only">: {names}</span>
      </span>
    </CutTooltip>
  )
}

function SourceSettingsBlock({
  source,
  settings,
  open,
}: {
  source: Source
  settings: readonly Setting[] | undefined
  /** The setting open in the docked panel, so opening another replaces it in the history. */
  open: string | null
}) {
  const fromServer = source.views.reduce((sum, view) => sum + view.fromServer, 0)
  return (
    <SettingsBlock
      title="Settings"
      slot="source-settings"
      description="An admin can change the link here. Each change is a new version, and the history log keeps its reason. Whoever runs the server sets the rest there, and it never holds a secret."
    >
      <FieldTable label="Settings" wideLabels>
        {source.settingKeys.filter(isSettingKey).map((key) => {
          const setting = settings?.find((candidate) => candidate.key === key)
          const meta = settingMeta[key]
          return (
            <FieldRow key={key} icon={LinkIcon} label={meta.title} hint={meta.description}>
              <span
                data-row-id={key}
                className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-1"
              >
                <span className="min-w-0 break-all" data-setting-value={key}>
                  {setting ? settingWords(key, setting.value) : 'Loading'}
                </span>
                <Link
                  to="/admin"
                  search={{ ...sourceSearch(source.id), setting: key }}
                  {...panelRowHistory(open !== null)}
                  resetScroll={false}
                  data-row-link
                  aria-label={`Change the ${meta.title.toLowerCase()}`}
                  className={cn(inlineLink, 'font-bold')}
                >
                  Change
                </Link>
              </span>
            </FieldRow>
          )
        })}
        {source.server ? (
          source.server.settings.map((setting) => {
            const words = serverSettingWords[setting.key]
            const extra =
              setting.key === 'domain_overrides' && fromServer
                ? ` ${fromServer.toLocaleString('en')} ${fromServer === 1 ? 'definition takes its' : 'definitions take their'} domain from here now.`
                : ''
            return (
              <FieldRow
                key={setting.key}
                icon={LockIcon}
                label={words.label}
                hint={`Set on the server (${setting.variable}). ${words.hint}${extra}`}
              >
                <span className="flex flex-col gap-1" data-server-setting={setting.key}>
                  {setting.value ? (
                    <span className="font-mono text-caption break-all" translate="no">
                      {setting.value}
                    </span>
                  ) : (
                    words.unset
                  )}
                  {setting.key === 'renames'
                    ? source.renames.map((rename) => (
                        <span
                          key={rename.from}
                          className="font-mono text-caption break-all text-muted-foreground"
                          translate="no"
                        >
                          {rename.from} → {rename.to}
                        </span>
                      ))
                    : null}
                </span>
              </FieldRow>
            )
          })
        ) : (
          <FieldRow
            icon={LockIcon}
            label="Where the app runs"
            hint="The folder and files a source reads are set where the app runs."
          >
            The app doesn&apos;t read {source.name}
          </FieldRow>
        )}
        <FieldRow
          icon={TimerIcon}
          label="Out of date after"
          hint="When the last good read is older, Operations says so and we send an alert."
        >
          {ageWords(source.staleAfterSeconds)}
        </FieldRow>
      </FieldTable>
    </SettingsBlock>
  )
}

/**
 * An added source's settings, as an administrator gave them in Sources: each field of its type,
 * a secret only as set or not set, and the domain names. Change settings opens its form.
 */
function AddedSettingsBlock({
  source,
  settings,
  failed,
  areas,
}: {
  source: Source
  settings: SourceSettings | null | undefined
  failed: boolean
  areas: readonly Area[]
}) {
  const listings = useQuery(sourceTypesQuery())
  const manifest = listings.data?.find(
    (candidate) => candidate.manifest.id === source.type,
  )?.manifest
  return (
    <SettingsBlock
      title="Settings"
      slot="source-settings"
      description="An admin set these here. A change applies from the next read, and the history log keeps it. We never show a secret, only whether it's set."
      action={
        <Button
          variant="outline"
          render={<Link to="/admin" search={editSourceSearch(source.id)} />}
        >
          <PencilIcon aria-hidden />
          Change settings
        </Button>
      }
    >
      <FieldTable label="Settings" wideLabels>
        {failed ? (
          <FieldRow icon={CircleAlertIcon} label="Settings">
            The settings didn&apos;t load. Reload the page to try again.
          </FieldRow>
        ) : !settings || !manifest ? (
          <FieldRow icon={LoaderCircleIcon} label="Settings">
            Loading
          </FieldRow>
        ) : (
          settingRows(manifest).map((row) => (
            <FieldRow
              key={row.key}
              icon={fieldIcon(row.key, row.kind)}
              label={row.label}
              hint={row.kind === 'secret' ? 'Kept in the server’s secret store.' : undefined}
            >
              <span data-source-setting={row.key} className="min-w-0 break-all">
                <SettingValue
                  kind={row.kind}
                  value={settings.config[row.key]}
                  set={settings.secrets.find((secret) => secret.key === row.key)?.set ?? false}
                  options={row.options}
                  areas={areas}
                />
              </span>
            </FieldRow>
          ))
        )}
        <FieldRow
          icon={TimerIcon}
          label="Out of date after"
          hint="When the last good read is older, Operations says so and we send an alert."
        >
          {ageWords(source.staleAfterSeconds)}
        </FieldRow>
      </FieldTable>
    </SettingsBlock>
  )
}

/** An added source's settings in the form's order: each secret after what it is bound to. */
function settingRows(manifest: ConnectorManifest) {
  type Row = {
    key: string
    label: string
    kind: ManifestField['kind'] | 'secret'
    options?: ManifestField['options']
  }
  const rows: Row[] = []
  const placed = new Set<string>()
  for (const field of manifest.config.fields) {
    rows.push({ key: field.key, label: field.label, kind: field.kind, options: field.options })
    for (const secret of manifest.secrets)
      if (!placed.has(secret.key) && secret.boundTo.at(-1) === field.key) {
        rows.push({ key: secret.key, label: secret.label, kind: 'secret' })
        placed.add(secret.key)
      }
  }
  for (const secret of manifest.secrets)
    if (!placed.has(secret.key)) rows.push({ key: secret.key, label: secret.label, kind: 'secret' })
  return rows
}

const notSet = <span className="text-muted-foreground">Not set</span>

/** A setting as its page shows it: a secret only as set or not, never what it is. */
function SettingValue({
  kind,
  value,
  set,
  options,
  areas,
}: {
  kind: ManifestField['kind'] | 'secret'
  value: SourceSettings['config'][string] | undefined
  set: boolean
  options: ManifestField['options']
  areas: readonly Area[]
}) {
  if (kind === 'secret')
    return set ? (
      <Badge form="soft" tone="success" icon={CircleCheckIcon} size="sm">
        Set
      </Badge>
    ) : (
      notSet
    )
  if (kind === 'domain_map')
    return typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length ? (
      <span className="flex flex-col gap-1">
        {Object.entries(value).map(([from, to]) => (
          <span key={from} className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-caption" translate="no">
              {from}
            </span>
            <span aria-label="means" className="text-muted-foreground">
              →
            </span>
            {areas.find((area) => area.id === to)?.name ?? (
              <span className="font-mono text-caption">{to}</span>
            )}
          </span>
        ))}
      </span>
    ) : (
      <span className="text-muted-foreground">None</span>
    )
  if (kind === 'boolean') return value === true ? 'Yes' : 'No'
  if (kind === 'json') {
    if (typeof value !== 'string') return notSet
    const lines = value.split('\n').length
    return (
      <span className="text-muted-foreground">
        {lines.toLocaleString('en')} {lines === 1 ? 'line' : 'lines'} of JSON. Change settings shows
        them.
      </span>
    )
  }
  if (Array.isArray(value))
    return value.length ? (
      <span className="flex flex-col gap-1 font-mono text-caption" translate="no">
        {value.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </span>
    ) : (
      notSet
    )
  if (kind === 'select' || kind === 'radio')
    return typeof value === 'string' && value
      ? (options?.find((option) => option.value === value)?.label ?? value)
      : notSet
  if ((typeof value === 'string' && value) || typeof value === 'number')
    return (
      <span className="font-mono text-caption" translate="no">
        {String(value)}
      </span>
    )
  return notSet
}

const readColumns: GridColumn[] = [
  { icon: ClockIcon, title: 'Read', className: 'w-column-changed' },
  { icon: CircleCheckIcon, title: 'Result', className: 'min-w-0 flex-1' },
  { icon: FileTextIcon, title: 'Definitions', className: cn('w-column-count-wide', optional) },
  { icon: GitCommitHorizontalIcon, title: 'Version', className: cn('w-column-version', optional) },
]

function RecentReadsBlock({ source }: { source: Source }) {
  return (
    <SettingsBlock
      title="Recent reads"
      slot="source-reads"
      description="The newest reads, newest first. A failed read changes nothing."
    >
      {source.recentReads.length === 0 ? (
        <GridMessage slot="source-read-list" icon={ClockIcon} title="Not read yet">
          The first read comes with the next run of the hourly job.
        </GridMessage>
      ) : (
        <GridTable
          slot="source-read-list"
          label="Recent reads"
          header={<GridHeaderCells columns={readColumns} />}
        >
          {source.recentReads.map((read) => (
            <div key={read.at} role="row" data-read={read.status} className={gridRowClass}>
              <div role="cell" className={cn(gridCell, 'w-column-changed tabular-nums')}>
                <span className="truncate">{formatMoment(read.at)}</span>
              </div>
              <div role="cell" className={cn(gridCell, 'min-w-0 flex-1 gap-2')}>
                {read.status === 'failed' ? (
                  <>
                    <Badge form="soft" tone="danger" icon={CircleAlertIcon} size="sm">
                      Failed
                    </Badge>
                    <span className="truncate">Nothing changed</span>
                  </>
                ) : (
                  <span className="truncate">{readResultWords(read)}</span>
                )}
              </div>
              <div
                role="cell"
                className={cn(gridCell, 'w-column-count-wide tabular-nums', optional)}
              >
                {read.definitionsSeen.toLocaleString('en')}
              </div>
              <div role="cell" className={cn(gridCell, 'w-column-version', optional)}>
                {read.sourceVersion ? (
                  <span className="truncate font-mono text-caption" title={read.sourceVersion}>
                    {versionWords(read.sourceVersion)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </div>
            </div>
          ))}
        </GridTable>
      )}
    </SettingsBlock>
  )
}
