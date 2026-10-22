import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ConnectInfo, Connection } from '@/api'
import { connectionsQuery } from '@/api/queries'
import {
  CheckIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CopyIcon,
  DownloadIcon,
  FileTextIcon,
  InfoIcon,
  LoaderCircleIcon,
  MonitorIcon,
  PlugIcon,
} from '@/components/icons'
import { useCopy } from '@/components/try-it/copy-block'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { productName } from '@/lib/brand'
import {
  appNameFor,
  isReportedAs,
  promptText,
  setupPromptFor,
  SKILL_FILE,
  skillFor,
  skillPlaces,
  type ConnectAuth,
} from '@/lib/connect'
import { formatMoment } from '@/lib/library'

/*
  Connect an agent in one step (D9, show slice S2): one card at the top of Connect an agent. A
  prompt to paste into the agent, with the Ask first line built in, so the agent adds Heed, writes
  the line into its instructions file and says how to sign in, as Notion's setup prompt does. The
  card says live whether an agent of the person's is connected: a sign-in connection is the one
  thing Heed knows about a person's agent (MCP requests keep no person, FR-410), so the card reads
  the connected agents, every few seconds while it waits for a sign-in after a copy. Beside it, the
  Heed skill (SKILL.md) for Claude Code, Codex and Cursor. The setup by hand stays below the card
  for anyone who needs a step on its own.
*/

/** How often the card reads the connected agents while it waits for a sign-in after a copy. */
export const WAITING_REFRESH_MS = 3_000
/** And otherwise, so an agent connected from elsewhere shows without a reload. */
export const CONNECT_REFRESH_MS = 30_000

/** The app the card opens on: Claude Code in the local pilot, else the first switched on. */
function firstClient(clients: ConnectInfo['clients']) {
  return clients.find((client) => client.label === 'claude-code') ?? clients[0]
}

/** The connection used last: the one the card names. */
function latest(connections: readonly Connection[]): Connection | undefined {
  return connections.reduce<Connection | undefined>(
    (best, c) => (!best || c.lastUsedAt > best.lastUsedAt ? c : best),
    undefined,
  )
}

/** Whether the address is on this computer, as with `docker compose up`: the app must run here too. */
function onThisComputer(address: string) {
  try {
    const host = new URL(address).hostname
    return host === 'localhost' || host === '[::1]' || host.startsWith('127.')
  } catch {
    return false
  }
}

function saveSkill(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: SKILL_FILE })
  link.click()
  // The download has started from the link; the object URL is not needed after that.
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function ConnectCard({
  address,
  clients,
  signIn,
}: Pick<ConnectInfo, 'clients' | 'signIn'> & { address: string }) {
  const [label, setLabel] = useState(() => firstClient(clients)?.label)
  const client = clients.find((c) => c.label === label) ?? firstClient(clients)
  if (!client) return null
  return (
    <ConnectCardFor
      key={client.label}
      address={address}
      client={client}
      clients={clients}
      signIn={signIn}
      onPick={setLabel}
    />
  )
}

function ConnectCardFor({
  address,
  client,
  clients,
  signIn,
  onPick,
}: {
  address: string
  client: ConnectInfo['clients'][number]
  clients: ConnectInfo['clients']
  signIn: boolean
  onPick: (label: string) => void
}) {
  const id = useId()
  const auth: ConnectAuth = signIn ? 'sign-in' : 'token'
  const name = appNameFor(client)
  const prompt = setupPromptFor(client, address, auth)
  const { state: copyState, copy } = useCopy(promptText(prompt))
  const [copied, setCopied] = useState(false)
  const [seen, setSeen] = useState<ReadonlySet<string> | null>(null)
  const read = (all: readonly Connection[]) => {
    const mine = latest(all.filter((c) => isReportedAs(client, c.clientName)))
    return { mine, other: mine || !seen ? undefined : latest(all.filter((c) => !seen.has(c.id))) }
  }
  const connections = useQuery({
    ...connectionsQuery(),
    enabled: signIn,
    refetchInterval: (query) => {
      const { mine, other } = read(query.state.data ?? [])
      return copied && !mine && !other ? WAITING_REFRESH_MS : CONNECT_REFRESH_MS
    },
  })
  if (!seen && connections.data) setSeen(new Set(connections.data.map((c) => c.id)))
  const { mine: last, other: stranger } = read(connections.data ?? [])
  const status: 'unknown' | 'connected' | 'waiting' | 'not-connected' = !signIn
    ? 'unknown'
    : last
      ? 'connected'
      : copied
        ? 'waiting'
        : 'not-connected'

  return (
    <section
      data-slot="connect-card"
      data-state={status}
      aria-labelledby={`${id}-title`}
      className="@container flex min-w-0 flex-col rounded-lg border bg-card"
    >
      <div className="flex min-w-0 flex-col gap-4 p-4 @md:p-6">
        <div className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-3">
          <span
            aria-hidden="true"
            className="flex size-control-lg shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground @max-md:hidden"
          >
            <PlugIcon className="size-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id={`${id}-title`} className="text-large font-bold">
              Connect {name} in one paste
            </h2>
            <p className="text-dense text-muted-foreground">
              {signIn
                ? `It adds ${productName}, puts the Ask first line in its instructions, and tells you how to sign in.`
                : 'It puts the Ask first line in its instructions and tells you where your access key goes.'}
            </p>
          </div>
          <span className="flex shrink-0 @max-md:basis-full">
            <StatusBadge status={status} />
          </span>
        </div>

        {clients.length > 1 ? (
          <ToggleGroup
            aria-label="Your agent"
            value={[client.label]}
            onValueChange={(value: string[]) => {
              if (value[0]) onPick(value[0])
            }}
          >
            {clients.map((c) => (
              <ToggleGroupItem key={c.label} value={c.label} size="sm">
                {appNameFor(c)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}

        <figure
          data-slot="connect-prompt"
          aria-labelledby={`${id}-prompt`}
          className="flex min-w-0 flex-col overflow-hidden rounded-md border"
        >
          <figcaption className="flex min-w-0 items-center justify-between gap-3 border-b bg-muted py-1 pr-1 pl-3">
            <span id={`${id}-prompt`} className="truncate text-caption text-muted-foreground">
              Paste this into {name}
            </span>
            <Button
              size="sm"
              aria-label={`Copy prompt for ${name}`}
              onClick={() =>
                void copy().then((ok) => {
                  if (ok) setCopied(true)
                })
              }
            >
              {copyState === 'copied' ? <CheckIcon /> : <CopyIcon />}
              {copyState === 'copied' ? 'Copied' : 'Copy prompt'}
            </Button>
          </figcaption>
          <div className="flex min-w-0 flex-col gap-3 p-4">
            {prompt.map((part, index) =>
              part.kind === 'code' ? (
                <code
                  key={index}
                  className="rounded-sm bg-muted px-2 py-1 font-mono text-caption break-words whitespace-pre-wrap"
                >
                  {part.text}
                </code>
              ) : (
                <p key={index} className="text-dense">
                  {part.text}
                </p>
              ),
            )}
          </div>
          <span role="status" className="sr-only">
            {copyState === 'copied' ? 'Copied' : ''}
          </span>
        </figure>

        <LiveLine
          status={status}
          name={name}
          last={last}
          stranger={stranger}
          failed={copyState === 'failed'}
        />

        {onThisComputer(address) ? (
          <p className="flex items-start gap-2 text-caption text-muted-foreground">
            <span className="flex h-4 shrink-0 items-center">
              <MonitorIcon aria-hidden="true" className="size-icon-sm" />
            </span>
            <span className="min-w-0">
              {productName} runs on this computer at {address}, so {name} must run here too.
            </span>
          </p>
        ) : null}
      </div>

      <SkillRow address={address} auth={auth} />
    </section>
  )
}

function StatusBadge({
  status,
}: {
  status: 'unknown' | 'connected' | 'waiting' | 'not-connected'
}) {
  if (status === 'unknown') return null
  if (status === 'connected')
    return (
      <Badge tone="success" icon={CircleCheckIcon} data-slot="connect-status">
        Connected
      </Badge>
    )
  return (
    <Badge form="outline" quiet icon={CircleDashedIcon} data-slot="connect-status">
      Not connected yet
    </Badge>
  )
}

/**
 * What happens next, read out when it changes: sign in after the paste; waiting for that
 * sign-in; or which app is connected and when it was last used.
 */
function LiveLine({
  status,
  name,
  last,
  stranger,
  failed,
}: {
  status: 'unknown' | 'connected' | 'waiting' | 'not-connected'
  name: string
  last: Connection | undefined
  stranger: Connection | undefined
  failed: boolean
}) {
  const line = (() => {
    if (failed)
      return {
        icon: <InfoIcon className="text-status-warning-icon" />,
        text: "Couldn't copy the prompt. Your browser blocked it. Select the text and copy it.",
      }
    if (stranger)
      return {
        icon: <InfoIcon className="text-muted-foreground" />,
        text: `An agent just signed in: ${stranger.clientName}. If that wasn't ${name}, check the list below.`,
      }
    switch (status) {
      case 'connected':
        if (!last) break
        return {
          icon: <CircleCheckIcon className="text-status-success-icon" />,
          text: `${last.clientName} is connected as you, last used ${formatMoment(last.lastUsedAt)}. It reads only what you can read.`,
        }
      case 'waiting':
        return {
          icon: <LoaderCircleIcon className="text-muted-foreground motion-safe:animate-spin" />,
          text: `Waiting for ${name} to sign in. Paste the prompt there, then sign in to ${productName} when it asks.`,
        }
      case 'not-connected':
        return {
          icon: <CircleDashedIcon className="text-muted-foreground" />,
          text: `After the paste, sign in to ${productName} when ${name} asks. This card says Connected once you have.`,
        }
    }
    return {
      icon: <InfoIcon className="text-muted-foreground" />,
      text: "An agent that connects with an access key doesn't show here, because we don't record who asks. To see what it's told, use Try a question.",
    }
  })()
  return (
    <p role="status" data-slot="connect-live" className="flex items-start gap-2 text-dense">
      <span aria-hidden="true" className="flex h-5 shrink-0 items-center [&>svg]:size-icon-sm">
        {line.icon}
      </span>
      <span className="min-w-0">{line.text}</span>
    </p>
  )
}

function SkillRow({ address, auth }: { address: string; auth: ConnectAuth }) {
  const id = useId()
  return (
    <div
      data-slot="connect-skill"
      className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-3 border-t px-4 py-4 @md:px-6"
    >
      <span
        aria-hidden="true"
        className="flex size-control-lg shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground"
      >
        <FileTextIcon className="size-5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-dense font-bold">The {productName} skill for coding tools</p>
        <p id={`${id}-about`} className="text-dense text-muted-foreground">
          Teaches Claude Code, Codex and Cursor to check {productName} first and to read its
          answers.
        </p>
        <ul aria-label="Where to save it" className="flex flex-col gap-1 text-caption">
          {skillPlaces.map((place) => (
            <li key={place.path} className="min-w-0 text-muted-foreground">
              <code className="font-mono break-words text-foreground">{place.path}</code> for{' '}
              {place.agents}
            </li>
          ))}
        </ul>
      </div>
      <Button
        variant="outline"
        className="@max-md:w-full"
        aria-describedby={`${id}-about`}
        onClick={() => saveSkill(skillFor(address, auth))}
      >
        <DownloadIcon />
        Download SKILL.md
      </Button>
    </div>
  )
}
