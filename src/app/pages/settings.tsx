import * as React from 'react'
import { cn } from '@/lib/utils'
import { PlusIcon } from '@/components/icons'
import { toast } from 'sonner'
import { ConnectAgent } from '@/components/connect-agent'
import { ToolLogo } from '@/components/heed/tool-logo'
import { PersonAvatar } from '@/components/heed/bits'
import { Page } from '@/components/site-header'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { AGENT_TOOLS, logoFor } from '@/data/agents'
import { GuideLink } from '@/components/heed/guide-link'
import { setLinksEnabled, useLinksEnabled } from '@/lib/links-switch'
import { revokeConnected, useConnected, type Connected } from '@/lib/connect'
import { domainIds, domains, servedToAgents } from '@/data/world'
import { useFacts, useMe, useStore, type LogEntry } from '@/lib/store'
import { relativeDate } from '@/data/history'
import { excerptOf, useDomains } from '@/lib/domains'
import { useDefinitions } from '@/lib/definitions'
import { DomainDot } from '@/components/heed/tag-chip'
import { IntegrationsRoute } from '@/pages/integrations'
import {
  Frame,
  FramePage,
  FrameRows,
  FrameSection,
  FrameTable,
  type FrameColumn,
} from '@/components/heed/frame'
import { SLUG } from '@/lib/brand'
import { DEFINITIONS_TOOL } from '@/data/integrations'
import { ShowMoreButton } from '@/components/heed/show-more'
import { useShowMore } from '@/hooks/use-show-more'
import { People } from '@/pages/people'

// Settings, for admins: five sections under the settings navigation (General, Domains and owners,
// Agents and access, Integrations, Advanced). No tabs anywhere.

/* ---------- Domains and owners ---------- */

/**
 * The domains as a grid of square hairline cells: each the domain's dot and name, two lines of what it
 * covers, its owners' faces and a quiet health line ("12 items - 2 due") with a freshness dot. One cell
 * adds a domain. Arrow keys move between cells; search shows once there are more than eight.
 */
function Domains() {
  useDomains()
  const facts = useFacts()
  const defs = useDefinitions()
  const [q, setQ] = React.useState('')
  const grid = React.useRef<HTMLDivElement>(null)
  // Sorted by name; the sandbox, which never reaches agents, comes last.
  const ids = [...domainIds]
    .sort((a, b) =>
      a === 'sandbox' ? 1 : b === 'sandbox' ? -1 : domains[a].name.localeCompare(domains[b].name),
    )
    .filter((id) =>
      `${domains[id].name} ${excerptOf(id)}`.toLowerCase().includes(q.trim().toLowerCase()),
    )
  const onKeyDown = (e: React.KeyboardEvent) => {
    const keys = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 0, ArrowUp: 0 } as Record<
      string,
      number
    >
    if (!(e.key in keys) || !grid.current) return
    const cells = [...grid.current.querySelectorAll<HTMLElement>('[data-cell]')]
    const i = cells.indexOf(document.activeElement as HTMLElement)
    if (i < 0) return
    const cols = getComputedStyle(grid.current).gridTemplateColumns.split(' ').length
    const step = e.key === 'ArrowDown' ? cols : e.key === 'ArrowUp' ? -cols : keys[e.key]
    const next = cells[i + step]
    if (!next) return
    e.preventDefault()
    next.focus()
  }
  return (
    <Frame>
      <FrameSection
        title="Domains and owners"
        description="A domain is a part of the business with its own owners. Owners publish its context and check it when it is due."
        action={
          domainIds.length > 8 && (
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search domains"
              aria-label="Search domains"
              className="h-8 w-56 max-w-full"
            />
          )
        }
      >
        <div
          ref={grid}
          onKeyDown={onKeyDown}
          role="list"
          aria-label="Domains"
          className="grid grid-cols-1 gap-px border-t bg-border @2xl/main:grid-cols-2 @5xl/main:grid-cols-3"
        >
          {ids.map((id) => {
            const items = facts.filter((f) => f.domain === id && servedToAgents(f))
            const due = items.filter((f) => f.status === 'Needs checking').length
            const terms = defs.filter((d) => d.domain === id).length
            return (
              <a
                key={id}
                role="listitem"
                data-cell
                href={`/settings/domains/${id}`}
                className="group/cell flex min-h-36 flex-col gap-2 bg-background p-4 outline-none hover:bg-muted/40 focus-visible:z-raised focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:p-5 @2xl/main:min-h-44"
              >
                <span className="flex items-center gap-2">
                  <DomainDot id={id} />
                  <span className="truncate font-medium">{domains[id].name}</span>
                  {id === 'sandbox' && (
                    <span className="text-xs text-muted-foreground">Never reaches agents</span>
                  )}
                </span>
                <span className="line-clamp-2 text-sm text-muted-foreground">
                  {excerptOf(id) || 'Nothing written yet.'}
                </span>
                <span className="mt-auto flex items-end justify-between gap-3 pt-2">
                  <span
                    className="flex -space-x-1.5 *:ring-2 *:ring-background"
                    aria-label={`Owners: ${domains[id].owners.join(', ')}`}
                  >
                    {domains[id].owners.slice(0, 4).map((o) => (
                      <PersonAvatar key={o} name={o} />
                    ))}
                    {domains[id].owners.length > 4 && (
                      <span className="grid size-7 place-items-center rounded-full bg-muted text-2xs font-medium">
                        +{domains[id].owners.length - 4}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                    <span
                      aria-hidden
                      className={cn(
                        'size-1.5 rounded-full',
                        !items.length
                          ? 'border border-muted-foreground'
                          : due
                            ? 'bg-due'
                            : 'bg-ready',
                      )}
                    />
                    {items.length} {items.length === 1 ? 'item' : 'items'}
                    {due > 0 && ` - ${due} due`}
                    {terms > 0 && ` - ${terms} ${terms === 1 ? 'term' : 'terms'}`}
                  </span>
                </span>
              </a>
            )
          })}
          <a
            role="listitem"
            data-cell
            href="/settings/domains/new"
            className="flex min-h-24 flex-col items-center justify-center gap-2 bg-background p-4 text-sm text-muted-foreground outline-none hover:bg-muted/40 hover:text-foreground focus-visible:z-raised focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset @2xl/main:min-h-44"
          >
            <PlusIcon aria-hidden className="size-5" />
            Add a domain
          </a>
        </div>
        {q && !ids.length && (
          <p className="border-t p-4 text-sm text-muted-foreground">
            No domain matches “{q.trim()}”.
          </p>
        )}
      </FrameSection>
    </Frame>
  )
}

/* ---------- About our business ---------- */

// The editor loads on its own (Tiptap stays out of the first load); until it does, the page's skeleton.
// A domain is a document too, so its page loads with the editor.
const DomainPage = React.lazy(() =>
  import('@/pages/domain-page').then((m) => ({ default: m.DomainPage })),
)
const AboutPage = React.lazy(() =>
  import('@/pages/about-editor').then((m) => ({ default: m.AboutPage })),
)

/** General's side help, in the aside (or under the frame on narrower screens). */
function AboutHelp() {
  return (
    <>
      <ul>
        <li>What the business is, in one or two sentences.</li>
        <li>Words that are easy to misread here, each with what it means for you.</li>
        <li>House rules for reading numbers, such as which calendar or currency to assume.</li>
        <li>No figures, deals or names of customers: agents read this with every question.</li>
      </ul>
      <GuideLink slug="write-context" className="mt-4" />
    </>
  )
}

/* ---------- Agents ---------- */

/** Revoking signs an agent out at once, so it asks first. */
function RevokeDialog({
  row,
  onClose,
  onRevoke,
}: {
  row?: Connected
  onClose: () => void
  onRevoke: () => void
}) {
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Revoke {row?.agent} for {row?.who}?
          </DialogTitle>
          <DialogDescription>
            It signs out at once and stops reading context. {row?.who.split(' ')[0]} can connect it
            again.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button variant="destructive" onClick={onRevoke}>
            Revoke
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Agents() {
  const linksOn = useLinksEnabled()
  const [paused, setPaused] = React.useState(false)
  const rows = useConnected()
  const [revoking, setRevoking] = React.useState<Connected>()
  const { shown, more, next, showMore } = useShowMore(rows, 5, 20)
  return (
    <Frame>
      <FrameSection
        title="Connect an agent"
        description="Paste one prompt into your agent, or start from your agent below. You approve the connection once, in the browser."
      >
        <ConnectAgent />
      </FrameSection>
      <FrameSection
        title="Connected agents"
        description={rows.length ? `${rows.length} agents people have connected.` : 'None yet.'}
      >
        {rows.length > 0 && (
          <ul className="border-t" aria-label="Connected agents">
            {shown.map((r) => (
              <li
                key={r.agent + r.who}
                className={cn(
                  'grid grid-cols-(--cols-around) items-center gap-x-3 border-t px-4 py-3 first:border-t-0 md:px-5',
                  r.fresh && 'bg-fresh',
                )}
              >
                <ToolLogo c={{ logo: logoFor(r.agent) }} />
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {r.agent}
                    {r.fresh && <span className="ml-2 text-xs font-normal text-primary">New</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.who}
                    <span className="@max-xl/main:hidden">
                      , since {r.since.replace(' 2026', '')}
                    </span>
                    <span className="@xl/main:hidden"> - used {r.used.toLowerCase()}</span>
                  </p>
                </div>
                <span className="flex items-center gap-4">
                  <span className="hidden text-xs text-muted-foreground @xl/main:inline">
                    Used {r.used.toLowerCase()}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setRevoking(r)}
                  >
                    Revoke
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {more > 0 && (
          <div className="border-t px-4 py-2 md:px-5">
            <ShowMoreButton more={more} next={next} onClick={showMore} />
          </div>
        )}
      </FrameSection>
      <RevokeDialog
        row={revoking}
        onClose={() => setRevoking(undefined)}
        onRevoke={() => {
          if (!revoking) return
          revokeConnected(revoking)
          toast(`${revoking.agent} for ${revoking.who} revoked`)
          setRevoking(undefined)
        }}
      />
      <FrameSection
        title="Pause sharing"
        level={3}
        description={
          paused
            ? 'Paused. Agents hear that context is paused, and get none.'
            : 'For an emergency: stop agents getting context.'
        }
        collapsible
        defaultOpen={false}
      >
        <FrameRows
          rows={[
            {
              id: 'all',
              label: <label htmlFor="pause-all">Pause everything</label>,
              hint: 'For an emergency. It acts at once and is logged.',
              value: <Switch id="pause-all" checked={paused} onCheckedChange={setPaused} />,
            },
            {
              id: 'domain',
              wide: true,
              label: <label htmlFor="pause-domain">Pause one domain</label>,
              hint: "Agents stop getting that domain's context; the rest goes on.",
              value: (
                <Select
                  items={[
                    { label: 'No domain paused', value: 'none' },
                    ...domainIds.map((d) => ({ label: domains[d].name, value: d })),
                  ]}
                  defaultValue="none"
                >
                  <SelectTrigger id="pause-domain" className="w-full sm:w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="none">No domain paused</SelectItem>
                      {domainIds.map((d) => (
                        <SelectItem key={d} value={d}>
                          {domains[d].name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ),
            },
          ]}
        />
      </FrameSection>
      <FrameSection
        title="Tools and access keys"
        level={3}
        description={`The ${AGENT_TOOLS.length} tools agents can call, and keys for agents that can't sign in.`}
        collapsible
        defaultOpen={false}
      >
        <FrameRows
          rows={[
            ...AGENT_TOOLS.filter((t) => t.name !== 'get_related').map(({ name, what }) => ({
              id: name,
              label: (
                <label htmlFor={`tool-${name}`} className="font-mono text-xs">
                  {name}
                </label>
              ),
              hint: what,
              value: <Switch id={`tool-${name}`} defaultChecked />,
            })),
            // Following links has its own switch: on in the demo, and it never changes what an answer includes.
            {
              id: 'get_related',
              label: (
                <label htmlFor="tool-get_related" className="flex flex-col gap-0.5">
                  <span className="font-mono text-xs">get_related</span>
                  <span className="text-sm">Let agents follow links</span>
                </label>
              ),
              hint: 'Follows a link between context items, definitions and domains, one step at a time. It never changes what an answer includes, and never lets agents read comments.',
              value: (
                <Switch id="tool-get_related" checked={linksOn} onCheckedChange={setLinksEnabled} />
              ),
            },
            {
              id: 'keys',
              label: 'Access keys',
              hint: "For a bot or a scheduled job that can't sign in. None yet.",
              value: (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    toast('Access key created', { description: 'Copy it now: it is shown once.' })
                  }
                >
                  Create an access key
                </Button>
              ),
            },
          ]}
        />
      </FrameSection>
    </Frame>
  )
}

/* ---------- Advanced ---------- */

const link = 'underline underline-offset-4'
const cols = (...labels: string[]): FrameColumn[] =>
  labels.map((label, i) => ({
    label,
    className: i === 0 ? 'w-56' : i === 1 ? 'whitespace-nowrap' : undefined,
    cell: i === 0 ? 'font-medium' : 'text-muted-foreground',
  }))

function Advanced() {
  const { state } = useStore()
  // What was deleted, newest first: drafts and terms. Published context is archived, never deleted.
  const deleted = [
    ...state.log
      .filter((e) => e.what === 'deleted')
      .flatMap((e) =>
        e.items.map((i) => ({
          key: `${e.id}.${i.id}`,
          title: i.title,
          hint: `Deleted by ${e.who}, ${relativeDate(e.on)}: ${e.summary.replace(/^Deleted: /, '')}`,
          domain: i.domain,
        })),
      ),
    {
      key: 'seed',
      title: 'Payment provider test in Sandbox',
      hint: 'Deleted by Ravi Kapoor, 3 Oct: a draft nobody published.',
      domain: 'sandbox' as const,
    },
  ]
  return (
    <Frame>
      <FrameSection
        title="Advanced"
        description="For the day someone needs them. Nothing here is needed day to day."
      />
      <FrameSection
        title="Limits"
        level={3}
        description={`28 tuning settings, read-only here. Change them with ${SLUG} settings set, or the API.`}
        collapsible
      >
        <FrameTable
          label="Limits"
          columns={[
            { label: 'Setting', className: 'w-56', cell: 'font-mono text-xs' },
            { label: 'Value', className: 'whitespace-nowrap' },
            { label: 'What it does', cell: 'text-muted-foreground' },
          ]}
          rows={[
            ['review.default_days', '90', "Days until a context item's check is due"],
            [
              'gaps.no_item_threshold',
              '5 in 7 days',
              'Questions with nothing written down before a Not found card',
            ],
            ['privacy.min_count', '5', 'Counts under this are hidden'],
            [
              'privacy.questions',
              'Scope and count',
              "What is kept of an agent's question: what it was about and how often, never the words or who asked",
            ],
            ['serving.max_reply_bytes', '100 KB', 'The most an agent gets in one reply'],
            ['limits.agent_suggestions', '20 a day', 'Suggestions one agent can send'],
            [
              'spend.monthly_cap',
              '$50',
              'All model use in a month; at the cap Ask and web reads stop and say why',
            ],
            ['spend.person_daily_cap', '$2', 'Model use by one person in a day'],
            ['spend.answer_tests_cap', '$20', 'Answer tests in a month'],
          ]}
        />
      </FrameSection>
      <FrameSection
        title="History log"
        level={3}
        description="Who changed what, and when. Hash-chained, so a change after the fact shows."
        collapsible
        defaultOpen={state.log.length > 0}
        action={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast('The chain is whole', { description: '1,284 entries checked.' })}
            >
              Check the chain
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast('Exported', { description: 'history-2026-10-22.jsonl' })}
            >
              Export
            </Button>
          </>
        }
      >
        <FrameTable
          label="History log"
          columns={[
            { label: 'When', className: 'w-36 whitespace-nowrap', cell: 'text-muted-foreground' },
            { label: 'Who', className: 'w-56', cell: 'font-medium' },
            { label: 'What' },
          ]}
          rows={[
            ...state.log.map((e) => [
              relativeDate(e.on).replace(/^./, (c) => c.toUpperCase()),
              e.who,
              logLine(e),
            ]),
            [
              '22 Oct, 09:40',
              'Jon Abara',
              'Published “Units sold excludes test accounts”, version 2',
            ],
            [
              '21 Oct, 16:40',
              'Cursor for Kofi Mensah',
              'Suggested “Payment provider delays order data in Poland”',
            ],
            [
              '20 Oct, 11:02',
              'Jon Abara',
              'Suggested a change to “Norway launch campaign started on 24 March 2026”',
            ],
            [
              '7 Oct, 06:00',
              'Automatic',
              <a key="cube" href="/settings/integrations/cube" className={link}>
                Read {DEFINITIONS_TOOL}: 2 definitions changed
              </a>,
            ],
          ]}
        />
      </FrameSection>
      <FrameSection
        title="Jobs"
        level={3}
        description="What runs on its own."
        collapsible
        defaultOpen={false}
      >
        <FrameTable
          label="Jobs"
          columns={cols('Job', 'Last run', 'Result')}
          rows={[
            [
              <a key="cube" href="/settings/integrations/cube" className={link}>
                Read {DEFINITIONS_TOOL}
              </a>,
              'Today, 06:00',
              'Done',
            ],
            [
              <a key="drive" href="/settings/integrations/google-drive" className={link}>
                Read Google Drive
              </a>,
              'Today, 06:00',
              'Done',
            ],
            ['Count what is not covered', 'Today, 06:05', 'Done'],
            ['Remind owners of checks due', 'Today, 07:00', 'Done'],
          ]}
        />
      </FrameSection>
      <FrameSection
        title="Editions"
        level={3}
        description="Agents read a sealed edition. Each publish seals a new one."
        collapsible
        defaultOpen={false}
      >
        <FrameTable
          label="Editions"
          columns={cols('Edition', 'Sealed', 'Change').map((c, i) =>
            i === 0 ? { ...c, cell: 'font-mono text-xs' } : c,
          )}
          rows={[
            ['2026-10-22.4', 'Today, 09:40', 'Units sold excludes test accounts'],
            ['2026-10-22.3', 'Today, 08:15', 'Checked: Online sales to Norway stopped'],
            ['2026-10-21.2', 'Yesterday', 'Archived: Payment provider switched in Norway'],
          ]}
        />
      </FrameSection>
      <FrameSection
        title="Answer tests"
        level={3}
        description="The heavy checks, with a real model. The free check of saved questions already runs after every change, in Observability, Quality."
        collapsible
        defaultOpen={false}
      >
        <FrameRows
          rows={[
            {
              label: 'Needs a model key',
              hint: 'Answer tests only run with a real model, so a passed test always means something. Add a key to start.',
              value: (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    toast('Add a model key', {
                      description: 'Paste a key from your model provider.',
                    })
                  }
                >
                  Add a key
                </Button>
              ),
            },
            {
              label: 'With and without context',
              hint: 'Runs the saved questions twice, with context and without, and a model judges whether context helps. It is run once from the command line first; this comes after, with a key.',
              value: (
                <Button
                  variant="outline"
                  size="sm"
                  aria-disabled
                  aria-description="Run it once from the command line first. A model key turns this on later."
                  title="Run it once from the command line first. A model key turns this on later."
                >
                  Run with and without
                </Button>
              ),
            },
          ]}
        />
      </FrameSection>
      <FrameSection
        title="Import and export"
        level={3}
        description="Context as JSON, for a backup or a move."
        action={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast('Import', { description: 'Pick a JSON file of context.' })}
            >
              Import context
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast('Exported', { description: 'context-2026-10-22.json' })}
            >
              Export context
            </Button>
          </>
        }
      />
      <FrameSection
        title="Deleted"
        level={3}
        description="Drafts and terms that were deleted, by whom and when. Deleting is for good; published context is archived instead, so it keeps its history."
        collapsible
        defaultOpen={deleted.length > 1}
      >
        <FrameRows
          rows={deleted.map((d) => ({
            id: d.key,
            label: d.title,
            hint: d.hint,
            value: (
              <span className="text-xs text-muted-foreground">
                {d.domain ? domains[d.domain].name : ''}
              </span>
            ),
          }))}
        />
      </FrameSection>
    </Frame>
  )
}

/** A change to many items, as the History log says it: "Archived “A”, “B” and 3 more". */
function logLine(e: LogEntry) {
  const names = e.items.map((i) => `“${i.title}”`)
  const titles =
    names.length > 2
      ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
      : names.join(' and ')
  const verb = {
    archived: 'Archived',
    deleted: 'Deleted',
    moved: 'Moved',
    kind: 'Changed the kind of',
    owners: 'Changed the owners of',
    checked: 'Checked',
  }[e.what]
  const detail =
    e.what === 'moved'
      ? e.summary.replace(/^Moved /, '').replace(/\.$/, '')
      : e.what === 'kind' || e.what === 'owners'
        ? e.summary.replace(/\.$/, '')
        : ''
  return `${verb} ${titles}${detail ? `: ${detail.charAt(0).toLowerCase()}${detail.slice(1)}` : ''}`
}

const TITLES: Record<string, string> = {
  people: 'People',
  general: 'General',
  domains: 'Domains and owners',
  agents: 'Agents and access',
  integrations: 'Integrations',
  advanced: 'Advanced',
}

/** Settings > Integrations > Cube: where you are inside Settings, each step a link back. */
export function SettingsCrumbs({ trail }: { trail: { label: string; href?: string }[] }) {
  return (
    <Breadcrumb>
      <BreadcrumbList className="flex-nowrap text-sm">
        {trail.map((t, i) => (
          <React.Fragment key={t.label}>
            {i > 0 && (
              <BreadcrumbSeparator
                className={cn(
                  i < trail.length - 1 && 'max-sm:hidden',
                  i === trail.length - 1 && 'max-sm:hidden',
                )}
              />
            )}
            <BreadcrumbItem className={cn(i < trail.length - 1 && 'max-sm:hidden', 'min-w-0')}>
              {t.href && i < trail.length - 1 ? (
                <BreadcrumbLink href={t.href} className="text-foreground/75 hover:text-foreground">
                  {t.label}
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage className="truncate font-medium">{t.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </React.Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

/** One Settings section, with its title and what it is for, under the settings navigation. No tabs. */
export function SettingsPage({
  section,
  sub,
  step,
}: {
  section?: string
  sub?: string
  step?: string
}) {
  const me = useMe()
  const current = section && TITLES[section] ? section : me.admin ? 'general' : 'domains'
  // Owners who aren't admins use two places here: their domains and the people list.
  if (!me.admin && current !== 'domains' && current !== 'people')
    return (
      <Page title="Settings">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Settings are for admins</EmptyTitle>
            <EmptyDescription>
              Ask Ravi Kapoor or Jon Abara if something here needs changing.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Page>
    )
  if (current === 'integrations') return <IntegrationsRoute id={sub} step={step} />
  if (current === 'domains' && sub)
    return (
      <React.Suspense fallback={<Page title="Domain">{null}</Page>}>
        <DomainPage
          id={sub}
          crumbs={(name) => (
            <SettingsCrumbs
              trail={[
                { label: 'Settings', href: '/settings/general' },
                { label: 'Domains and owners', href: '/settings/domains' },
                { label: name },
              ]}
            />
          )}
        />
      </React.Suspense>
    )
  const title = (
    <SettingsCrumbs
      trail={[{ label: 'Settings', href: '/settings/general' }, { label: TITLES[current] }]}
    />
  )
  if (current === 'general')
    return (
      <React.Suspense fallback={<Page title={title}>{null}</Page>}>
        <AboutPage title={title} helpText={<AboutHelp />} />
      </React.Suspense>
    )
  return (
    <Page title={title}>
      <FramePage>
        {current === 'domains' && <Domains />}
        {current === 'people' && <People />}
        {current === 'agents' && <Agents />}
        {current === 'advanced' && <Advanced />}
      </FramePage>
    </Page>
  )
}
