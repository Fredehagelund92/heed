import { useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import type { ConnectorManifest, ManifestField } from '@domain/connector-manifest'
import { fieldVisible } from '@domain/connector-config'
import type { CheckStep } from '@domain/connector-runtime'
import type { ConnectorListing, SourceCheck, SourceSettings } from '@/api'
import { ApiError } from '@/api/errors'
import { areasQuery, operationsQuery, useApiWrite } from '@/api/queries'
import { sourceTypesQuery } from '@/api/source-queries'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CodeIcon,
  DatabaseIcon,
  FolderIcon,
  GitBranchIcon,
  GlobeIcon,
  HashIcon,
  HeedDomainIcon,
  KeyRoundIcon,
  LinkIcon,
  ListChecksIcon,
  ListIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  NetworkIcon,
  PlugIcon,
  PlusIcon,
  ShieldCheckIcon,
  SquareCheckIcon,
  TagIcon,
  TimerIcon,
  TriangleAlertIcon,
  UserRoundIcon,
  XIcon,
  type Icon,
} from '@/components/icons'
import { HelpLink } from '@/components/help/help-link'
import { GridFailed } from '@/components/page/grid-table'
import { PageContent } from '@/components/page/page'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Field,
  FieldControl,
  FieldCounter,
  FieldDescription,
  FieldError,
  FieldFooter,
  FieldGroup,
  FieldHeader,
  FieldItem,
  FieldItemContent,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { usePendingIndicator } from '@/hooks/use-pending-indicator'
import {
  addConnectorSearch,
  addSourceSearch,
  checkWords,
  connectorKindWords,
  connectorMaturityWords,
  egressWords,
  scheduleWords,
  sourceFormInput,
  sourceFormProblems,
  sourceFormValues,
  sourceSearch,
  type DomainNameRow,
  type SourceFormValues,
} from '@/lib/sources'
import { showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { ComingSoonNote, connectorIcons } from './coming-soon-sources'
import { SettingsBlock } from './settings-parts'
import { SourcesLoading } from './sources-loading'

const REASON_MAX = 500
/** The job that reads every definition source; a new source is read with it at once. */
const SYNC_JOB = 'connectors.sync'

/** The icons of the fields the Cube connector has, by key, where a key says more than a kind. */
const keyIcons: Record<string, Icon> = {
  repository: GlobeIcon,
  ref: GitBranchIcon,
  folder: FolderIcon,
  token: KeyRoundIcon,
  username: UserRoundIcon,
  modelUrl: LinkIcon,
  domainNames: HeedDomainIcon,
}

/** Each kind of field's icon, in the form and on the source's page. */
const kindIcons: Record<ManifestField['kind'] | 'secret', Icon> = {
  text: TagIcon,
  address: GlobeIcon,
  path: FolderIcon,
  ref: GitBranchIcon,
  select: ListChecksIcon,
  radio: ListChecksIcon,
  boolean: SquareCheckIcon,
  integer: HashIcon,
  list: ListIcon,
  json: CodeIcon,
  domain_map: HeedDomainIcon,
  secret: KeyRoundIcon,
}

/** A field's icon: by its key when the key says more, otherwise by its kind. */
export const fieldIcon = (key: string, kind: ManifestField['kind'] | 'secret'): Icon =>
  keyIcons[key] ?? kindIcons[kind]

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

function ConnectorGlyph({ manifest }: { manifest: ConnectorManifest }) {
  const Glyph = manifest.icon ? connectorIcons[manifest.icon] : PlugIcon
  return (
    <span
      aria-hidden="true"
      className="flex size-control-lg shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground"
    >
      <Glyph className="size-5" />
    </span>
  )
}

/** How far along a connector is, as a quiet badge; nothing for a stable one. */
function MaturityBadge({ manifest }: { manifest: ConnectorManifest }) {
  const words = connectorMaturityWords[manifest.maturity]
  if (!words) return null
  return (
    <Badge form="outline" size="sm" icon={TimerIcon} data-slot="connector-maturity">
      {words}
    </Badge>
  )
}

const checkIcons = {
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
  danger: CircleAlertIcon,
} as const

const stepIcons: Record<CheckStep['status'], { icon: Icon; className: string; words: string }> = {
  ok: { icon: CircleCheckIcon, className: 'text-status-success-icon', words: 'Done' },
  warning: { icon: TriangleAlertIcon, className: 'text-status-warning-icon', words: 'Warning' },
  failed: { icon: CircleAlertIcon, className: 'text-status-danger-fg', words: 'Failed' },
  skipped: { icon: CircleDashedIcon, className: 'text-muted-foreground', words: 'Skipped' },
}

/**
 * Adding a source (connector interface 3.0): first the connectors this server has, by what they
 * sync, each with what it reads; then the chosen one's page, with the least access it needs and
 * its form, which its manifest declares (so no screen names a vendor, CON-101). Test connection
 * runs its check and one read, and keeps nothing; Add connector saves it and reads it at once.
 * Admins only.
 */
export function AddConnectorPage({ connector }: { connector: string | undefined }) {
  const listings = useQuery(sourceTypesQuery())
  if (listings.isPending) return <SourcesLoading />
  if (listings.isError)
    return (
      <PageContent width="reading">
        <GridFailed
          slot="source-form"
          what="the connectors"
          retry={() => void listings.refetch()}
        />
      </PageContent>
    )
  // This form has no step to choose a content source's folders, which the new web app's connect
  // flow has: here an admin adds definition sources only.
  const addable = listings.data.filter((candidate) => candidate.manifest.kind === 'definitions')
  if (connector === undefined) return <ConnectorList listings={addable} />
  const listing = addable.find((candidate) => candidate.manifest.id === connector)
  if (!listing) return <UnknownConnector />
  return (
    <PageContent width="reading" className="gap-8" data-slot="source-form">
      <ConnectorHeader manifest={listing.manifest} />
      <ConnectorFacts manifest={listing.manifest} />
      <SourceFormBody key={listing.manifest.id} manifest={listing.manifest} settings={null} />
    </PageContent>
  )
}

/** The connectors to add a source of, by kind: each a row that opens its form. */
function ConnectorList({ listings }: { listings: readonly ConnectorListing[] }) {
  // Stable connectors first, then by name; each kind in its own group.
  const order = { stable: 0, beta: 1, experimental: 2 } as const
  const sorted = [...listings].sort(
    (a, b) =>
      order[a.manifest.maturity] - order[b.manifest.maturity] ||
      a.manifest.title.localeCompare(b.manifest.title),
  )
  const kinds = (['definitions', 'content'] as const).filter((kind) =>
    sorted.some((listing) => listing.manifest.kind === kind),
  )
  // How many sources already use each connector, the server's own among them.
  const overview = useQuery(operationsQuery())
  const inUse = (id: string) =>
    overview.data?.connectors.filter((source) => source.type === id).length ?? 0
  return (
    <PageContent width="reading" className="gap-8" data-slot="connector-list">
      <SourceFormHeader title="Add a connector">
        A connector reads one tool for us, offline and read only. Choose one, fill in its settings
        and test them. We read nothing until you add it.{' '}
        <HelpLink to="add-a-connector">How it works</HelpLink>
      </SourceFormHeader>
      {kinds.length === 0 ? (
        <Empty className="flex-none border" data-slot="connector-list-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PlugIcon />
            </EmptyMedia>
            <EmptyTitle>No connector to add here</EmptyTitle>
            <EmptyDescription>
              The list shows the sources the app reads from its own settings.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        kinds.map((kind) => (
          <SettingsBlock
            key={kind}
            title={connectorKindWords[kind].title}
            description={connectorKindWords[kind].description}
            slot={`connectors-${kind}`}
          >
            <ul
              aria-label={`${connectorKindWords[kind].title} connectors`}
              className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card"
            >
              {sorted
                .filter((listing) => listing.manifest.kind === kind)
                .map(({ manifest }) => (
                  <li
                    key={manifest.id}
                    data-connector={manifest.id}
                    className="relative flex min-w-0 items-start gap-4 px-4 py-3 hover:bg-accent has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-ring"
                  >
                    <ConnectorGlyph manifest={manifest} />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <Link
                          to="/admin"
                          search={addConnectorSearch(manifest.id)}
                          className="text-body font-bold outline-none after:absolute after:inset-0"
                        >
                          {manifest.title}
                        </Link>
                        <MaturityBadge manifest={manifest} />
                      </span>
                      <span className="line-clamp-2 text-dense text-muted-foreground">
                        {manifest.summary}
                      </span>
                    </div>
                    {inUse(manifest.id) ? (
                      <span
                        data-slot="connector-in-use"
                        className="hidden shrink-0 self-center text-dense text-muted-foreground tabular-nums @md:block"
                      >
                        {inUse(manifest.id).toLocaleString('en')}{' '}
                        {inUse(manifest.id) === 1 ? 'source' : 'sources'}
                      </span>
                    ) : null}
                    <ChevronRightIcon
                      aria-hidden="true"
                      className="size-4 shrink-0 self-center text-muted-foreground"
                    />
                  </li>
                ))}
            </ul>
          </SettingsBlock>
        ))
      )}
      <ComingSoonNote />
    </PageContent>
  )
}

function UnknownConnector() {
  return (
    <PageContent width="reading">
      <Empty className="flex-none border" data-slot="connector-not-found">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PlugIcon />
          </EmptyMedia>
          <EmptyTitle>No connector has this name</EmptyTitle>
          <EmptyDescription>
            This server may no longer have it. The connectors you can add are on the list.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" render={<Link to="/admin" search={addSourceSearch} />}>
            Open the connectors
          </Button>
        </EmptyContent>
      </Empty>
    </PageContent>
  )
}

/** The chosen connector: its picture, its title, the tool it reads and what it syncs. */
function ConnectorHeader({ manifest }: { manifest: ConnectorManifest }) {
  return (
    <div className="flex min-w-0 items-start gap-4" data-slot="connector-header">
      <ConnectorGlyph manifest={manifest} />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-title font-bold tracking-title">{manifest.title}</h1>
          <MaturityBadge manifest={manifest} />
        </div>
        <p className="max-w-reading text-dense text-muted-foreground">{manifest.summary}</p>
      </div>
    </div>
  )
}

/**
 * What the connector syncs, how often, where it reaches and the least access it needs, said
 * before anything is given (CON-106, CON-113).
 */
function ConnectorFacts({ manifest }: { manifest: ConnectorManifest }) {
  const hosts = egressWords(manifest)
  const facts: { icon: Icon; label: string; value: ReactNode }[] = [
    { icon: DatabaseIcon, label: 'Syncs', value: connectorKindWords[manifest.kind].syncs },
    {
      icon: TimerIcon,
      label: 'Reads',
      value: `${capitalized(scheduleWords(manifest.schedule.default))}, read only`,
    },
    {
      icon: NetworkIcon,
      label: 'Reaches',
      value: hosts.length ? hosts.join('; ') : 'Nothing outside the app',
    },
  ]
  return (
    <SettingsBlock title="What it reads" slot="source-type">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg border bg-card p-4 @md:grid-cols-3">
        {facts.map((fact) => (
          <div key={fact.label} className="flex min-w-0 flex-col gap-1">
            <dt className="flex items-center gap-2 text-caption text-muted-foreground">
              <fact.icon aria-hidden="true" className="size-icon-sm" />
              {fact.label}
            </dt>
            <dd className="text-dense">{fact.value}</dd>
          </div>
        ))}
      </dl>
      <ul className="flex flex-col gap-2" aria-label="The access it needs">
        {manifest.access.map((line) => (
          <li key={line} className="flex items-start gap-2 text-dense">
            <ShieldCheckIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </SettingsBlock>
  )
}

/** A source's settings, to change: the same form, filled, with each secret said to be set. */
export function EditSourcePage({ settings }: { settings: SourceSettings }) {
  const listings = useQuery(sourceTypesQuery())
  if (listings.isPending) return <SourcesLoading />
  if (listings.isError)
    return (
      <PageContent width="reading">
        <GridFailed
          slot="source-form"
          what="the source's form"
          retry={() => void listings.refetch()}
        />
      </PageContent>
    )
  const listing = listings.data.find((candidate) => candidate.manifest.id === settings.type)
  return (
    <PageContent width="reading" className="gap-8" data-slot="source-form">
      <SourceFormHeader title={`Change ${settings.name}`}>
        Changes apply from the next read and are kept in the history log. A secret left empty keeps
        the one the server holds.
      </SourceFormHeader>
      {listing ? (
        <SourceFormBody manifest={listing.manifest} settings={settings} />
      ) : (
        <p className="text-body text-muted-foreground">
          The connector for this source is gone, so you can&apos;t change its settings here.
        </p>
      )}
    </PageContent>
  )
}

function SourceFormHeader({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-title font-bold tracking-title">{title}</h1>
      <p className="max-w-reading text-dense text-muted-foreground">{children}</p>
    </div>
  )
}

/** The settings in the order the form shows them: each secret after what it is bound to. */
type FormEntry =
  | { type: 'field'; field: ManifestField }
  | { type: 'secret'; secret: ConnectorManifest['secrets'][number] }

function formEntries(manifest: ConnectorManifest, fields: readonly ManifestField[]): FormEntry[] {
  const entries: FormEntry[] = []
  const placed = new Set<string>()
  for (const field of fields) {
    entries.push({ type: 'field', field })
    for (const secret of manifest.secrets)
      if (!placed.has(secret.key) && secret.boundTo.at(-1) === field.key) {
        entries.push({ type: 'secret', secret })
        placed.add(secret.key)
      }
  }
  return entries
}

/**
 * The form, drawn from the manifest. Every value stays in the page until it is sent; a secret
 * goes to the service only, which never sends it back. Add connector (or Save changes) is never
 * disabled: pressing it says what is missing, next to the field.
 */
function SourceFormBody({
  manifest,
  settings,
}: {
  manifest: ConnectorManifest
  settings: SourceSettings | null
}) {
  const isNew = settings === null
  const { data: areas = [] } = useQuery(areasQuery())
  const navigate = useNavigate()
  const add = useApiWrite('addSource')
  const update = useApiWrite('updateSource')
  const test = useApiWrite('testSource')
  const run = useApiWrite('runJob')
  const [values, setValues] = useState<SourceFormValues>(() =>
    sourceFormValues(manifest, settings ?? undefined),
  )
  const [shown, setShown] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [check, setCheck] = useState<SourceCheck | null>(null)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const spinning = usePendingIndicator(busy)
  const testSpinning = usePendingIndicator(testing)
  const visible = manifest.config.fields.filter((field) =>
    fieldVisible(field, { ...values.fields, ...values.flags }),
  )
  const main = formEntries(
    manifest,
    visible.filter((field) => !field.advanced),
  )
  const advanced = formEntries(
    manifest,
    visible.filter((field) => field.advanced),
  )
  const unplaced = manifest.secrets.filter(
    (secret) =>
      ![...main, ...advanced].some(
        (entry) => entry.type === 'secret' && entry.secret.key === secret.key,
      ),
  )
  const order = [
    'name',
    ...main.map((entry) => (entry.type === 'field' ? entry.field.key : entry.secret.key)),
    ...unplaced.map((secret) => secret.key),
    ...advanced.map((entry) => (entry.type === 'field' ? entry.field.key : entry.secret.key)),
    'reason',
  ]
  // More settings opens by itself when one of them holds a value or a problem.
  const [moreOpen, setMoreOpen] = useState(() =>
    advanced.some(
      (entry) =>
        entry.type === 'field' &&
        ((values.fields[entry.field.key] ?? '') !== '' ||
          (values.maps[entry.field.key] ?? []).length > 0),
    ),
  )
  const secretSet = (key: string) =>
    settings?.secrets.find((secret) => secret.key === key)?.set ?? false
  // A stored secret is sent only to where it was given for (the service forgets it).
  const rebound = (key: string) => {
    if (settings === null) return false
    const secret = manifest.secrets.find((candidate) => candidate.key === key)
    return (secret?.boundTo ?? []).some((bound) => {
      const before = settings.config[bound]
      return (values.fields[bound] ?? '').trim() !== (typeof before === 'string' ? before : '')
    })
  }

  const change = (next: SourceFormValues) => {
    setValues(next)
    // What a test said is about the settings it read: a change makes it old.
    setCheck(null)
    const marked = Object.keys(shown).filter((key) => shown[key])
    if (marked.length) {
      const problems = sourceFormProblems(manifest, next, { isNew })
      setShown(Object.fromEntries(marked.map((key) => [key, problems[key] ?? ''])))
    }
  }

  const focusFirst = (problems: Record<string, string>) => {
    const first = order.find((key) => problems[key])
    if (first && advanced.some((entry) => entry.type === 'field' && entry.field.key === first))
      setMoreOpen(true)
    if (first) requestAnimationFrame(() => document.getElementById(`source-${first}`)?.focus())
    return first !== undefined
  }

  /** The service's refusal, by field where it names one; otherwise in the page's alert. */
  const refused = (error: unknown, what: string) => {
    if (error instanceof ApiError && error.kind === 'invalid' && error.findings.length) {
      const byField = Object.fromEntries(
        error.findings.map((finding) => [
          order.includes(finding.field) ? finding.field : 'reason',
          finding.message,
        ]),
      )
      setShown(byField)
      focusFirst(byField)
      return
    }
    const message = error instanceof Error && error.message ? error.message : 'Try again.'
    setFailure(
      error instanceof ApiError && error.kind === 'conflict'
        ? 'Someone changed this source after you opened it. Open its page again to see their change.'
        : `${what} ${message}`,
    )
  }

  const runTest = async () => {
    if (testing) return
    const problems = sourceFormProblems(manifest, values, { isNew, withReason: false })
    delete problems.name
    setShown(problems)
    if (focusFirst(problems)) return
    setFailure(null)
    setTesting(true)
    try {
      const { config, secrets } = sourceFormInput(manifest, values)
      setCheck(
        await test.mutateAsync({
          ...(settings ? { id: settings.id } : {}),
          type: manifest.id,
          config,
          secrets,
        }),
      )
    } catch (error) {
      refused(error, "The test didn't run.")
    } finally {
      setTesting(false)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const problems = sourceFormProblems(manifest, values, { isNew })
    setShown(problems)
    if (focusFirst(problems)) return
    setFailure(null)
    setBusy(true)
    const { config, secrets } = sourceFormInput(manifest, values)
    const fields = { name: values.name.trim(), config, secrets, reason: values.reason.trim() }
    try {
      if (settings) {
        const saved = await update.mutateAsync({
          ...fields,
          id: settings.id,
          revision: settings.revision,
        })
        showToast(`${saved.name} saved`, 'We read it with these settings from the next read.')
        void navigate({ to: '/admin', search: sourceSearch(saved.id) })
      } else {
        const saved = await add.mutateAsync({ ...fields, type: manifest.id })
        // Read at once, so its page fills within a minute rather than at the next hour.
        const queued = await run.mutateAsync({ job: SYNC_JOB }).then(
          () => true,
          () => false,
        )
        showToast(
          `${saved.name} added`,
          queued
            ? "We're reading it now. Its page shows the read within a minute."
            : 'We read it within the hour.',
        )
        void navigate({ to: '/admin', search: sourceSearch(saved.id) })
      }
    } catch (error) {
      refused(error, isNew ? "The source wasn't added." : "The source wasn't saved.")
    } finally {
      setBusy(false)
    }
  }

  const checkShown = check ? checkWords(check, manifest.tool) : null
  const CheckGlyph = checkShown ? checkIcons[checkShown.tone] : null

  const renderEntry = (entry: FormEntry) =>
    entry.type === 'secret' ? (
      <SecretField
        key={entry.secret.key}
        secret={entry.secret}
        value={values.secrets[entry.secret.key] ?? ''}
        set={secretSet(entry.secret.key)}
        rebound={rebound(entry.secret.key)}
        isNew={isNew}
        problem={shown[entry.secret.key]}
        disabled={busy}
        onChange={(next) =>
          change({ ...values, secrets: { ...values.secrets, [entry.secret.key]: next } })
        }
      />
    ) : (
      <SettingField
        key={entry.field.key}
        field={entry.field}
        values={values}
        areas={areas}
        problem={shown[entry.field.key]}
        disabled={busy}
        onChange={change}
      />
    )

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-label={isNew ? `Add ${manifest.title}` : `Change ${settings.name}`}
      aria-busy={busy || undefined}
      className="@container flex flex-col gap-6"
    >
      {failure ? (
        <Alert variant="danger" role="alert">
          <CircleAlertIcon aria-hidden />
          <AlertContent>
            <AlertTitle>{isNew ? "The source wasn't added" : "The source wasn't saved"}</AlertTitle>
            <AlertDescription>{failure}</AlertDescription>
          </AlertContent>
        </Alert>
      ) : null}
      <FieldGroup>
        <Field name="name" invalid={Boolean(shown.name)} disabled={busy}>
          <FieldHeader>
            <FieldLabel icon={DatabaseIcon}>Name</FieldLabel>
            <FieldDescription>
              How Sources and the Catalogue name it, such as Finance metrics.
              {isNew ? ' We make its address from the name, and the address stays.' : ''}
            </FieldDescription>
          </FieldHeader>
          <FieldControl
            value={values.name}
            onValueChange={(next) => change({ ...values, name: String(next) })}
            render={<Input id="source-name" size="lg" autoComplete="off" />}
          />
          <FieldError>{shown.name}</FieldError>
        </Field>
        {main.map(renderEntry)}
        {unplaced.map((secret) => renderEntry({ type: 'secret', secret }))}
        {advanced.length ? (
          <Collapsible
            open={moreOpen}
            onOpenChange={setMoreOpen}
            className="flex flex-col gap-6"
            data-slot="source-more"
          >
            <CollapsibleTrigger className="group/more inline-flex w-fit items-center gap-2 rounded-sm text-dense font-bold text-muted-foreground hover:text-foreground">
              <ChevronDownIcon
                aria-hidden="true"
                className="size-4 -rotate-90 transition-transform group-data-panel-open/more:rotate-0"
              />
              More settings
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-6">
              {advanced.map(renderEntry)}
            </CollapsibleContent>
          </Collapsible>
        ) : null}
        <Field name="reason" invalid={Boolean(shown.reason)} disabled={busy}>
          <FieldHeader>
            <FieldLabel icon={MessageSquareIcon}>Why</FieldLabel>
            <FieldDescription>
              The history log keeps it with the change. It says a secret was set, never what it is.
            </FieldDescription>
          </FieldHeader>
          <FieldControl
            id="source-reason"
            value={values.reason}
            onValueChange={(next) => change({ ...values, reason: String(next) })}
            render={<Textarea rows={3} className="resize-y text-body pointer-coarse:text-large" />}
          />
          <FieldFooter>
            <FieldError>{shown.reason}</FieldError>
            <FieldCounter count={[...values.reason].length} max={REASON_MAX} />
          </FieldFooter>
        </Field>
      </FieldGroup>
      {check && checkShown && CheckGlyph ? (
        <Alert variant={checkShown.tone} role="status" data-slot="source-check" data-ok={check.ok}>
          <CheckGlyph aria-hidden />
          <AlertContent>
            <AlertTitle>{checkShown.title}</AlertTitle>
            <AlertDescription>{checkShown.description}</AlertDescription>
            {check.steps.length ? <CheckSteps steps={check.steps} /> : null}
          </AlertContent>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-3 @md:flex-row @md:flex-wrap @md:items-center">
        <Button
          type="button"
          variant="outline"
          size="lg"
          aria-disabled={testing || busy || undefined}
          onClick={() => void runTest()}
          className="relative"
        >
          <span
            className={
              testSpinning ? 'flex items-center gap-2 opacity-0' : 'flex items-center gap-2'
            }
          >
            <PlugIcon aria-hidden />
            Test connection
          </span>
          {testSpinning ? (
            <LoaderCircleIcon
              aria-hidden
              className="absolute inset-0 m-auto motion-safe:animate-spin"
            />
          ) : null}
        </Button>
        <span className="hidden flex-1 @md:block" />
        <Button
          variant="ghost"
          className="order-last @md:order-none"
          size="lg"
          render={
            <Link to="/admin" search={settings ? sourceSearch(settings.id) : addSourceSearch} />
          }
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="lg"
          aria-disabled={busy || undefined}
          onMouseDown={(event) => event.preventDefault()}
          className="relative"
        >
          <span className={spinning ? 'opacity-0' : undefined}>
            {isNew ? 'Add connector' : 'Save changes'}
          </span>
          {spinning ? (
            <LoaderCircleIcon
              aria-hidden
              className="absolute inset-0 m-auto motion-safe:animate-spin"
            />
          ) : null}
        </Button>
      </div>
      <p role="status" className="sr-only">
        {spinning ? 'Saving' : testSpinning ? 'Testing the connection' : ''}
      </p>
    </form>
  )
}

/** The connector's check, step by step, in its own words. */
function CheckSteps({ steps }: { steps: readonly CheckStep[] }) {
  return (
    <ol
      className="flex flex-col gap-2"
      aria-label="What the test did"
      data-slot="source-check-steps"
    >
      {steps.map((step) => {
        const status = stepIcons[step.status]
        return (
          <li key={step.id} data-step={step.id} className="flex items-start gap-2 text-dense">
            <span className="flex h-5 shrink-0 items-center">
              <status.icon aria-hidden="true" className={cn('size-icon-sm', status.className)} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span>
                <span className="font-bold">{step.title}</span>
                <span className="sr-only">: {status.words}</span>
                {step.detail ? <span className="text-muted-foreground"> {step.detail}</span> : null}
              </span>
              {step.fix ? <span className="text-muted-foreground">{step.fix}</span> : null}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** A secret slot: written once, kept in the server's secret store, never shown again. */
function SecretField({
  secret,
  value,
  set,
  rebound,
  isNew,
  problem,
  disabled,
  onChange,
}: {
  secret: ConnectorManifest['secrets'][number]
  value: string
  set: boolean
  rebound: boolean
  isNew: boolean
  problem: string | undefined
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <Field name={secret.key} invalid={Boolean(problem)} disabled={disabled}>
      <FieldHeader>
        <FieldLabel icon={fieldIcon(secret.key, 'secret')} optional={!secret.required || !isNew}>
          {secret.label}
        </FieldLabel>
        <FieldDescription>
          {set
            ? rebound
              ? 'Where it is sent changed, so the one set is forgotten when you save. Give the one for the new address.'
              : 'One is set, kept in the server’s secret store and never shown. Leave this empty to keep it, or give a new one to replace it.'
            : secret.description}
        </FieldDescription>
      </FieldHeader>
      <FieldControl
        value={value}
        onValueChange={(next) => onChange(String(next))}
        render={
          <Input
            id={`source-${secret.key}`}
            size="lg"
            type="password"
            // A secret is never offered to the browser's password manager or its history.
            autoComplete="new-password"
            spellCheck={false}
            autoCapitalize="off"
            placeholder={set && !rebound ? 'Set · leave empty to keep it' : undefined}
          />
        }
      />
      <FieldError>{problem}</FieldError>
    </Field>
  )
}

/** One setting, drawn by its kind. */
function SettingField({
  field,
  values,
  areas,
  problem,
  disabled,
  onChange,
}: {
  field: ManifestField
  values: SourceFormValues
  areas: readonly { id: string; name: string }[]
  problem: string | undefined
  disabled: boolean
  onChange: (next: SourceFormValues) => void
}) {
  const id = `source-${field.key}`
  const icon = fieldIcon(field.key, field.kind)
  const text = values.fields[field.key] ?? ''
  const setText = (next: string) =>
    onChange({ ...values, fields: { ...values.fields, [field.key]: next } })

  if (field.kind === 'domain_map')
    return (
      <DomainNamesField
        id={id}
        label={field.label}
        description={field.description}
        lines={values.maps[field.key] ?? []}
        areas={areas}
        problem={problem}
        disabled={disabled}
        onChange={(lines) => onChange({ ...values, maps: { ...values.maps, [field.key]: lines } })}
      />
    )

  if (field.kind === 'boolean')
    return (
      <Field name={field.key} invalid={Boolean(problem)} disabled={disabled}>
        <div className="flex items-start justify-between gap-4">
          <FieldHeader>
            <FieldLabel icon={icon} htmlFor={id}>
              {field.label}
            </FieldLabel>
            <FieldDescription>{field.description}</FieldDescription>
          </FieldHeader>
          <Switch
            id={id}
            checked={values.flags[field.key] ?? false}
            onCheckedChange={(checked) =>
              onChange({ ...values, flags: { ...values.flags, [field.key]: checked } })
            }
          />
        </div>
        <FieldError>{problem}</FieldError>
      </Field>
    )

  if (field.kind === 'radio')
    return (
      <Field name={field.key} invalid={Boolean(problem)} disabled={disabled}>
        <FieldSet
          render={<RadioGroup value={text} onValueChange={(next) => setText(String(next))} />}
        >
          <FieldLegend icon={icon}>{field.label}</FieldLegend>
          <FieldDescription>{field.description}</FieldDescription>
          {(field.options ?? []).map((option, index) => (
            <FieldItem key={option.value}>
              <RadioGroupItem value={option.value} id={index === 0 ? id : undefined} />
              <FieldItemContent>
                <FieldLabel>{option.label}</FieldLabel>
                {option.description ? (
                  <FieldDescription>{option.description}</FieldDescription>
                ) : null}
              </FieldItemContent>
            </FieldItem>
          ))}
        </FieldSet>
        <FieldError>{problem}</FieldError>
      </Field>
    )

  const control =
    field.kind === 'select' ? (
      <NativeSelect
        id={id}
        size="lg"
        value={text}
        onChange={(event) => setText(event.target.value)}
      >
        <NativeSelectOption value="">Choose one</NativeSelectOption>
        {(field.options ?? []).map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    ) : field.kind === 'json' || field.kind === 'list' ? (
      <FieldControl
        id={id}
        value={text}
        onValueChange={(next) => setText(String(next))}
        render={
          <Textarea
            rows={field.kind === 'json' ? 8 : 4}
            spellCheck={false}
            autoCapitalize="off"
            placeholder={field.placeholder}
            className="resize-y font-mono text-caption"
          />
        }
      />
    ) : (
      <FieldControl
        value={text}
        onValueChange={(next) => setText(String(next))}
        render={
          <Input
            id={id}
            size="lg"
            type={field.kind === 'address' ? 'url' : 'text'}
            inputMode={field.kind === 'integer' ? 'numeric' : undefined}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            placeholder={field.placeholder}
            className="font-mono"
          />
        }
      />
    )
  return (
    <Field name={field.key} invalid={Boolean(problem)} disabled={disabled}>
      <FieldHeader>
        <FieldLabel icon={icon} optional={!field.required}>
          {field.label}
        </FieldLabel>
        <FieldDescription>
          {field.description}
          {field.kind === 'list' ? ' One per line.' : ''}
        </FieldDescription>
      </FieldHeader>
      {control}
      {field.kind === 'json' ? (
        <FieldFooter>
          <FieldError>{problem}</FieldError>
          <FieldCounter count={[...text].length} max={field.maxLength ?? 20_000} />
        </FieldFooter>
      ) : (
        <FieldError>{problem}</FieldError>
      )}
    </Field>
  )
}

/**
 * The names the tool gives domains, one line each: the name as the tool writes it, and the
 * Heed domain it means. A line half filled says so; an empty one is left out.
 */
function DomainNamesField({
  id,
  label,
  description,
  lines,
  areas,
  problem,
  disabled,
  onChange,
}: {
  id: string
  label: string
  description: string
  lines: readonly DomainNameRow[]
  areas: readonly { id: string; name: string }[]
  problem: string | undefined
  disabled: boolean
  onChange: (lines: DomainNameRow[]) => void
}) {
  const set = (index: number, line: DomainNameRow) =>
    onChange(lines.map((current, at) => (at === index ? line : current)))
  return (
    <FieldSet className="gap-2" disabled={disabled}>
      <FieldHeader>
        <FieldLegend icon={HeedDomainIcon}>
          {label} <span className="font-normal text-muted-foreground">(optional)</span>
        </FieldLegend>
        <FieldDescription>{description}</FieldDescription>
      </FieldHeader>
      {lines.length ? (
        <ul className="flex flex-col gap-2" aria-label={label}>
          {lines.map((line, index) => (
            // One line on a wide form; on a narrow one the name, then the domain under it.
            <li key={index} className="flex flex-col gap-2 @md:flex-row @md:items-center">
              <Input
                id={index === 0 ? id : undefined}
                size="lg"
                value={line.from}
                onChange={(event) => set(index, { ...line, from: event.target.value })}
                aria-label={`The tool's name, line ${index + 1}`}
                aria-invalid={problem && !line.from.trim() ? true : undefined}
                placeholder="paid_media"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="off"
                className="min-w-0 font-mono @md:flex-1"
              />
              <span className="flex min-w-0 items-center gap-2 @md:flex-1">
                <span aria-hidden className="text-muted-foreground">
                  →
                </span>
                <NativeSelect
                  size="lg"
                  value={line.to}
                  onChange={(event) => set(index, { ...line, to: event.target.value })}
                  aria-label={`The domain, line ${index + 1}`}
                  aria-invalid={problem && !line.to ? true : undefined}
                  className="min-w-0 flex-1"
                >
                  <NativeSelectOption value="">Choose a domain</NativeSelectOption>
                  {areas.map((area) => (
                    <NativeSelectOption key={area.id} value={area.id}>
                      {area.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  aria-label={`Remove line ${index + 1}`}
                  onClick={() => onChange(lines.filter((_, at) => at !== index))}
                >
                  <XIcon aria-hidden />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="lg"
        id={lines.length ? undefined : id}
        className="self-start"
        onClick={() => onChange([...lines, { from: '', to: '' }])}
      >
        <PlusIcon aria-hidden />
        Add a domain name
      </Button>
      {problem ? (
        <p
          role="alert"
          data-slot="field-error"
          className="flex items-start gap-1 text-caption text-status-danger-fg"
        >
          <CircleAlertIcon aria-hidden className="size-icon-sm shrink-0 translate-y-px" />
          <span className="min-w-0">{problem}</span>
        </p>
      ) : null}
    </FieldSet>
  )
}
