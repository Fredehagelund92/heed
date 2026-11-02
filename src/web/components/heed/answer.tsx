import * as React from 'react'
import {
  ArrowLeftRightIcon,
  BookmarkIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleStopIcon,
  EllipsisIcon,
  FileTextIcon,
  FlagIcon,
  PencilIcon,
  RefreshCwIcon,
  ShareIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from '@/components/icons'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { marksExceptions } from '@/lib/marks'
import { TypeGlyph } from '@/components/heed/definition'
import { kindIcons } from '@/components/heed/kind-icons'
import { ComingSoon } from '@/components/heed/bits'
import { StateHelp } from '@/components/heed/state-help'
import { SharePopover } from '@/components/heed/share-answer'
import { recordsParts } from '@/components/heed/records-parts'
import { ReadingLine } from '@/components/heed/reading'
import { answerKey, keepShown } from '@/lib/shown-answers'
import { sentencesOf, type Sentence } from '@/lib/where'
import {
  ASK_CADENCE,
  useReveal,
  useShownStage,
  useStillLooking,
  type ShownStage,
} from '@/lib/ask-motion'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CopiedIcon, useCopied } from '@/components/heed/copied-icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  scopeText,
  type Answer,
  type AnswerLinks,
  type AskedDefinition,
  type QuestionPart,
} from '@/model/ask'
import { isLive, type Turn } from '@/model/ask-turn'
import { MentionChip } from '@/components/heed/mention-chip'
import type { Fact } from '@/model/items'
import { openDock, useDock } from '@/lib/dock'
import { href, useRoute } from '@/lib/router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ConflictPairCompact } from '@/components/heed/conflict-pair'
import {
  conflictQuery,
  definitionsPageQuery,
  figureQuery,
  myReportsQuery,
  useWrite,
} from '@/api/queries'
import { useDomains, useFacts, useMe } from '@/lib/workspace'
import { listOf } from '@/model/people'
import { SaveQuestion } from '@/components/obs/save-question'
import { agentReply } from '@/lib/agent-reply'
import { mentionId, parseMentionId, plainText, type MentionRef } from '@/lib/mentions'
import type { FigureView } from '@/model/figures'
import type { ConnectorId } from '@/model/integrations'
import { useFigures } from '@/lib/figures'
import { FigureAgainst, FigureLine, FigureLink, NoFigure } from '@/components/heed/answer-figure'
import { useRelated } from '@/hooks/use-related'
import { relLabel } from '@/lib/links'

// One turn of Ask, drawn the way the chat apps people know draw a thread: the question as a quiet
// muted bubble on the right, the answer as plain 16/26 text at a reading measure under its state
// badge, its sources as numbered chips with what was looked up beside them, and one row of icons
// under the answer, the rest in More.

function IconButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string
  onClick: () => void
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={active}
            onClick={onClick}
            className={cn(
              'size-7 text-muted-foreground hover:text-foreground pointer-coarse:size-9',
              active && 'bg-accent text-foreground',
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/* ---------- the question ---------- */

/** True when the question was read as something its words don't say: a synonym, a metric or market it doesn't name, or dates it doesn't give. */
function readDifferently(answer: Answer) {
  const q = answer.question.toLowerCase()
  const month = answer.dates?.match(/[A-Z][a-z]{2}/)?.[0]?.toLowerCase()
  return (
    !!answer.alias ||
    !q.includes(answer.metric.toLowerCase()) ||
    answer.markets.some((m) => !q.includes(m.toLowerCase())) ||
    (!!answer.dates && !(month && q.includes(month)))
  )
}

export function Question({
  answer,
  onRescope,
  onEdit,
}: {
  answer: Answer
  onRescope?: (parts: QuestionPart[]) => void
  onEdit?: (parts: QuestionPart[]) => void
}) {
  const [copied, copy] = useCopied()
  // Scoped with '@', the answer's header says how; otherwise one quiet line, only when the reading differs from the words.
  const showReadAs = !answer.scope?.length && !!scopeText(answer) && readDifferently(answer)
  return (
    <div className="group/q flex flex-col items-end gap-2">
      <div className="max-w-22/25 min-w-0 rounded-surface bg-muted px-4 py-2.5 text-base leading-chat wrap-anywhere whitespace-pre-line @lg:max-w-4/5 [&_.mention-chip]:bg-background">
        {answer.parts
          ? answer.parts.map((p, i) =>
              typeof p === 'string' ? (
                <React.Fragment key={i}>{p}</React.Fragment>
              ) : (
                <MentionChip key={i} mention={p} />
              ),
            )
          : answer.question}
      </div>
      {/* Copy, and Edit to put the question back in the box: under the bubble, so it keeps its width; always there on a touch screen. */}
      <div className="-my-1 flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover/q:opacity-100 focus-within:opacity-100 pointer-coarse:gap-2.5 pointer-coarse:opacity-100">
        <IconButton
          label="Copy"
          onClick={() => {
            copy(answer.question)
            toast('Copied')
          }}
        >
          <CopiedIcon copied={copied} />
        </IconButton>
        {onEdit && (
          <IconButton
            label="Edit and ask again"
            onClick={() => onEdit(answer.parts ?? [answer.question])}
          >
            <PencilIcon />
          </IconButton>
        )}
      </div>
      {showReadAs && (
        <p className="flex flex-wrap items-center justify-end gap-x-2 text-xs text-muted-foreground">
          <span>Understood as {scopeText(answer)}</span>
          {onRescope && (
            <button
              type="button"
              className="rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={() =>
                onRescope([`${answer.question} `, ...readScope(answer).flatMap((m) => [m, ' '])])
              }
            >
              Change it
            </button>
          )}
        </p>
      )}
    </div>
  )
}

/** A reading as mentions, to put back in the box: the metric and each market. */
function readScope(answer: Answer): MentionRef[] {
  return [
    ...(answer.metric ? [{ id: mentionId('metric', answer.metric), label: answer.metric }] : []),
    ...answer.markets.map((m) => ({ id: mentionId('market', m), label: m })),
  ]
}

/** How a scoped question was read: its mentions, and what came from the words, said once in the answer's header. */
function ScopeLine({ answer }: { answer: Answer }) {
  const domains = useDomains()
  const scope = answer.scope ?? []
  if (!scope.length) return null
  const kinds = scope.map((m) => parseMentionId(m.id).kind)
  const fromWords = [
    !kinds.some((k) => k === 'metric' || k === 'term' || k === 'context') && answer.metric,
    !kinds.some((k) => k === 'market' || k === 'context') && answer.markets.join(' and '),
  ].filter(Boolean)
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-dense leading-6 text-muted-foreground">
      <span>Scoped to</span>
      {scope.map((m) => (
        <MentionChip key={m.id} mention={m} />
      ))}
      {fromWords.length > 0 && <span>- the rest read as {fromWords.join(' in ')}</span>}
      {/* A scoped domain says what it covers, in its owners' words. */}
      {scope
        .map((m) => parseMentionId(m.id))
        .filter((m) => m.kind === 'domain' && domains[m.key])
        .map((m) => (
          <span key={m.key} className="basis-full text-xs leading-5">
            {domains[m.key]?.name}: {domains[m.key]?.covers}
          </span>
        ))}
    </p>
  )
}

/* ---------- what Heed looked up ---------- */

/** An answer that says nothing of links follows none. */
const NO_LINKS: AnswerLinks = { on: true, followed: [], notFollowed: [] }

/**
 * What the look-up is doing, then what it did. While it works, one line where the state line will
 * be; once the answer is in, a quiet line at the end of the sources row (`children`, the chips) that
 * opens What agents get.
 */
function LookupCard({
  answer,
  facts,
  turn,
  shown,
  children,
}: {
  answer: Answer
  facts: Fact[]
  turn: Turn
  /** The stage on screen: the look-up's own steps, each label held long enough to read. */
  shown: ShownStage
  children?: React.ReactNode
}) {
  const { stage, stopped } = turn
  const answered = shown === 'answered'
  const scope = scopeText(answer) || 'Nothing matched'
  const raw = agentReply(answer, facts)
  // Looking up and reading come from the look-up's own steps, until its answer is in.
  const running = !stopped && !answered
  const still = useStillLooking(running && shown === 'looking')
  const found = turn.found ?? 0
  // What the agent followed with get_related, as the answer says: one step each, never a retired target.
  const { followed, notFollowed, on: enabled } = answer.links ?? NO_LINKS
  const n = followed.length
  const linkWords = !facts.length
    ? ''
    : !enabled
      ? ", didn't follow links"
      : n
        ? `, followed ${n} ${n === 1 ? 'link' : 'links'}`
        : ''
  // One quiet line that says what the look-up is doing; opened, the card in the chat's soft surface.
  // A look-up that answers within moments shows none: the answer comes instead.
  if (shown === 'quiet' && !stopped) return null
  const line =
    stopped && !answered
      ? stage === 'looking'
        ? 'Stopped while looking up'
        : 'Stopped while reading'
      : running
        ? shown === 'looking'
          ? still
            ? 'Still looking up…'
            : 'Looking up context…'
          : found
            ? `Reading ${found} context ${found === 1 ? 'item' : 'items'}…`
            : 'Found no context items'
        : answer.state === null
          ? 'Nothing was looked up'
          : answer.state === 'failed'
            ? 'The look-up failed'
            : facts.length
              ? `Looked up ${facts.length} context ${facts.length === 1 ? 'item' : 'items'}${linkWords}`
              : 'Looked up: no context items'
  if (!answered)
    return (
      <p className="flex min-h-6 items-center">
        <ReadingLine running={running} className="text-sm">
          {line}
        </ReadingLine>
      </p>
    )
  return (
    <Collapsible className="flex flex-col gap-2 text-sm">
      {/* On a touch screen the rows sit a finger apart: 24 px chips 20 px apart. */}
      <div className="flex flex-wrap items-center gap-1.5 pointer-coarse:gap-y-5">
        {children}
        <CollapsibleTrigger className="group/lookup inline-flex h-6 items-center gap-1 rounded-sm px-1 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
          {line}
          <ChevronDownIcon
            className="size-3.5 shrink-0 transition-transform group-aria-expanded/lookup:rotate-180"
            aria-hidden
          />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="flex max-w-reading flex-col gap-2 rounded-frame border bg-background px-3.5 py-3 text-muted-foreground">
          <p className="text-xs font-medium text-foreground">What agents get</p>
          <p>
            <span className="text-foreground">Read:</span> {scope}.
          </p>
          <p>
            <span className="text-foreground">Told the agent:</span> “{answer.said}”
          </p>
          {facts.length > 0 && (
            <p>
              The agent got each context item with its source, who checked it, and its “don't
              conclude” line.
            </p>
          )}
          {answer.leftOut && (
            <p>
              <span className="text-foreground">Left out:</span> {answer.leftOut}
            </p>
          )}
          {/* The links it followed with get_related: one step, where each led, and what it left alone. */}
          {facts.length > 0 && !enabled && (
            <p>It didn't follow any links: following links is switched off in Agents and access.</p>
          )}
          {(n > 0 || notFollowed.length > 0) && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-foreground">Links it followed, one step</p>
              <ul className="flex flex-col gap-2">
                {followed.map((f) => (
                  <li key={`${f.from.id}>${f.to.id}`} className="flex flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
                      <span className="line-clamp-1 max-w-56">{f.from.title}</span>
                      <span>{relLabel[f.rel]}</span>
                      <MentionChip mention={f.to} />
                    </span>
                    <span className="line-clamp-2 border-l-2 pl-2 text-xs">{f.read}</span>
                  </li>
                ))}
                {notFollowed.map((f) => (
                  <li
                    key={`${f.from.id}>${f.to.id}`}
                    className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs"
                  >
                    <MentionChip mention={f.to} />
                    <span>no longer available, not followed</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs">
                It follows one step, never a link from a link, and it never changes which context
                the answer used.
              </p>
            </div>
          )}
          <Collapsible>
            <CollapsibleTrigger className="group/dev mt-1 inline-flex items-center gap-1 rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
              Developer details
              <ChevronDownIcon
                className="size-3 transition-transform group-aria-expanded/dev:rotate-180"
                aria-hidden
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p className="mt-2 text-xs">
                Tool <span className="font-mono text-foreground">get_context</span>
              </p>
              <pre className="mt-1 overflow-x-auto rounded-md bg-muted/50 p-2.5 font-mono text-xs leading-relaxed text-foreground/90">
                {JSON.stringify(raw, null, 2)}
              </pre>
              {n > 0 && (
                <>
                  <p className="mt-2 text-xs">
                    Tool <span className="font-mono text-foreground">get_related</span>
                  </p>
                  <pre className="mt-1 overflow-x-auto rounded-md bg-muted/50 p-2.5 font-mono text-xs leading-relaxed text-foreground/90">
                    {JSON.stringify(
                      {
                        depth: 1,
                        nodes: followed.map((f) => ({
                          id: f.to.id,
                          label: f.to.label,
                          rel: f.rel,
                          from: `context:${f.from.id}`,
                        })),
                        not_followed: notFollowed.map((f) => ({
                          id: f.to.id,
                          status: 'retired',
                        })),
                      },
                      null,
                      2,
                    )}
                  </pre>
                </>
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/* ---------- the answer ---------- */

/** One citation: a small marker; hovered or pressed, a card with the context item and a way to open it. */
function Citation({ n, fact, draft }: { n: number; fact?: Fact; draft?: boolean }) {
  const marker =
    // 24px to see, 44px to tap: the hit area grows, the marker doesn't.
    'relative ml-0.5 mr-px inline-flex h-6 min-w-6 -translate-y-px items-center justify-center rounded-md bg-muted px-1.5 align-middle text-xs font-medium text-foreground tabular-nums outline-none after:absolute after:-inset-[13px] hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50'
  if (!fact || draft)
    return (
      <span className={marker} aria-label={`Source ${n}`}>
        {n}
      </span>
    )
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={120}
        closeDelay={80}
        render={
          <button type="button" className={marker} aria-label={`Source ${n}: ${fact.title}`} />
        }
      >
        {n}
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 gap-1.5 p-3">
        <SourceCard fact={fact} />
      </PopoverContent>
    </Popover>
  )
}

/** A source's card, from its marker or its chip: the item, who checked it and when, and a way to open it. */
function SourceCard({ fact }: { fact: Fact }) {
  const domains = useDomains()
  return (
    <>
      <p className="text-sm leading-snug font-medium">{fact.title}</p>
      <p className="text-xs text-muted-foreground">
        {domains[fact.domain]?.name} - checked by {fact.checkedBy}, {fact.checkedOn}
      </p>
      <p className="line-clamp-3 text-sm text-muted-foreground">{plainText(fact.summary)}</p>
      <SourceLinks fact={fact} />
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 w-fit text-primary"
        onClick={() => openDock('context', fact.id)}
      >
        Open it
      </Button>
    </>
  )
}

/** In a source's card: the links an agent can follow from it, a retired one marked. */
function SourceLinks({ fact }: { fact: Fact }) {
  const related = useRelated(`context:${fact.id}`)
  const enabled = related.following
  const links = related.links.filter((l) => l.rel !== 'mentioned_by' && l.rel !== 'replaced_by')
  if (!links.length) return null
  return (
    <div className="flex flex-col gap-1 border-t pt-1.5">
      <p className="text-xs text-muted-foreground">
        {enabled ? 'Links an agent can follow from it' : "Links (agents don't follow them now)"}
      </p>
      <p className="flex flex-wrap items-center gap-1">
        {links.slice(0, 4).map((l) => (
          <MentionChip key={l.to.id} mention={{ id: l.to.id, label: l.to.label }} />
        ))}
        {links.length > 4 && (
          <span className="text-xs text-muted-foreground">+{links.length - 4}</span>
        )}
      </p>
    </div>
  )
}

/**
 * Which sentences come from the items that disagree (`conflict`, their ids): each is marked as
 * words that differ, unless every sentence would be, when none is.
 */
function differingSentences(
  sentences: ReturnType<typeof sentencesOf>,
  facts: Fact[],
  conflict: string[] | undefined,
) {
  const differs = sentences.map((s) =>
    s.cites.some((n) => !!conflict?.includes(facts[n - 1]?.id ?? '')),
  )
  return marksExceptions(differs, (d) => d) ? differs : differs.map(() => false)
}

/**
 * A finished answer's sentences, each one a way to see where it says that: selected, the right panel
 * walks it back to its context item and the source line. Its numbers stay as markers inside it.
 * In a conflict, the sentences from the items that disagree (`conflict`, their ids) are marked as
 * the ones that differ, unless every sentence is.
 */
/** How a word comes in as it is revealed: a fade, none with reduced motion (the tokens). */
const wordIn = 'animate-in fade-in-0 duration-(--ask-word-fade)'
/** How a sentence comes in whole (`ASK_CADENCE` sentences): a fade, none with reduced motion. */
const sentenceIn = 'animate-in fade-in-0 duration-(--dur-3)'

/**
 * An answer's words, the same from its first revealed word to the finished answer, so nothing is
 * drawn again when it ends. Only the first `revealed` characters show, word by word; a sentence's
 * citation markers come with its last word. With `where`, once finished, each sentence opens where
 * it says that in the right panel; and the sentences from two items that disagree sit together
 * behind an amber rule, as they arrive.
 */
function AnswerWords({
  sentences,
  revealed,
  facts,
  conflict,
  answerId,
  where,
  live,
  draft,
}: {
  sentences: Sentence[]
  revealed: number
  facts: Fact[]
  conflict?: string[]
  answerId: string
  /** Each sentence opens where it says that (not in a draft, or Ask in the right panel). */
  where: boolean
  /** Still being revealed: words fade in, and nothing opens yet. */
  live: boolean
  draft?: boolean
}) {
  const dock = useDock()
  const { query } = useRoute()
  const open = dock?.kind === 'where' && dock.id === answerId ? Number(query.get('wn')) || 1 : 0
  const show = (n: number) => openDock('where', answerId, { wn: String(n) })
  // Where each sentence's words end, counted over the sentences joined by spaces.
  const placed = sentences.reduce<
    (Sentence & { start: number; words: { word: string; end: number }[] })[]
  >((all, s) => {
    const prev = all.at(-1)
    const start = prev ? prev.start + prev.text.length + 1 : 0
    const words = [...s.text.matchAll(/\S+/g)].map((m) => ({
      word: m[0],
      end: start + m.index + m[0].length,
    }))
    return [...all, { ...s, start, words }]
  }, [])
  const shown = placed.filter((s) => s.words.length && s.words[0]!.end <= revealed)
  const marked = differingSentences(shown, facts, conflict)
  const first = marked.indexOf(true)
  const last = marked.lastIndexOf(true)
  const fade = ASK_CADENCE === 'words' ? wordIn : undefined
  const sentence = (s: (typeof placed)[number], i: number) => {
    const done = s.words.at(-1)!.end <= revealed
    const words = s.words.map((w, k) =>
      w.end <= revealed ? (
        <React.Fragment key={k}>
          {k > 0 && ' '}
          <span className={live ? fade : undefined}>{w.word}</span>
        </React.Fragment>
      ) : null,
    )
    const cites = done
      ? s.cites.map((n) =>
          where ? (
            <span
              key={n}
              aria-hidden
              className={cn(
                'ml-1 inline-flex h-5 min-w-5 -translate-y-px items-center justify-center rounded-md bg-muted px-1 align-middle text-xs font-medium text-foreground tabular-nums',
                live && fade,
              )}
            >
              {n}
            </span>
          ) : (
            <Citation key={n} n={n} fact={facts[n - 1]} draft={draft} />
          ),
        )
      : null
    const sentenceClass = live && ASK_CADENCE === 'sentences' ? sentenceIn : undefined
    if (!where)
      return (
        <span key={i} className={sentenceClass}>
          {words}
          {cites}
        </span>
      )
    const opens = !live && done
    return (
      <span
        key={i}
        role={opens ? 'button' : undefined}
        tabIndex={opens ? 0 : undefined}
        aria-pressed={opens ? open === i + 1 : undefined}
        onClick={opens ? () => show(i + 1) : undefined}
        onKeyDown={
          opens
            ? (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                show(i + 1)
              }
            : undefined
        }
        className={cn(
          sentenceClass,
          'rounded-mark box-decoration-clone transition-colors outline-none',
          opens &&
            'cursor-pointer hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-primary/12 dark:aria-pressed:bg-primary/25',
        )}
      >
        {words}
        {cites}
        {done && (
          <span className="sr-only">
            {s.cites.length
              ? `, from ${s.cites.map((n) => facts[n - 1]?.title ?? `source ${n}`).join(' and ')}`
              : ", Ask's own wording"}
            {marked[i] && ', which says something different from another item'}
          </span>
        )}
      </span>
    )
  }
  const run = (from: number, to: number) => (
    <p>
      {shown.slice(from, to).map((s, j) => (
        <React.Fragment key={from + j}>
          {j > 0 && ' '}
          {sentence(s, from + j)}
        </React.Fragment>
      ))}
    </p>
  )
  if (first < 0) return run(0, shown.length)
  return (
    <div className="flex flex-col gap-4">
      {first > 0 && run(0, first)}
      {/* The one mark on the sentences that differ: an amber rule, the words plain. The badge's card
          says which two items disagree. */}
      <div data-differ className="border-l-2 border-caution-icon pl-3.5">
        {run(first, last + 1)}
      </div>
      {last < shown.length - 1 && run(last + 1, shown.length)}
    </div>
  )
}

/** When a question used a Heed synonym: "You asked about turnover - this is Net revenue", opening the definition. */
function AliasChip({ alias }: { alias: NonNullable<Answer['alias']> }) {
  return (
    <button
      type="button"
      onClick={() => openDock('def', alias.is)}
      className="flex w-fit max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-lg border bg-background px-3 py-2 text-left text-sm transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <TypeGlyph d={{ type: 'term', sameAs: alias.is }} />
      <span className="text-muted-foreground">You asked about</span>
      <span>{alias.asked.toLowerCase()}</span>
      <span className="text-muted-foreground">- this is</span>
      <span className="inline-flex items-center gap-1 font-medium">
        <TypeGlyph d={{ type: alias.type }} className="text-foreground" />
        {alias.is}
      </span>
    </button>
  )
}

/**
 * One source under the words: the one chip, numbered as its markers, with its kind's icon and its
 * title. Hovered or focused, its card; pressed, the item opens in the right panel. An answer from a
 * draft has nothing to open.
 */
function SourceChip({
  n,
  fact,
  draft,
  card: hasCard = true,
}: {
  n: number
  fact: Fact
  draft?: boolean
  /** Its card on hover; off inside another card. */
  card?: boolean
}) {
  const [card, setCard] = React.useState(false)
  const Icon = kindIcons[fact.kind]
  const chip =
    'inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-sm bg-muted pr-2 pl-1.5 text-xs font-medium @lg:max-w-70'
  const label = (
    <>
      <span className="text-muted-foreground tabular-nums">{n}</span>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{fact.title}</span>
    </>
  )
  if (draft) return <span className={chip}>{label}</span>
  const press = cn(
    chip,
    'transition-colors outline-none hover:bg-foreground/10 focus-visible:ring-3 focus-visible:ring-ring/50',
  )
  if (!hasCard)
    return (
      <button
        type="button"
        aria-label={`Source ${n}: ${fact.title}`}
        onClick={() => openDock('context', fact.id)}
        className={press}
      >
        {label}
      </button>
    )
  return (
    <Popover
      open={card}
      // A press opens the item itself; the card is for a look on the way.
      onOpenChange={(open, { reason }) => reason !== 'trigger-press' && setCard(open)}
    >
      <PopoverTrigger
        openOnHover
        delay={120}
        closeDelay={80}
        render={
          <button
            type="button"
            aria-label={`Source ${n}: ${fact.title}`}
            onClick={() => openDock('context', fact.id)}
            className={press}
          />
        }
      >
        {label}
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 gap-1.5 p-3">
        <SourceCard fact={fact} />
      </PopoverContent>
    </Popover>
  )
}

/** The Something wrong? form: a flag, or a suggestion when a correction is given. */
/** What became of your report, in this chat only: sent, then what the owner did. */
function ReportLine({ report }: { report: NonNullable<Answer['report']> }) {
  return (
    <p
      role="status"
      className="flex animate-in items-start gap-2 text-sm text-muted-foreground duration-(--dur-4) fade-in-0"
    >
      <FlagIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {report.outcome ?? (
          <>
            You reported this {report.on}. The owner sees it in their Inbox; you'll see here what
            they do. Agents keep getting the item until it changes.
          </>
        )}
      </span>
    </p>
  )
}

function SomethingWrong({
  answer,
  facts,
  figure,
  onClose,
  onSent,
}: {
  answer: Answer
  facts: Fact[]
  /** The integration of the figure the answer shows, when it shows one. */
  figure?: ConnectorId
  onClose: () => void
  onSent: () => void
}) {
  const domains = useDomains()
  const write = useWrite()
  const figures = useFigures()
  const [part, setPart] = React.useState(facts[0]?.id ?? 'answer')
  const [sending, setSending] = React.useState(false)
  // The answer itself, and its figure, are filed on its first source, so they reach that
  // domain's owners; a figure reaches the integration's data contact too.
  const fact = facts.find((f) => f.id === part) ?? facts[0]
  const domain = fact?.domain ?? 'sales'
  const aboutFigure = part === 'figure' && figure !== undefined
  const owners = `the owner of ${domains[domain]?.name}`
  const to = aboutFigure ? `${owners} and to ${figures.contact(figure)}, the data contact,` : owners

  return (
    <form
      className="flex animate-in flex-col gap-4 rounded-surface border border-input bg-background p-4 duration-(--dur-3) fade-in-0 slide-in-from-top-1"
      onSubmit={(e) => {
        e.preventDefault()
        const form = new FormData(e.currentTarget)
        const text = (name: string) => {
          const value = form.get(name)
          return typeof value === 'string' ? value.trim() : ''
        }
        setSending(true)
        write('reportAnswer', {
          question: answer.question,
          part,
          sources: answer.sources,
          what: text('what'),
          correction: text('correction') || undefined,
          link: text('link') || undefined,
          ...(aboutFigure
            ? {
                figure: {
                  source: figure,
                  to: 'both' as const,
                  metric: answer.metric,
                  markets: answer.markets,
                  ...(answer.dates ? { dates: answer.dates } : {}),
                },
              }
            : {}),
        })
          .then(onSent)
          .catch(() =>
            toast.error("The report wasn't sent", {
              description: 'Nothing was lost: try again in a moment.',
            }),
          )
          .finally(() => setSending(false))
      }}
    >
      <div>
        <p className="text-sm font-medium">Something wrong?</p>
        <p className="text-sm text-muted-foreground">
          It goes to {to} with your words and this question. Nothing else from this chat is kept.
        </p>
      </div>
      <FieldGroup className="gap-4">
        <FieldSet>
          <FieldLegend variant="label">Which part?</FieldLegend>
          <RadioGroup value={part} onValueChange={(v) => setPart(v as string)}>
            {facts.map((f, i) => (
              <Field key={f.id} orientation="horizontal">
                <RadioGroupItem value={f.id} id={`part-${answer.id}-${f.id}`} />
                <Label htmlFor={`part-${answer.id}-${f.id}`} className="font-normal">
                  {i + 1}. {f.title}
                </Label>
              </Field>
            ))}
            {figure && (
              <Field orientation="horizontal">
                <RadioGroupItem value="figure" id={`part-${answer.id}-figure`} />
                <Label htmlFor={`part-${answer.id}-figure`} className="font-normal">
                  The figure: it doesn&apos;t fit the context
                </Label>
              </Field>
            )}
            <Field orientation="horizontal">
              <RadioGroupItem value="answer" id={`part-${answer.id}-answer`} />
              <Label htmlFor={`part-${answer.id}-answer`} className="font-normal">
                The answer itself
              </Label>
            </Field>
          </RadioGroup>
        </FieldSet>
        <Field>
          <FieldLabel htmlFor={`what-${answer.id}`}>What's wrong?</FieldLabel>
          <Textarea
            id={`what-${answer.id}`}
            name="what"
            defaultValue={answer.correction?.note}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`correct-${answer.id}`}>Correct version (optional)</FieldLabel>
          <Textarea
            id={`correct-${answer.id}`}
            name="correction"
            defaultValue={answer.correction?.correct}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`link-${answer.id}`}>Link (optional)</FieldLabel>
          <Input
            id={`link-${answer.id}`}
            name="link"
            type="url"
            defaultValue={answer.correction?.link}
            placeholder="https://"
          />
        </Field>
      </FieldGroup>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={sending}>
          {aboutFigure
            ? 'Send to the owner and the data contact'
            : `Send to the owner of ${domains[domain]?.name}`}
        </Button>
      </div>
    </form>
  )
}

/**
 * A question that looked nothing up: the three kinds of question Ask answers, in words, the names
 * closest to the question's words, and where every definition is listed. It suggests no question
 * to ask, and nothing here says whether anything is written down.
 */
function AskableKinds({ answer }: { answer: Answer }) {
  const close = answer.closest ?? []
  const definitions = useQuery(definitionsPageQuery()).data?.filter(
    (d) => !d.sameAs && (d.type === 'metric' || d.type === 'dimension'),
  )
  const metrics = definitions?.filter((d) => d.type === 'metric').length ?? 0
  const many = (n: number, one: string) =>
    `${n.toLocaleString('en-GB')} ${one}${n === 1 ? '' : 's'}`
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Ask answers three kinds of question: about a metric or a market, about the workspace&apos;s
        records, and about what Definitions lists. Type @ to scope one to a metric or a market.
      </p>
      {close.length > 0 && (
        <p className="text-sm text-muted-foreground">
          The names closest to your words: <span className="text-foreground">{listOf(close)}</span>.
        </p>
      )}
      {definitions && definitions.length > 0 && (
        <p className="text-sm text-muted-foreground">
          <a
            href="/definitions"
            className="rounded-sm font-medium text-foreground underline underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Definitions
          </a>{' '}
          lists {many(definitions.length, 'definition')}: {many(metrics, 'metric')} and{' '}
          {many(definitions.length - metrics, 'dimension')}.
        </p>
      )}
    </div>
  )
}

/**
 * What the definition source says a metric means, beside the answer, as agents get it with theirs
 * (FR-703). The source's own words, labelled as its; the state stays the context's.
 */
function AnswerDefinitions({ definitions }: { definitions: AskedDefinition[] }) {
  return (
    <div className="flex flex-col gap-2">
      {definitions.map((d) => (
        <figure
          key={d.name}
          className="flex flex-col gap-1 rounded-surface border bg-background px-3 py-2.5 text-sm"
        >
          <figcaption className="text-xs text-muted-foreground">
            <a
              href={`/definitions/${encodeURIComponent(d.name)}`}
              className="rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {d.name}
            </a>
            , as {d.tool} defines it
          </figcaption>
          {d.words ? (
            <blockquote className="text-pretty">{d.words}</blockquote>
          ) : (
            <p className="text-muted-foreground">{d.tool} gives no description of it.</p>
          )}
        </figure>
      ))}
    </div>
  )
}

/** The next step that fits the state: for the owner, or for everyone else. */
function NextStep({ answer, facts }: { answer: Answer; facts: Fact[] }) {
  const me = useMe()
  const write = useWrite()
  const owns = me.owns.includes('sales') || me.admin
  const scope = scopeText({ metric: answer.metric, markets: answer.markets.slice(-1) })
  const tellReason = React.useId()
  if (answer.state === 'missing' || answer.state === 'partial') {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {owns ? (
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={
              <a
                href={href('/context/new', {
                  metric: answer.metric,
                  market: answer.markets.at(-1),
                  dates: answer.dates,
                })}
              />
            }
          >
            <PencilIcon data-icon="inline-start" />
            Write context for {scope}
          </Button>
        ) : (
          // Not built yet: the button stays disabled where it will be, and the reason is text.
          <>
            <Button size="sm" variant="outline" aria-disabled aria-describedby={tellReason}>
              Tell the owner
              <ComingSoon />
            </Button>
            <span id={tellReason} className="text-xs text-muted-foreground">
              Sending this to the owner from here comes later.
            </span>
          </>
        )}
        {answer.times && (
          <span className="text-xs text-muted-foreground">
            Agents asked this {answer.times} times this week.
          </span>
        )}
      </div>
    )
  }
  // The two items that disagree, side by side, and the way to the comparison: never another item
  // the answer also gives.
  if (answer.state === 'conflict' && answer.conflict?.length === 2) {
    return <ConflictNextStep pairKey={answer.conflict.join('.')} />
  }
  if (answer.state === 'stale') {
    // An Outdated answer rests on at least one item.
    const f = facts.find((x) => x.outOfDate) ?? facts[0]!
    return owns ? (
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void write('editItem', {
              id: f.id,
              patch: {
                status: 'Live',
                outOfDate: undefined,
                checkedBy: me.name,
                checkedOn: '22 Oct 2026',
              },
            }).then(() =>
              toast('Checked: still true', {
                description: 'Agents get it without the warning from now on.',
              }),
            )
          }
        >
          Mark it still true
        </Button>
        <Button
          size="sm"
          variant="ghost"
          nativeButton={false}
          render={<a href={href(`/context/${f.id}/edit`)} />}
        >
          Edit
        </Button>
        <span className="basis-full text-xs text-muted-foreground">
          Its check date passed. Mark it still true if it is, and the warning goes.
        </span>
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">The owner has been reminded.</p>
    )
  }
  return null
}

/** Items that apply to the scope but not to this question: named, not used. One row each, 44px tall on a touch screen. */
function Related({ ids }: { ids: string[] }) {
  const all = useFacts()
  const items = ids.map((id) => all.find((f) => f.id === id)).filter((f): f is Fact => !!f)
  return (
    <div className="text-xs text-muted-foreground">
      <p>Also related, not used here:</p>
      <ul className="mt-0.5 flex flex-col pointer-coarse:gap-0.5">
        {items.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              className="flex min-h-7 items-center rounded-sm text-left text-foreground underline decoration-foreground/25 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-11"
              onClick={() => openDock('context', f.id)}
            >
              {f.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The note says what the answer shows of the numbers: shown, a link to them, or not shown here. */
function noteFor(note: string | undefined, view: FigureView | null) {
  if (!note) return note
  const numbers = /The numbers aren't shown here, so the (drop|change) itself isn't confirmed\./
  if (view?.kind === 'line' || view?.kind === 'against')
    return note.replace(numbers, '').trim() || undefined
  if (view?.kind === 'link')
    return note.replace(
      numbers,
      (_, w) => `This answer shows no figure, so the ${w} itself isn't confirmed here.`,
    )
  return note
}

type AnswerBodyProps = {
  /** The question and its answer, as far as the look-up has got. */
  turn: Turn
  draft?: Fact
  /** Ask is itself in the right panel: what would open there opens in place. */
  docked?: boolean
  onRetry?: () => void
  /** Told while the turn's words are still on their way to the screen, and when the last shows. */
  onRevealing?: (id: string, revealing: boolean) => void
  /** The chat's last answer: its actions always show, and it can be asked again from them. */
  latest?: boolean
}

/** A records answer's own body, loaded with the first one: most chats never need it. */
const RecordsAnswerBody = React.lazy(() =>
  import('@/components/heed/records-answer').then((m) => ({ default: m.RecordsAnswerBody })),
)

/**
 * An answer in the chat: from the context, with its state and sources; or, for a question about
 * the context's own records, the records answer (FR-718), which has no state and no sources.
 */
export function AnswerBody(props: AnswerBodyProps) {
  const { records } = props.turn.answer
  if (props.turn.error) return <Unanswered error={props.turn.error} onRetry={props.onRetry} />
  if (!records) return <ContextAnswerBody {...props} />
  return (
    <React.Suspense
      fallback={<ReadingLine running>Counting from the workspace&apos;s records…</ReadingLine>}
    >
      <RecordsAnswerBody parts={recordsParts} records={records} />
    </React.Suspense>
  )
}

/** A question that got nothing back: it says so, and can be asked again. */
function Unanswered({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
      <span className="flex items-center gap-2">
        <CircleAlertIcon className="size-4 shrink-0" aria-hidden />
        {error}
      </span>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCwIcon data-icon="inline-start" />
          Ask again
        </Button>
      )}
    </div>
  )
}

function ContextAnswerBody({ turn, draft, onRetry, docked, onRevealing, latest }: AnswerBodyProps) {
  const { answer, stopped } = turn
  // A Conflict's pair is read while the answer is still being written, so it shows with the rest
  // of the finished answer and nothing below it moves once it is in view.
  const queryClient = useQueryClient()
  const pairKey =
    answer.state === 'conflict' && answer.conflict?.length === 2 ? answer.conflict.join('.') : null
  React.useEffect(() => {
    if (pairKey) void queryClient.prefetchQuery(conflictQuery(pairKey))
  }, [pairKey, queryClient])
  const all = useFacts()
  const facts = React.useMemo(
    () =>
      draft
        ? [draft]
        : answer.sources.flatMap((id) => {
            const f = all.find((x) => x.id === id)
            // The answer carries the line its owner copied, and what not to conclude, when the
            // library does not.
            const cited = answer.cited?.[id]
            return f ? [cited ? { ...f, ...cited } : f] : []
          }),
    [draft, answer.sources, answer.cited, all],
  )
  const [wrong, setWrong] = React.useState(!!answer.correction)
  const [sentNow, setSentNow] = React.useState(answer.report)
  // A report the person sent about this answer, here or before: what the owners did comes back.
  const mine = useQuery({ ...myReportsQuery(), enabled: !draft }).data?.find(
    (r) => r.question.toLowerCase() === answer.question.toLowerCase(),
  )
  const report = mine ? { on: mine.on, outcome: mine.outcome } : sentNow

  // Where the answer has got to, from the look-up's events: its labels held long enough to read,
  // then the engine's answer, then a model's checked sentences revealed as `ASK_CADENCE` says.
  const shownStage = useShownStage(turn)
  const answered = shownStage === 'answered'
  const reduced = useReducedMotion()
  const streamed = turn.sentences.length > 0
  const sentences = React.useMemo(
    () =>
      sentencesOf(streamed ? turn.sentences.join(' ') : turn.stage === 'done' ? answer.text : ''),
    [streamed, turn.sentences, turn.stage, answer.text],
  )
  // Where each sentence ends, in the characters the reveal counts (the sentences joined by spaces).
  const ends = sentences.reduce<number[]>(
    (all, sentence) => [...all, (all.at(-1) ?? -1) + 1 + sentence.text.length],
    [],
  )
  const total = answered ? (ends.at(-1) ?? 0) : 0
  // The engine's own words, and an answer already in, show whole; a model's are revealed.
  const instant = reduced || ASK_CADENCE !== 'words' || !streamed
  const [limit, setLimit] = React.useState(total)
  const revealed = useReveal(limit, { flowing: isLive(turn), instant })
  // Stopped, it finishes the sentence on screen, which was checked, and shows no more.
  const started = ends.findIndex((_, i) => (i ? ends[i - 1]! + 1 : 0) >= revealed)
  const upTo = stopped ? (started < 0 ? total : started ? ends[started - 1]! : 0) : total
  if (upTo !== limit) setLimit(upTo)
  const revealing = isLive(turn) || revealed < limit
  // The chat holds Stop and Escape until the last word shows, not only until the answer is in.
  // Before paint, so Ask never flashes in Stop's place as the answer comes in.
  const id = answer.id
  React.useLayoutEffect(() => {
    if (!revealing || !onRevealing) return
    onRevealing(id, true)
    return () => onRevealing(id, false)
  }, [revealing, onRevealing, id])
  const finished = turn.stage === 'done' && answered && !revealing && !stopped
  const writing = answered && isLive(turn) && !revealed
  const where = !draft && !docked && facts.length > 0
  // The data, when an answer asks about a figure: one line, a link into the tool, or why there is none.
  const asked = {
    metric: answer.metric,
    markets: answer.markets,
    dates: answer.dates,
    state: answer.state,
    sources: answer.sources,
  }
  const figure = useQuery({ ...figureQuery(asked), enabled: !draft && answer.state !== null })
  const figures = useFigures()
  const view = draft ? null : (figure.data ?? null)
  const note = noteFor(answer.note, view)
  // A finished answer is kept by its key, so the right panel can share it or show where it says that.
  const key = answerKey(answer)
  React.useEffect(() => {
    if (finished && !draft) keepShown(key, { answer, facts })
  }, [finished, draft, key, answer, facts])
  // While the words are revealed a screen reader hears each sentence once it is whole, never word
  // by word; the words on screen are read once finished.
  const whole = sentences.filter((_, i) => ends[i]! <= revealed)

  // The words, which the state's card goes beside when the thread has room.
  const wordsRef = React.useRef<HTMLDivElement>(null)
  // The two items that disagree, as the answer numbers them: named in the state's card.
  const disagree =
    answer.state === 'conflict'
      ? facts.flatMap((f, i) => (answer.conflict?.includes(f.id) ? [{ n: i + 1, fact: f }] : []))
      : []

  return (
    // Busy only until the engine's answer is in: from then on its words are read as they come.
    <div className="group/msg flex min-w-0 flex-col gap-4" aria-busy={isLive(turn) && !answered}>
      {/* While it works, what the look-up is doing, where the state will be. */}
      {!answered && <LookupCard answer={answer} facts={facts} turn={turn} shown={shownStage} />}
      {answered && (answer.state !== null || note || !!answer.scope?.length) && (
        <div className="flex animate-in flex-col gap-2 duration-(--dur-3) fade-in-0">
          <ScopeLine answer={answer} />
          {/* The badge alone; what it means is its card, on hover, focus or a tap. */}
          {answer.state && (
            <StateHelp state={answer.state} draft={!!draft} words={wordsRef}>
              {disagree.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-sm font-medium">These two disagree</p>
                  <div className="flex flex-wrap gap-1.5">
                    {disagree.map(({ n, fact }) => (
                      <SourceChip key={fact.id} n={n} fact={fact} draft={!!draft} card={false} />
                    ))}
                  </div>
                </div>
              )}
            </StateHelp>
          )}
          {note && <p className="text-sm text-muted-foreground">{note}</p>}
        </div>
      )}
      {/* What the metric means, from its source: first, since that is what was asked. */}
      {answered && answer.definitions && (
        <div className="animate-in duration-(--dur-3) fade-in-0">
          <AnswerDefinitions definitions={answer.definitions} />
        </div>
      )}
      {/* The words: a model's checked sentences as they come, revealed word by word, or the
            engine's own whole; drawn the same way from the first word to the end. */}
      {writing && (
        <p className="flex min-h-6 items-center">
          <ReadingLine running className="text-sm">
            Writing the answer…
          </ReadingLine>
        </p>
      )}
      {revealed > 0 && (
        <div
          ref={wordsRef}
          data-answer-words
          aria-hidden={revealing || undefined}
          aria-live="off"
          className={cn(
            'max-w-reading text-base leading-chat',
            !streamed && turn.asked > 0 && sentenceIn,
          )}
        >
          <AnswerWords
            sentences={sentences}
            revealed={revealed}
            facts={facts}
            conflict={answer.state === 'conflict' ? answer.conflict : undefined}
            answerId={key}
            where={where}
            live={revealing}
            draft={!!draft}
          />
        </div>
      )}
      {revealing && (
        <p className="sr-only" aria-live="polite">
          {whole.map((sentence, i) => (
            <span key={i}>{sentence.text} </span>
          ))}
        </p>
      )}
      {/* The sources are the engine's, in with its answer; a model's words never change them. Then
            what was looked up, which opens What agents get. */}
      {answered && (
        <LookupCard answer={answer} facts={facts} turn={turn} shown={shownStage}>
          {facts.map((f, i) => (
            <SourceChip key={f.id} n={i + 1} fact={f} draft={!!draft} />
          ))}
        </LookupCard>
      )}
      {/* The chat's own status line says it was stopped (src/web/pages/ask.tsx). */}
      {stopped && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            <CircleStopIcon className="size-4 shrink-0" aria-hidden />
            Stopped{answered ? '. This is not a finished answer.' : ' before an answer.'}
          </span>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCwIcon data-icon="inline-start" />
              Ask again
            </Button>
          )}
        </div>
      )}
      {finished && (
        <div className="flex animate-in flex-col gap-4 delay-(--dur-3) duration-(--dur-4) fade-in-0 fill-mode-backwards slide-in-from-bottom-1">
          {answer.state === 'failed' && onRetry && (
            <Button variant="outline" size="sm" className="w-fit" onClick={onRetry}>
              <RefreshCwIcon data-icon="inline-start" />
              Ask again
            </Button>
          )}
          {view?.kind === 'line' && <FigureLine view={view} metric={answer.metric} />}
          {view?.kind === 'against' && (
            <FigureAgainst view={view} answer={answer} contact={figures.contact(view.source)} />
          )}
          {view?.kind === 'none' && <NoFigure view={view} />}
          {view?.kind === 'link' && <FigureLink view={view} />}
          {answer.alias && <AliasChip alias={answer.alias} />}
          {answer.related?.length ? <Related ids={answer.related} /> : null}
          {answer.state === null ? (
            <AskableKinds answer={answer} />
          ) : (
            !draft && <NextStep answer={answer} facts={facts} />
          )}
          {!draft && report && <ReportLine report={report} />}
          {!draft && wrong && !report && facts.length > 0 && (
            <SomethingWrong
              answer={answer}
              facts={facts}
              figure={view?.kind === 'line' || view?.kind === 'against' ? view.source : undefined}
              onClose={() => setWrong(false)}
              onSent={() => {
                setWrong(false)
                setSentNow({ on: 'just now' })
              }}
            />
          )}
          <AnswerActions
            answer={answer}
            facts={facts}
            answerId={key}
            draft={!!draft}
            docked={docked}
            latest={latest}
            onRetry={onRetry}
            wrong={wrong}
            onWrong={(w) => !draft && facts.length > 0 && !report && setWrong(w)}
            canReport={!draft && facts.length > 0 && !report}
          />
        </div>
      )}
    </div>
  )
}

/**
 * One row of icons under a finished answer: Copy, Good, Bad, Ask again on the chat's last answer,
 * and More with the rest (Something wrong?, Save question, Share). The last answer always shows
 * them; an earlier one on hover or focus, and always on a touch screen.
 */
function AnswerActions({
  answer,
  facts,
  answerId,
  draft,
  docked,
  latest,
  onRetry,
  wrong,
  onWrong,
  canReport,
}: {
  answer: Answer
  facts: Fact[]
  answerId: string
  draft: boolean
  docked?: boolean
  latest?: boolean
  onRetry?: () => void
  wrong: boolean
  onWrong: (wrong: boolean) => void
  canReport: boolean
}) {
  const [rated, setRated] = React.useState<'up' | 'down' | null>(null)
  const [copied, copy] = useCopied()
  // Saving a question is for the owners of the domain it is about, and admins.
  const me = useMe()
  const domainsById = useDomains()
  const saveDomain = facts[0]?.domain ?? me.owns.find((d) => !domainsById[d]?.sandbox) ?? 'sales'
  const canSave = me.admin || me.owns.includes(saveDomain)
  // What More opened that needs a card of its own, beside the More button.
  const more = React.useRef<HTMLButtonElement>(null)
  const [opened, setOpened] = React.useState<'save' | 'share' | null>(null)
  const stated = !draft && !!answer.state && answer.state !== 'failed'
  const save = stated && canSave
  const hasMore = canReport || save || stated
  // A check that did not run has its own Ask again above, and nothing to rate, copy or report.
  if (answer.state === 'failed' && !answer.text && !hasMore) return null
  return (
    <div
      role="group"
      aria-label="Answer actions"
      className={cn(
        '-ml-1.5 flex flex-wrap items-center gap-0.5 pointer-coarse:gap-2.5',
        !latest &&
          !opened &&
          'opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100 has-aria-expanded:opacity-100 pointer-coarse:opacity-100',
      )}
    >
      {answer.text && (
        <IconButton
          label="Copy"
          onClick={() => {
            copy(answer.text.replace(/\[\d+\]/g, ''))
            toast('Copied')
          }}
        >
          <CopiedIcon copied={copied} />
        </IconButton>
      )}
      {answer.state !== 'failed' && (
        <>
          <IconButton
            label="Good answer"
            active={rated === 'up'}
            onClick={() => setRated(rated === 'up' ? null : 'up')}
          >
            {rated === 'up' ? <CheckIcon /> : <ThumbsUpIcon />}
          </IconButton>
          {/* One way to say it is wrong: a bad answer asks what was wrong, in the same form. */}
          <IconButton
            label="Bad answer"
            active={rated === 'down'}
            onClick={() => {
              setRated(rated === 'down' ? null : 'down')
              if (rated !== 'down') onWrong(true)
            }}
          >
            <ThumbsDownIcon />
          </IconButton>
        </>
      )}
      {latest && onRetry && answer.state !== 'failed' && (
        <IconButton label="Ask again" onClick={onRetry}>
          <RefreshCwIcon />
        </IconButton>
      )}
      {hasMore && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  ref={more}
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="More"
                      className="size-7 text-muted-foreground hover:text-foreground pointer-coarse:size-9"
                    />
                  }
                />
              }
            >
              <EllipsisIcon />
            </TooltipTrigger>
            <TooltipContent>More</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="w-auto">
            {canReport && (
              <DropdownMenuItem onClick={() => onWrong(!wrong)}>
                <FlagIcon />
                Something wrong?
              </DropdownMenuItem>
            )}
            {/* Keep checking this answer after every change: for the owners of its domain and admins. */}
            {save && (
              <DropdownMenuItem onClick={() => setOpened('save')}>
                <BookmarkIcon />
                Save question
              </DropdownMenuItem>
            )}
            {/* The answer travels with its state and its sources: beside it in the right panel. */}
            {stated && (
              <DropdownMenuItem
                onClick={() => (docked ? setOpened('share') : openDock('share', answerId))}
              >
                <ShareIcon />
                Share
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {opened === 'save' && (
        <SaveQuestion
          question={answer.question}
          domain={saveDomain}
          answer={answer}
          from={more}
          onClose={() => setOpened(null)}
        />
      )}
      {opened === 'share' && (
        <SharePopover answer={answer} facts={facts} from={more} onClose={() => setOpened(null)} />
      )}
    </div>
  )
}

export function DraftBanner() {
  return (
    <div className="flex items-center gap-2 rounded-surface border border-dashed border-input px-3 py-2 text-sm">
      <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      Trying the draft. Agents don't get it yet.
    </div>
  )
}

/** Under a Conflict answer: the pair, compact, and Compare and decide (or Compare the two). */
function ConflictNextStep({ pairKey }: { pairKey: string }) {
  const pair = useQuery(conflictQuery(pairKey)).data
  if (!pair) return null
  const can = Object.values(pair.rights).some(Boolean)
  return (
    <div className="flex flex-col gap-3">
      <ConflictPairCompact pair={pair} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button size="sm" variant="outline" onClick={() => openDock('conflict', pair.key)}>
          <ArrowLeftRightIcon data-icon="inline-start" />
          {can ? 'Compare and decide' : 'Compare the two'}
        </Button>
        <span className="text-xs text-muted-foreground">
          {can
            ? 'You can keep one, narrow one to where it applies, or keep both.'
            : 'See them side by side, and ask the owner.'}
        </span>
      </div>
    </div>
  )
}
