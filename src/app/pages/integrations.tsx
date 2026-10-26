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
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
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
  cubeActivity,
  cubeViews,
  driveActivity,
  driveDocuments,
  driveFolders,
  figureConnections,
  integrationState,
  warehouseHas,
  kindName,
  type Activity,
  type Connector,
  type DocState,
  type IntegrationState,
} from '@/data/integrations'
import { domainIds, domains, people, type DomainId } from '@/data/world'
import { connect, disconnect, useConnected } from '@/lib/integrations'
import { setDataContact, setFigures, useFigures } from '@/lib/figures'
import { navigate, setQuery, useRoute } from '@/lib/router'
import { useStore } from '@/lib/store'
import { SettingsCrumbs } from '@/pages/settings'
import { SERVICE_ACCOUNT, SLUG } from '@/lib/brand'
import { Frame, FrameNumbers, FramePage, FrameSection } from '@/components/heed/frame'

// Settings > Integrations: the tools Heed reads. Connected tools as rows (is it healthy, when did
// it last read, what is waiting), available tools as Efferd hairline cells below in two groups,
// Definitions and Context, and Request a connector. Each connected tool has one page with sections
// and no tabs; connecting is five steps on a full page. A sync never publishes.

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

const crumbs = (...rest: { label: string; href?: string }[]) => (
  <SettingsCrumbs
    trail={[
      { label: 'Settings', href: '#/settings/general' },
      { label: 'Integrations', href: '#/settings/integrations' },
      ...rest,
    ]}
  />
)

type Health = 'healthy' | 'reading' | 'failed' | 'reauth' | 'paused'

const healthLook: Record<Health, { label: string; icon: React.ReactNode; cls: string }> = {
  healthy: {
    label: 'Healthy',
    icon: <CircleCheckIcon />,
    cls: 'border-[oklch(0.62_0.15_150/0.35)] text-[oklch(0.45_0.12_150)] dark:text-[oklch(0.78_0.13_150)]',
  },
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
    cls: 'border-[oklch(0.68_0.16_65/0.45)] text-[oklch(0.5_0.13_65)] dark:text-[oklch(0.8_0.13_75)]',
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

const dotCls = {
  ok: 'bg-[oklch(0.62_0.15_150)]',
  changed: 'bg-[oklch(0.68_0.16_65)]',
  failed: 'bg-destructive',
}

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
    <div className="overflow-x-auto border-t">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[color-mix(in_oklab,var(--muted)_45%,var(--background))] text-xs text-muted-foreground">
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
    </div>
  )
}

function Owners({ domain }: { domain?: DomainId }) {
  if (!domain) return <span className="text-muted-foreground">shared</span>
  return (
    <span className="flex -space-x-1.5">
      {domains[domain].owners.map((o) => (
        <PersonAvatar key={o} name={o} size={20} className="ring-2 ring-background" />
      ))}
    </span>
  )
}

function NoDomain() {
  return (
    <Badge
      variant="outline"
      className="gap-1 border-[oklch(0.68_0.16_65/0.45)] font-normal text-[oklch(0.5_0.13_65)] dark:text-[oklch(0.8_0.13_75)] [&>svg]:size-3"
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
          className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-4 gap-y-0.5 border-t px-4 py-3 text-sm first:border-t-0 sm:grid-cols-[8.5rem_9rem_minmax(0,1fr)] md:px-5"
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
            className="grid gap-1 border-t px-4 py-3 text-sm first:border-t-0 sm:grid-cols-[11rem_minmax(0,1fr)] md:px-5"
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
 * Figures in Ask, on each integration that can answer one: off by default (Ask then links into the
 * tool), its endpoint, the secret (masked), the one host it may call, who to ask about a figure,
 * and the rule for which integration answers a metric.
 */
function FiguresSection({ c }: { c: Connector }) {
  const f = useFigures()
  const conn = figureConnections[c.id]
  const on = f.enabled(c.id)
  const switchId = `figures-${c.id}`
  return (
    <PanelSection
      title="Figures in Ask"
      description={`Off, an answer links into ${c.name} instead. On, an answer can show one figure from ${c.name}: read when asked, never stored, and never called checked.`}
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
              toast(v ? `Figures from ${c.name} are on` : `Figures from ${c.name} are off`, {
                description: v
                  ? 'Answers show one figure for the metric they ask about.'
                  : `Answers link into ${c.name} instead.`,
              })
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
              <code key="e" className="font-mono text-[13px] break-all">
                {conn.endpoint}
              </code>,
            ],
            [
              'Secret',
              <span key="s" className="flex flex-wrap items-center gap-3">
                <code
                  className="font-mono text-[13px]"
                  aria-label={`Secret ending in ${conn.secretTail}`}
                >
                  {'••••••••••••'}
                  {conn.secretTail}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    toast('A new secret replaces this one', {
                      description: 'Paste it when you have it; the old one stops working.',
                    })
                  }
                >
                  Replace
                </Button>
              </span>,
            ],
            [
              'Declared host',
              <span key="h">
                <code className="font-mono text-[13px]">{conn.host}</code>
                <span className="block text-xs text-muted-foreground">
                  The only host called for a figure. Read only, with a 4 second limit.
                </span>
              </span>,
            ],
            [
              'Data contact',
              <span key="c" className="flex flex-wrap items-center gap-2">
                <PersonAvatar name={f.contact(c.id)} size={20} />
                <Select
                  value={f.contact(c.id)}
                  onValueChange={(v) => setDataContact(c.id, v as string)}
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
            [
              'Data as of',
              <span key="a">
                {conn.asOf}, the last time {c.name} refreshed its data
              </span>,
            ],
          ] as [string, React.ReactNode][]
        ).map(([k, v]) => (
          <div
            key={k}
            className="grid gap-1 border-t px-4 py-3 text-sm first:border-t-0 sm:grid-cols-[11rem_minmax(0,1fr)] md:px-5"
          >
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex items-start gap-2 border-t bg-[color-mix(in_oklab,var(--muted)_45%,var(--background))] px-4 py-3 text-sm md:px-5">
        <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p>
          <span className="font-medium">Which integration answers:</span>{' '}
          <span className="text-muted-foreground">
            {c.id === 'cube'
              ? "the one a metric's definition comes from, never a guess. All 22 metrics' definitions come from Cube, so Cube answers them."
              : `the one a metric's definition comes from, never a guess. ${c.name} has tables for ${warehouseHas.join(', ')}, but no definition comes from it, so it answers none of them. Orders is in Cube too: its definition comes from Cube, so Cube answers Orders, and Ask says so.`}
          </span>
        </p>
      </div>
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
            Tell us which tool holds your definitions or your context. Only definitions and context
            are read, never numbers, so a warehouse isn't one.
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

function health(id: string, state: IntegrationState): Health {
  if (id === 'cube' && state === 'syncing') return 'reading'
  if (id === 'cube' && state === 'failed') return 'failed'
  if (id === 'google-drive' && state === 'reauth') return 'reauth'
  return 'healthy'
}

function ConnectedRow({ c, state }: { c: Connector; state: IntegrationState }) {
  const h = health(c.id, state)
  const detail =
    c.id === 'cube' ? (
      <>22 metrics and 5 dimensions. 2 views have no domain</>
    ) : c.id === 'google-drive' ? (
      <>
        14 documents.{' '}
        <a
          href="#/inbox?demo=week&card=drive-marketplace"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          3 suggestions
        </a>{' '}
        waiting for owners
      </>
    ) : c.id === 'warehouse' ? (
      <>Figures for Ask, read only when an answer asks. Answers no metric yet</>
    ) : (
      <>First read at 07:00. Suggestions go to the owners of each folder's domain</>
    )
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t px-4 py-3 first:border-t-0 md:px-5 @3xl/main:grid-cols-[auto_minmax(0,1fr)_13rem_auto]">
      <ToolLogo c={c} />
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {c.name}
          <Badge variant="secondary" className="font-normal">
            {kindName[c.kind]}
          </Badge>
        </p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      <div className="col-span-3 col-start-2 row-start-2 text-xs @3xl/main:col-span-1 @3xl/main:col-start-auto @3xl/main:row-start-auto">
        {h === 'healthy' ? (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className={cn('size-2 rounded-full', dotCls.ok)} />
            <span>
              {c.id === 'warehouse' ? (
                'Ready, read when asked'
              ) : (
                <>
                  Read today, 06:00
                  <span className="text-muted-foreground">
                    , next {c.id === 'cube' ? '07:00' : 'tomorrow'}
                  </span>
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
        className="row-start-1 col-start-3 @3xl/main:col-start-4"
        onClick={() =>
          navigate(`/settings/integrations/${c.id}`, state !== 'normal' ? { state } : undefined)
        }
      >
        Manage
      </Button>
    </li>
  )
}

function AvailableCell({ c, connected }: { c: Connector; connected: boolean }) {
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
        {c.soon ? (
          <Badge variant="outline" className="font-normal text-muted-foreground">
            Soon
          </Badge>
        ) : connected ? (
          <a
            href={`#/settings/integrations/${c.id}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Connected, manage <ArrowRightIcon className="size-3.5" aria-hidden />
          </a>
        ) : (
          <a
            href={`#/settings/integrations/${c.id}/connect`}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Connect <ArrowRightIcon className="size-3.5" aria-hidden />
          </a>
        )}
      </div>
    </div>
  )
}

export function IntegrationsPage() {
  const { query } = useRoute()
  const state = integrationState(query.get('state'))
  const live = useConnected()
  const connected = state === 'nothing' ? [] : live
  const [text, setText] = React.useState('')
  const [asking, setAsking] = React.useState(false)
  const q = text.trim().toLowerCase()
  const shown = connectors.filter((c) => `${c.name} ${c.blurb}`.toLowerCase().includes(q))
  const rows = shown.filter((c) => connected.includes(c.id))
  const cells = shown.filter((c) => !connected.includes(c.id))

  return (
    <Page
      title={
        <SettingsCrumbs
          trail={[{ label: 'Settings', href: '#/settings/general' }, { label: 'Integrations' }]}
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
          {state === 'reauth' && (
            <div
              role="alert"
              className="flex flex-wrap items-start gap-3 border-t bg-[oklch(0.68_0.16_65/0.08)] px-4 py-4 text-sm md:px-5"
            >
              <TriangleAlertIcon
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-[oklch(0.5_0.13_65)] dark:text-[oklch(0.8_0.13_75)]"
              />
              <p className="min-w-0 flex-1">
                <span className="font-medium">Google Drive needs a new key.</span> Google refused
                the service account key on 21 Oct. Reading is paused; published context is not
                affected.
              </p>
              <Button
                size="sm"
                onClick={() =>
                  navigate('/settings/integrations/google-drive/connect', { step: '2' })
                }
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
            {connected.length === 0 ? (
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
                {rows.map((c) => (
                  <ConnectedRow key={c.id} c={c} state={state} />
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
                <AvailableCell key={c.id} c={c} connected={false} />
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
                  onClick={() => setAsking(true)}
                  className="mt-auto inline-flex w-fit items-center gap-1 pt-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  Tell us <ArrowRightIcon className="size-3.5" aria-hidden />
                </button>
              </div>
            </div>
          </PanelSection>
        </Panel>
        <p className="text-xs text-muted-foreground">
          There is no data source here on purpose: your workspace holds no numbers, so it never
          reads a warehouse.
        </p>
      </FramePage>
      <RequestConnector open={asking} onOpenChange={setAsking} />
    </Page>
  )
}

/* ---------- a connector's page ---------- */

const docLook: Record<DocState, string> = {
  waiting: 'border-primary/35 text-primary',
  published:
    'border-[oklch(0.62_0.15_150/0.35)] text-[oklch(0.45_0.12_150)] dark:text-[oklch(0.78_0.13_150)]',
  returned: 'text-muted-foreground',
  skipped:
    'border-[oklch(0.68_0.16_65/0.45)] text-[oklch(0.5_0.13_65)] dark:text-[oklch(0.8_0.13_75)]',
}
const docLabel: Record<DocState, string> = {
  waiting: 'Suggestion waiting',
  published: 'Published',
  returned: 'Returned',
  skipped: 'Skipped',
}

function ConnectorMenu({ c, onDisconnect }: { c: Connector; onDisconnect: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="icon-sm" aria-label={`More for ${c.name}`} />}
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem
          onClick={() =>
            toast(`Reading paused for ${c.name}`, {
              description: "Agents keep getting what's published. Resume from this menu.",
            })
          }
        >
          <PauseIcon />
          Pause reading
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => navigate(`/settings/integrations/${c.id}/connect`, { step: '2' })}
        >
          <KeyRoundIcon />
          Change settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDisconnect}>
          <XIcon />
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DisconnectDialog({
  c,
  open,
  onOpenChange,
}: {
  c: Connector
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Disconnect {c.name}?</DialogTitle>
          <DialogDescription>
            {c.kind === 'definitions'
              ? 'Reading stops. The definitions already read stay, marked as no longer read, and no context is flagged by it again.'
              : c.kind === 'data'
                ? 'Answers stop showing its figures and link nowhere instead. Nothing it returned was kept, so nothing else changes.'
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
              disconnect(c.id)
              onOpenChange(false)
              toast(`${c.name} disconnected`, {
                description: 'Kept in the history log. Connect it again from Integrations.',
              })
              navigate('/settings/integrations')
            }}
          >
            Disconnect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReadAgain({ c, busy }: { c: Connector; busy?: boolean }) {
  const [reading, setReading] = React.useState(false)
  const on = busy || reading
  return (
    <Button
      variant="outline"
      size="sm"
      loading={on}
      loadingLabel="Reading…"
      onClick={() => {
        setReading(true)
        window.setTimeout(() => {
          setReading(false)
          toast(`Read ${c.name}`, {
            description:
              c.kind === 'definitions'
                ? '27 definitions, no changes.'
                : '14 documents, no changes. No new suggestions.',
          })
        }, 1200)
      }}
    >
      <RefreshCwIcon data-icon="inline-start" />
      Read again
    </Button>
  )
}

export function ConnectorPage({ id }: { id: string }) {
  const c = connectorById(id)
  const { query } = useRoute()
  const state = integrationState(query.get('state'))
  const live = useConnected()
  const [leaving, setLeaving] = React.useState(false)
  if (!c || !live.includes(c.id))
    return (
      <Page title={crumbs({ label: c?.name ?? 'Not found' })}>
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
      </Page>
    )
  const h = health(c.id, state)
  const isCube = c.id === 'cube'
  const isDrive = c.id === 'google-drive'
  const isWarehouse = c.id === 'warehouse'

  return (
    <Page title={crumbs({ label: c.name })}>
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
                  ? "Reads your Cube definition files from Git. Read-only, and it keeps no calculation. Figures in Ask, when switched on, read one figure from Cube's data API at the time of the answer."
                  : isWarehouse
                    ? "Reads one figure from the warehouse's query API when an answer asks for it, if figures are switched on. It never writes and never keeps a row."
                    : isDrive
                      ? 'Reads the Google Docs in folders shared with its service account. Each new or changed document becomes one suggestion for the owners of its domain.'
                      : "Reads the Markdown files in a repository. Each new or changed file becomes one suggestion for the owners of its folder's domain."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {!isWarehouse && <ReadAgain c={c} busy={h === 'reading'} />}
              <ConnectorMenu c={c} onDisconnect={() => setLeaving(true)} />
            </div>
          </header>

          {h === 'reading' && (
            <div className="border-t px-4 py-4 md:px-5" role="status">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Reading 7 views</span>
                <span className="text-muted-foreground tabular-nums">19 of 27 definitions</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full w-[70%] rounded-full bg-primary" />
              </div>
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
                    The last 3 reads failed: the repository refused the token (401).
                  </span>{' '}
                  The last good read from 21 Oct, 06:00 stays, and nothing is flagged while Cube
                  can't be reached. Admins are told at 6 hours.
                </span>
              </p>
              <div className="mt-3 flex gap-2 pl-6">
                <ReadAgain c={c} />
                <Button
                  size="sm"
                  onClick={() => navigate('/settings/integrations/cube/connect', { step: '2' })}
                >
                  Change settings
                </Button>
              </div>
            </div>
          )}
          {isDrive && state === 'suggestions' && (
            <div role="status" className="border-t bg-primary/5 px-4 py-4 text-sm md:px-5">
              <p className="font-medium">
                Today's read created 3 suggestions in the owners' Inbox.
              </p>
              <ul className="mt-2 flex flex-col gap-1 text-muted-foreground">
                {[
                  '3 new suggestions, 1 replaced an open one',
                  '1 document skipped: it names people',
                  'Nothing published. Daily cap 3 of 5',
                ].map((t) => (
                  <li key={t} className="flex items-center gap-2">
                    <CheckIcon aria-hidden className="size-3.5" />
                    {t}
                  </li>
                ))}
              </ul>
              <Button
                size="sm"
                className="mt-3"
                onClick={() => navigate('/inbox', { demo: 'week', card: 'drive-marketplace' })}
              >
                Open the Inbox
              </Button>
            </div>
          )}

          <Numbers
            items={
              isCube
                ? h === 'failed'
                  ? [
                      {
                        label: 'Last good read',
                        value: '21 Oct',
                        sub: '06:00, 24 hours ago',
                        tone: 'bad',
                      },
                      { label: 'Next try', value: '07:00', sub: 'backing off' },
                      { label: 'Definitions', value: '27', sub: 'as last read' },
                      { label: 'Context affected', value: '0', sub: 'none flagged' },
                    ]
                  : [
                      {
                        label: h === 'reading' ? 'Last good read' : 'Last read',
                        value: 'Today, 06:00',
                        sub: 'complete, 3 s',
                      },
                      { label: 'Next read', value: '07:00', sub: 'every hour' },
                      { label: 'Definitions', value: '27', sub: '22 metrics, 5 dimensions' },
                      { label: 'Context to check', value: '2', sub: 'after the 7 Oct changes' },
                    ]
                : isWarehouse
                  ? [
                      { label: 'Reads', value: 'When asked', sub: 'one figure an answer' },
                      {
                        label: 'Metrics it answers',
                        value: '0',
                        sub: 'no definition comes from it',
                      },
                      {
                        label: 'Tables it has',
                        value: String(warehouseHas.length),
                        sub: 'seen, not read',
                      },
                      { label: 'Data as of', value: '05:30', sub: 'today' },
                    ]
                  : isDrive
                    ? [
                        {
                          label: 'Last read',
                          value: state === 'reauth' ? '21 Oct' : 'Today, 06:00',
                          sub:
                            state === 'reauth'
                              ? 'paused: needs a new key'
                              : '14 documents looked at',
                          tone: state === 'reauth' ? 'warn' : undefined,
                        },
                        { label: 'Next read', value: 'Tomorrow', sub: '06:00, every day' },
                        { label: 'Suggestions waiting', value: '3', sub: 'for 2 domains' },
                        { label: 'Drafts today', value: '3 of 5', sub: 'the daily cap' },
                      ]
                    : [
                        { label: 'Last read', value: 'Not yet', sub: 'first read at 07:00' },
                        { label: 'Next read', value: '07:00', sub: 'every day' },
                        { label: 'Suggestions waiting', value: '0', sub: 'none yet' },
                        { label: 'Drafts today', value: '0 of 5', sub: 'the daily cap' },
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
                  rows={cubeViews.map((v) => [
                    <code key="v" className="font-mono text-[13px]">
                      {v.view}
                    </code>,
                    v.metrics,
                    v.dimensions,
                    v.domain ? domains[v.domain].name : <NoDomain key="d" />,
                    <Owners key="o" domain={v.domain} />,
                  ])}
                />
                <div className="flex flex-wrap items-center gap-3 border-t bg-[oklch(0.68_0.16_65/0.08)] px-4 py-3 text-sm md:px-5">
                  <TriangleAlertIcon
                    aria-hidden
                    className="size-4 shrink-0 text-[oklch(0.5_0.13_65)] dark:text-[oklch(0.8_0.13_75)]"
                  />
                  <p className="min-w-0 flex-1">
                    <span className="font-medium">2 views have no domain.</span> Their definitions
                    stay shared, and no owner is told when they change.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate('/settings/integrations/cube/connect', { step: '4' })}
                  >
                    Map to a domain
                  </Button>
                </div>
                <p className="flex items-center gap-2 border-t px-4 py-3 text-xs text-muted-foreground md:px-5">
                  <LockIcon aria-hidden className="size-3.5" />
                  It keeps a read-only copy: name, title, a description up to 500 characters, type,
                  domain and a change mark. Never a calculation, a query or a row of data.
                </p>
              </PanelSection>
              <PanelSection title="Activity" description="Every read, newest first.">
                <ActivityList items={cubeActivity} />
              </PanelSection>
              <PanelSection title="Connection">
                <Connection
                  rows={[
                    [
                      'Repository',
                      <code key="r" className="font-mono text-[13px]">
                        https://git.example/larchwood/cube-definitions
                      </code>,
                    ],
                    [
                      'Branch or tag',
                      <code key="b" className="font-mono text-[13px]">
                        main
                      </code>,
                    ],
                    [
                      'Folder',
                      <code key="f" className="font-mono text-[13px]">
                        cube/
                      </code>,
                    ],
                    ['Read-only token', 'Set, only used for reading'],
                  ]}
                  actions={
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          navigate('/settings/integrations/cube/connect', { step: '2' })
                        }
                      >
                        Change settings
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          toast('Reading paused for Cube', {
                            description: "Agents keep getting what's published.",
                          })
                        }
                      >
                        <PauseIcon data-icon="inline-start" />
                        Pause reading
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setLeaving(true)}
                      >
                        Disconnect
                      </Button>
                    </>
                  }
                />
              </PanelSection>
            </>
          )}

          {isDrive && (
            <>
              <PanelSection
                title="What it reads"
                description="Each shared folder goes to exactly one domain. Its suggestions go only to that domain's owners."
              >
                <DataTable
                  head={['Folder', 'Domain', 'Owners', 'Documents']}
                  align={['left', 'left', 'left', 'right']}
                  rows={driveFolders.map((f) => [
                    <span key="f" className="whitespace-nowrap">
                      <span className="font-medium">{f.folder}</span>
                      <span className="text-muted-foreground"> / {f.path}</span>
                    </span>,
                    domains[f.domain].name,
                    <Owners key="o" domain={f.domain} />,
                    f.documents,
                  ])}
                />
              </PanelSection>
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
                  rows={driveDocuments.map((d) => [
                    <span key="t" className="flex flex-col">
                      {d.card ? (
                        <a
                          href={`#/inbox?demo=week&card=${d.card}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {d.title}
                        </a>
                      ) : (
                        <span className="font-medium">{d.title}</span>
                      )}
                      <span className="text-xs text-muted-foreground">{d.folder}</span>
                    </span>,
                    domains[d.domain].name,
                    <Badge
                      key="s"
                      variant="outline"
                      className={cn('font-normal whitespace-nowrap', docLook[d.state])}
                    >
                      {d.note ?? docLabel[d.state]}
                    </Badge>,
                    <span key="r" className="whitespace-nowrap text-muted-foreground">
                      {d.read}
                    </span>,
                  ])}
                />
              </PanelSection>
              <PanelSection title="Activity" description="Every read, newest first.">
                <ActivityList
                  items={
                    state === 'reauth'
                      ? [
                          {
                            when: '21 Oct, 06:00',
                            tone: 'failed',
                            what: 'Read refused',
                            detail: 'Google refused the service account key. Reading paused.',
                          },
                          ...driveActivity.slice(1),
                        ]
                      : driveActivity
                  }
                />
              </PanelSection>
              <PanelSection title="Connection">
                <Connection
                  rows={[
                    [
                      'Reads as',
                      <code key="a" className="font-mono text-[13px] break-all">
                        {SERVICE_ACCOUNT}
                      </code>,
                    ],
                    ['Access', 'Viewer on the folders above. Nothing else in Drive'],
                    [
                      'Service account key',
                      state === 'reauth'
                        ? 'Refused by Google on 21 Oct'
                        : 'Set, only used for reading',
                    ],
                    [
                      'Connected by',
                      <span key="by" className="flex items-center gap-2">
                        <PersonAvatar name="Ravi Kapoor" size={20} />
                        Ravi Kapoor, 1 Oct
                      </span>,
                    ],
                  ]}
                  actions={
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          navigate('/settings/integrations/google-drive/connect', { step: '3' })
                        }
                      >
                        Change folders
                      </Button>
                      <Button
                        variant={state === 'reauth' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() =>
                          navigate('/settings/integrations/google-drive/connect', { step: '2' })
                        }
                      >
                        Replace key
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          toast('Reading paused for Google Drive', {
                            description: 'Open suggestions stay in the Inbox.',
                          })
                        }
                      >
                        <PauseIcon data-icon="inline-start" />
                        Pause reading
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setLeaving(true)}
                      >
                        Disconnect
                      </Button>
                    </>
                  }
                />
              </PanelSection>
            </>
          )}

          {c.figures && <FiguresSection c={c} />}

          {!isCube && !isDrive && !isWarehouse && (
            <>
              <PanelSection
                title="What it reads"
                description="Each folder goes to exactly one domain."
              >
                <DataTable
                  head={['Folder', 'Domain', 'Owners', 'Files']}
                  align={['left', 'left', 'left', 'right']}
                  rows={[
                    ['docs/sales', 'Sales', <Owners key="o" domain="sales" />, 5],
                    ['docs/marketing', 'Marketing', <Owners key="o2" domain="marketing" />, 3],
                  ]}
                />
              </PanelSection>
              <PanelSection title="Activity" description="Every read, newest first.">
                <ActivityList
                  items={[
                    {
                      when: 'Today',
                      tone: 'ok',
                      what: 'Connected',
                      detail: 'First read at 07:00. Nothing is published by a read.',
                    },
                  ]}
                />
              </PanelSection>
              <PanelSection title="Connection">
                <Connection
                  rows={[
                    [
                      'Repository',
                      <code key="r" className="font-mono text-[13px]">
                        https://git.example/larchwood/handbook
                      </code>,
                    ],
                    [
                      'Branch or tag',
                      <code key="b" className="font-mono text-[13px]">
                        main
                      </code>,
                    ],
                    ['Read-only token', 'Set, only used for reading'],
                  ]}
                  actions={
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setLeaving(true)}
                    >
                      Disconnect
                    </Button>
                  }
                />
              </PanelSection>
            </>
          )}
        </Panel>
      </FramePage>
      <DisconnectDialog c={c} open={leaving} onOpenChange={setLeaving} />
    </Page>
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
                'grid size-5 place-items-center rounded-full border text-[11px] tabular-nums',
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

function Checks({ items, running }: { items: string[]; running: number }) {
  return (
    <ul className="flex flex-col gap-2 rounded-frame border p-4 text-sm" aria-live="polite">
      {items.map((t, i) => (
        <li
          key={t}
          className={cn('flex items-center gap-2', i >= running && 'text-muted-foreground')}
        >
          {i < running ? (
            <CircleCheckIcon aria-hidden className="size-4 text-[oklch(0.55_0.14_150)]" />
          ) : i === running ? (
            <LoaderCircleIcon aria-hidden className="size-4 animate-spin" />
          ) : (
            <span aria-hidden className="size-4 rounded-full border" />
          )}
          {t}
        </li>
      ))}
    </ul>
  )
}

function DomainPick({ value, onChange }: { value?: DomainId; onChange: (d: DomainId) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'w-40 justify-between font-normal',
              !value &&
                'border-[oklch(0.68_0.16_65/0.6)] text-[oklch(0.5_0.13_65)] dark:text-[oklch(0.8_0.13_75)]',
            )}
          />
        }
      >
        <span className="truncate">{value ? domains[value].name : 'Choose'}</span>
        <ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuRadioGroup value={value ?? ''} onValueChange={(v) => onChange(v as DomainId)}>
          {domainIds.map((d) => (
            <DropdownMenuRadioItem key={d} value={d}>
              {domains[d].name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ConnectFlow({ id }: { id: string }) {
  const c = connectorById(id)
  const { query } = useRoute()
  const { dispatch } = useStore()
  const live = useConnected()
  const at = Math.min(5, Math.max(1, Number(query.get('step')) || 1))
  const setup = !!query.get('setup')
  const [tested, setTested] = React.useState(-1)
  const isCube = c?.kind === 'definitions'
  const isDrive = c?.id === 'google-drive'
  const scopes = isCube
    ? cubeViews.map((v) => ({
        name: v.view,
        detail: [
          v.metrics && plural(v.metrics, 'metric'),
          v.dimensions && plural(v.dimensions, 'dimension'),
        ]
          .filter(Boolean)
          .join(', '),
        domain: v.domain,
      }))
    : isDrive
      ? driveFolders.map((f) => ({
          name: `${f.folder} / ${f.path}`,
          detail: `${f.documents} documents`,
          domain: f.domain as DomainId | undefined,
        }))
      : [
          { name: 'docs/sales', detail: '5 files', domain: 'sales' as DomainId | undefined },
          { name: 'docs/marketing', detail: '3 files', domain: undefined },
          { name: 'docs/people', detail: '1 file', domain: undefined },
        ]
  // The folders to read: Shift and a click ticks a run of them, as in every list.
  const pickScopes = useSelection(
    scopes.map((s) => s.name),
    { keys: false, initial: scopes.map((s) => s.name).filter((n) => n !== 'docs/people') },
  )
  const chosen = pickScopes.ids
  const [map, setMap] = React.useState<Record<string, DomainId | undefined>>(
    Object.fromEntries(scopes.map((s) => [s.name, s.domain])),
  )
  const [why, setWhy] = React.useState(isCube ? 'Our metric definitions live in Cube' : '')

  if (!c || c.soon)
    return (
      <Page title={crumbs({ label: 'Connect' })}>
        <p className="p-6 text-sm text-muted-foreground">
          {c ? `${c.name} isn't ready to connect yet.` : 'There is no such integration.'}
        </p>
      </Page>
    )

  const go = (n: number) => setQuery({ step: String(n) })
  const test = () => {
    setTested(0)
    ;[1, 2, 3].forEach((n) => window.setTimeout(() => setTested(n), n * 500))
  }
  const finish = () => {
    connect(c.id)
    toast(`${c.name} connected`, {
      description: isCube
        ? 'First read now. Definitions show in Definitions as a read-only copy.'
        : 'First read at 07:00. Documents become suggestions; nothing is published by a read.',
    })
    if (setup) {
      dispatch({ type: 'setupStep', step: 'definitions' })
      navigate('/inbox')
    } else navigate(`/settings/integrations/${c.id}`)
  }
  const testItems = isCube
    ? ['Reached the repository', 'Signed in with the token', 'Found 7 Cube views']
    : isDrive
      ? [
          'Google accepted the service account',
          'Found 3 shared folders',
          'Read 14 Google Docs: titles only',
        ]
      : [
          'Reached the repository',
          'Signed in with the token',
          'Found 9 Markdown files in 3 folders',
        ]
  const mapped = chosen.filter((n) => map[n]).length
  const preview = isCube
    ? 'It would hold 22 metrics and 5 dimensions.'
    : isDrive
      ? 'It would look at 14 documents in 3 folders.'
      : 'It would look at 9 files in 3 folders.'

  return (
    <Page title={crumbs({ label: `Add ${c.name}` })}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
        <Stepper at={at} />
        <Panel>
          <div className="flex flex-col gap-5 px-4 py-5 md:px-6 md:py-6">
            {at === 1 && (
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
                          <CheckIcon aria-hidden className="size-4 text-[oklch(0.55_0.14_150)]" />
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
                        : [
                            'The document itself, or who can read it',
                            'Anything published without an owner',
                          ]
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
            )}

            {at === 2 && (
              <>
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">
                    {isDrive
                      ? 'Share folders with the service account'
                      : `Connect to your ${isCube ? 'Cube files' : 'repository'}`}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {isDrive
                      ? 'Google Docs are read by a service account that can only view.'
                      : `It reads them from Git, ${isCube ? 'once an hour' : 'once a day'}.`}
                  </p>
                </div>
                {isDrive ? (
                  <FieldGroup>
                    <Field>
                      <FieldLabel>Service account key</FieldLabel>
                      <div className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
                        <KeyRoundIcon aria-hidden className="size-4 text-muted-foreground" />
                        <span className="flex-1 truncate">{SLUG}-reader.json</span>
                        <Badge
                          variant="outline"
                          className="border-[oklch(0.62_0.15_150/0.35)] font-normal text-[oklch(0.45_0.12_150)] dark:text-[oklch(0.78_0.13_150)]"
                        >
                          Uploaded
                        </Badge>
                      </div>
                      <FieldDescription>
                        Created in your Google Cloud project. Stored where only this source can use
                        it.
                      </FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="share-address">
                        Share each folder with this address, as Viewer
                      </FieldLabel>
                      <div className="flex gap-2">
                        <Input
                          id="share-address"
                          readOnly
                          value={SERVICE_ACCOUNT}
                          className="font-mono text-xs"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label="Copy the address"
                          onClick={() => {
                            navigator.clipboard?.writeText(SERVICE_ACCOUNT).catch(() => undefined)
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
                  </FieldGroup>
                ) : (
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="repo">Repository address</FieldLabel>
                      <Input
                        id="repo"
                        defaultValue={
                          isCube
                            ? 'https://git.example/larchwood/cube-definitions'
                            : 'https://git.example/larchwood/handbook'
                        }
                        className="font-mono text-[13px]"
                      />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field>
                        <FieldLabel htmlFor="branch">Branch or tag</FieldLabel>
                        <Input id="branch" defaultValue="main" className="font-mono text-[13px]" />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="folder">Folder</FieldLabel>
                        <Input
                          id="folder"
                          defaultValue={isCube ? 'cube/' : 'docs/'}
                          className="font-mono text-[13px]"
                        />
                      </Field>
                    </div>
                    <Field>
                      <FieldLabel htmlFor="token">Read-only token</FieldLabel>
                      <Input id="token" type="password" defaultValue="ghp_mock_read_only_token" />
                      <FieldDescription>Stored where only this source can use it.</FieldDescription>
                    </Field>
                  </FieldGroup>
                )}
                <div className="flex flex-col gap-3">
                  <Button
                    variant="outline"
                    className="w-fit"
                    onClick={test}
                    disabled={tested >= 0 && tested < 3}
                  >
                    <PlugIcon data-icon="inline-start" />
                    Test connection
                  </Button>
                  {tested >= 0 && <Checks items={testItems} running={tested} />}
                </div>
              </>
            )}

            {at === 3 && (
              <>
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">Choose what to read</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{preview}</p>
                </div>
                <ul className="overflow-hidden rounded-frame border">
                  {scopes.map((s) => (
                    <li key={s.name} className="border-t first:border-t-0">
                      <label
                        className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm hover:bg-muted/40"
                        onMouseDown={pickScopes.onMouseDown}
                      >
                        <Checkbox {...pickScopes.checkbox(s.name)} />
                        <span
                          className={cn(
                            'min-w-0 flex-1 truncate',
                            isCube && 'font-mono text-[13px]',
                          )}
                        >
                          {s.name}
                        </span>
                        <span className="text-muted-foreground">{s.detail}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                {isCube && (
                  <p className="flex items-start gap-2 rounded-frame border border-[oklch(0.68_0.16_65/0.45)] bg-[oklch(0.68_0.16_65/0.08)] p-3 text-sm">
                    <TriangleAlertIcon
                      aria-hidden
                      className="mt-0.5 size-4 shrink-0 text-[oklch(0.5_0.13_65)] dark:text-[oklch(0.8_0.13_75)]"
                    />
                    <span>
                      2 views have no <code className="font-mono text-xs">meta.domain</code>. You
                      can map them in the next step.
                    </span>
                  </p>
                )}
                {!isCube && !isDrive && (
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">docs/people</span> is left out:
                    its file names people, and those are skipped.
                  </p>
                )}
              </>
            )}

            {at === 4 && (
              <>
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">
                    Map to domains and owners
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {isCube
                      ? 'Owners of a domain are told when a definition they rely on changes.'
                      : "Each folder goes to exactly one domain. Its suggestions go only to that domain's owners."}
                  </p>
                </div>
                <div className="overflow-x-auto rounded-frame border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[color-mix(in_oklab,var(--muted)_45%,var(--background))] text-left text-xs text-muted-foreground">
                        <th className="h-9 px-4 font-medium">{isCube ? 'Cube view' : 'Folder'}</th>
                        <th className="h-9 px-4 font-medium">Domain</th>
                        <th className="h-9 px-4 font-medium">Owners</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chosen.map((n) => (
                        <tr key={n} className="border-t">
                          <td className={cn('h-12 px-4', isCube && 'font-mono text-[13px]')}>
                            {n}
                          </td>
                          <td className="px-4">
                            <DomainPick
                              value={map[n]}
                              onChange={(d) => setMap((m) => ({ ...m, [n]: d }))}
                            />
                          </td>
                          <td className="px-4">
                            <Owners domain={map[n]} />
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
                    <dd className="mt-1 font-medium">
                      {isCube ? 'Every hour' : 'Every day at 06:00'}
                    </dd>
                  </div>
                  <div className="rounded-frame border p-3">
                    <dt className="text-xs text-muted-foreground">
                      {isCube ? 'Out of date after' : 'Suggestions per day'}
                    </dt>
                    <dd className="mt-1 font-medium">{isCube ? '6 hours' : 'At most 5'}</dd>
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
                        <>
                          If Cube can't be reached, the last good read stays and nothing is flagged.
                        </>,
                      ]
                    : [
                        <>
                          A new or changed document becomes{' '}
                          <span className="font-medium">one suggestion</span> in its owners' Inbox.
                        </>,
                        <>
                          Nothing is published by a read. An owner publishes, or returns it with a
                          note.
                        </>,
                        <>
                          If {c.name} can't be reached, what was read stays and nothing is created.
                        </>,
                      ]
                  ).map((t, i) => (
                    <li key={i} className="flex gap-2">
                      <CircleCheckIcon
                        aria-hidden
                        className="mt-0.5 size-4 shrink-0 text-[oklch(0.55_0.14_150)]"
                      />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
                <Field>
                  <FieldLabel htmlFor="why">Why are you adding this?</FieldLabel>
                  <Input
                    id="why"
                    value={why}
                    onChange={(e) => setWhy(e.target.value)}
                    placeholder="Our handbook lives in Git"
                  />
                  <FieldDescription>Kept in the history log.</FieldDescription>
                </Field>
              </>
            )}
          </div>
          <footer className="flex items-center gap-2 border-t px-4 py-3 md:px-6">
            {at === 1 ? (
              <span className="text-sm text-muted-foreground tabular-nums">1 of 5</span>
            ) : (
              <Button variant="ghost" onClick={() => go(at - 1)}>
                <ArrowLeftIcon data-icon="inline-start" />
                Back
              </Button>
            )}
            <Button
              variant="ghost"
              className="ml-auto"
              onClick={() =>
                navigate(
                  live.includes(c.id) ? `/settings/integrations/${c.id}` : '/settings/integrations',
                )
              }
            >
              Cancel
            </Button>
            {at < 5 ? (
              <Button
                onClick={() => go(at + 1)}
                disabled={at === 4 && !isCube && mapped < chosen.length}
              >
                Continue
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            ) : (
              <Button onClick={finish} disabled={!why.trim()}>
                {isCube ? `Add ${c.name}` : `Connect ${c.name}`}
              </Button>
            )}
          </footer>
        </Panel>
      </div>
    </Page>
  )
}

/** Settings > Integrations, its tool pages and the connect flow. */
export function IntegrationsRoute({ id, step }: { id?: string; step?: string }) {
  if (!id) return <IntegrationsPage />
  if (step === 'connect') return <ConnectFlow key={id} id={id} />
  return <ConnectorPage id={id} />
}
