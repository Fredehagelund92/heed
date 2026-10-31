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
import { toApiError } from '@/api/errors'
import { useAgentConnections, useSettings, useWrite } from '@/api/queries'
import { AGENT_TOOLS, logoFor } from '@/lib/agents'
import { connectedLine, keysHint, usedLine, type Connected } from '@/lib/connect'
import { useSetLinksEnabled, useLinksEnabled } from '@/lib/links-switch'
import { arriveRef, leaveThen, useLeavingRows } from '@/lib/presence'
import { cn } from '@/lib/utils'
import { useDomainList, useDomains, useMe } from '@/lib/workspace'
import {
  agentNameProblem,
  mayDo,
  neverWords,
  permissionsFor,
  permissionWords,
  type AgentPermission,
} from '@domain/agents'

/*
  Settings, Agents and access: connect an agent, every agent by its name with what it may do
  (FR-420), Pause sharing, and the tools agents call. An admin sees every agent and sets what each
  may do; anyone else sees the apps they signed in with, and may revoke them.
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

/** Why an agent may do less than its permission says: the person allowed less when it connected. */
function narrowerLine(r: Connected) {
  if (r.kind !== 'app' || r.permission !== 'suggest' || r.allowed.includes('propose')) return null
  return `${r.who.split(' ')[0]} allowed it to read only when it connected, so it cannot suggest.`
}

/** What one agent may do, who changed it, and what it sent lately: the fold under its row. */
function AgentDetails({
  r,
  admin,
  onPermission,
  onRename,
}: {
  r: Connected
  admin: boolean
  onPermission: (permission: AgentPermission) => void
  onRename: () => void
}) {
  const may = mayDo(r.scopes)
  const narrower = narrowerLine(r)
  const id = `agent-permission-${r.id}`
  return (
    <div className="grid gap-4 border-t bg-muted/40 px-4 py-4 text-sm md:px-5 @2xl/main:grid-cols-2">
      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-medium text-muted-foreground">What it may do</h4>
        {admin ? (
          <Select
            items={permissionsFor(r.kind).map((p) => ({
              label: permissionWords[p].label,
              value: p,
            }))}
            value={r.permission}
            onValueChange={(v) => v && v !== r.permission && onPermission(v)}
          >
            <SelectTrigger id={id} aria-label={`What ${r.agent} may do`} className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {permissionsFor(r.kind).map((p) => (
                  <SelectItem key={p} value={p}>
                    {permissionWords[p].label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : (
          <p className="font-medium">{permissionWords[r.permission].label}</p>
        )}
        {may.length ? (
          <ul className="list-disc pl-5 text-muted-foreground">
            {may.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">{permissionWords.none.line}</p>
        )}
        <p className="text-muted-foreground">
          {narrower ? `${narrower} ` : ''}
          {r.kind === 'key' ? 'An access key names no person, so it never suggests. ' : ''}
          {neverWords}
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
  )
}

/** One agent on Connected agents: its name, who it is for, what it may do, and its fold. */
function AgentRow({
  r,
  admin,
  leaving,
  onRevoke,
  onPermission,
  onRename,
}: {
  r: Connected
  admin: boolean
  leaving: boolean
  onRevoke: () => void
  onPermission: (permission: AgentPermission) => void
  onRename: () => void
}) {
  const [open, setOpen] = React.useState(false)
  // What it may do now: its permission, narrowed by what the person allowed.
  const now: AgentPermission = r.scopes.includes('propose')
    ? 'suggest'
    : r.scopes.length
      ? 'read'
      : 'none'
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
              <Badge variant={now === 'none' ? 'destructive' : 'outline'} className="font-normal">
                {permissionWords[now].label}
              </Badge>
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
          <AgentDetails r={r} admin={admin} onPermission={onPermission} onRename={onRename} />
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
  const setPermission = (r: Connected, permission: AgentPermission) =>
    void write('setAgentPermission', { id: r.id, permission })
      .then(() => toast(`${r.agent}: ${permissionWords[permission].label.toLowerCase()}`))
      .catch((e: unknown) =>
        toast(`Couldn't change what ${r.agent} may do`, { description: toApiError(e).message }),
      )
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
                onPermission={(permission) => setPermission(r, permission)}
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
