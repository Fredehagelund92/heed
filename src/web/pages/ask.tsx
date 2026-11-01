import * as React from 'react'
import {
  EllipsisIcon,
  HistoryIcon,
  MessageSquareIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PencilIcon,
  SearchIcon,
  SquarePenIcon,
  Trash2Icon,
  XIcon,
} from '@/components/icons'
import { toast } from 'sonner'
import { toApiError } from '@/api/errors'
import { cn } from '@/lib/utils'
import { DockFrame } from '@/components/dock'
import { AnswerBody, DraftBanner, Question, type Phase } from '@/components/heed/answer'
import { ResizableAside } from '@/components/resizable-aside'
import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  askedWeekQuery,
  askQuery,
  useAskExamples,
  useInbox,
  useSession,
  useWrite,
} from '@/api/queries'
import type { Answer, AskInput, QuestionPart } from '@/model/ask'
import type { AskQuestion, ComposerHandle } from '@/pages/ask-composer'
import type { Fact } from '@/model/items'
import { useDraft } from '@/lib/draft'
import { useIsMobile } from '@/hooks/use-mobile'
import { readWidth, saveWidth } from '@/lib/pane-width'
import { navigate, setQuery, useRoute } from '@/lib/router'
import { inputSurface } from '@/lib/surfaces'
import { findThread, useThreadActions, useThreads, type Day, type Thread } from '@/lib/threads'
import { TruncatedText } from '@/components/heed/truncated'
import { markRead, wasRead } from '@/lib/stages'
import { AskedThisWeek } from '@/components/heed/asked-week'
import { Answering, Suggestions } from '@/components/heed/suggestions'
import { arriveRef, leaveThen, useLeaving } from '@/lib/presence'

// Ask, drawn like assistant-ui's thread inside the Efferd shell: a thread history on the left, a
// calm centred thread at reading width, and a composer docked to the bottom edge. Mock answers only:
// each one "looks up" for a moment, then streams in.

type Turn = { answer: Answer; phase: Phase }

/** What Ask is asked for a chat's first answer: its example, or its question. */
const firstAsk = (t: Pick<Thread, 'example' | 'question'>): AskInput =>
  t.example ? { example: t.example } : { question: t.question }

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

const AskComposer = React.lazy(() =>
  import('@/pages/ask-composer').then((m) => ({ default: m.AskComposer })),
)

/** The box as it looks before its editor has loaded, so nothing shifts when it arrives. */
function ComposerPlaceholder({ placeholder }: { placeholder: string }) {
  return (
    <div aria-hidden className={cn('flex w-full flex-col', inputSurface)}>
      <div className="min-h-14 px-3 py-3 text-base leading-6 text-muted-foreground">
        {placeholder}
      </div>
      <div className="h-10 border-t" />
    </div>
  )
}

export function AskChat({
  initial,
  draft,
  compact,
  prefill,
  onFirstAsk,
  onStarter,
  onTurns,
  stageFirst,
}: {
  /** The first answer plays its stages the first time this key is shown (Try it), then opens at once. */
  stageFirst?: string
  initial?: Answer[]
  draft?: Fact
  compact?: boolean
  /** A question typed into the box, waiting to be sent. */
  prefill?: string
  onFirstAsk?: (question: string) => void
  /** A starter that is already a chat opens that chat instead of asking it again; true when it did. */
  onStarter?: (question: string) => boolean
  /** Everything this chat has asked and answered so far, so the history search finds it. */
  onTurns?: (text: string) => void
}) {
  const [turns, setTurns] = React.useState<Turn[]>(() =>
    (initial ?? []).map((answer, i) => ({
      answer,
      phase: i === 0 && stageFirst && !wasRead(stageFirst) && !reducedMotion() ? 'live' : 'done',
    })),
  )
  React.useEffect(() => {
    if (stageFirst) markRead(stageFirst)
  }, [stageFirst])
  const viewport = React.useRef<HTMLDivElement>(null)

  const busy = turns.some((t) => t.phase === 'live')
  // One question at a time, as in any chat: from the moment one is sent until its answer is in (or
  // has failed), nothing else is asked. The ref holds it at once, before React shows it: a second
  // click in the same moment finds it held.
  const [waiting, setWaiting] = React.useState(false)
  const sending = React.useRef(false)
  const answering = waiting || busy
  /** Runs one send, unless another is under way or an answer is still being written. */
  const one = async (send: () => Promise<void>) => {
    if (sending.current || busy) return
    sending.current = true
    setWaiting(true)
    try {
      await send()
    } finally {
      sending.current = false
      setWaiting(false)
    }
  }
  // While an answer is written the view follows it down, until the asker scrolls up to read.
  const follow = React.useRef(true)

  /** Brings a finished answer fully into view, down to its action row, above the composer. */
  const reveal = (i: number) =>
    requestAnimationFrame(() => {
      const box = viewport.current
      const el = box?.querySelector<HTMLElement>(`[data-turn="${i}"]`)
      if (!box || !el) return
      const below = el.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom + 16
      if (below > 0) box.scrollBy({ top: below, behavior: reducedMotion() ? 'auto' : 'smooth' })
    })

  // Stop cancels: the answer freezes where it got to, says it isn't finished, and that comes into view.
  const stop = () => {
    const i = turns.findIndex((t) => t.phase === 'live')
    if (i < 0) return
    setTurns((ts) => ts.map((t) => (t.phase === 'live' ? { ...t, phase: 'stopped' } : t)))
    reveal(i)
  }

  const settle = (i: number) => () => {
    setTurns((ts) =>
      ts.map((t, j) => (j === i && t.phase === 'live' ? { ...t, phase: 'done' } : t)),
    )
    reveal(i)
  }

  const composer = React.useRef<ComposerHandle>(null)
  // A touch screen gets no automatic focus: the keyboard would cover the page before anyone asked for it.
  const [touch] = React.useState(() => window.matchMedia('(pointer: coarse)').matches)
  const { fresh } = useSession()
  const examples = useAskExamples()
  // What agents asked this week; with nothing asked yet (a new workspace), its starters instead.
  const week = useQuery(askedWeekQuery()).data
  const starters = examples.filter((e) => e.starter).map((e) => e.question)
  const queryClient = useQueryClient()
  const add = (asked: string | AskQuestion) =>
    one(async () => {
      const {
        text: q,
        parts,
        scope,
      } = typeof asked === 'string' ? { text: asked, parts: undefined, scope: [] } : asked
      let answer: Answer
      try {
        answer =
          draft && initial?.[0]
            ? { ...initial[0], question: q, parts }
            : await queryClient.fetchQuery(askQuery({ question: q, parts, scope }))
      } catch (e) {
        // Nothing came back: the question goes back in an empty box, to send again.
        composer.current?.refill(parts ?? [q])
        toast("Couldn't ask that", { description: toApiError(e).message })
        return
      }
      const index = turns.length
      // A question that is already a chat, typed or picked, opens that chat: the history never has it twice.
      if (index === 0 && onStarter?.(q)) return
      if (index === 0) {
        // The chat this starts opens again on its question alone: a question with no mentions gets
        // the same answer, so it is kept for that, and opening the chat again looks nothing up.
        if (!scope.length && (parts ?? []).every((p) => typeof p === 'string'))
          queryClient.setQueryData(askQuery({ question: q }).queryKey, answer)
        onFirstAsk?.(q)
      }
      follow.current = true
      // With reduced motion the answer is there at once, finished.
      const phase: Phase = reducedMotion() ? 'done' : 'live'
      setTurns((ts) => [...ts, { answer: { ...answer, id: `t${index}` }, phase }])
      if (phase === 'done') window.setTimeout(() => reveal(index), 0)
    })

  // "Change it" under a misread question: the question goes back in the box with what it was read as, as chips to keep or swap.
  const rescope = (parts: QuestionPart[]) => composer.current?.set(parts)

  // Ask again asks the same question again; a check that failed reads it afresh, since the failure was the check's.
  const retry = (i: number) => () => void askAgain(i)
  const askAgain = (i: number) =>
    one(async () => {
      const { question, parts, scope, id, state, dates } = turns[i]!.answer
      let fresh: Answer
      try {
        fresh = await queryClient.fetchQuery(
          askQuery(
            state === 'failed' ? { question, reread: { dates } } : { question, parts, scope },
          ),
        )
      } catch (e) {
        toast("Couldn't ask that again", { description: toApiError(e).message })
        return
      }
      setTurns((ts) =>
        ts.map((t, j) =>
          j === i
            ? { answer: { ...fresh, id, parts, scope }, phase: reducedMotion() ? 'done' : 'live' }
            : t,
        ),
      )
      follow.current = true
      if (reducedMotion()) window.setTimeout(() => reveal(i), 0)
    })

  // "/" puts the cursor in the box from anywhere on the page that isn't a text field.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (
        e.key !== '/' ||
        e.metaKey ||
        e.ctrlKey ||
        t.closest('input, textarea, [contenteditable=true]')
      )
        return
      e.preventDefault()
      composer.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Escape stops an answer being written, unless something open (a menu, the @ list) takes it first.
  React.useEffect(() => {
    if (!busy) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // A long answer stays in view as it is written: its last line follows the bottom edge.
  const content = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const box = viewport.current
    const inner = content.current
    if (!box || !inner || !busy) return
    const away = (e: WheelEvent | TouchEvent) => {
      if (!('deltaY' in e) || e.deltaY < 0) follow.current = false
    }
    const ro = new ResizeObserver(() => {
      const i = turns.findIndex((t) => t.phase === 'live')
      const el = box.querySelector<HTMLElement>(`[data-turn="${i}"]`)
      if (!follow.current || !el) return
      const below = el.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom + 16
      if (below > 0) box.scrollBy({ top: below })
    })
    ro.observe(inner)
    box.addEventListener('wheel', away, { passive: true })
    box.addEventListener('touchmove', away, { passive: true })
    return () => {
      ro.disconnect()
      box.removeEventListener('wheel', away)
      box.removeEventListener('touchmove', away)
    }
  }, [busy, turns])

  // What the chat holds, for the history search.
  const said = turns.map((t) => `${t.answer.question} ${t.answer.text}`).join(' ')
  React.useEffect(() => onTurns?.(said), [said, onTurns])

  // A new question scrolls to the top of the view, so the answer arrives under it.
  const count = turns.length
  React.useEffect(() => {
    if (!count) return
    const el = viewport.current?.querySelector<HTMLElement>(`[data-turn="${count - 1}"]`)
    el?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })
  }, [count])

  const width = compact ? 'max-w-none px-4' : 'max-w-176 px-4'
  const placeholder = draft
    ? 'Ask another question against the draft'
    : 'Ask about a metric, a market or the records'

  return (
    <Answering value={answering}>
      <div data-touch-targets className="@container flex h-full min-h-0 flex-col">
        {/* Positioned, so what is placed inside a turn (a citation's screen-reader words) stays in
            this scroll box and never makes the page around it taller. */}
        <div ref={viewport} className="relative min-h-0 flex-1 scrollbar-stable overflow-y-auto">
          <div ref={content} className={cn('mx-auto flex min-h-full w-full flex-col', width)}>
            {turns.length === 0 ? (
              <div className="flex flex-1 flex-col justify-center gap-5 py-10">
                <div className="px-2 text-center">
                  <h2 className="text-2xl font-medium tracking-tight text-balance">
                    What do you want to know about the numbers?
                  </h2>
                  <p className="mt-2 text-sm text-balance text-muted-foreground">
                    Answers come from checked context, the way an agent gets it, and say how sure
                    they are.
                  </p>
                </div>
                {/* What agents asked this week; a new workspace, with nothing asked yet, gets its starters instead. */}
                {!draft &&
                  (fresh || (week && !week.rows.length) ? (
                    <Suggestions
                      grid
                      items={starters.slice(0, 4)}
                      onPick={(q) => onStarter?.(q) || void add(q)}
                    />
                  ) : (
                    <AskedThisWeek onPick={(q) => onStarter?.(q) || void add(q)} />
                  ))}
              </div>
            ) : (
              // A log, so a screen reader hears each answer arrive.
              <div
                role="log"
                aria-label="Questions and answers"
                className="flex flex-col gap-y-8 pt-6 pb-10"
              >
                {draft && <DraftBanner />}
                {turns.map((t, i) => (
                  <div
                    key={t.answer.id}
                    data-turn={i}
                    className="flex scroll-mt-4 flex-col gap-y-6"
                  >
                    <Question
                      answer={t.answer}
                      onRescope={draft ? undefined : rescope}
                      onEdit={draft ? undefined : (parts) => composer.current?.set(parts)}
                    />
                    <AnswerBody
                      answer={t.answer}
                      draft={draft}
                      docked={compact}
                      phase={t.phase}
                      onRetry={retry(i)}
                      onSettled={settle(i)}
                      onAsk={draft ? undefined : (q) => void add(q)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {/* Docked to the bottom edge, part of the frame: a hairline above, the box at reading width. */}
        <div className="shrink-0 border-t bg-background">
          {/* Under the box, the bar height less its control row (40) and edge (1): the hairline over the
            controls then sits one bar from the bottom, in line with the sidebar's user block and the other bars. */}
          <div className={cn('mx-auto flex w-full flex-col gap-2 pt-3 pb-ask-foot', width)}>
            <React.Suspense fallback={<ComposerPlaceholder placeholder={placeholder} />}>
              <AskComposer
                ref={composer}
                onSubmit={(q) => void add(q)}
                onStop={stop}
                busy={busy}
                waiting={waiting}
                placeholder={placeholder}
                prefill={prefill}
                autoFocus={(turns.length === 0 || !!prefill) && !touch}
              />
            </React.Suspense>
          </div>
        </div>
      </div>
    </Answering>
  )
}

/* ---------- the chats ---------- */

const DAYS: Day[] = ['Today', 'Yesterday', 'Earlier']
const HISTORY_KEY = '⌥H'

/** Starts an empty chat: a new `n` gives the thread a fresh start. */
const startChat = () => setQuery({ example: undefined, chat: undefined, n: String(Date.now()) })

/**
 * One chat. Its time sits on the right; on hover or focus, Rename and Delete fade in over the same
 * spot on a fade of the row's own colour, so nothing moves. On a touch screen they always show.
 */
function ThreadRow({
  thread,
  active,
  tabbable,
  snippet,
  onOpen,
  onDelete,
}: {
  thread: Thread
  active: boolean
  tabbable: boolean
  /** While searching: the line where the words matched, the match marked. */
  snippet?: Snippet
  onOpen: () => void
  onDelete: () => void
}) {
  const threadActions = useThreadActions()
  const [renaming, setRenaming] = React.useState(false)
  const leaving = useLeaving(thread.id)
  const row = React.useRef<HTMLLIElement>(null)
  const openButton = React.useRef<HTMLButtonElement>(null)

  const nameInput = React.useRef<HTMLInputElement>(null)
  // Rename can come from the touch menu, which is still closing: focus the field once it has.
  React.useEffect(() => {
    if (!renaming) return
    const t = window.setTimeout(() => {
      nameInput.current?.focus()
      nameInput.current?.select()
    }, 0)
    return () => window.clearTimeout(t)
  }, [renaming])

  const finishRename = (title?: string) => {
    if (title?.trim()) threadActions.rename(thread.id, title.trim())
    setRenaming(false)
    requestAnimationFrame(() => openButton.current?.focus())
  }

  const remove = () => {
    // Focus goes to the neighbouring chat, or to New chat when this was the last one.
    const li = row.current
    const next =
      li?.nextElementSibling?.querySelector<HTMLElement>('[data-open]') ??
      li?.previousElementSibling?.querySelector<HTMLElement>('[data-open]') ??
      li?.closest('[data-chats]')?.querySelector<HTMLElement>('[data-new-chat]')
    void leaveThen(thread.id, () => {
      onDelete()
      next?.focus()
    })
  }

  return (
    <li
      ref={row}
      data-active={active || undefined}
      data-leaving={leaving || undefined}
      className="group/row row-presence"
    >
      <div className="relative min-h-0 overflow-hidden rounded-md bg-(--row) [--row:var(--background)] group-data-active/row:shadow-hairline group-data-active/row:[--row:var(--muted)] hover:[--row:var(--row-hover)]">
        {renaming ? (
          <Input
            ref={nameInput}
            defaultValue={thread.title}
            aria-label="Chat name"
            className="h-9 rounded-md px-2.5 text-sm"
            onBlur={(e) => finishRename(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finishRename(e.currentTarget.value)
              if (e.key === 'Escape') {
                e.stopPropagation()
                finishRename()
              }
            }}
          />
        ) : (
          <>
            <button
              ref={openButton}
              type="button"
              data-open
              // The list is one stop: arrows move through the chats, F2 renames, Delete deletes.
              tabIndex={tabbable ? 0 : -1}
              aria-current={active ? 'page' : undefined}
              aria-keyshortcuts="F2 Delete"
              aria-describedby="chat-keys"
              onClick={onOpen}
              onKeyDown={(e) => {
                if (e.key === 'F2') {
                  e.preventDefault()
                  setRenaming(true)
                } else if (e.key === 'Delete') {
                  e.preventDefault()
                  remove()
                } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  const rows = [
                    ...(row.current?.closest('nav')?.querySelectorAll<HTMLElement>('[data-open]') ??
                      []),
                  ]
                  const i = rows.indexOf(e.currentTarget)
                  rows[
                    Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))
                  ]?.focus()
                }
              }}
              title={thread.title}
              className="flex min-h-9 w-full flex-wrap items-center gap-x-2 rounded-md py-1.5 pr-2 pl-2.5 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <TruncatedText text={thread.title} className="min-w-0 flex-1" />
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums transition-opacity duration-(--dur-2) group-focus-within/row:opacity-0 group-hover/row:opacity-0 [@media(hover:none)]:opacity-0">
                {thread.time}
              </span>
              {snippet && (
                <span className="basis-full truncate text-xs text-muted-foreground">
                  {snippet.before}
                  <mark className="rounded-xs bg-primary/15 px-px text-foreground">
                    {snippet.hit}
                  </mark>
                  {snippet.after}
                </span>
              )}
            </button>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 bg-linear-to-l from-(--row) from-65% to-transparent pr-1 pl-7 opacity-0 transition-opacity duration-(--dur-2) group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100 group-hover/row:pointer-events-auto group-hover/row:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
              <div className="flex items-center gap-0.5 [@media(hover:none)]:hidden">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        tabIndex={-1}
                        aria-label={`Rename ${thread.title}`}
                        className="hover:bg-foreground/8"
                        onClick={() => setRenaming(true)}
                      />
                    }
                  >
                    <PencilIcon />
                  </TooltipTrigger>
                  <TooltipContent>Rename</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        tabIndex={-1}
                        aria-label={`Delete ${thread.title}`}
                        className="hover:bg-foreground/8"
                        onClick={remove}
                      />
                    }
                  >
                    <Trash2Icon />
                  </TooltipTrigger>
                  <TooltipContent>Delete</TooltipContent>
                </Tooltip>
              </div>
              {/* No hover on a touch screen: one menu instead of two buttons, so the title keeps its room. */}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`More for ${thread.title}`}
                      className="hidden hover:bg-foreground/8 [@media(hover:none)]:inline-flex"
                    />
                  }
                >
                  <EllipsisIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36" finalFocus={false}>
                  <DropdownMenuItem onClick={() => setRenaming(true)}>
                    <PencilIcon />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={remove}>
                    <Trash2Icon />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        )}
      </div>
    </li>
  )
}

/** The folded history: a slim rail whose toggle sits exactly where Hide history was. */
function HistoryRail({ onShow }: { onShow: (focusSearch?: boolean) => void }) {
  return (
    <div className="flex h-full flex-col gap-1 px-2 pt-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Show history"
              className="size-9"
              onClick={() => onShow()}
            />
          }
        >
          <PanelLeftOpenIcon />
        </TooltipTrigger>
        <TooltipContent side="right">
          Show history <Kbd>{HISTORY_KEY}</Kbd>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="New chat"
              className="size-9"
              onClick={startChat}
            />
          }
        >
          <SquarePenIcon />
        </TooltipTrigger>
        <TooltipContent side="right">New chat</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Search chats"
              className="size-9"
              onClick={() => onShow(true)}
            />
          }
        >
          <SearchIcon />
        </TooltipTrigger>
        <TooltipContent side="right">Search chats</TooltipContent>
      </Tooltip>
    </div>
  )
}

type Snippet = { before: string; hit: string; after: string }

/** The words around a match, for one line: "…sales to Norway stopped after a new [customs] rule…". */
function snippetOf(text: string, q: string): Snippet | undefined {
  const at = text.toLowerCase().indexOf(q)
  if (at < 0) return undefined
  const from = Math.max(0, text.lastIndexOf(' ', Math.max(0, at - 14)) + 1)
  return {
    before: (from > 0 ? '…' : '') + text.slice(from, at),
    hit: text.slice(at, at + q.length),
    after: text.slice(at + q.length, at + q.length + 60),
  }
}

/** The chats beside the thread: New chat and search pinned on top, then the chats by day. */
function ThreadList({
  current,
  live,
  onPick,
  onHide,
  onOpenChat,
  onNewChat,
}: {
  current?: string | null
  /** What the open chat has said so far, follow-ups included. */
  live?: string
  onPick?: () => void
  onHide?: () => void
  /** Where a chat opens, when not in Ask itself (the dock). */
  onOpenChat?: (t: Thread) => void
  onNewChat?: () => void
}) {
  const all = useThreads()
  const { fresh } = useSession()
  const threadActions = useThreadActions()
  const [search, setSearch] = React.useState('')
  const visible = fresh ? all.filter((t) => !t.seed) : all
  const q = search.trim().toLowerCase()
  // Search reads what was asked and what the answers said, the open chat's latest turns too, not only the title.
  const body = (t: Thread) =>
    `${t.question} ${t.preview}${t.id === current && live ? ` ${live.replace(/\[\d+\]/g, '')}` : ''}`
  const shown = visible.filter((t) => `${t.title} ${body(t)}`.toLowerCase().includes(q))
  // The line that matched, unless the title already shows it.
  const snippet = (t: Thread) =>
    q && !t.title.toLowerCase().includes(q) ? snippetOf(body(t), q) : undefined

  const startNew = () => {
    if (onNewChat) onNewChat()
    else startChat()
    onPick?.()
  }
  const open = (t: Thread) => {
    if (onOpenChat) onOpenChat(t)
    else
      setQuery(
        t.example
          ? { example: t.example, chat: undefined, n: undefined }
          : { example: undefined, chat: t.id, n: t.id },
      )
    onPick?.()
  }
  const remove = async (t: Thread) => {
    const undo = await threadActions.remove(t.id)
    if (current === t.id) startChat()
    toast('Chat deleted', {
      description: t.title,
      action: { label: 'Undo', onClick: () => threadActions.undo(undo) },
    })
  }

  return (
    <div data-chats className="group/chats flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 px-2 pt-2 pb-1">
        <div className="flex items-center gap-1">
          {onHide && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Hide history"
                    className="size-9"
                    onClick={onHide}
                  />
                }
              >
                <PanelLeftCloseIcon />
              </TooltipTrigger>
              <TooltipContent>
                Hide history <Kbd>{HISTORY_KEY}</Kbd>
              </TooltipContent>
            </Tooltip>
          )}
          <Button
            data-new-chat
            variant="ghost"
            className="h-9 flex-1 justify-start gap-2 px-2.5"
            onClick={startNew}
          >
            <SquarePenIcon />
            New chat
          </Button>
        </div>
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && search && (e.stopPropagation(), setSearch(''))}
            placeholder="Search chats"
            aria-label="Search chats"
            data-search-chats
            className="h-8 pr-8 pl-8 text-sm"
          />
          {search && (
            <button
              type="button"
              aria-label="Clear the search"
              onClick={() => setSearch('')}
              className="absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      <nav aria-label="Chats" className="min-h-0 flex-1 overflow-y-auto fade-in-top px-2 pb-3">
        {visible.length === 0 ? (
          <div className="px-2.5 pt-5 text-sm">
            <p className="font-medium">No chats yet</p>
            <p className="mt-1 text-muted-foreground">
              Your questions here show up in this list, and only you see them. From agents, only
              what a question was about and how often is kept, never the words or who asked.
            </p>
          </div>
        ) : shown.length === 0 ? (
          <div className="px-2.5 pt-5 text-sm">
            <p className="break-words text-muted-foreground">No chats match “{search.trim()}”.</p>
            <Button
              variant="link"
              className="mt-1 h-auto p-0 text-sm"
              onClick={() => setSearch('')}
            >
              Clear the search
            </Button>
          </div>
        ) : (
          DAYS.map((day) => {
            const items = shown.filter((t) => t.day === day)
            if (!items.length) return null
            return (
              <section key={day} aria-labelledby={`chats-${day}`} className="pt-3 first:pt-2">
                <h2
                  id={`chats-${day}`}
                  className="px-2.5 pb-1.5 text-dense leading-none font-semibold tracking-wide text-muted-foreground all-small-caps"
                >
                  {day}
                </h2>
                <ul ref={arriveRef} className="flex flex-col gap-px">
                  {items.map((t) => (
                    <ThreadRow
                      key={t.id}
                      thread={t}
                      active={current === t.id}
                      tabbable={
                        current
                          ? current === t.id ||
                            (!shown.some((x) => x.id === current) && t.id === shown[0]?.id)
                          : t.id === shown[0]?.id
                      }
                      snippet={snippet(t)}
                      onOpen={() => open(t)}
                      onDelete={() => void remove(t)}
                    />
                  ))}
                </ul>
              </section>
            )
          })
        )}
      </nav>
      {/* What is kept, said once where the chats are; while a chat has keyboard focus, the keys instead. */}
      <p className="flex h-bar shrink-0 items-center border-t px-4 text-xs leading-4 text-muted-foreground group-has-[[data-open]:focus-visible]/chats:hidden">
        Only you see these chats. Agents' questions are kept as counts.
      </p>
      <p
        id="chat-keys"
        className="hidden h-bar shrink-0 flex-wrap content-center items-center gap-x-2.5 gap-y-1 border-t px-4 text-xs text-muted-foreground group-has-[[data-open]:focus-visible]/chats:flex"
      >
        <span>
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
        </span>
        <span>
          <Kbd>F2</Kbd> rename
        </span>
        <span>
          <Kbd>Delete</Kbd> delete
        </span>
      </p>
    </div>
  )
}

export function AskPage() {
  const { query } = useRoute()
  const isMobile = useIsMobile()
  const example = query.get('example')
  const chat = query.get('chat')
  const n = query.get('n')
  const threads = useThreads()
  const asked = findThread(threads, chat)?.question
  // The chat a first question in this thread started: the thread already shows it. Opening it from
  // the history changes `n`, and then its first answer is read like any other chat's.
  const [started, setStarted] = React.useState<{ chat: string; n: string | null }>()
  const showing = !!chat && started?.chat === chat && started.n === n
  // An example or a chat opens on its first answer, which is read before the thread shows. Each read
  // is a look-up, so the chat on show is not read again, nor when the window regains focus.
  const first = useQuery({
    ...askQuery(example ? { example } : { question: asked ?? '' }),
    enabled: !!example || (!!asked && !showing),
    refetchOnWindowFocus: false,
  })
  const initial = React.useMemo(() => (first.data ? [first.data] : []), [first.data])
  const [sheet, setSheet] = React.useState(false)
  const [live, setLive] = React.useState('')
  const [collapsed, setCollapsedState] = React.useState(
    () => readWidth('ask-chats-hidden', 0) === 1,
  )
  const setCollapsed = React.useCallback((c: boolean) => {
    setCollapsedState(c)
    saveWidth('ask-chats-hidden', c ? 1 : 0)
  }, [])
  const show = (focusSearch?: boolean) => {
    setCollapsed(false)
    if (focusSearch)
      window.setTimeout(
        () => document.querySelector<HTMLElement>('#ask-chats [data-search-chats]')?.focus(),
        reducedMotion() ? 0 : 200,
      )
  }

  // Option-H shows and hides the history, on a phone as the sheet.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.code !== 'KeyH') return
      e.preventDefault()
      if (isMobile) setSheet((o) => !o)
      else setCollapsed(!collapsed)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isMobile, collapsed, setCollapsed])

  // A new chat joins the list with its first question. The thread stays mounted: only an opened
  // chat or New chat changes `n`, which is what starts a thread afresh.
  const write = useWrite()
  const threadActions = useThreadActions()
  // A starter already asked opens that chat, so the history never gets the same question twice.
  const openExisting = (question: string) => {
    const t = threads.find((x) => x.question.toLowerCase() === question.toLowerCase())
    if (!t) return false
    setQuery(
      t.example
        ? { example: t.example, chat: undefined, n: undefined }
        : { example: undefined, chat: t.id, n: t.id },
    )
    return true
  }
  const setup = query.get('setup')
  const onFirstAsk = (q: string) => {
    const id = `chat-${n ?? Date.now()}`
    setStarted({ chat: id, n })
    threadActions.add(id, q)
    setQuery({ chat: id, setup: undefined, q: undefined })
    // The setup step "Ask a question about it" is done by asking one.
    if (setup) {
      void write('completeSetupStep', { step: 'ask' })
      toast('Asked your first question', {
        description: 'This is what agents get from what you wrote.',
        action: { label: 'Back to setup', onClick: () => navigate('/inbox') },
      })
    }
  }

  return (
    <div data-touch-targets className="flex h-full min-h-0 flex-col">
      <SiteHeader title="Ask" icon={<MessageSquareIcon />}>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                aria-label="History"
                aria-expanded={isMobile ? sheet : !collapsed}
                aria-controls={isMobile ? undefined : 'ask-chats'}
                className="max-lg:w-7 max-lg:px-0"
                onClick={() => (isMobile ? setSheet(true) : setCollapsed(!collapsed))}
              />
            }
          >
            <HistoryIcon />
            <span className="max-lg:hidden">History</span>
          </TooltipTrigger>
          <TooltipContent>
            {isMobile ? 'History' : collapsed ? 'Show history' : 'Hide history'}{' '}
            <Kbd>{HISTORY_KEY}</Kbd>
          </TooltipContent>
        </Tooltip>
        {/* The history has New chat; on a phone, where the history is a sheet, the header has it too. */}
        {isMobile && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="New chat"
                  onClick={startChat}
                />
              }
            >
              <SquarePenIcon />
            </TooltipTrigger>
            <TooltipContent>New chat</TooltipContent>
          </Tooltip>
        )}
      </SiteHeader>
      <div className="flex min-h-0 flex-1">
        <div id="ask-chats" className="hidden md:contents">
          <ResizableAside
            side="left"
            storageKey="ask-chats"
            defaultWidth={272}
            min={220}
            max={400}
            label="History"
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
            rail={<HistoryRail onShow={show} />}
            railWidth={52}
            className="border-r"
          >
            <ThreadList current={example ?? chat} live={live} onHide={() => setCollapsed(true)} />
          </ResizableAside>
        </div>
        <div className="min-h-0 min-w-0 flex-1">
          {/* An example or a chat opens on its first answer, so the thread waits for it; a chat
              started here by asking is already showing it. */}
          {(first.data || (!example && (!asked || showing))) && (
            <AskChat
              key={example ? `e-${example}` : `c-${n ?? ''}`}
              initial={initial}
              prefill={query.get('q') ?? undefined}
              onFirstAsk={example || asked ? undefined : onFirstAsk}
              onStarter={openExisting}
              onTurns={setLive}
            />
          )}
        </div>
      </div>
      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent side="left" className="w-popover-phone gap-0 bg-background p-0">
          <SheetHeader className="border-b">
            <SheetTitle>History</SheetTitle>
          </SheetHeader>
          <ThreadList current={example ?? chat} live={live} onPick={() => setSheet(false)} />
        </SheetContent>
      </Sheet>
    </div>
  )
}

export function AskDock() {
  // A quick view's "Try it with a question" opens Ask with the question typed in, not yet sent.
  const { query } = useRoute()
  const q = query.get('q') ?? undefined
  // The dock keeps its own chat: History opens one here, New chat starts afresh, and a first question joins the history.
  const [chat, setChat] = React.useState<{ key: string; initial: Answer[]; id?: string }>({
    key: 'new',
    initial: [],
  })
  const [history, setHistory] = React.useState(false)
  const queryClient = useQueryClient()
  const threadActions = useThreadActions()
  const newChat = () => setChat({ key: `new-${Date.now()}`, initial: [] })
  const openChat = async (t: Thread) => {
    const answer = await queryClient.fetchQuery(askQuery(firstAsk(t)))
    setChat({ key: t.id, id: t.id, initial: [answer] })
    setHistory(false)
  }
  return (
    <DockFrame
      title="Ask"
      actions={
        <>
          <Popover open={history} onOpenChange={setHistory}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <PopoverTrigger
                    render={<Button variant="ghost" size="icon" aria-label="History" />}
                  />
                }
              >
                <HistoryIcon />
              </TooltipTrigger>
              <TooltipContent>History</TooltipContent>
            </Tooltip>
            <PopoverContent align="end" aria-label="History" className="h-history w-72 p-0">
              <ThreadList
                current={chat.id}
                onOpenChat={(t) => void openChat(t)}
                onNewChat={() => (newChat(), setHistory(false))}
              />
            </PopoverContent>
          </Popover>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon" aria-label="New chat" onClick={newChat} />
              }
            >
              <SquarePenIcon />
            </TooltipTrigger>
            <TooltipContent>New chat</TooltipContent>
          </Tooltip>
        </>
      }
    >
      <AskChat
        key={`${q}-${chat.key}`}
        compact
        initial={chat.initial}
        prefill={chat.initial.length ? undefined : q}
        onFirstAsk={
          chat.initial.length
            ? undefined
            : (question) => threadActions.add(`chat-dock-${Date.now()}`, question)
        }
      />
    </DockFrame>
  )
}

/** Try it: Ask against a suggestion's draft, before agents get it. */
export function TryIt({ cardId, embedded }: { cardId?: string; embedded?: boolean }) {
  const { cards } = useInbox()
  const card = cards.find((c) => c.id === cardId)
  const editorDraft = useDraft()
  const draft = cardId === 'editor' ? (editorDraft ?? undefined) : card?.suggestion?.draft
  const hasDraft = !!draft
  const initial = React.useMemo(() => {
    if (!draft) return []
    const question =
      cardId === 'editor'
        ? `What should I know about ${draft.where[0]?.toLowerCase() ?? 'this'}${draft.where[1] ? ` in ${draft.where[1]}` : ''}?`
        : card?.id === 'sug-agent'
          ? 'Why are Poland orders low this week?'
          : card?.id === 'sug-jon'
            ? 'Why is return on ad spend in Norway empty since May?'
            : 'How many test accounts does units sold leave out in Norway?'
    return [
      {
        id: 'try',
        question,
        metric: draft.where[0] ?? 'Orders',
        markets: [draft.where[1] ?? 'Norway'],
        state: 'grounded' as const,
        text: `${draft.summary
          .split(/(?<=\.)\s/)
          .slice(0, 2)
          .join(' ')} [1]`,
        sources: [draft.id],
        said: `1 context item applies to ${draft.where.join(' in ')}. Only that was checked.`,
      },
    ]
    // The draft is read once it exists, when Try it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, hasDraft])
  const chat = (
    <AskChat
      key={`${cardId}-${!!draft}`}
      initial={initial}
      draft={draft}
      compact
      stageFirst={`try:${cardId}:${!!draft}`}
    />
  )
  if (embedded) return chat
  return <DockFrame title="Try it">{chat}</DockFrame>
}
