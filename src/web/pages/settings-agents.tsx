import * as React from 'react'
import { toast } from 'sonner'
import { ChevronDownIcon, KeyRoundIcon } from '@/components/icons'
import { ConnectAgent } from '@/components/connect-agent'
import { ToolLogo } from '@/components/heed/tool-logo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { Frame, FrameRows, FrameSection } from '@/components/heed/frame'
import { ShowMoreButton } from '@/components/heed/show-more'
import { useShowMore } from '@/hooks/use-show-more'
import { useQuery } from '@tanstack/react-query'
import { toApiError } from '@/api/errors'
import { autoPublishQuery, useAgentConnections, useSettings, useWrite } from '@/api/queries'
import { PolicyCard } from '@/pages/agent-policies'
import { AGENT_TOOLS, logoFor } from '@/lib/agents'
import {
  connectedLine,
  keysHint,
  toolsLine,
  toolsOn,
  usedLine,
  type Connected,
} from '@/lib/connect'
import { useSetLinksEnabled, useLinksEnabled } from '@/lib/links-switch'
import { arriveRef, leaveThen, useLeavingRows } from '@/lib/presence'
import { cn } from '@/lib/utils'
import { useDomainList, useDomains, useMe } from '@/lib/workspace'
import { agentNameProblem, type AgentToolName } from '@domain/agents'

/*
  Settings, Agents and access: connect an agent, every agent by its name with what it may do
  (FR-420) and where it publishes without review (FR-421), Pause sharing, publishing without review
  for the workspace, and the tools agents call. An admin sees every agent and sets what each may
  do; anyone else sees the apps they signed in with, and may revoke them or turn a policy off.
*/

/** What a suggestion's state reads as on an agent's list of what it sent. */
const SENT_STATES: Record<string, string> = {
  draft: 'kept as a draft',
  submitted: 'waiting for the owner',
  in_review: 'waiting for the owner',
  changes_requested: 'sent back',
  accepted: 'published',
  rejected: 'not published',
  withdrawn: 'withdrawn',
}

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
        {row?.kind === 'key' ? (
          <DialogHeader>
            <DialogTitle>Revoke the access key “{row.agent}”?</DialogTitle>
            <DialogDescription>
              It stops working at once, and whatever uses it stops reading context. A job that still
              needs one gets a new key.
            </DialogDescription>
          </DialogHeader>
        ) : (
          <DialogHeader>
            <DialogTitle>
              Revoke {row?.agent} for {row?.who}?
            </DialogTitle>
            <DialogDescription>
              It signs out at once and stops reading context. {row?.who.split(' ')[0]} can connect
              it again.
            </DialogDescription>
          </DialogHeader>
        )}
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

/**
 * Names an access key: a new one, or one an admin renames. The name is what Connected agents, the
 * history log and a suggestion's review call it. Each opening starts afresh (`seq`).
 */
function KeyNameDialog({
  naming,
  onClose,
  onSave,
}: {
  naming: Naming
  onClose: () => void
  onSave: (name: string) => Promise<boolean>
}) {
  return (
    <Dialog open={naming.open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <KeyNameForm
          key={naming.seq}
          {...(naming.renaming ? { renaming: naming.renaming } : {})}
          onSave={async (name) => {
            if (await onSave(name)) onClose()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

/** Which key the name dialog is for, and whether it is open; `seq` counts the openings. */
type Naming = { seq: number; open: boolean; renaming?: Connected }

function KeyNameForm({
  renaming,
  onSave,
}: {
  renaming?: Connected
  onSave: (name: string) => Promise<void>
}) {
  const [name, setName] = React.useState(renaming?.agent ?? '')
  const [problem, setProblem] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    const found = agentNameProblem(name)
    setProblem(found)
    if (found) return
    setSaving(true)
    await onSave(name.trim())
    setSaving(false)
  }
  return (
    <form onSubmit={(e) => void save(e)} noValidate>
      <DialogHeader>
        <DialogTitle>{renaming ? 'Rename the access key' : 'Create an access key'}</DialogTitle>
        <DialogDescription>
          {renaming
            ? 'The new name shows on Connected agents and in the history log, which keeps the old one too.'
            : 'Name it after what will use it, such as a weekly sales digest. It may read context and report what is missing, and never suggests. The key is shown once.'}
        </DialogDescription>
      </DialogHeader>
      <div className="mt-4 flex flex-col gap-1.5">
        <label htmlFor="key-name" className="text-sm font-medium">
          Name
        </label>
        <Input
          id="key-name"
          value={name}
          maxLength={100}
          autoComplete="off"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? 'key-name-problem' : undefined}
          onChange={(e) => {
            setName(e.target.value)
            if (problem) setProblem(null)
          }}
        />
        {problem && (
          <p id="key-name-problem" className="text-xs text-destructive">
            {problem}
          </p>
        )}
      </div>
      <DialogFooter className="mt-6">
        <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
        <Button type="submit" disabled={saving}>
          {renaming ? 'Rename' : 'Create'}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Why an agent can't have a tool: an access key never suggests, and an app has what the person allowed. */
function notAllowedLine(r: Connected) {
  if (r.kind === 'key') return 'An access key names no person, so it never suggests.'
  return `${r.who.split(' ')[0]} didn't allow this when connecting it.`
}

/** The tools of one agent, each with its switch, who changed one, and what it sent lately: the fold under its row. */
function AgentDetails({
  r,
  admin,
  workspaceOff,
  onTool,
  onRename,
}: {
  r: Connected
  admin: boolean
  /** Whether a tool is off for every agent (Tools and access keys). */
  workspaceOff: (tool: AgentToolName) => boolean
  onTool: (tool: AgentToolName, on: boolean) => void
  onRename: () => void
}) {
  return (
    <>
      {r.policies.length > 0 && (
        <div className="flex flex-col gap-2 border-t bg-muted/40 px-4 pt-4 text-sm md:px-5">
          <h4 className="text-xs font-medium text-muted-foreground">Publishes without review</h4>
          <ul
            className="flex flex-col gap-2"
            aria-label={`Where ${r.agent} publishes without review`}
          >
            {r.policies.map((p) => (
              <PolicyCard key={p.id} policy={p} title={`In ${p.domainName}`} from="agents" />
            ))}
          </ul>
          <p className="text-muted-foreground">
            There, its suggestions for new, low-risk items publish at once, as the owner's decision.
            Everything else waits for an owner.
          </p>
        </div>
      )}
      <div
        className={cn(
          'grid gap-4 bg-muted/40 px-4 py-4 text-sm md:px-5 @2xl/main:grid-cols-2',
          !r.policies.length && 'border-t',
        )}
      >
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-medium text-muted-foreground">Tools it may call</h4>
          <ul className="flex flex-col gap-2" aria-label={`Tools ${r.agent} may call`}>
            {r.tools.map(({ tool, on, allowed }) => {
              const id = `agent-${r.id}-${tool}`
              const hint = !allowed
                ? notAllowedLine(r)
                : workspaceOff(tool)
                  ? 'Off for every agent, in Tools and access keys.'
                  : AGENT_TOOLS.find((t) => t.name === tool)?.what
              return (
                <li key={tool} className="flex items-start justify-between gap-3">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <label htmlFor={id} className="font-mono text-xs">
                      {tool}
                    </label>
                    <span className="text-xs text-muted-foreground">{hint}</span>
                  </span>
                  {admin ? (
                    <Switch
                      id={id}
                      checked={on && allowed}
                      disabled={!allowed}
                      onCheckedChange={(next) => onTool(tool, next)}
                    />
                  ) : (
                    <span id={id} className="shrink-0 text-xs text-muted-foreground">
                      {on && allowed ? 'On' : 'Off'}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
          <p className="text-muted-foreground">
            {!toolsOn(r).length
              ? 'Every tool is off: it gets nothing until an admin switches one on. Revoke ends it for good.'
              : r.policies.length
                ? 'It never reads comments and never sees who asked.'
                : 'It never publishes, never reads comments and never sees who asked.'}
          </p>
          {r.setBy && (
            <p className="text-xs text-muted-foreground">
              Changed by {r.setBy.name} on {r.setBy.on}.
            </p>
          )}
          {admin && r.kind === 'key' && (
            <div>
              <Button variant="outline" size="sm" onClick={onRename}>
                Rename
              </Button>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-medium text-muted-foreground">What it sent</h4>
          {r.kind === 'key' ? (
            <p className="text-muted-foreground">Nothing: an access key only reads and reports.</p>
          ) : r.recent.length ? (
            <>
              <p className="text-muted-foreground">
                {r.sent === 1 ? '1 suggestion' : `${r.sent} suggestions`} in the last 30 days, each
                with {r.who.split(' ')[0]}'s OK.
              </p>
              <ul className="flex flex-col gap-1.5">
                {r.recent.map((s) => (
                  <li key={s.id} className="flex min-w-0 flex-col">
                    <span className="truncate">{s.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {s.on}, {SENT_STATES[s.state] ?? s.state}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-muted-foreground">No suggestions yet.</p>
          )}
        </div>
      </div>
    </>
  )
}

/**
 * Publishing without review, for the workspace (FR-421): off until an admin switches it on; then
 * owners choose, per domain and per agent, which agent's low-risk new items publish without a
 * review round. Off again ends every policy at once, so it asks first while any is on.
 */
function AutoPublishSection() {
  const write = useWrite()
  const load = useQuery(autoPublishQuery())
  const [asking, setAsking] = React.useState(false)
  const state = load.data
  const setOn = (on: boolean) =>
    void write('setAutoPublish', { on }).then(
      ({ ended }) =>
        toast(
          on
            ? 'Owners can let an agent publish without review'
            : 'Publishing without review is off',
          ended
            ? {
                description: `${ended === 1 ? '1 policy' : `${ended} policies`} turned off. Those suggestions wait for review again.`,
              }
            : undefined,
        ),
      (e: unknown) =>
        toast(on ? "Couldn't switch it on" : "Couldn't switch it off", {
          description: toApiError(e).message,
        }),
    )
  return (
    <FrameSection
      title="Publish without review"
      level={3}
      description={
        !state?.on
          ? 'Off. Every suggestion waits for an owner.'
          : state.open
            ? `On, with ${state.open === 1 ? '1 policy' : `${state.open} policies`}. Each is in its agent's Details.`
            : 'On. No owner has let an agent publish without review yet.'
      }
      collapsible
      defaultOpen={false}
    >
      <FrameRows
        rows={[
          {
            id: 'auto-publish',
            label: (
              <label htmlFor="auto-publish">
                Let owners choose agents that publish without review
              </label>
            ),
            hint: "Low-risk new items only, as the owner's decision. Off ends every policy.",
            value: (
              <Switch
                id="auto-publish"
                checked={state?.on ?? false}
                disabled={!state}
                onCheckedChange={(on) => (!on && state?.open ? setAsking(true) : setOn(on))}
              />
            ),
          },
        ]}
      />
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Turn off publishing without review?</DialogTitle>
            <DialogDescription>
              {state?.open === 1 ? 'The 1 policy' : `All ${state?.open ?? 0} policies`} end at once.
              Their agents' suggestions wait for review again, and owners set them again once it is
              back on.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setAsking(false)
                setOn(false)
              }}
            >
              Turn off
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FrameSection>
  )
}

/** One agent on Connected agents: its name, who it is for, what it may do, and its fold. */
function AgentRow({
  r,
  admin,
  leaving,
  onRevoke,
  workspaceOff,
  onTool,
  onRename,
}: {
  r: Connected
  admin: boolean
  leaving: boolean
  workspaceOff: (tool: AgentToolName) => boolean
  onRevoke: () => void
  onTool: (tool: AgentToolName, on: boolean) => void
  onRename: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const off = toolsOn(r).length === 0
  const who = r.kind === 'key' ? `Access key, made by ${r.who}` : r.who
  return (
    <li data-leaving={leaving || undefined} className="row-presence border-t first:border-t-0">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div
          className={cn(
            'grid grid-cols-(--cols-around) items-center gap-x-3 px-4 py-3 md:px-5',
            r.fresh && 'bg-fresh',
          )}
        >
          {r.kind === 'key' ? (
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border bg-logo-plate text-muted-foreground">
              <KeyRoundIcon className="size-4" aria-hidden />
            </span>
          ) : (
            <ToolLogo c={{ logo: logoFor(r.agent) }} />
          )}
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
              <span className="min-w-0 truncate">{r.agent}</span>

              {r.fresh && <span className="text-xs font-normal text-primary">New</span>}
              <Badge variant={off ? 'destructive' : 'outline'} className="font-normal">
                {toolsLine(r)}
              </Badge>
              {r.policies.length > 0 && (
                <Badge variant="secondary" className="font-normal">
                  Publishes without review
                </Badge>
              )}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {who}
              <span className="@max-xl/main:hidden">, since {r.since.replace(' 2026', '')}</span>
              <span className="@xl/main:hidden"> - {usedLine(r)}</span>
            </p>
          </div>
          <span className="flex items-center gap-1">
            <span className="mr-3 hidden text-xs text-muted-foreground first-letter:uppercase @xl/main:inline">
              {usedLine(r)}
            </span>
            <CollapsibleTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={
                    r.kind === 'key'
                      ? `Details of ${r.agent}`
                      : `Details of ${r.agent} for ${r.who}`
                  }
                />
              }
            >
              Details
              <ChevronDownIcon
                aria-hidden
                className={cn('size-4 transition-transform', open && 'rotate-180')}
              />
            </CollapsibleTrigger>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={onRevoke}
            >
              Revoke
            </Button>
          </span>
        </div>
        <CollapsibleContent>
          <AgentDetails
            r={r}
            admin={admin}
            workspaceOff={workspaceOff}
            onTool={onTool}
            onRename={onRename}
          />
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

export function Agents() {
  const domains = useDomains()
  const domainIds = useDomainList().map((d) => d.id)
  const linksOn = useLinksEnabled()
  const setLinksEnabled = useSetLinksEnabled()
  const write = useWrite()
  const { admin } = useMe()
  const { pause, tools } = useSettings()
  const paused = pause.all
  const setPaused = (all: boolean) =>
    void write('setPause', { all }).catch((e: unknown) =>
      toast(all ? "Couldn't pause sharing" : "Couldn't let sharing go on", {
        description: toApiError(e).message,
      }),
    )
  const pauseDomain = (domain: string | null) =>
    void write('setPause', { domain }).catch((e: unknown) =>
      toast("Couldn't change what is paused", { description: toApiError(e).message }),
    )
  const setTool = (name: string, on: boolean) =>
    void write('setTool', { name, on }).catch((e: unknown) =>
      toast(`Couldn't switch ${name} ${on ? 'on' : 'off'}`, { description: toApiError(e).message }),
    )
  const [naming, setNaming] = React.useState<Naming>({ seq: 0, open: false })
  const openNaming = (renaming?: Connected) =>
    setNaming((n) => ({ seq: n.seq + 1, open: true, ...(renaming ? { renaming } : {}) }))
  const nameKey = async (name: string) => {
    const renaming = naming.renaming
    try {
      if (renaming) {
        await write('renameAccessKey', { id: renaming.id, name })
        toast(`Renamed to ${name}`)
        return true
      }
      const { key } = await write('createAccessKey', { name })
      toast(`Access key ${name} created`, {
        description: 'Copy it now: it is shown once.',
        action: { label: 'Copy', onClick: () => void navigator.clipboard?.writeText(key) },
      })
      return true
    } catch (e) {
      toast(renaming ? "Couldn't rename the access key" : "Couldn't create an access key", {
        description: toApiError(e).message,
      })
      return false
    }
  }
  const setAgentTool = (r: Connected, tool: AgentToolName, on: boolean) =>
    void write('setAgentTool', { id: r.id, tool, on })
      .then(() => toast(`${tool} ${on ? 'on' : 'off'} for ${r.agent}`))
      .catch((e: unknown) =>
        toast(`Couldn't switch ${tool} ${on ? 'on' : 'off'} for ${r.agent}`, {
          description: toApiError(e).message,
        }),
      )
  const workspaceOff = (tool: AgentToolName) =>
    tool === 'get_related' ? !linksOn : tools[tool] === false
  const rows = useAgentConnections()
  const [revoking, setRevoking] = React.useState<Connected>()
  const leaving = useLeavingRows()
  const { shown, more, next, showMore } = useShowMore(rows, 5, 20)
  return (
    <Frame>
      <FrameSection
        title="Connect an agent"
        description="Paste one prompt into your agent, or start from your agent below. You approve the connection once, in the browser."
      >
        <ConnectAgent />
      </FrameSection>
      <FrameSection title="Connected agents" description={connectedLine(rows)}>
        {rows.length > 0 && (
          <ul ref={arriveRef} className="border-t" aria-label="Connected agents">
            {shown.map((r) => (
              <AgentRow
                key={r.id}
                r={r}
                admin={admin}
                leaving={leaving.has(r.id)}
                onRevoke={() => setRevoking(r)}
                workspaceOff={workspaceOff}
                onTool={(tool, on) => setAgentTool(r, tool, on)}
                onRename={() => openNaming(r)}
              />
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
          const { id, agent, who, kind } = revoking
          // The row goes first, then the access is revoked.
          void leaveThen(id, () =>
            write('revokeAgent', { id })
              .then(() =>
                toast(
                  kind === 'key' ? `Access key ${agent} revoked` : `${agent} for ${who} revoked`,
                ),
              )
              .catch((e: unknown) =>
                toast(`Couldn't revoke ${agent}`, { description: toApiError(e).message }),
              ),
          )
          setRevoking(undefined)
        }}
      />
      <KeyNameDialog
        naming={naming}
        onClose={() => setNaming((n) => ({ ...n, open: false }))}
        onSave={nameKey}
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
                    ...domainIds.map((d) => ({ label: domains[d]?.name, value: d })),
                  ]}
                  value={pause.domain ?? 'none'}
                  onValueChange={(v) => pauseDomain(v === 'none' || !v ? null : String(v))}
                >
                  <SelectTrigger id="pause-domain" className="w-full sm:w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="none">No domain paused</SelectItem>
                      {domainIds.map((d) => (
                        <SelectItem key={d} value={d}>
                          {domains[d]?.name}
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
      {admin && <AutoPublishSection />}
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
              value: (
                <Switch
                  id={`tool-${name}`}
                  checked={tools[name] ?? true}
                  onCheckedChange={(on) => setTool(name, on)}
                />
              ),
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
              hint: `For a bot or a scheduled job that can't sign in. ${keysHint(rows)}`,
              value: (
                <Button variant="outline" size="sm" onClick={() => openNaming()}>
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
