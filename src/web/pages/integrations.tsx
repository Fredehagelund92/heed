import * as React from 'react'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CopyIcon,
  EllipsisIcon,
  EyeOffIcon,
  GitPullRequestArrowIcon,
  InfoIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  LockIcon,
  PauseIcon,
  PlayIcon,
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  TriangleAlertIcon,
  XIcon,
} from '@/components/icons'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { PersonAvatar } from '@/components/heed/bits'
import { ToolLogo } from '@/components/heed/tool-logo'
import { Page } from '@/components/site-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useSelection } from '@/hooks/use-selection'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  connectorById,
  connectors,
  kindName,
  type Activity,
  type ConnectField,
  type ConnectForm,
  type Connector,
  type ConnectScope,
  type ConnectStep,
  type ConnectTest,
  type ConnectValues,
  type DocState,
  type Health,
  type IntegrationsView,
  type Source,
  type SourcePage,
  type When,
} from '@/model/integrations'
import type { DomainId } from '@/model/items'
import type { FigureTry } from '@/model/figures'
import { useConnectActions } from '@/lib/integrations'
import { tryFailureWords, useFigureActions, useFigures } from '@/lib/figures'
import { navigate, setQuery, useRoute } from '@/lib/router'
import { useQuery } from '@tanstack/react-query'
import { api, toApiError } from '@/api'
import {
  connectFormQuery,
  integrationPageQuery,
  integrationsPageQuery,
  useIntegrations,
  useWrite,
} from '@/api/queries'
import { Loadable, RowsSkeleton } from '@/components/heed/load-state'
import { useDomainList, useDomains, usePeople } from '@/lib/workspace'
import { useDefinitions } from '@/lib/definitions'
import { SettingsCrumbs } from '@/pages/settings'
import { Frame, FrameNumbers, FramePage, FrameScroll, FrameSection } from '@/components/heed/frame'

// Settings > Integrations: the tools Heed reads. Connected tools as rows (is it healthy, when did
// it last read, what is waiting), available tools as Efferd hairline cells below in two groups,
// Definitions and Context, and Request a connector. Each connected tool has one page with sections
// and no tabs; connecting is five steps on a full page. A sync never publishes.

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

const crumbs = (...rest: { label: string; href?: string }[]) => (
  <SettingsCrumbs
    trail={[
      { label: 'Settings', href: '/settings/general' },
      { label: 'Integrations', href: '/settings/integrations' },
      ...rest,
    ]}
  />
)

const healthLook: Record<Health, { label: string; icon: React.ReactNode; cls: string }> = {
  healthy: { label: 'Healthy', icon: <CircleCheckIcon />, cls: 'border-good/35 text-good-ink' },
  reading: {
    label: 'Reading',
    icon: <LoaderCircleIcon className="animate-spin" />,
    cls: 'border-primary/35 text-primary',
  },
  failed: {
    label: 'Failed',
    icon: <CircleAlertIcon />,
    cls: 'border-destructive/40 text-destructive',
  },
  reauth: {
    label: 'Needs a new key',
    icon: <KeyRoundIcon />,
    cls: 'border-caution/45 text-caution-ink',
  },
  paused: { label: 'Paused', icon: <PauseIcon />, cls: 'text-muted-foreground' },
}

function HealthBadge({ health }: { health: Health }) {
  const h = healthLook[health]
  return (
    <Badge variant="outline" className={cn('gap-1 font-normal [&>svg]:size-3', h.cls)}>
      {h.icon}
      {h.label}
    </Badge>
  )
}

const dotCls = { ok: 'bg-good', changed: 'bg-caution', failed: 'bg-destructive' }

// The connector pages are built from the shared square frames (components/heed/frame.tsx).
const Panel = Frame
function PanelSection(props: React.ComponentProps<typeof FrameSection>) {
  return <FrameSection level={3} {...props} />
}

const Numbers = FrameNumbers

function DataTable({
  head,
  rows,
  align,
}: {
  head: string[]
  rows: React.ReactNode[][]
  align?: ('left' | 'right')[]
}) {
  return (
    <FrameScroll>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-band text-xs text-muted-foreground">
            {head.map((h, i) => (
              <th
                key={h}
                className={cn(
                  'h-9 px-4 font-medium whitespace-nowrap md:px-5',
                  align?.[i] === 'right' ? 'text-right' : 'text-left',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              {r.map((c, j) => (
                <td
                  key={j}
                  className={cn(
                    'h-11 px-4 align-middle md:px-5',
                    align?.[j] === 'right' && 'text-right tabular-nums',
                  )}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </FrameScroll>
  )
}

function Owners({ domain }: { domain?: DomainId }) {
  const domains = useDomains()
  if (!domain) return <span className="text-muted-foreground">shared</span>
  return (
    <span className="flex -space-x-1.5">
      {domains[domain]?.owners.map((o) => (
        <PersonAvatar key={o} name={o} size={20} className="ring-2 ring-background" />
      ))}
    </span>
  )
}

function NoDomain() {
  return (
    <Badge
      variant="outline"
      className="gap-1 border-caution/45 font-normal text-caution-ink [&>svg]:size-3"
    >
      <TriangleAlertIcon />
      No domain
    </Badge>
  )
}

function ActivityList({ items }: { items: Activity[] }) {
  return (
    <ul className="border-t">
      {items.map((a) => (
        <li
          key={a.when}
          className="grid grid-cols-(--cols-lead-30) gap-x-4 gap-y-0.5 border-t px-4 py-3 text-sm first:border-t-0 sm:grid-cols-(--cols-sync-row) md:px-5"
        >
          <span className="text-muted-foreground tabular-nums">{a.when}</span>
          <span className="flex items-center gap-2">
            <span aria-hidden className={cn('size-2 rounded-full', dotCls[a.tone])} />
            {a.what}
          </span>
          <span className="col-span-2 text-muted-foreground sm:col-span-1">{a.detail}</span>
        </li>
      ))}
    </ul>
  )
}

function Connection({
  rows,
  actions,
}: {
  rows: [string, React.ReactNode][]
  actions: React.ReactNode
}) {
  return (
    <>
      <dl className="border-t">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="grid gap-1 border-t px-4 py-3 text-sm first:border-t-0 sm:grid-cols-(--cols-lead-44) md:px-5"
          >
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3 md:px-5">{actions}</div>
    </>
  )
}

/**
 * Where an integration's figures are read: its data endpoint and a token for it. The token is kept
 * in the secret store, sent only to the endpoint's address and never shown again, so the field
 * starts empty every time.
 */
function FigureConnectionDialog({
  c,
  open,
  onOpenChange,
  endpoint,
}: {
  c: Connector
  open: boolean
  onOpenChange: (open: boolean) => void
  endpoint: string | null
}) {
  const { setConnection } = useFigureActions()
  const [saving, setSaving] = React.useState(false)
  const id = `figures-${c.id}`
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault()
            const form = new FormData(e.currentTarget)
            const value = (name: string) => {
              const v = form.get(name)
              return typeof v === 'string' ? v.trim() : ''
            }
            setSaving(true)
            setConnection(c.id, value('endpoint'), value('token'))
              .then(() => {
                onOpenChange(false)
                toast(`Figures from ${c.name} are set up`, {
                  description:
                    'The token is kept in the secret store and never shown again. Try a figure to see that they work.',
                })
              })
              .catch((error: unknown) =>
                toast.error("Couldn't set up figures", {
                  description: toApiError(error).message,
                }),
              )
              .finally(() => setSaving(false))
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {endpoint ? 'Replace the token' : `Set up figures from ${c.name}`}
            </DialogTitle>
            <DialogDescription>
              Figures have a connection of their own: {c.name}&apos;s data API, with a read-only
              token for it. The token is sent only to the endpoint&apos;s address, and a new address
              needs its token again. No MCP server and no warehouse login are needed.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${id}-endpoint`}>Data endpoint</FieldLabel>
              <Input
                id={`${id}-endpoint`}
                name="endpoint"
                type="url"
                required
                defaultValue={endpoint ?? ''}
                placeholder="https://cube.example.com/cubejs-api/v1/load"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-token`}>Token</FieldLabel>
              <Input
                id={`${id}-token`}
                name="token"
                type="password"
                autoComplete="off"
                required
                minLength={8}
              />
              <FieldDescription>Read only. Shown nowhere once saved.</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Try a figure as the dialog shows it: reading, what was read, or why nothing was. */
type Trying = { running: boolean; result?: FigureTry; error?: string }

/** Try a figure from a tool: reads now, and says how the read went. */
function useTryFigure(c: Connector) {
  const [trying, setTrying] = React.useState<Trying>({ running: false })
  const run = async () => {
    setTrying({ running: true })
    try {
      setTrying({ running: false, result: await api.tryFigure({ source: c.id }) })
    } catch (e: unknown) {
      setTrying({ running: false, error: toApiError(e).message })
    }
  }
  return { trying, run }
}

/**
 * Try a figure: one figure read now from the integration's data API, with the endpoint and token
 * as saved, so an admin sees they work before switching figures on. It reads one measure of the
 * tool's first view with a single date, for the last 7 days, and keeps nothing.
 */
function TryFigureDialog({
  c,
  open,
  onOpenChange,
  trying,
  onRetry,
}: {
  c: Connector
  open: boolean
  onOpenChange: (open: boolean) => void
  trying: Trying
  onRetry: () => void
}) {
  const result = trying.result
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Try a figure from {c.name}</DialogTitle>
          <DialogDescription>
            Reads one measure for the last 7 days, with the data endpoint and token as saved.
            Nothing is kept, and Show figures in Ask stays as it is.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-frame border p-4 text-sm" aria-live="polite">
          {trying.running ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <LoaderCircleIcon aria-hidden className="size-4 animate-spin" />
              Reading one figure from {c.name}…
            </p>
          ) : trying.error ? (
            <p className="flex items-start gap-2">
              {stepLook.failed}
              <span>{trying.error}</span>
            </p>
          ) : result?.kind === 'figure' ? (
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex">{stepLook.ok}</span>
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-medium">
                  {result.label}:{' '}
                  {result.value ?? (
                    <span className="font-normal text-muted-foreground">
                      nothing for those days
                    </span>
                  )}
                </p>
                <p className="text-muted-foreground">
                  From {c.name}, data as of {result.asOf}. Answered in{' '}
                  {(result.took / 1000).toFixed(1)} seconds.
                </p>
                <p className="text-muted-foreground">The data endpoint and its token work.</p>
              </div>
            </div>
          ) : result?.kind === 'failed' ? (
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex">{stepLook.failed}</span>
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-medium">{tryFailureWords(result.failure, c.name).title}.</p>
                <p className="text-muted-foreground">
                  {tryFailureWords(result.failure, c.name).fix}
                </p>
                <p className="text-xs text-muted-foreground">
                  Code: <code className="font-mono">{result.failure}</code>
                </p>
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button disabled={trying.running} onClick={onRetry}>
            Try again
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The figures connection, an integration's second one when its tool can read figures: its own data
 * endpoint, its own token (masked, never any of it shown), the one host it may call, who to ask
 * about a figure, Try a figure, and the switch for Show figures in Ask, off by default (Ask then
 * links into the tool). The definition decides which integration answers a metric.
 */
function FiguresSection({ c }: { c: Connector }) {
  const f = useFigures()
  const { setFigures, setDataContact } = useFigureActions()
  const people = usePeople()
  const { figureConnections } = useIntegrations()
  const [connecting, setConnecting] = React.useState(false)
  const [tryOpen, setTryOpen] = React.useState(false)
  const { trying, run } = useTryFigure(c)
  const fromTool = useDefinitions().filter(
    (d) => d.type === 'metric' && d.synced && d.tool === c.name,
  ).length
  // Shown only for an integration that can answer figures, which says how it is reached.
  const conn = figureConnections[c.id] ?? {
    endpoint: null,
    host: null,
    secretSet: false,
    contact: '',
  }
  const on = f.enabled(c.id)
  const switchId = `figures-${c.id}`
  const notSet = <span className="text-muted-foreground">Not set</span>
  const ready = conn.endpoint !== null && conn.secretSet
  return (
    <PanelSection
      title="Figures connection"
      description={`The second of ${c.name}'s two connections, with its own endpoint and token: ${c.name}'s data API. Off, an answer links into ${c.name} instead. On, an answer can show one figure from it: read when asked, never stored, and never called checked.`}
      action={
        <span className="flex items-center gap-2">
          <label htmlFor={switchId} className="text-sm">
            Show figures in Ask
          </label>
          <Switch
            id={switchId}
            checked={on}
            onCheckedChange={(v) => {
              setFigures(c.id, v)
                .then(() =>
                  toast(v ? `Figures from ${c.name} are on` : `Figures from ${c.name} are off`, {
                    description: v
                      ? 'Answers show one figure for the metric they ask about.'
                      : `Answers link into ${c.name} instead.`,
                  }),
                )
                .catch((error: unknown) =>
                  toast.error(
                    v ? `Couldn't switch figures from ${c.name} on` : `Couldn't switch figures off`,
                    { description: toApiError(error).message },
                  ),
                )
            }}
          />
        </span>
      }
    >
      <dl className="border-t">
        {(
          [
            [
              'Data endpoint',
              conn.endpoint ? (
                <code key="e" className="font-mono text-dense break-all">
                  {conn.endpoint}
                </code>
              ) : (
                notSet
              ),
            ],
            [
              'Token',
              conn.secretSet ? (
                <span key="s">
                  <code className="font-mono text-dense" aria-label="Token, set">
                    {'••••••••••••'}
                  </code>
                  <span className="block text-xs text-muted-foreground">
                    Its own, not the definitions token. Only used for reading.
                  </span>
                </span>
              ) : (
                notSet
              ),
            ],
            [
              'Declared host',
              conn.host ? (
                <span key="h">
                  <code className="font-mono text-dense">{conn.host}</code>
                  <span className="block text-xs text-muted-foreground">
                    The only host called for a figure. Read only, with a 4 second limit.
                  </span>
                </span>
              ) : (
                notSet
              ),
            ],
            [
              'Data contact',
              <span key="c" className="flex flex-wrap items-center gap-2">
                <PersonAvatar name={f.contact(c.id)} size={20} />
                <Select
                  value={f.contact(c.id)}
                  onValueChange={(v) =>
                    void setDataContact(c.id, v as string).catch((error: unknown) =>
                      toast.error("Couldn't change the data contact", {
                        description: toApiError(error).message,
                      }),
                    )
                  }
                >
                  <SelectTrigger size="sm" aria-label="Data contact" className="min-w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {people
                        .filter((p) => !p.invited)
                        .map((p) => (
                          <SelectItem key={p.name} value={p.name}>
                            {p.name}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">
                  Who hears about a figure that looks wrong.
                </span>
              </span>,
            ],
            ...(conn.asOf
              ? [
                  [
                    'Data as of',
                    <span key="a">
                      {conn.asOf}, the last time {c.name} refreshed its data
                    </span>,
                  ],
                ]
              : []),
          ] as [string, React.ReactNode][]
        ).map(([k, v]) => (
          <div
            key={k}
            className="grid gap-1 border-t px-4 py-3 text-sm first:border-t-0 sm:grid-cols-(--cols-lead-44) md:px-5"
          >
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex items-start gap-2 border-t bg-band px-4 py-3 text-sm md:px-5">
        <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p>
          <span className="font-medium">Which integration answers:</span>{' '}
          <span className="text-muted-foreground">
            the one a metric&apos;s definition comes from, never a guess. All {fromTool}{' '}
            metrics&apos; definitions come from {c.name}, so {c.name} answers them.
          </span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-3 md:px-5">
        <Button variant="outline" size="sm" onClick={() => setConnecting(true)}>
          {conn.secretSet ? 'Replace token' : 'Set up figures'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-disabled={!ready || undefined}
          aria-describedby={`${switchId}-try`}
          onClick={() => {
            if (!ready) return
            setTryOpen(true)
            void run()
          }}
        >
          Try a figure
        </Button>
        <span id={`${switchId}-try`} className="text-xs text-muted-foreground">
          {ready
            ? 'Reads one measure for the last 7 days. Nothing is kept.'
            : 'Set up figures first: the data endpoint and its token.'}
        </span>
      </div>
      <FigureConnectionDialog
        c={c}
        open={connecting}
        onOpenChange={setConnecting}
        endpoint={conn.endpoint}
      />
      <TryFigureDialog
        c={c}
        open={tryOpen}
        onOpenChange={setTryOpen}
        trying={trying}
        onRetry={() => void run()}
      />
    </PanelSection>
  )
}

/* ---------- the catalog ---------- */

function RequestConnector({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [text, setText] = React.useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request a connector</DialogTitle>
          <DialogDescription>
            Tell us which tool holds your definitions or your context. A warehouse on its own isn't
            one: a figure is read only from the tool a metric&apos;s definition comes from.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="request-tool">The tool, and what it holds</FieldLabel>
          <Textarea
            id="request-tool"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Confluence: our data team's definitions pages"
            className="min-h-24"
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!text.trim()}
            onClick={() => {
              onOpenChange(false)
              setText('')
              toast('Request sent', { description: "Thank you. You'll hear back by email." })
            }}
          >
            Send the request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** When a tool reads next, on its row: "07:00" today, "tomorrow", or the day. */
const nextWords = (next: When) =>
  next.day === 'Today' ? next.time : next.day === 'Tomorrow' ? 'tomorrow' : next.day

/** A day as it reads inside a sentence: "today", "21 Oct". */
const inSentence = (day: string) => (/^[A-Z][a-z]+$/.test(day) ? day.toLowerCase() : day)

/** What a connected tool holds, in one line on its row. */
function RowDetail({ source }: { source: Source }) {
  const { definitions: d, documents: docs } = source
  if (d)
    return (
      <>
        {plural(d.metrics, 'metric')} and {plural(d.dimensions, 'dimension')}
        {d.noDomain > 0 && (
          <>. {d.noDomain === 1 ? '1 view has no domain' : `${d.noDomain} views have no domain`}</>
        )}
      </>
    )
  if (!source.last)
    return (
      <>
        First read {source.next ? `at ${source.next.time}` : 'soon'}. Suggestions go to the owners
        of each folder's domain
      </>
    )
  return (
    <>
      {plural(docs?.held ?? 0, 'document')}.{' '}
      {docs?.waiting && source.inbox ? (
        <>
          <a
            href={source.inbox}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {plural(docs.waiting, 'suggestion')}
          </a>{' '}
          waiting for owners
        </>
      ) : (
        'No suggestions waiting'
      )}
    </>
  )
}

function ConnectedRow({ source, state }: { source: Source; state: string | null }) {
  const c = connectorById(source.connector)!
  const h = source.health
  return (
    <li className="grid grid-cols-(--cols-around) items-center gap-x-3 gap-y-1 border-t px-4 py-3 first:border-t-0 md:px-5 @3xl/main:grid-cols-(--cols-source)">
      <ToolLogo c={c} />
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {c.name}
          <Badge variant="secondary" className="font-normal">
            {kindName[c.kind]}
          </Badge>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          <RowDetail source={source} />
        </p>
      </div>
      <div className="col-span-3 col-start-2 row-start-2 text-xs @3xl/main:col-span-1 @3xl/main:col-start-auto @3xl/main:row-start-auto">
        {h === 'healthy' ? (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className={cn('size-2 rounded-full', dotCls.ok)} />
            <span>
              {source.last ? (
                <>
                  Read {inSentence(source.last.at.day)}, {source.last.at.time}
                  {source.next && (
                    <span className="text-muted-foreground">, next {nextWords(source.next)}</span>
                  )}
                </>
              ) : (
                <>
                  Not read yet
                  {source.next && (
                    <span className="text-muted-foreground">
                      , first read at {source.next.time}
                    </span>
                  )}
                </>
              )}
            </span>
          </span>
        ) : (
          <HealthBadge health={h} />
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="col-start-3 row-start-1 @3xl/main:col-start-4"
        onClick={() =>
          navigate(`/settings/integrations/${source.id}`, state ? { state } : undefined)
        }
      >
        Manage
      </Button>
    </li>
  )
}

function AvailableCell({ c, connectable }: { c: Connector; connectable: boolean }) {
  return (
    <div className="flex min-h-44 flex-col gap-2 border-r border-b bg-background p-4 md:p-5">
      <div className="flex items-start justify-between gap-2">
        <ToolLogo c={c} />
        <Badge variant="secondary" className="font-normal">
          {kindName[c.kind]}
        </Badge>
      </div>
      <h4 className="mt-1 text-sm font-medium">{c.name}</h4>
      <p className="text-sm text-muted-foreground">{c.blurb}</p>
      <div className="mt-auto pt-2">
        {c.soon || !connectable ? (
          <Badge variant="outline" className="font-normal text-muted-foreground">
            Soon
          </Badge>
        ) : (
          <a
            href={`/settings/integrations/${c.id}/connect`}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Connect <ArrowRightIcon className="size-3.5" aria-hidden />
          </a>
        )}
      </div>
    </div>
  )
}

/** The catalog's order: the connected rows read in the order the cells do. */
const catalogOrder = (a: Source, b: Source) =>
  connectors.findIndex((c) => c.id === a.connector) -
  connectors.findIndex((c) => c.id === b.connector)

export function IntegrationsPage() {
  const load = useQuery(integrationsPageQuery())
  const [asking, setAsking] = React.useState(false)
  return (
    <Page
      title={
        <SettingsCrumbs
          trail={[{ label: 'Settings', href: '/settings/general' }, { label: 'Integrations' }]}
        />
      }
      actions={
        <Button variant="outline" size="sm" onClick={() => setAsking(true)}>
          <PlusIcon data-icon="inline-start" />
          <span className="max-sm:sr-only">Request a connector</span>
        </Button>
      }
    >
      <FramePage>
        <Panel>
          <FrameSection
            title="Integrations"
            description="The tools definitions and context are read from. They are only read, and a read never publishes: definitions arrive as a read-only copy, and documents become suggestions for their owners."
          />
          <Loadable what="Integrations" skeleton={<RowsSkeleton rows={4} />} query={load}>
            {load.data && <IntegrationsBody view={load.data} onRequest={() => setAsking(true)} />}
          </Loadable>
        </Panel>
        <p className="text-xs text-muted-foreground">
          Your workspace keeps no numbers. Where a definitions tool can also read figures and an
          admin switches them on, Ask reads one figure when someone asks, from the tool the
          metric&apos;s definition comes from, and keeps it nowhere.
        </p>
      </FramePage>
      <RequestConnector open={asking} onOpenChange={setAsking} />
    </Page>
  )
}

function IntegrationsBody({ view, onRequest }: { view: IntegrationsView; onRequest: () => void }) {
  const { query } = useRoute()
  const state = query.get('state')
  const [text, setText] = React.useState('')
  const q = text.trim().toLowerCase()
  const matches = (c: Connector) => `${c.name} ${c.blurb}`.toLowerCase().includes(q)
  const sources = [...view.sources].sort(catalogOrder)
  const connected = new Set(sources.map((s) => s.connector))
  const rows = sources.filter((s) => matches(connectorById(s.connector)!))
  const cells = connectors.filter((c) => matches(c) && !connected.has(c.id))
  const refused = sources.find((s) => s.health === 'reauth')
  const refusedTool = refused && connectorById(refused.connector)

  return (
    <>
      {refused && refusedTool && (
        <div
          role="alert"
          className="flex flex-wrap items-start gap-3 border-t bg-caution/8 px-4 py-4 text-sm md:px-5"
        >
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-caution-ink" />
          <p className="min-w-0 flex-1">
            <span className="font-medium">{refusedTool.name} needs a new key.</span>{' '}
            {sentence(refused.failure ?? 'the key was refused')}
            {refused.last ? ` on ${refused.last.at.day}` : ''}. Reading is paused; published context
            is not affected.
          </p>
          <Button
            size="sm"
            onClick={() => navigate(`/settings/integrations/${refused.id}/connect`, { step: '2' })}
          >
            Replace key
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3 md:px-5">
        <div className="relative min-w-0 flex-1 basis-56">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search integrations"
            aria-label="Search integrations"
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>
      <PanelSection title="Connected">
        {sources.length === 0 ? (
          <div className="mx-4 mb-4 flex flex-col items-center gap-3 rounded-frame border border-dashed px-6 py-10 text-center md:mx-5">
            <span className="grid size-10 place-items-center rounded-lg border bg-muted">
              <PlugIcon className="size-5" aria-hidden />
            </span>
            <p className="font-medium">Nothing connected yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Connect your definitions so your workspace knows which metrics exist and can tell
              owners when one changes. Agents get your context either way.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => navigate('/settings/integrations/cube/connect')}>
                Connect Cube
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  document.getElementById('available')?.scrollIntoView({ behavior: 'smooth' })
                }
              >
                Browse integrations
              </Button>
            </div>
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground md:px-5">
            None of the connected tools match.
          </p>
        ) : (
          <ul className="border-t">
            {rows.map((s) => (
              <ConnectedRow key={s.id} source={s} state={state} />
            ))}
          </ul>
        )}
      </PanelSection>
      <PanelSection
        title="Available"
        description="Definitions say what exists. Context is what people know."
      >
        {/* Hairline cells: each cell draws its right and bottom line, and the panel clips the outer ones. */}
        <div
          id="available"
          className="-mr-px -mb-px grid border-t @xl/main:grid-cols-2 @4xl/main:grid-cols-3"
        >
          {cells.map((c) => (
            <AvailableCell key={c.id} c={c} connectable={view.connectable.includes(c.id)} />
          ))}
          <div className="flex min-h-44 flex-col gap-2 border-r border-b bg-background p-4 md:p-5">
            <span className="grid size-8 place-items-center rounded-md border border-dashed text-muted-foreground">
              <PlusIcon className="size-4" aria-hidden />
            </span>
            <h4 className="mt-1 text-sm font-medium">Request a connector</h4>
            <p className="text-sm text-muted-foreground">
              Tell us which tool holds your definitions or context.
            </p>
            <button
              type="button"
              onClick={onRequest}
              className="mt-auto inline-flex w-fit items-center gap-1 pt-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Tell us <ArrowRightIcon className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>
      </PanelSection>
    </>
  )
}

/** Words that start a sentence: their first letter a capital. */
const sentence = (words: string) => words.replace(/^./, (c) => c.toUpperCase())

/* ---------- a connector's page ---------- */

const docLook: Record<DocState, string> = {
  waiting: 'border-primary/35 text-primary',
  published: 'border-good/35 text-good-ink',
  returned: 'text-muted-foreground',
  declined: 'text-muted-foreground',
  withdrawn: 'text-muted-foreground',
  held: 'text-muted-foreground',
  skipped: 'border-caution/45 text-caution-ink',
  gone: 'text-muted-foreground',
}
const docLabel: Record<DocState, string> = {
  waiting: 'Suggestion waiting',
  published: 'Published',
  returned: 'Returned',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  held: 'Waiting for the next read',
  skipped: 'Skipped',
  gone: 'Gone from the tool',
}

/** Pauses reading a tool, or lets it go on, and says so. */
function usePauseReading(source: Source, c: Connector) {
  const write = useWrite()
  return (paused: boolean) =>
    void write('pauseIntegration', { id: source.id, paused }).then(
      () =>
        toast(paused ? `Reading paused for ${c.name}` : `Reading resumed for ${c.name}`, {
          description: paused
            ? c.kind === 'context'
              ? 'Open suggestions stay in the Inbox. Resume from this menu.'
              : "Agents keep getting what's published. Resume from this menu."
            : 'It is read again on its schedule.',
        }),
      (e: unknown) =>
        toast(paused ? `Couldn't pause ${c.name}` : `Couldn't resume ${c.name}`, {
          description: toApiError(e).message,
        }),
    )
}

function ConnectorMenu({
  source,
  c,
  onDisconnect,
}: {
  source: Source
  c: Connector
  onDisconnect: () => void
}) {
  const pause = usePauseReading(source, c)
  const paused = source.health === 'paused'
  // Whoever runs the server set its own tools up: their settings are theirs to change.
  const own = source.added === null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="icon-sm" aria-label={`More for ${c.name}`} />}
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => pause(!paused)}>
          {paused ? <PlayIcon /> : <PauseIcon />}
          {paused ? 'Resume reading' : 'Pause reading'}
        </DropdownMenuItem>
        {!own && (
          <>
            <DropdownMenuItem
              onClick={() => navigate(`/settings/integrations/${source.id}/connect`, { step: '2' })}
            >
              <KeyRoundIcon />
              Change settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDisconnect}>
              <XIcon />
              Disconnect
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Pause reading, or Resume reading while paused, as a button of the Connection section. */
function PauseButton({ source, c }: { source: Source; c: Connector }) {
  const pause = usePauseReading(source, c)
  const paused = source.health === 'paused'
  return (
    <Button variant="outline" size="sm" onClick={() => pause(!paused)}>
      {paused ? <PlayIcon data-icon="inline-start" /> : <PauseIcon data-icon="inline-start" />}
      {paused ? 'Resume reading' : 'Pause reading'}
    </Button>
  )
}

function DisconnectDialog({
  source,
  c,
  open,
  onOpenChange,
}: {
  source: Source
  c: Connector
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { disconnect } = useConnectActions()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Disconnect {c.name}?</DialogTitle>
          <DialogDescription>
            {c.kind === 'definitions'
              ? 'Reading stops. The definitions already read stay, marked as no longer read, and no context is flagged by it again.'
              : 'Reading stops and its open suggestions are withdrawn. Context that owners already published stays as it is.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onOpenChange(false)
              disconnect(source.id).then(
                () => {
                  toast(`${c.name} disconnected`, {
                    description: 'Kept in the history log. Connect it again from Integrations.',
                  })
                  navigate('/settings/integrations')
                },
                (e: unknown) =>
                  toast(`Couldn't disconnect ${c.name}`, { description: toApiError(e).message }),
              )
            }}
          >
            Disconnect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReadAgain({ source, c }: { source: Source; c: Connector }) {
  const write = useWrite()
  const [asking, setAsking] = React.useState(false)
  return (
    <Button
      variant="outline"
      size="sm"
      loading={asking || source.health === 'reading'}
      loadingLabel="Reading…"
      disabled={source.health === 'paused'}
      onClick={() => {
        setAsking(true)
        write('readIntegration', { id: source.id })
          .catch((e: unknown) =>
            toast(`Couldn't read ${c.name}`, { description: toApiError(e).message }),
          )
          .finally(() => setAsking(false))
      }}
    >
      <RefreshCwIcon data-icon="inline-start" />
      Read again
    </Button>
  )
}

/** The read Read again asked for has ended: says what it found, once. */
function useReadDone(page: SourcePage | null | undefined, name: string) {
  const health = page?.source.health
  const was = React.useRef(health)
  React.useEffect(() => {
    if (was.current === 'reading' && health && health !== 'reading' && page) {
      const latest = page.activity[0]
      toast(`Read ${name}`, latest ? { description: `${latest.detail}.` } : undefined)
    }
    was.current = health
  }, [health, page, name])
}

/** "Read 1 Oct", "3 s": how a read went, under its number. */
const readSub = (source: Source) =>
  source.last
    ? source.definitions
      ? `${source.last.complete ? 'complete' : 'in part'}${source.last.seconds === null ? '' : `, ${source.last.seconds} s`}`
      : `${plural(source.last.seen, 'document')} looked at`
    : source.next
      ? `first read at ${source.next.time}`
      : 'first read soon'

/** When it reads next, as a number of the page: "07:00", "every hour"; "Tomorrow", "06:00, every day". */
const nextNumber = (source: Source, label = 'Next read') =>
  source.next
    ? {
        label,
        value: source.next.day === 'Today' ? source.next.time : source.next.day,
        sub: source.next.day === 'Today' ? source.every : `${source.next.time}, ${source.every}`,
      }
    : {
        label,
        value: source.health === 'paused' ? 'Paused' : 'Soon',
        sub: source.every,
      }

function NotConnected({ id }: { id: string }) {
  const c = connectorById(id)
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 text-center md:px-6">
      <p className="font-medium">
        {c ? `${c.name} isn't connected` : 'There is no such integration'}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {c && !c.soon
          ? 'Connect it to see what it reads.'
          : 'See what can be connected in Integrations.'}
      </p>
      <div className="mt-4 flex justify-center gap-2">
        {c && !c.soon && (
          <Button onClick={() => navigate(`/settings/integrations/${c.id}/connect`)}>
            Connect {c.name}
          </Button>
        )}
        <Button variant="outline" onClick={() => navigate('/settings/integrations')}>
          Integrations
        </Button>
      </div>
    </div>
  )
}

export function ConnectorPage({ id }: { id: string }) {
  const load = useQuery(integrationPageQuery(id))
  const page = load.data
  const c = connectorById(page?.source.connector ?? id)
  useReadDone(page, c?.name ?? '')
  return (
    <Page title={crumbs({ label: page === null ? (c?.name ?? 'Not found') : (c?.name ?? '') })}>
      <Loadable
        what={c?.name ?? 'This integration'}
        skeleton={<RowsSkeleton rows={6} />}
        query={load}
      >
        {page === null ? (
          <NotConnected id={id} />
        ) : (
          page && c && <ConnectorSections page={page} c={c} />
        )}
      </Loadable>
    </Page>
  )
}

function ConnectorSections({ page, c }: { page: SourcePage; c: Connector }) {
  const domains = useDomains()
  const [leaving, setLeaving] = React.useState(false)
  const { figureConnections } = useIntegrations()
  const { source, views, folders, documents, activity, connection } = page
  const h = source.health
  const isCube = c.kind === 'definitions'
  const isDrive = c.id === 'google-drive'
  const isContent = c.kind === 'context'
  const d = source.definitions
  const docs = source.documents
  const created = source.created
  const connectionRows: [string, React.ReactNode][] = [
    ...connection.map((row): [string, React.ReactNode] => [
      row.label,
      row.code ? (
        <code key={row.label} className="font-mono text-dense break-all">
          {row.value}
        </code>
      ) : (
        row.value
      ),
    ]),
    ...(source.added?.by
      ? [
          [
            'Connected by',
            <span key="by" className="flex items-center gap-2">
              <PersonAvatar name={source.added.by} size={20} />
              {source.added.by}, {source.added.when}
            </span>,
          ] as [string, React.ReactNode],
        ]
      : []),
  ]
  // Google Drive names who connected it; the definitions tools are connected by whoever runs Git.
  const shownRows = isDrive ? connectionRows : connectionRows.filter(([k]) => k !== 'Connected by')
  // Whoever runs the server set its own tools up: their settings are theirs to change.
  const own = source.added === null
  const disconnect = own ? null : (
    <Button
      variant="outline"
      size="sm"
      className="ml-auto border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
      onClick={() => setLeaving(true)}
    >
      Disconnect
    </Button>
  )

  return (
    <FramePage>
      <Panel>
        <header className="flex flex-wrap items-start gap-4 px-4 py-5 md:px-5">
          <ToolLogo c={c} size="lg" />
          <div className="min-w-0 flex-1 basis-64">
            <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
              {c.name}
              <Badge variant="secondary" className="font-normal">
                {kindName[c.kind]}
              </Badge>
              <HealthBadge health={h} />
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {isCube
                ? "Reads your Cube definition files from Git. Read-only, and it keeps no calculation. It has two connections: definitions from Git, and figures, when switched on, from Cube's data API at the time of the answer."
                : isDrive
                  ? 'Reads the Google Docs in folders shared with its service account. Each new or changed document becomes one suggestion for the owners of its domain.'
                  : "Reads the Markdown files in a repository. Each new or changed file becomes one suggestion for the owners of its folder's domain."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ReadAgain source={source} c={c} />
            <ConnectorMenu source={source} c={c} onDisconnect={() => setLeaving(true)} />
          </div>
        </header>

        {h === 'reading' && (
          <div className="border-t px-4 py-4 md:px-5" role="status">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                {isCube && d ? `Reading ${plural(d.views, 'view')}` : `Reading ${c.name}`}
              </span>
              {source.progress && (
                <span className="text-muted-foreground tabular-nums">
                  {source.progress.done} of {plural(source.progress.total, 'definition')}
                </span>
              )}
            </div>
            {source.progress && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${(100 * source.progress.done) / source.progress.total}%` }}
                />
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Takes a few seconds. Agents keep getting the same context while it runs.
            </p>
          </div>
        )}
        {h === 'failed' && (
          <div role="alert" className="border-t bg-destructive/5 px-4 py-4 text-sm md:px-5">
            <p className="flex items-start gap-2">
              <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>
                <span className="font-medium">
                  {source.failures > 1
                    ? `The last ${source.failures} reads failed`
                    : 'The last read failed'}
                  : {source.failure ?? "it couldn't be read"}.
                </span>{' '}
                {source.lastGood
                  ? `The last good read from ${source.lastGood.day}, ${source.lastGood.time} stays`
                  : 'Nothing was read yet'}
                , and nothing is {isCube ? 'flagged' : 'created'} while {c.name} can't be reached.
                Admins are told at {source.staleAfter}.
              </span>
            </p>
            <div className="mt-3 flex gap-2 pl-6">
              <ReadAgain source={source} c={c} />
              {!own && (
                <Button
                  size="sm"
                  onClick={() =>
                    navigate(`/settings/integrations/${source.id}/connect`, { step: '2' })
                  }
                >
                  Change settings
                </Button>
              )}
            </div>
          </div>
        )}
        {h === 'paused' && (
          <div role="status" className="border-t bg-muted/40 px-4 py-4 text-sm md:px-5">
            <p className="flex items-start gap-2">
              <PauseIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="font-medium">Reading is paused.</span> Agents keep getting what's
                published, and nothing is read until an admin resumes it.
              </span>
            </p>
          </div>
        )}
        {isContent && created && docs && (
          <div role="status" className="border-t bg-primary/5 px-4 py-4 text-sm md:px-5">
            <p className="font-medium">
              {source.last?.at.day === 'Today' ? "Today's read" : 'The last read'} created{' '}
              {plural(created.suggested, 'suggestion')} in the owners' Inbox.
            </p>
            <ul className="mt-2 flex flex-col gap-1 text-muted-foreground">
              {[
                `${plural(created.suggested, 'new suggestion')}${created.replaced ? `, ${created.replaced} replaced an open one` : ''}`,
                ...(created.skipped.length
                  ? [
                      `${plural(created.skipped.length, 'document')} skipped: ${[...new Set(created.skipped)].join(', ')}`,
                    ]
                  : []),
                `Nothing published. Daily cap ${docs.madeToday} of ${docs.perDay}`,
              ].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <CheckIcon aria-hidden className="size-3.5" />
                  {t}
                </li>
              ))}
            </ul>
            {source.inbox && (
              <Button size="sm" className="mt-3" onClick={() => navigate(source.inbox!)}>
                Open the Inbox
              </Button>
            )}
          </div>
        )}

        <Numbers
          items={
            d
              ? h === 'failed'
                ? [
                    {
                      label: 'Last good read',
                      value: source.lastGood?.day ?? 'None',
                      sub: source.lastGood
                        ? `${source.lastGood.time}${source.lastGood.ago ? `, ${source.lastGood.ago}` : ''}`
                        : 'not read yet',
                      tone: 'bad',
                    },
                    { ...nextNumber(source, 'Next try'), sub: 'backing off' },
                    {
                      label: 'Definitions',
                      value: String(d.metrics + d.dimensions),
                      sub: 'as last read',
                    },
                    {
                      label: 'Context affected',
                      value: String(d.flagged),
                      sub: d.flagged ? 'flagged' : 'none flagged',
                    },
                  ]
                : [
                    {
                      label: h === 'reading' ? 'Last good read' : 'Last read',
                      value: source.last
                        ? `${source.last.at.day}, ${source.last.at.time}`
                        : 'Not yet',
                      sub: readSub(source),
                    },
                    nextNumber(source),
                    {
                      label: 'Definitions',
                      value: String(d.metrics + d.dimensions),
                      sub: `${plural(d.metrics, 'metric')}, ${plural(d.dimensions, 'dimension')}`,
                    },
                    {
                      label: 'Context to check',
                      value: String(d.flagged),
                      sub: d.flagged
                        ? page.changedOn
                          ? `after the ${page.changedOn} changes`
                          : 'after a change'
                        : 'none flagged',
                    },
                  ]
              : [
                  h === 'reauth'
                    ? {
                        label: 'Last read',
                        value: source.last?.at.day ?? 'Not yet',
                        sub: 'paused: needs a new key',
                        tone: 'warn',
                      }
                    : {
                        label: 'Last read',
                        value: source.last
                          ? `${source.last.at.day}, ${source.last.at.time}`
                          : 'Not yet',
                        sub: readSub(source),
                      },
                  nextNumber(source),
                  {
                    label: 'Suggestions waiting',
                    value: String(docs?.waiting ?? 0),
                    sub: docs?.waiting ? `for ${plural(docs.domains, 'domain')}` : 'none yet',
                  },
                  {
                    label: 'Drafts today',
                    value: `${docs?.madeToday ?? 0} of ${docs?.perDay ?? 0}`,
                    sub: 'the daily cap',
                  },
                ]
          }
        />

        {isCube && (
          <>
            <PanelSection
              title="What it reads"
              description={
                <>
                  Each Cube view, and the domain it belongs to. It reads{' '}
                  <code className="font-mono text-xs">meta.domain</code> on the view.
                </>
              }
            >
              <DataTable
                head={['View', 'Metrics', 'Dimensions', 'Domain', 'Owners']}
                align={['left', 'right', 'right', 'left', 'left']}
                rows={views.map((v) => [
                  <code key="v" className="font-mono text-dense">
                    {v.view}
                  </code>,
                  v.metrics,
                  v.dimensions,
                  v.domain ? domains[v.domain]?.name : <NoDomain key="d" />,
                  <Owners key="o" domain={v.domain} />,
                ])}
              />
              {d && d.noDomain > 0 && (
                <div className="flex flex-wrap items-center gap-3 border-t bg-caution/8 px-4 py-3 text-sm md:px-5">
                  <TriangleAlertIcon aria-hidden className="size-4 shrink-0 text-caution-ink" />
                  <p className="min-w-0 flex-1">
                    <span className="font-medium">
                      {d.noDomain === 1
                        ? '1 view has no domain.'
                        : `${d.noDomain} views have no domain.`}
                    </span>{' '}
                    Their definitions stay shared, and no owner is told when they change.
                  </p>
                  {!own && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        navigate(`/settings/integrations/${source.id}/connect`, { step: '4' })
                      }
                    >
                      Map to a domain
                    </Button>
                  )}
                </div>
              )}
              <p className="flex items-center gap-2 border-t px-4 py-3 text-xs text-muted-foreground md:px-5">
                <LockIcon aria-hidden className="size-3.5" />
                It keeps a read-only copy: name, title, a description up to 500 characters, type,
                domain and a change mark. Never a calculation, a query or a row of data.
              </p>
            </PanelSection>
            <PanelSection title="Activity" description="Every read, newest first.">
              <ActivityList items={activity} />
            </PanelSection>
            <PanelSection
              title={c.figures ? 'Definitions connection' : 'Connection'}
              description={
                c.figures
                  ? `The first of ${c.name}'s two connections: its definition files, read from Git ${source.every}, never ${c.name}'s data. Figures have their own connection below.`
                  : undefined
              }
            >
              <Connection
                rows={shownRows}
                actions={
                  <>
                    {!own && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          navigate(`/settings/integrations/${source.id}/connect`, { step: '2' })
                        }
                      >
                        Change settings
                      </Button>
                    )}
                    <PauseButton source={source} c={c} />
                    {disconnect}
                  </>
                }
              />
            </PanelSection>
          </>
        )}

        {isContent && (
          <>
            <PanelSection
              title="What it reads"
              description={
                isDrive
                  ? "Each shared folder goes to exactly one domain. Its suggestions go only to that domain's owners."
                  : 'Each folder goes to exactly one domain.'
              }
            >
              <DataTable
                head={['Folder', 'Domain', 'Owners', isDrive ? 'Documents' : 'Files']}
                align={['left', 'left', 'left', 'right']}
                rows={folders.map((f) => [
                  <span key="f" className="whitespace-nowrap">
                    <span className={cn(isDrive && 'font-medium')}>{f.folder}</span>
                    {f.path && <span className="text-muted-foreground"> / {f.path}</span>}
                  </span>,
                  domains[f.domain]?.name,
                  <Owners key="o" domain={f.domain} />,
                  f.documents,
                ])}
              />
            </PanelSection>
            {documents.length > 0 && (
              <>
                <PanelSection title="What happens to a document">
                  <ul className="flex flex-col gap-2.5 border-t px-4 py-4 text-sm md:px-5">
                    <li className="flex gap-2.5">
                      <GitPullRequestArrowIcon
                        aria-hidden
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      />
                      <span>
                        A new or changed document becomes{' '}
                        <span className="font-medium">one suggestion</span>. A changed document
                        replaces its open suggestion. Nothing is published by a read.
                      </span>
                    </li>
                    <li className="flex gap-2.5">
                      <LockIcon
                        aria-hidden
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      />
                      <span>
                        It keeps the link, the title, a quote of up to 500 characters and the date
                        read. Never the document.
                      </span>
                    </li>
                    <li className="flex gap-2.5">
                      <EyeOffIcon
                        aria-hidden
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      />
                      <span>
                        Documents that name people are skipped. Who can read a page is not copied:
                        once published, anyone in the workspace can read the context.
                      </span>
                    </li>
                  </ul>
                </PanelSection>
                <PanelSection title="Recent documents">
                  <DataTable
                    head={['Document', 'Domain', 'State', 'Read']}
                    rows={documents.map((doc) => [
                      <span key="t" className="flex flex-col">
                        {doc.href ? (
                          <a
                            href={doc.href}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {doc.title}
                          </a>
                        ) : (
                          <span className="font-medium">{doc.title}</span>
                        )}
                        <span className="text-xs text-muted-foreground">{doc.folder}</span>
                      </span>,
                      doc.domain ? domains[doc.domain]?.name : null,
                      <Badge
                        key="s"
                        variant="outline"
                        className={cn('font-normal whitespace-nowrap', docLook[doc.state])}
                      >
                        {doc.note ?? docLabel[doc.state]}
                      </Badge>,
                      <span key="r" className="whitespace-nowrap text-muted-foreground">
                        {doc.read}
                      </span>,
                    ])}
                  />
                </PanelSection>
              </>
            )}
            <PanelSection title="Activity" description="Every read, newest first.">
              <ActivityList items={activity} />
            </PanelSection>
            <PanelSection title="Connection">
              <Connection
                rows={shownRows}
                actions={
                  isDrive ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          navigate(`/settings/integrations/${source.id}/connect`, { step: '3' })
                        }
                      >
                        Change folders
                      </Button>
                      <Button
                        variant={h === 'reauth' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() =>
                          navigate(`/settings/integrations/${source.id}/connect`, { step: '2' })
                        }
                      >
                        Replace key
                      </Button>
                      <PauseButton source={source} c={c} />
                      {disconnect}
                    </>
                  ) : (
                    disconnect
                  )
                }
              />
            </PanelSection>
          </>
        )}

        {/* Figures show where the integration says how it is reached for one. */}
        {c.figures && figureConnections[c.id] && <FiguresSection c={c} />}
      </Panel>
      <DisconnectDialog source={source} c={c} open={leaving} onOpenChange={setLeaving} />
    </FramePage>
  )
}

/* ---------- the connect flow ---------- */

const STEPS = ['Pick', 'Connect', 'Choose', 'Map', 'Schedule'] as const

function Stepper({ at }: { at: number }) {
  return (
    <ol aria-label="Steps" className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
      {STEPS.map((s, i) => {
        const n = i + 1
        const done = n < at
        const on = n === at
        return (
          <li
            key={s}
            aria-current={on ? 'step' : undefined}
            className={cn('flex items-center gap-2', !on && 'max-sm:hidden')}
          >
            {i > 0 && <span aria-hidden className="h-px w-5 bg-border max-sm:hidden" />}
            <span
              className={cn(
                'grid size-5 place-items-center rounded-full border text-2xs tabular-nums',
                done && 'border-foreground bg-foreground text-background',
                on && 'border-primary text-primary ring-2 ring-primary/20',
              )}
            >
              {done ? <CheckIcon className="size-3" aria-label="Done" /> : n}
            </span>
            <span className={cn(on ? 'font-medium' : 'text-muted-foreground')}>
              {s}
              {on && <span className="text-muted-foreground sm:hidden"> ({n} of 5)</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** A step of a tool's check: done, a warning, failed, or left out. */
const stepLook: Record<ConnectStep['status'], React.ReactNode> = {
  ok: <CircleCheckIcon aria-hidden className="size-4 shrink-0 text-good-icon" />,
  warning: <TriangleAlertIcon aria-hidden className="size-4 shrink-0 text-caution-ink" />,
  failed: <CircleAlertIcon aria-hidden className="size-4 shrink-0 text-destructive" />,
  skipped: <span aria-hidden className="size-4 shrink-0 rounded-full border" />,
}

/** What Test connection says: its checks while they run, then each step in the tool's words. */
function Checks({ test }: { test: Testing }) {
  return (
    <ul className="flex flex-col gap-2 rounded-frame border p-4 text-sm" aria-live="polite">
      {test.running ? (
        <li className="flex items-center gap-2 text-muted-foreground">
          <LoaderCircleIcon aria-hidden className="size-4 animate-spin" />
          Testing the connection…
        </li>
      ) : test.error ? (
        <li className="flex items-start gap-2">
          {stepLook.failed}
          <span>{test.error}</span>
        </li>
      ) : (
        <>
          {test.result?.steps.map((step, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-0.5 flex">{stepLook[step.status]}</span>
              <span className="min-w-0">
                {step.title}
                {step.detail && <span className="text-muted-foreground">. {step.detail}</span>}
                {step.fix && <span className="block text-muted-foreground">{step.fix}</span>}
              </span>
            </li>
          ))}
          {test.result?.failure && (
            <li className="flex items-start gap-2">
              <span className="mt-0.5 flex">{stepLook.failed}</span>
              {test.result.failure}
            </li>
          )}
        </>
      )}
    </ul>
  )
}

function DomainPick({
  value,
  onChange,
}: {
  value: DomainId | null
  onChange: (d: DomainId) => void
}) {
  const domains = useDomains()
  const domainIds = useDomainList().map((d) => d.id)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'w-40 justify-between font-normal',
              !value && 'border-caution/60 text-caution-ink',
            )}
          />
        }
      >
        <span className="truncate">{value ? domains[value]?.name : 'Choose'}</span>
        <ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuRadioGroup value={value ?? ''} onValueChange={(v) => onChange(v as DomainId)}>
          {domainIds.map((d) => (
            <DropdownMenuRadioItem key={d} value={d}>
              {domains[d]?.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A test of the form's settings: running, what it found, or why it could not be asked. */
type Testing = {
  /** Which test this is: a new one starts what may be chosen again. */
  run: number
  /** The settings it tested, so a change to them asks for a new test. */
  of: string
  running: boolean
  result: ConnectTest | null
  error: string | null
}

const untested: Testing = { run: 0, of: '', running: false, result: null, error: null }

/** How often a tool is read, as Connect says it: "once an hour", "once a day". */
const onceWords = (every: string) =>
  every === 'every hour' ? 'once an hour' : every === 'every day' ? 'once a day' : every

/** The form's settings, read to compare: a test is of exactly these. */
const settingsKey = (values: ConnectValues) => JSON.stringify([values.config, values.secrets])

/** The service account a key file signs in as: its `client_email`, never anything else of it. */
function accountOf(text: string): string | null {
  try {
    const key: unknown = JSON.parse(text)
    const email =
      typeof key === 'object' && key !== null
        ? (key as { client_email?: unknown }).client_email
        : null
    return typeof email === 'string' ? email : null
  } catch {
    return null
  }
}

/** Settings › Integrations › a tool › Connect: five steps on a full page, and Change settings. */
export function ConnectFlow({ id }: { id: string }) {
  const load = useQuery(connectFormQuery(id))
  const form = load.data
  const c = connectorById(form?.connector ?? id)
  const label = form?.source ? 'Change settings' : c ? `Add ${c.name}` : 'Connect'
  return (
    <Page
      title={
        form?.source && c
          ? crumbs({ label: c.name, href: `/settings/integrations/${form.source.id}` }, { label })
          : crumbs({ label })
      }
    >
      <Loadable what="The connect form" skeleton={<RowsSkeleton rows={6} />} query={load}>
        {form === null || (c && c.soon) ? (
          <p className="p-6 text-sm text-muted-foreground">
            {c && c.soon
              ? `${c.name} isn't ready to connect yet.`
              : c
                ? `${c.name}'s settings are set where the server runs.`
                : 'There is no such integration.'}
          </p>
        ) : (
          form && c && <ConnectSteps form={form} c={c} />
        )}
      </Loadable>
    </Page>
  )
}

function ConnectSteps({ form, c }: { form: ConnectForm; c: Connector }) {
  const { query } = useRoute()
  const at = Math.min(5, Math.max(1, Number(query.get('step')) || 1))
  const isDrive = c.keyFile !== undefined
  const [values, setValues] = React.useState<ConnectValues>(() => ({
    config: Object.fromEntries(form.fields.map((f) => [f.key, f.value])),
    secrets: Object.fromEntries(form.secrets.map((s) => [s.key, ''])),
  }))
  const [files, setFiles] = React.useState<
    Record<string, { name: string; account: string | null }>
  >(() => Object.fromEntries(form.secrets.flatMap((s) => (s.file ? [[s.key, s.file]] : []))))
  const [more, setMore] = React.useState(false)
  const [test, setTest] = React.useState<Testing>(untested)
  const tested = !!test.result?.ok && test.of === settingsKey(values)

  const go = (n: number) => setQuery({ step: String(n) })
  const cancel = () =>
    navigate(form.source ? `/settings/integrations/${form.source.id}` : '/settings/integrations')
  const runTest = React.useCallback(async () => {
    const of = settingsKey(values)
    setTest((t) => ({ ...untested, run: t.run + 1, of, running: true }))
    try {
      const result = await api.testIntegration({
        connector: c.id,
        ...(form.source ? { source: form.source.id } : {}),
        ...values,
      })
      setTest((t) => ({ ...t, running: false, result }))
    } catch (e: unknown) {
      setTest((t) => ({ ...t, running: false, error: toApiError(e).message }))
    }
  }, [values, c.id, form.source])
  // Choose, Map or Schedule opened by its address: the settings are tested first, as they are.
  const needsTest = at >= 3 && !test.running && test.run === 0
  React.useEffect(() => {
    if (needsTest) void runTest()
  }, [needsTest, runTest])

  const setField = (key: string, value: string) =>
    setValues((v) => ({ ...v, config: { ...v.config, [key]: value } }))
  const setSecret = (key: string, value: string) =>
    setValues((v) => ({ ...v, secrets: { ...v.secrets, [key]: value } }))
  const upload = (key: string, file: File) =>
    void file.text().then((text) => {
      setSecret(key, text)
      setFiles((f) => ({ ...f, [key]: { name: file.name, account: accountOf(text) } }))
    })

  if (at >= 3 && test.result?.ok && test.of === settingsKey(values))
    return (
      <ChoiceSteps
        key={test.run}
        form={form}
        c={c}
        at={at}
        values={values}
        scopes={test.result.scopes}
        go={go}
        cancel={cancel}
      />
    )

  const main = form.fields.filter((f) => !f.advanced)
  const advanced = form.fields.filter((f) => f.advanced)
  const typed = form.secrets.filter((s) => s.key !== c.keyFile)
  const keyFile = form.secrets.find((s) => s.key === c.keyFile)
  const account = keyFile ? (files[keyFile.key]?.account ?? null) : null
  const input = (f: ConnectField) => (
    <Field key={f.key}>
      <FieldLabel htmlFor={`field-${f.key}`}>{f.label}</FieldLabel>
      <Input
        id={`field-${f.key}`}
        value={values.config[f.key] ?? ''}
        onChange={(e) => setField(f.key, e.target.value)}
        placeholder={f.placeholder}
        required={f.required}
        className={cn(f.kind !== 'text' && 'font-mono text-dense')}
      />
      {f.advanced && <FieldDescription>{f.description}</FieldDescription>}
    </Field>
  )
  // A branch and a folder sit side by side, as the repository's own two parts.
  const rows: ConnectField[][] = []
  for (const f of main) {
    const last = rows.at(-1)
    if (last?.length === 1 && last[0]!.kind === 'ref' && f.kind === 'path') last.push(f)
    else rows.push([f])
  }

  return (
    <FlowFrame at={at}>
      <div className="flex flex-col gap-5 px-4 py-5 md:px-6 md:py-6">
        {at === 1 && <PickStep c={c} />}
        {at === 2 && (
          <>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                {isDrive
                  ? 'Share folders with the service account'
                  : `Connect to your ${c.kind === 'definitions' ? 'Cube files' : 'repository'}`}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {isDrive
                  ? 'Google Docs are read by a service account that can only view.'
                  : `It reads them from Git, ${onceWords(form.every)}.`}
              </p>
            </div>
            <FieldGroup>
              {keyFile && (
                <Field>
                  <FieldLabel htmlFor={`file-${keyFile.key}`}>{keyFile.label}</FieldLabel>
                  <div className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
                    <KeyRoundIcon aria-hidden className="size-4 text-muted-foreground" />
                    <span className="flex-1 truncate">
                      {files[keyFile.key]?.name ??
                        (keyFile.set ? 'A key is set' : 'No key uploaded yet')}
                    </span>
                    {(files[keyFile.key] || keyFile.set) && (
                      <Badge variant="outline" className="border-good/35 font-normal text-good-ink">
                        {files[keyFile.key] ? 'Uploaded' : 'Set'}
                      </Badge>
                    )}
                    <label className="cursor-pointer text-sm font-medium text-primary underline-offset-4 hover:underline">
                      {files[keyFile.key] || keyFile.set ? 'Replace' : 'Upload'}
                      <input
                        id={`file-${keyFile.key}`}
                        type="file"
                        accept=".json,application/json"
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) upload(keyFile.key, file)
                          e.target.value = ''
                        }}
                      />
                    </label>
                  </div>
                  <FieldDescription>
                    Created in your Google Cloud project. Stored where only this source can use it.
                  </FieldDescription>
                </Field>
              )}
              {account && (
                <Field>
                  <FieldLabel htmlFor="share-address">
                    Share each folder with this address, as Viewer
                  </FieldLabel>
                  <div className="flex gap-2">
                    <Input
                      id="share-address"
                      readOnly
                      value={account}
                      className="font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Copy the address"
                      onClick={() => {
                        navigator.clipboard?.writeText(account).catch(() => undefined)
                        toast('Address copied')
                      }}
                    >
                      <CopyIcon />
                    </Button>
                  </div>
                  <FieldDescription>
                    It can only see folders shared with it. It can't see the rest of your Drive.
                  </FieldDescription>
                </Field>
              )}
              {rows.map((row) =>
                row.length === 2 ? (
                  <div key={row[0]!.key} className="grid gap-4 sm:grid-cols-2">
                    {row.map(input)}
                  </div>
                ) : (
                  input(row[0]!)
                ),
              )}
              {typed.map((secret) => (
                <Field key={secret.key}>
                  <FieldLabel htmlFor={`secret-${secret.key}`}>{secret.label}</FieldLabel>
                  <Input
                    id={`secret-${secret.key}`}
                    type="password"
                    autoComplete="off"
                    value={values.secrets[secret.key] ?? ''}
                    onChange={(e) => setSecret(secret.key, e.target.value)}
                    placeholder={secret.set ? 'Set. Leave it empty to keep it' : undefined}
                  />
                  <FieldDescription>Stored where only this source can use it.</FieldDescription>
                </Field>
              ))}
              {advanced.length > 0 && (
                <div className="flex flex-col gap-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-fit"
                    aria-expanded={more}
                    onClick={() => setMore((m) => !m)}
                  >
                    <ChevronDownIcon
                      data-icon="inline-start"
                      className={cn('transition-transform', !more && '-rotate-90')}
                    />
                    More settings
                  </Button>
                  {more && advanced.map(input)}
                </div>
              )}
            </FieldGroup>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  className="w-fit"
                  onClick={() => void runTest()}
                  disabled={test.running}
                >
                  <PlugIcon data-icon="inline-start" />
                  Test connection
                </Button>
                {!tested && !test.running && (
                  <span className="text-sm text-muted-foreground">
                    Test it before you continue.
                  </span>
                )}
              </div>
              {test.run > 0 && <Checks test={test} />}
            </div>
          </>
        )}
        {at >= 3 && (
          <>
            <Checks test={test} />
            {!test.running && (
              <p className="text-sm text-muted-foreground">
                Go back to Connect, check the settings and test again.
              </p>
            )}
          </>
        )}
      </div>
      <FlowFooter at={at} go={go} cancel={cancel}>
        <Button onClick={() => go(at + 1)} disabled={at === 2 ? !tested : at > 2}>
          Continue
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </FlowFooter>
    </FlowFrame>
  )
}

/** The connect flow's page: its five steps above one panel. */
function FlowFrame({ at, children }: { at: number; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
      <Stepper at={at} />
      <Panel>{children}</Panel>
    </div>
  )
}

/** Back (or where the steps stand), Cancel, and the step's own button. */
function FlowFooter({
  at,
  go,
  cancel,
  children,
}: {
  at: number
  go: (n: number) => void
  cancel: () => void
  children: React.ReactNode
}) {
  return (
    <footer className="flex items-center gap-2 border-t px-4 py-3 md:px-6">
      {at === 1 ? (
        <span className="text-sm text-muted-foreground tabular-nums">1 of 5</span>
      ) : (
        <Button variant="ghost" onClick={() => go(at - 1)}>
          <ArrowLeftIcon data-icon="inline-start" />
          Back
        </Button>
      )}
      <Button variant="ghost" className="ml-auto" onClick={cancel}>
        Cancel
      </Button>
      {children}
    </footer>
  )
}

/** Pick: what the tool will hold and never hold, and what connecting it needs. */
function PickStep({ c }: { c: Connector }) {
  const isCube = c.kind === 'definitions'
  const isDrive = c.keyFile !== undefined
  return (
    <>
      <div className="flex items-center gap-3">
        <ToolLogo c={c} size="lg" />
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{c.name}</h2>
          <p className="text-sm text-muted-foreground">
            {isCube
              ? 'Definitions: which metrics and dimensions exist.'
              : 'Context: what people wrote down, as suggestions for owners.'}
          </p>
        </div>
      </div>
      <div className="overflow-hidden rounded-frame border">
        <div className="p-4">
          <h3 className="text-sm font-medium">What it will hold</h3>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {(isCube
              ? [
                  'The name, title and a short description of each definition',
                  'Its type, its domain and a change mark',
                  'A link back to the Cube file',
                ]
              : [
                  'The link and title of each document',
                  'A quote of up to 500 characters, and the date read',
                  'One suggestion per document, for the owners of its domain',
                ]
            ).map((t) => (
              <li key={t} className="flex items-center gap-2">
                <CheckIcon aria-hidden className="size-4 text-good-icon" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="border-t p-4">
          <h3 className="text-sm font-medium">What it will never hold</h3>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {(isCube
              ? ['A calculation, a query or a row of data']
              : ['The document itself, or who can read it', 'Anything published without an owner']
            ).map((t) => (
              <li key={t} className="flex items-center gap-2">
                <XIcon aria-hidden className="size-4 text-destructive" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="flex gap-2 rounded-frame bg-primary/5 p-4 text-sm">
        <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        {isCube
          ? 'You need a read-only token for the Git repository that holds your Cube files. Only admins can connect a source.'
          : isDrive
            ? 'You need a Google Cloud project to create a service account key, and the folders to share with it. Only admins can connect a source.'
            : 'You need a read-only token for the repository. Only admins can connect a source.'}
      </p>
    </>
  )
}

/**
 * Choose, Map and Schedule, over what the test found: the views or folders ticked, the domain
 * each maps to, and why it is added. A new test starts them again.
 */
function ChoiceSteps({
  form,
  c,
  at,
  values,
  scopes,
  go,
  cancel,
}: {
  form: ConnectForm
  c: Connector
  at: number
  values: ConnectValues
  scopes: ConnectScope[]
  go: (n: number) => void
  cancel: () => void
}) {
  const { query } = useRoute()
  const setup = !!query.get('setup')
  const { connect, change } = useConnectActions()
  const isCube = c.kind === 'definitions'
  const isDrive = c.keyFile !== undefined
  const ids = scopes.map((s) => s.id)
  // A tool connected starts from what it reads (a definitions tool with nothing chosen reads all);
  // a new one from everything found, but what is left out at first.
  const before = new Map(form.chosen.map((choice) => [choice.id, choice.domain]))
  const initial = form.source
    ? before.size
      ? ids.filter((i) => before.has(i))
      : ids
    : scopes.filter((s) => !s.leftOut).map((s) => s.id)
  // The rows to read: Shift and a click ticks a run of them, as in every list.
  const pickScopes = useSelection(ids, { keys: false, initial })
  const chosen = scopes.filter((s) => pickScopes.ids.includes(s.id))
  // A domain the tool suggests goes in only when it is one of the workspace's.
  const domainIds = new Set(useDomainList().map((d) => d.id))
  const [map, setMap] = React.useState<Record<string, DomainId | null>>(() =>
    Object.fromEntries(
      scopes.map((s) => {
        const domain = before.has(s.id) ? (before.get(s.id) ?? null) : (s.domain ?? null)
        return [s.id, domain && domainIds.has(domain) ? domain : null]
      }),
    ),
  )
  const [why, setWhy] = React.useState(
    isCube && !form.source ? 'Our metric definitions live in Cube' : '',
  )
  const [saving, setSaving] = React.useState(false)
  const mapped = chosen.filter((s) => map[s.id]).length
  const unmapped = scopes.filter((s) => !s.domain).length
  const leftOut = scopes.filter((s) => s.leftOut)
  const sum = (key: 'metrics' | 'dimensions' | 'documents') =>
    chosen.reduce((n, s) => n + (s[key] ?? 0), 0)
  const preview = isCube
    ? `It would hold ${plural(sum('metrics'), 'metric')} and ${plural(sum('dimensions'), 'dimension')}.`
    : chosen.some((s) => s.documents !== undefined)
      ? `It would look at ${plural(sum('documents'), isDrive ? 'document' : 'file')} in ${plural(chosen.length, 'folder')}.`
      : `It would look at ${plural(chosen.length, 'folder')}.`

  const finish = async () => {
    const choices = chosen.map((s) => ({ id: s.id, title: s.title, domain: map[s.id] ?? null }))
    // A definitions tool that reads every view as the tool maps it keeps nothing chosen: a view
    // added later is read too.
    const asFound =
      isCube &&
      chosen.length === scopes.length &&
      choices.every((ch) => ch.domain === (scopes.find((s) => s.id === ch.id)?.domain ?? null))
    const input = { ...values, chosen: asFound ? [] : choices, reason: why.trim() }
    setSaving(true)
    try {
      if (form.source) {
        await change({ id: form.source.id, revision: form.source.revision, ...input })
        toast(`${c.name} settings saved`, {
          description: 'They apply from its next read, which starts now. Kept in the history log.',
        })
        navigate(`/settings/integrations/${form.source.id}`)
        return
      }
      const done = await connect({ connector: c.id, ...input, ...(setup ? { setup } : {}) })
      toast(`${c.name} connected`, {
        description: isCube
          ? 'First read now. Definitions show in Definitions as a read-only copy.'
          : `First read ${done.firstRead ? `at ${done.firstRead}` : 'now'}. Documents become suggestions; nothing is published by a read.`,
      })
      if (setup) navigate('/inbox')
      else navigate(`/settings/integrations/${done.id}`)
    } catch (e: unknown) {
      toast(form.source ? `Couldn't save ${c.name}` : `Couldn't connect ${c.name}`, {
        description: toApiError(e).message,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <FlowFrame at={at}>
      <div className="flex flex-col gap-5 px-4 py-5 md:px-6 md:py-6">
        {at === 3 && (
          <>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Choose what to read</h2>
              <p className="mt-1 text-sm text-muted-foreground">{preview}</p>
            </div>
            <ul className="overflow-hidden rounded-frame border">
              {scopes.map((s) => (
                <li key={s.id} className="border-t first:border-t-0">
                  <label
                    className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm hover:bg-muted/40"
                    onMouseDown={pickScopes.onMouseDown}
                  >
                    <Checkbox {...pickScopes.checkbox(s.id)} />
                    <span
                      className={cn('min-w-0 flex-1 truncate', isCube && 'font-mono text-dense')}
                    >
                      {s.title}
                    </span>
                    <span className="text-muted-foreground">{s.detail}</span>
                  </label>
                </li>
              ))}
            </ul>
            {isCube && unmapped > 0 && (
              <p className="flex items-start gap-2 rounded-frame border border-caution/45 bg-caution/8 p-3 text-sm">
                <TriangleAlertIcon
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-caution-ink"
                />
                <span>
                  {unmapped === 1 ? '1 view has' : `${unmapped} views have`} no{' '}
                  <code className="font-mono text-xs">meta.domain</code>. You can map{' '}
                  {unmapped === 1 ? 'it' : 'them'} in the next step.
                </span>
              </p>
            )}
            {leftOut.map((s) => (
              <p key={s.id} className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{s.title}</span> is left out:{' '}
                {s.leftOut}.
              </p>
            ))}
          </>
        )}

        {at === 4 && (
          <>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Map to domains and owners</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {isCube
                  ? 'Owners of a domain are told when a definition they rely on changes.'
                  : "Each folder goes to exactly one domain. Its suggestions go only to that domain's owners."}
              </p>
            </div>
            <div className="overflow-x-auto rounded-frame border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-band text-left text-xs text-muted-foreground">
                    <th className="h-9 px-4 font-medium">{isCube ? 'Cube view' : 'Folder'}</th>
                    <th className="h-9 px-4 font-medium">Domain</th>
                    <th className="h-9 px-4 font-medium">Owners</th>
                  </tr>
                </thead>
                <tbody>
                  {chosen.map((s) => (
                    <tr key={s.id} className="border-t">
                      <td className={cn('h-12 px-4', isCube && 'font-mono text-dense')}>
                        {s.title}
                      </td>
                      <td className="px-4">
                        <DomainPick
                          value={map[s.id] ?? null}
                          onChange={(d) => setMap((m) => ({ ...m, [s.id]: d }))}
                        />
                      </td>
                      <td className="px-4">
                        <Owners domain={map[s.id] ?? undefined} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              {isCube
                ? `A hint never creates a domain. Leave a view unmapped and its definitions stay shared. ${mapped} of ${chosen.length} mapped.`
                : `Every folder needs a domain before it is read. ${mapped} of ${chosen.length} mapped.`}
            </p>
          </>
        )}

        {at === 5 && (
          <>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Schedule and review</h2>
              <p className="mt-1 text-sm text-muted-foreground">What happens on each read.</p>
            </div>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-frame border p-3">
                <dt className="text-xs text-muted-foreground">Read</dt>
                <dd className="mt-1 font-medium">{sentence(form.every)}</dd>
              </div>
              <div className="rounded-frame border p-3">
                <dt className="text-xs text-muted-foreground">
                  {isCube ? 'Out of date after' : 'Suggestions per day'}
                </dt>
                <dd className="mt-1 font-medium">
                  {isCube || form.perDay === null ? form.staleAfter : `At most ${form.perDay}`}
                </dd>
              </div>
            </dl>
            <ul className="flex flex-col gap-2 rounded-frame border p-4 text-sm">
              {(isCube
                ? [
                    <>
                      A changed or missing definition marks the context that relies on it{' '}
                      <span className="font-medium">Needs checking</span> and tells its owner.
                    </>,
                    <>Nothing is published or changed by a read.</>,
                    <>If Cube can't be reached, the last good read stays and nothing is flagged.</>,
                  ]
                : [
                    <>
                      A new or changed document becomes{' '}
                      <span className="font-medium">one suggestion</span> in its owners' Inbox.
                    </>,
                    <>
                      Nothing is published by a read. An owner publishes, or returns it with a note.
                    </>,
                    <>If {c.name} can't be reached, what was read stays and nothing is created.</>,
                  ]
              ).map((t, i) => (
                <li key={i} className="flex gap-2">
                  <CircleCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-good-icon" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <Field>
              <FieldLabel htmlFor="why">
                {form.source ? 'Why are you changing it?' : 'Why are you adding this?'}
              </FieldLabel>
              <Input
                id="why"
                value={why}
                onChange={(e) => setWhy(e.target.value)}
                placeholder={form.source ? 'The handbook moved' : 'Our handbook lives in Git'}
              />
              <FieldDescription>Kept in the history log.</FieldDescription>
            </Field>
          </>
        )}
      </div>
      <FlowFooter at={at} go={go} cancel={cancel}>
        {at < 5 ? (
          <Button
            onClick={() => go(at + 1)}
            disabled={
              (at === 3 && !chosen.length) || (at === 4 && !isCube && mapped < chosen.length)
            }
          >
            Continue
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        ) : (
          <Button onClick={() => void finish()} disabled={!why.trim() || saving}>
            {form.source ? 'Save changes' : isCube ? `Add ${c.name}` : `Connect ${c.name}`}
          </Button>
        )}
      </FlowFooter>
    </FlowFrame>
  )
}

/** Settings > Integrations, its tool pages and the connect flow. */
export function IntegrationsRoute({ id, step }: { id?: string; step?: string }) {
  if (!id) return <IntegrationsPage />
  if (step === 'connect') return <ConnectFlow key={id} id={id} />
  return <ConnectorPage id={id} />
}
