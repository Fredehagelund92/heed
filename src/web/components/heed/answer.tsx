import * as React from 'react'
import {
  ArrowLeftRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleStopIcon,
  FileTextIcon,
  FlagIcon,
  PencilIcon,
  RefreshCwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from '@/components/icons'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { markText } from '@/components/heed/mark'
import { marksExceptions } from '@/lib/marks'
import { TypeGlyph } from '@/components/heed/definition'
import { ComingSoon, PersonAvatar } from '@/components/heed/bits'
import { StateHelp } from '@/components/heed/state-help'
import { ShareButton } from '@/components/heed/share-answer'
import { Answering, Suggestions, suggestionClass } from '@/components/heed/suggestions'
import { recordsParts } from '@/components/heed/records-parts'
import { ReadingLine } from '@/components/heed/reading'
import { answerKey, keepShown } from '@/lib/shown-answers'
import { sentencesOf } from '@/lib/where'
import { LogoSymbol } from '@/components/heed/logo'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
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
  useAskExamples,
  useWrite,
} from '@/api/queries'
import { useDomains, useFacts, useMe } from '@/lib/workspace'
import { SaveQuestion } from '@/components/obs/save-question'
import { agentReply } from '@/lib/agent-reply'
import { mentionId, parseMentionId, plainText, type MentionRef } from '@/lib/mentions'
import type { FigureView } from '@/model/figures'
import type { ConnectorId } from '@/model/integrations'
import { useFigures } from '@/lib/figures'
import { FigureAgainst, FigureLine, FigureLink, NoFigure } from '@/components/heed/answer-figure'
import { useRelated } from '@/hooks/use-related'
import { relLabel } from '@/lib/links'

// One turn of Ask, drawn the way assistant-ui draws a thread: the question as a quiet muted
// bubble on the right, the answer as plain text beside a small avatar, what Heed looked up as a
// collapsible tool card, sources as small cards, and an action bar under the answer.

/** A turn's life: still answering, finished, or stopped by the asker before it finished. */
export type Phase = 'live' | 'done' | 'stopped'

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
  const me = useMe()
  const [copied, copy] = useCopied()
  // Scoped with '@', the answer's header says how; otherwise one quiet line, only when the reading differs from the words.
  const showReadAs = !answer.scope?.length && !!scopeText(answer) && readDifferently(answer)
  return (
    <div className="group/q flex flex-col items-end gap-2">
      <div className="flex max-w-17/20 min-w-0 items-end gap-2">
        <div className="min-w-0 rounded-surface bg-muted px-4 py-2 text-reading leading-relaxed wrap-anywhere whitespace-pre-line [&_.mention-chip]:bg-background">
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
        <PersonAvatar name={me.name} size={28} className="hidden shrink-0 @md:flex" />
      </div>
      {/* Copy, and Edit to put the question back in the box: under the bubble, so it keeps its width; always there on a touch screen. */}
      <div className="-my-1 flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover/q:opacity-100 focus-within:opacity-100 @md:pr-9 pointer-coarse:gap-2.5 pointer-coarse:opacity-100">
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
        <p className="flex flex-wrap items-center justify-end gap-x-2 text-xs text-muted-foreground @md:pr-9">
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

function LookupCard({
  answer,
  facts,
  stage,
  stopped,
}: {
  answer: Answer
  facts: Fact[]
  stage: Stage
  stopped: boolean
}) {
  const scope = scopeText(answer) || 'Nothing matched'
  const raw = agentReply(answer, facts)
  const running = !stopped && (stage === 'looking' || stage === 'reading')
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
  const line = stopped
    ? stage === 'looking'
      ? 'Stopped while looking up'
      : stage === 'reading'
        ? 'Stopped while reading'
        : 'Stopped while writing'
    : running && stage === 'looking'
      ? 'Looking up context…'
      : answer.state === null
        ? 'Nothing was looked up'
        : running
          ? facts.length
            ? `Reading ${facts.length} context ${facts.length === 1 ? 'item' : 'items'}…`
            : 'Found no context items'
          : answer.state === 'failed'
            ? 'The look-up failed'
            : facts.length
              ? `Looked up ${facts.length} context ${facts.length === 1 ? 'item' : 'items'}${linkWords}`
              : 'Looked up: no context items'
  return (
    <Collapsible className="text-sm">
      <CollapsibleTrigger
        disabled={running}
        className="group/lookup -ml-1 inline-flex h-7 items-center gap-1.5 rounded-md px-1 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ReadingLine running={running}>{line}</ReadingLine>
        {!running && (
          <ChevronDownIcon
            className="size-3.5 shrink-0 transition-transform group-aria-expanded/lookup:rotate-180"
            aria-hidden
          />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 flex flex-col gap-2 rounded-surface border border-input bg-background px-3 py-3 text-muted-foreground">
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
  const domains = useDomains()
  const marker =
    // 24px to see, 44px to tap: the hit area grows, the marker doesn't.
    'relative ml-0.5 mr-px inline-flex h-6 min-w-6 -translate-y-px items-center justify-center rounded-md bg-muted px-1.5 align-middle text-2xs font-medium text-foreground tabular-nums outline-none after:absolute after:-inset-[13px] hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50'
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
      </PopoverContent>
    </Popover>
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

/** Sentences with [n] turned into citation markers with a hover card. */
function Cited({
  text,
  facts,
  draft,
  caret,
}: {
  text: string
  facts: Fact[]
  draft?: boolean
  caret?: boolean
}) {
  // A marker sits against its sentence, after the full stop: "nothing.1 Orders", never "nothing 1 .".
  const parts = text
    .replace(/\s+(\[\d+\])/g, '$1')
    .replace(/(\[\d+\])([.,;:])/g, '$2$1')
    .split(/(\[\d+\])/)
  return (
    <p className="text-reading leading-relaxed">
      {parts.map((p, i) => {
        const m = p.match(/^\[(\d+)\]$/)
        if (!m) return <React.Fragment key={i}>{p}</React.Fragment>
        return <Citation key={i} n={Number(m[1])} fact={facts[Number(m[1]) - 1]} draft={draft} />
      })}
      {caret && (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-foreground/60"
        />
      )}
    </p>
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
function WhereSentences({
  text,
  facts,
  conflict,
  answerId,
}: {
  text: string
  facts: Fact[]
  conflict?: string[]
  answerId: string
}) {
  const dock = useDock()
  const { query } = useRoute()
  const open = dock?.kind === 'where' && dock.id === answerId ? Number(query.get('wn')) || 1 : 0
  const sentences = sentencesOf(text)
  const show = (n: number) => openDock('where', answerId, { wn: String(n) })
  const marked = differingSentences(sentences, facts, conflict)
  // The sentences from the two items that disagree sit together under a line that says so, so the
  // pair reads as a pair and a sentence from another item stays outside it.
  const first = marked.indexOf(true)
  const last = marked.lastIndexOf(true)
  const run = (from: number, to: number) => (
    <p className="text-reading leading-relaxed">
      {sentences.slice(from, to).map((s, j) => {
        const i = from + j
        return (
          <React.Fragment key={i}>
            {j > 0 && ' '}
            <span
              role="button"
              tabIndex={0}
              aria-pressed={open === i + 1}
              onClick={() => show(i + 1)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                show(i + 1)
              }}
              data-mark={marked[i] ? 'differs' : undefined}
              className={cn(
                'cursor-pointer rounded-mark box-decoration-clone underline decoration-foreground/25 decoration-dotted underline-offset-5 transition-colors outline-none hover:bg-muted hover:decoration-transparent focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-primary/12 aria-pressed:decoration-transparent dark:aria-pressed:bg-primary/25',
                marked[i] && [
                  markText('differs'),
                  'decoration-solid hover:decoration-caution-icon aria-pressed:decoration-caution-icon',
                ],
              )}
            >
              {s.text}
              {s.cites.map((n) => (
                <span
                  key={n}
                  aria-hidden
                  className="ml-1 inline-flex h-5 min-w-5 -translate-y-px items-center justify-center rounded-md bg-muted px-1 align-middle text-2xs font-medium text-foreground tabular-nums"
                >
                  {n}
                </span>
              ))}
              <span className="sr-only">
                {s.cites.length
                  ? `, from ${s.cites.map((n) => facts[n - 1]?.title ?? `source ${n}`).join(' and ')}`
                  : ", Ask's own wording"}
                {marked[i] && ', which says something different from another item'}
              </span>
            </span>
          </React.Fragment>
        )
      })}
    </p>
  )
  if (first < 0) return run(0, sentences.length)
  return (
    <div className="flex flex-col gap-3">
      {first > 0 && run(0, first)}
      <div className="flex flex-col gap-1 border-l-2 pl-3">
        <p className="text-xs font-medium text-caution-text">These two disagree</p>
        {run(first, last + 1)}
      </div>
      {last < sentences.length - 1 && run(last + 1, sentences.length)}
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

/** The full list of sources, closed: one quiet line under the answer that opens compact rows. */
function SourceList({ facts, draft }: { facts: Fact[]; draft?: boolean }) {
  const domains = useDomains()
  return (
    <Collapsible className="text-sm">
      <CollapsibleTrigger className="group/src -ml-1 inline-flex h-7 items-center gap-1.5 rounded-md px-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronRightIcon
          className="size-3.5 transition-transform group-aria-expanded/src:rotate-90"
          aria-hidden
        />
        {facts.length} {facts.length === 1 ? 'source' : 'sources'}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-1 flex flex-col border-y">
          {facts.map((f, i) => (
            <li key={f.id} className="border-t first:border-t-0">
              <button
                type="button"
                disabled={draft}
                onClick={() => openDock('context', f.id)}
                className="grid w-full grid-cols-(--cols-lead-5) gap-x-2 py-2 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none"
              >
                <span className="pt-px text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm">{f.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {draft
                      ? `${domains[f.domain]?.name}, the draft`
                      : `${domains[f.domain]?.name}, checked by ${f.checkedBy}, ${f.checkedOn}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
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

/** Questions from the workspace to try instead, other than the one asked. */
function useInsteadExamples(answer: Answer) {
  const asked = answer.question.toLowerCase()
  return useAskExamples()
    .map((e) => e.question)
    .filter((q) => q.toLowerCase() !== asked)
    .slice(0, 2)
}

/**
 * A question that looked nothing up: the three kinds of question Ask answers, each with one to
 * try, the one about a metric or a market made from the names closest to the words (else from the
 * workspace), and where every definition is listed. Nothing here says whether anything is written
 * down.
 */
function AskableKinds({ answer, onAsk }: { answer: Answer; onAsk?: (q: string) => void }) {
  const answering = React.use(Answering)
  const workspace = useInsteadExamples(answer)[0]
  const close = answer.closest?.[0]
  const kinds = [
    {
      kind: 'About a metric or a market',
      question: close ? `What should I know about ${close}?` : workspace,
    },
    { kind: 'About the records', question: 'What changed this week?' },
    { kind: 'About what Definitions lists', question: 'What dimensions are there?' },
  ].filter((k): k is { kind: string; question: string } => !!k.question)
  const definitions = useQuery(definitionsPageQuery()).data?.filter(
    (d) => !d.sameAs && (d.type === 'metric' || d.type === 'dimension'),
  )
  const metrics = definitions?.filter((d) => d.type === 'metric').length ?? 0
  const many = (n: number, one: string) =>
    `${n.toLocaleString('en-GB')} ${one}${n === 1 ? '' : 's'}`
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Ask answers three kinds of question. Type @ to scope one to a metric or a market.
      </p>
      {onAsk && (
        <ul aria-label="Questions Ask can answer" className="flex flex-col gap-2">
          {kinds.map((k) => (
            <li key={k.kind} className="flex flex-col items-start gap-1">
              <span className="text-xs text-muted-foreground">{k.kind}</span>
              <button
                type="button"
                aria-disabled={answering || undefined}
                onClick={() => !answering && onAsk(k.question)}
                className={suggestionClass}
              >
                {k.question}
              </button>
            </li>
          ))}
        </ul>
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

/**
 * Questions to try after a Not found answer: for a market on its own, the same market with the
 * metrics its context is written for; otherwise two from the workspace.
 */
function TryInstead({ answer, onAsk }: { answer: Answer; onAsk?: (q: string) => void }) {
  const workspace = useInsteadExamples(answer)
  const examples = answer.instead?.length ? answer.instead : workspace
  if (!onAsk || examples.length === 0) return null
  return <Suggestions items={examples} onPick={onAsk} label="Questions Ask can answer" />
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

function AssistantAvatar() {
  return (
    <span
      aria-hidden
      className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-background"
    >
      <LogoSymbol className="h-3.5" />
    </span>
  )
}

type Stage = 'looking' | 'reading' | 'writing' | 'done'

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

// The answer's timing, so it reads like an answer being written: the look-up (450ms), reading
// what it found (650ms, long enough to be read), then the words, about 50ms each, between 0.6 and
// 2.2 seconds; what backs them settles in last. The asker can stop it at any point.
const LOOK = 450
const READ = 1100
const writingTime = (words: number) => Math.min(2200, Math.max(600, words * 50))

type AnswerBodyProps = {
  answer: Answer
  draft?: Fact
  phase?: Phase
  /** Ask another question in this chat: one of those an answer that looked nothing up offers. */
  onAsk?: (question: string) => void
  /** Ask is itself in the right panel: what would open there opens in place. */
  docked?: boolean
  onRetry?: () => void
  /** Told when a live answer has finished writing. */
  onSettled?: () => void
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
  const { records } = props.answer
  if (!records) return <ContextAnswerBody {...props} />
  return (
    <div className="flex gap-3">
      <AssistantAvatar />
      <React.Suspense
        fallback={<ReadingLine running>Counting from the workspace&apos;s records…</ReadingLine>}
      >
        <RecordsAnswerBody
          parts={recordsParts}
          records={records}
          onAsk={props.onAsk}
          onSettled={props.onSettled}
        />
      </React.Suspense>
    </div>
  )
}

function ContextAnswerBody({
  answer,
  draft,
  phase = 'done',
  onRetry,
  onSettled,
  onAsk,
  docked,
}: AnswerBodyProps) {
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
  const [rated, setRated] = React.useState<'up' | 'down' | null>(null)
  const [copied, copy] = useCopied()
  const [wrong, setWrong] = React.useState(!!answer.correction)
  const [sentNow, setSentNow] = React.useState(answer.report)
  // A report the person sent about this answer, here or before: what the owners did comes back.
  const mine = useQuery({ ...myReportsQuery(), enabled: !draft }).data?.find(
    (r) => r.question.toLowerCase() === answer.question.toLowerCase(),
  )
  const report = mine ? { on: mine.on, outcome: mine.outcome } : sentNow
  // Saving a question is for the owners of the domain it is about, and admins.
  const me = useMe()
  const domainsById = useDomains()
  const saveDomain = facts[0]?.domain ?? me.owns.find((d) => !domainsById[d]?.sandbox) ?? 'sales'
  const canSave = me.admin || me.owns.includes(saveDomain)

  // How far a live answer has got, in milliseconds; stages and words follow from it.
  const tokens = React.useMemo(() => answer.text.match(/\S+\s*/g) ?? [], [answer.text])
  const total = READ + writingTime(tokens.length)
  const [elapsed, setElapsed] = React.useState(phase === 'live' ? 0 : Infinity)
  const settled = React.useRef(onSettled)
  React.useEffect(() => {
    settled.current = onSettled
  })
  React.useEffect(() => {
    if (phase !== 'live') return
    const start = performance.now() - (Number.isFinite(elapsed) ? elapsed : 0)
    const id = window.setInterval(() => {
      const now = performance.now() - start
      setElapsed(now)
      if (now >= total) {
        window.clearInterval(id)
        settled.current?.()
      }
    }, 30)
    return () => window.clearInterval(id)
    // Restarted only when the phase changes; a stop freezes it where it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, total])

  const stopped = phase === 'stopped' && elapsed < total
  const stage: Stage =
    elapsed < LOOK ? 'looking' : elapsed < READ ? 'reading' : elapsed < total ? 'writing' : 'done'
  const shown =
    stage === 'done'
      ? tokens.length
      : stage === 'writing'
        ? Math.ceil(((elapsed - READ) / writingTime(tokens.length)) * tokens.length)
        : 0
  const cut = tokens.slice(0, shown).join('').trimEnd()
  // Where Stop cut a sentence, it says so: "…".
  const partial = stopped && cut && !/[.!?:)\]”"]$/.test(cut) ? `${cut}…` : cut
  const writing = stage === 'writing' && !stopped
  const finished = stage === 'done'
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

  return (
    <div className="group/msg flex gap-3" aria-busy={phase === 'live' && !finished}>
      <AssistantAvatar />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <LookupCard answer={answer} facts={facts} stage={stage} stopped={stopped} />
        {phase === 'live' && !finished && <span className="sr-only">Writing the answer</span>}
        {(writing || finished) && (answer.state !== null || note || !!answer.scope?.length) && (
          <div className="flex animate-in flex-col gap-3 duration-(--dur-3) fade-in-0">
            <ScopeLine answer={answer} />
            {/* The line opens a small card: what it means and what to do, from the list Help shares. */}
            {answer.state && <StateHelp state={answer.state} draft={!!draft} />}
            {note && <p className="-mt-1 text-sm text-muted-foreground">{note}</p>}
          </div>
        )}
        {/* What the metric means, from its source: first, since that is what was asked. */}
        {(writing || finished) && answer.definitions && (
          <div className="animate-in duration-(--dur-3) fade-in-0">
            <AnswerDefinitions definitions={answer.definitions} />
          </div>
        )}
        {/* The words arrive as they are written; a screen reader hears them once, when they are done or stopped. */}
        {answer.text && (writing || finished || (stopped && shown > 0)) && (
          <div aria-hidden={phase === 'live' && !finished}>
            {finished && !draft && !docked && facts.length > 0 ? (
              <WhereSentences
                text={answer.text}
                facts={facts}
                conflict={answer.state === 'conflict' ? answer.conflict : undefined}
                answerId={key}
              />
            ) : (
              <Cited
                text={finished ? answer.text : partial}
                facts={facts}
                draft={!!draft}
                caret={writing}
              />
            )}
          </div>
        )}
        {finished && !draft && !docked && facts.length > 0 && (
          <p className="-mt-1.5 text-xs text-muted-foreground">
            {answer.state === 'conflict' &&
              differingSentences(sentencesOf(answer.text), facts, answer.conflict).some(Boolean) &&
              'The sentences in bold say different things. '}
            Select a sentence to see where it says that.
          </p>
        )}
        {stopped && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground"
          >
            <span className="flex items-center gap-2">
              <CircleStopIcon className="size-4 shrink-0" aria-hidden />
              Stopped{shown > 0 ? '. This is not a finished answer.' : ' before an answer.'}
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
          <div className="flex animate-in flex-col gap-3 delay-(--dur-3) duration-(--dur-4) fade-in-0 fill-mode-backwards slide-in-from-bottom-1">
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
            {facts.length > 0 && <SourceList facts={facts} draft={!!draft} />}
            {answer.related?.length ? <Related ids={answer.related} /> : null}
            {answer.state === null ? (
              <AskableKinds answer={answer} onAsk={onAsk} />
            ) : (
              <>
                {!draft && <NextStep answer={answer} facts={facts} />}
                {answer.state === 'missing' && <TryInstead answer={answer} onAsk={onAsk} />}
              </>
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
            <div className="-ml-1.5 flex flex-wrap items-center gap-0.5 pointer-coarse:gap-2.5">
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
                      if (rated !== 'down' && !draft && facts.length > 0 && !report) setWrong(true)
                    }}
                  >
                    <ThumbsDownIcon />
                  </IconButton>
                </>
              )}
              {!draft && facts.length > 0 && !report && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-pressed={wrong}
                  onClick={() => setWrong((w) => !w)}
                  className={cn(
                    'h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground pointer-coarse:h-9',
                    wrong && 'bg-accent text-foreground',
                  )}
                >
                  <FlagIcon data-icon="inline-start" />
                  Something wrong?
                </Button>
              )}
              {/* Keep checking this answer after every change: for the owners of its domain and admins. */}
              {!draft && answer.state && answer.state !== 'failed' && canSave && (
                <SaveQuestion
                  quiet
                  question={answer.question}
                  domain={saveDomain}
                  answer={answer}
                />
              )}
              {/* The answer travels with its state and its sources. */}
              {!draft && answer.state && answer.state !== 'failed' && (
                <ShareButton answer={answer} facts={facts} answerId={key} docked={docked} />
              )}
              {/* The rest on hover or focus. */}
              <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100 pointer-coarse:gap-2.5 pointer-coarse:opacity-100">
                <IconButton
                  label="Copy"
                  onClick={() => {
                    copy(answer.text.replace(/\[\d+\]/g, ''))
                    toast('Copied')
                  }}
                >
                  <CopiedIcon copied={copied} />
                </IconButton>
                {onRetry && (
                  <IconButton label="Ask again" onClick={onRetry}>
                    <RefreshCwIcon />
                  </IconButton>
                )}
              </span>
            </div>
          </div>
        )}
      </div>
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
      <ConflictPairCompact pair={pair} label="These two disagree" />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button size="sm" onClick={() => openDock('conflict', pair.key)}>
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
