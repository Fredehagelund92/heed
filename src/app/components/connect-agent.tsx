import * as React from 'react'
import {
  CheckIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  ClockIcon,
  CopyIcon,
  LoaderCircleIcon,
  PlugIcon,
} from 'lucide-react'
import { cn } from 'cn'
import { toast } from 'sonner'
import { ToolLogo } from '@/components/heed/tool-logo'
import { FrameSection } from '@/components/heed/frame'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { AgentPreviewLink } from '@/components/agent-preview'
import {
  ADDRESS,
  CHECKS,
  CLAUDE_CODE_COMMAND,
  GUIDES,
  PROMPT,
  PROMPT_PARTS,
  TOOL_NAMES,
  cursorLink,
  guide,
  liveCopy,
  vscodeLink,
  type AgentId,
  type Via,
} from '@/data/agents'
import {
  addConnected,
  CHECK_MS,
  HINT_MS,
  LIVE_PHASES,
  MOCK_SIGN_IN_MS,
  phaseAt,
  type LivePhase,
} from '@/lib/connect'
import { onOpen } from '@/lib/events'
import { useRoute } from '@/lib/router'
import { useMe } from '@/lib/store'

// Connect an agent: one prompt first, shown in full and copied exactly as shown, with a live line
// that watches for the sign-in; then one cell per agent for a quick start, with the one-click links
// where a client has them; then every agent's steps by hand, in a fold. The Settings page and the
// Connect an agent dialog (user menu, palette, setup checklist) show this same body.

const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => undefined)

/** The name an agent reports when it signs in; a pasted prompt is most often run in Claude Code. */
const agentOf = (via: Via) =>
  via === 'prompt' ? 'Claude Code' : guide(via).name === 'Your agent' ? 'ChatGPT' : guide(via).name

type Live = { phase: LivePhase; via: Via; started: number; signIn?: number; agent?: string }

/** A state from the review flag: it waits for nobody, so each state stays until acted on. */
function fromFlag(flag?: LivePhase): Live {
  const now = Date.now()
  return {
    phase: flag ?? 'idle',
    via: 'prompt',
    started: flag === 'hint' ? now - HINT_MS : now,
    agent: 'Claude Code',
  }
}

/** The live line's state: a mock agent signs in 8 seconds after a copy, and ?connect= shows any state. */
function useLive() {
  const me = useMe()
  const asked = useRoute().query.get('connect')
  const flag = LIVE_PHASES.find((p) => p === asked)
  const [live, setLive] = React.useState<Live>(() => fromFlag(flag))
  // A new ?connect= flag (a review link) starts that state over, during render rather than after it.
  const [shownFlag, setShownFlag] = React.useState(flag)
  if (flag !== shownFlag) {
    setShownFlag(flag)
    setLive(fromFlag(flag))
  }
  React.useEffect(() => {
    if (flag === 'connected') addConnected('Claude Code', me.name)
  }, [flag, me.name])

  const waiting = live.phase === 'waiting' || live.phase === 'hint'
  React.useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => {
      const phase = phaseAt(Date.now() - live.started, live.signIn)
      if (phase === live.phase) return
      if (phase === 'connected') addConnected(live.agent!, me.name)
      setLive((l) => ({ ...l, phase }))
    }, CHECK_MS)
    return () => clearInterval(t)
  }, [waiting, live, me.name])

  const start = (via: Via) =>
    setLive({
      phase: 'waiting',
      via,
      started: Date.now(),
      signIn: MOCK_SIGN_IN_MS,
      agent: agentOf(via),
    })
  return { live, start, again: () => start(live.via), me: me.name }
}

/* ---------- The prompt ---------- */

function PromptCard({ onCopy }: { onCopy: () => void }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <figure className="border bg-background" aria-labelledby="connect-prompt-label">
      <figcaption className="flex min-h-11 items-center justify-between gap-3 border-b bg-[color-mix(in_oklab,var(--muted)_45%,var(--background))] py-1.5 pr-1.5 pl-3">
        <span id="connect-prompt-label" className="text-xs text-muted-foreground">
          Paste this into your agent
        </span>
        <Button
          size="sm"
          onClick={() => {
            copy(PROMPT)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
            onCopy()
          }}
        >
          {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
          {copied ? 'Copied' : 'Copy prompt'}
        </Button>
      </figcaption>
      <div className="flex flex-col gap-2.5 px-3 py-3 text-sm leading-relaxed md:px-4">
        {PROMPT_PARTS.map((p, i) =>
          p.code ? (
            <code
              key={i}
              className="block rounded-md bg-muted px-2.5 py-1.5 font-mono text-[12.5px] leading-relaxed [overflow-wrap:anywhere]"
            >
              {p.text}
            </code>
          ) : (
            <p key={i} className="text-pretty">
              {p.text}
            </p>
          ),
        )}
      </div>
    </figure>
  )
}

/* ---------- The live line ---------- */

function LiveLine({
  live,
  me,
  onAgain,
  onCopyAgain,
}: {
  live: Live
  me: string
  onAgain: () => void
  onCopyAgain: () => void
}) {
  const { phase } = live
  const icon = {
    idle: <CircleDashedIcon className="text-muted-foreground" />,
    waiting: <LoaderCircleIcon className="animate-spin text-primary" />,
    hint: <LoaderCircleIcon className="animate-spin text-primary" />,
    connected: <CircleCheckIcon className="text-primary" />,
    timeout: <ClockIcon className="text-muted-foreground" />,
    declined: <CircleXIcon className="text-destructive" />,
  }[phase]
  const { title, body } = liveCopy(live.phase, live.via, live.agent ?? 'your agent', me)
  return (
    <div
      role="status"
      aria-live="polite"
      className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3 gap-y-1 [&>svg]:mt-0.5 [&>svg]:size-4"
    >
      {React.cloneElement(icon, { 'aria-hidden': true })}
      <p className="text-sm font-medium">{title}</p>
      <div className="col-start-2 flex flex-col items-start gap-2 text-sm text-muted-foreground">
        {body && <p className="text-pretty">{body}</p>}
        {phase === 'connected' && (
          <>
            <p className="text-pretty">
              It can call{' '}
              {TOOL_NAMES.map((t, i) => (
                <React.Fragment key={t}>
                  {i > 0 && (i === TOOL_NAMES.length - 1 ? ' and ' : ', ')}
                  <code className="font-mono text-[12.5px] text-foreground">{t}</code>
                </React.Fragment>
              ))}
              .
            </p>
            <AgentPreviewLink agent={live.agent ?? 'Your agent'} />
          </>
        )}
        {(phase === 'hint' || phase === 'timeout') && (
          <ul className="flex list-disc flex-col gap-1 pl-4 marker:text-muted-foreground/60">
            {CHECKS.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
        {(phase === 'hint' || phase === 'timeout' || phase === 'declined') && (
          <div className="flex flex-wrap gap-2 pt-1">
            {phase === 'timeout' && (
              <Button size="sm" onClick={onAgain}>
                Check again
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onCopyAgain}>
              <CopyIcon data-icon="inline-start" />
              Copy prompt again
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- The quick cells ---------- */

function CopyButton({ label, text, onCopy }: { label: string; text: string; onCopy: () => void }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => {
        copy(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
        onCopy()
      }}
    >
      {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
      {copied ? 'Copied' : label}
    </Button>
  )
}

function LinkButton({ label, href, onOpen }: { label: string; href: string; onOpen: () => void }) {
  return (
    <a
      href={href}
      onClick={onOpen}
      className={cn(buttonVariants({ size: 'sm', variant: 'outline' }))}
    >
      <PlugIcon data-icon="inline-start" />
      {label}
    </a>
  )
}

/** A quiet text button inside a cell: the Claude switch, and the way into an agent's steps. */
function TextButton({ children, ...props }: React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className="-mx-1 inline-flex min-h-6 items-center rounded-sm px-1 text-xs text-muted-foreground underline decoration-muted-foreground/40 underline-offset-4 outline-none hover:text-foreground hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
      {...props}
    >
      {children}
    </button>
  )
}

const CLAUDE_KEY = 'connect-claude'
function readClaude(): 'code' | 'app' {
  try {
    return sessionStorage.getItem(CLAUDE_KEY) === 'app' ? 'app' : 'code'
  } catch {
    return 'code'
  }
}

function Cell({
  logo,
  name,
  hint,
  children,
  switcher,
}: {
  logo: string
  name: string
  hint: string
  children: React.ReactNode
  switcher?: React.ReactNode
}) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 bg-background p-4 min-[28rem]:flex min-[28rem]:min-h-40 min-[28rem]:flex-col md:p-5">
      <ToolLogo c={{ logo }} />
      <div>
        <p className="text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {hint}
        </p>
        {switcher}
      </div>
      <div className="col-start-2 mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 min-[28rem]:pt-1">
        {children}
      </div>
    </li>
  )
}

function QuickCells({
  start,
  showSteps,
}: {
  start: (via: Via) => void
  showSteps: (id: AgentId) => void
}) {
  const [claude, setClaude] = React.useState(readClaude)
  const pick = (v: 'code' | 'app') => {
    setClaude(v)
    try {
      sessionStorage.setItem(CLAUDE_KEY, v)
    } catch {
      // Remembering the choice is a convenience only.
    }
  }
  return (
    <ul
      aria-label="Start from your agent"
      className="grid grid-cols-1 gap-px border-t bg-border min-[28rem]:grid-cols-2 @3xl/main:grid-cols-4"
    >
      <Cell
        logo={guide('claude-code').logo}
        name="Claude"
        hint={
          claude === 'code' ? 'Claude Code, in a terminal' : 'The app, on the web or the desktop'
        }
        switcher={
          <TextButton onClick={() => pick(claude === 'code' ? 'app' : 'code')}>
            {claude === 'code' ? 'Use the app instead' : 'Use Claude Code instead'}
          </TextButton>
        }
      >
        {claude === 'code' ? (
          <CopyButton
            label="Copy command"
            text={CLAUDE_CODE_COMMAND}
            onCopy={() => start('claude-code')}
          />
        ) : (
          <>
            <CopyButton label="Copy address" text={ADDRESS} onCopy={() => start('claude-app')} />
            <TextButton onClick={() => showSteps('claude-app')}>Steps</TextButton>
          </>
        )}
      </Cell>
      <Cell logo={guide('cursor').logo} name="Cursor" hint="In the editor">
        <LinkButton label="Add to Cursor" href={cursorLink()} onOpen={() => start('cursor')} />
      </Cell>
      <Cell logo={guide('vscode').logo} name="VS Code" hint="With Copilot">
        <LinkButton label="Install in VS Code" href={vscodeLink()} onOpen={() => start('vscode')} />
      </Cell>
      <Cell logo={guide('chatgpt').logo} name="ChatGPT and others" hint="Any agent that speaks MCP">
        <CopyButton label="Copy address" text={ADDRESS} onCopy={() => start('other')} />
        <TextButton onClick={() => showSteps('chatgpt')}>Steps</TextButton>
      </Cell>
    </ul>
  )
}

/* ---------- By hand ---------- */

export function SetupLine({ line, onCopy }: { line: string; onCopy?: () => void }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <InputGroup>
      <InputGroupInput
        readOnly
        value={line}
        aria-label="The line to copy"
        className="font-mono text-xs"
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          aria-label="Copy the line"
          size="icon-xs"
          onClick={() => {
            copy(line)
            setCopied(true)
            toast('Copied', { description: 'Paste it where the step says.' })
            setTimeout(() => setCopied(false), 1500)
            onCopy?.()
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

function ByHand({
  shown,
  onShow,
  start,
  pad,
}: {
  shown?: AgentId
  onShow: (id?: AgentId) => void
  start: (via: Via) => void
  pad: string
}) {
  return (
    <ul aria-label="Each agent's steps" className="border-t">
      {GUIDES.map((g) => {
        const open = g.id === shown
        const id = `by-hand-${g.id}`
        return (
          <li key={g.id} id={`guide-${g.id}`} className="scroll-mt-4 border-t first:border-t-0">
            <h4>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={id}
                onClick={() => onShow(open ? undefined : g.id)}
                className={cn(
                  'group/g flex min-h-12 w-full items-center gap-3 text-left text-sm font-medium outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                  pad,
                )}
              >
                <ToolLogo c={g} size="sm" />
                <span className="flex-1">
                  {g.id === 'claude-app'
                    ? 'Claude, the app'
                    : g.id === 'other'
                      ? 'Other agents'
                      : g.name}
                </span>
                <ChevronRightIcon
                  aria-hidden
                  className="mr-1.5 size-4 text-muted-foreground transition-transform group-aria-expanded/g:rotate-90"
                />
              </button>
            </h4>
            <ol
              id={id}
              hidden={!open}
              className={cn('flex max-w-[52rem] flex-col gap-3 pt-1 pb-4', pad)}
            >
              {g.steps.map((s, i) => (
                <li key={i} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
                  <span
                    aria-hidden
                    className="grid size-6 place-items-center border text-xs font-medium tabular-nums"
                  >
                    {i + 1}
                  </span>
                  <span className="self-center text-sm text-pretty">{s.what}</span>
                  {s.copy && (
                    <div className="col-start-2 min-w-0">
                      <SetupLine line={s.copy} onCopy={i === 0 ? () => start(g.id) : undefined} />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </li>
        )
      })}
    </ul>
  )
}

/* ---------- The whole body ---------- */

/** The connect body, edge to edge: inside a Settings frame, or inside the dialog (`inDialog`, the dialog's own gutter). */
export function ConnectAgent({ inDialog }: { inDialog?: boolean }) {
  const { live, start, again, me } = useLive()
  const [fold, setFold] = React.useState(false)
  const [shown, setShown] = React.useState<AgentId>()
  const pad = inDialog ? 'px-4' : 'px-4 md:px-5'
  const showSteps = (id: AgentId) => {
    setFold(true)
    setShown(id)
    requestAnimationFrame(() => {
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
      document
        .getElementById(`guide-${id}`)
        ?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
    })
  }
  return (
    <div className="flex flex-col">
      <div className={cn('flex max-w-[52rem] flex-col gap-4 pb-5', pad, inDialog && 'pt-4')}>
        <PromptCard onCopy={() => start('prompt')} />
        <p className="-mt-1.5 text-xs text-muted-foreground">
          It adds the connection, writes one line into the agent's instructions, and tells you how
          to sign in. It never asks for a key.
        </p>
        <LiveLine
          live={live}
          me={me}
          onAgain={again}
          onCopyAgain={() => {
            copy(PROMPT)
            start('prompt')
          }}
        />
      </div>
      <p className={cn('border-t py-3 text-sm text-muted-foreground', pad)}>
        Or start from your agent
      </p>
      <QuickCells start={start} showSteps={showSteps} />
      <FrameSection
        title="Prefer to do it by hand"
        description="Each agent's own steps, if you would rather type them yourself."
        level={3}
        collapsible
        open={fold}
        onOpenChange={setFold}
        className="border-t"
      >
        <ByHand shown={shown} onShow={setShown} start={start} pad={pad} />
      </FrameSection>
    </div>
  )
}

// Connect an agent, from the user menu, the palette or the setup checklist: the same body.
export function ConnectAgentDialog() {
  const [open, setOpen] = React.useState(false)
  React.useEffect(() => onOpen('connect', () => setOpen(true)), [])
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100svh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Connect an agent</DialogTitle>
          <DialogDescription>
            Paste one prompt into your agent, or start from your agent below. You approve the
            connection once, in the browser.
          </DialogDescription>
        </DialogHeader>
        <div className="@container/main -mx-4 min-h-0 overflow-y-auto overscroll-contain border-t **:data-[slot=frame-section-header]:px-4">
          <ConnectAgent inDialog />
        </div>
        <DialogFooter className="-mt-4">
          <Button onClick={() => setOpen(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
