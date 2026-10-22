import { useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { TryItReading } from '@/api'
import { tryItReadingQuery } from '@/api/queries'
import { CalendarIcon, PinIcon, TriangleAlertIcon, XIcon } from '@/components/icons'
import {
  ScopeTermLabel,
  scopeTermKind,
  scopeTermWords,
  type ScopeTermView,
} from '@/components/mentions/scope-term'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useScrollEdges } from '@/hooks/use-scroll-edges'
import { aboutTheChat } from '@domain/assistant-meta'
import {
  isChatQuestion,
  readsOf,
  readsSomething,
  type Reads,
  type TaggedScope,
} from '@/lib/ask-reads'
import { dayWords, rangeWords, readQuestion, type AskMessage } from '@/lib/assistant'
import { useAskChat, useAskDropped, useAskPinned } from '@/lib/assistant-chat'
import { formatDay } from '@/lib/library'
import { emptyScope, hasTerms, type TryItScope } from '@/lib/try-it'
import { useLibrary } from '@/lib/use-library'
import { addToScope, removeFromScope } from '@/lib/mention-targets'
import { cn } from '@/lib/utils'
import { useScopeTerms } from './ask-scope'
import '@/components/ui/scroll-fade.css'

/*
  The composer's "Heed reads" line (Heed composer, stages 1 and 2): under the words, what Heed
  will read for the question as typed, so the scope belongs to the question and nothing is a
  surprise. It shows the chips in the question, the terms its other words name, what was picked
  for this question (with a pin to keep it for the next ones), what is carried from the last
  question (dashed, each with a remove button),
  words that name more than one term with a one-click choice, and one period: the words', the
  picker's, the last question's, or "Today · assumed". It is derived, never edited: change the
  words and the chips, or pick, remove and pin. The question is sent with exactly this scope (`useAskSend`),
  unless its words take longer than a few seconds to read, and the assistant's tool calls read it.
  A polite live region says it in words as it changes.
*/

/** How long typing rests before the words are read: as Home's Try it reads them. */
export const READ_DEBOUNCE_MS = 300
/** get_facts reads at most this many characters of a question. */
const MAX_QUESTION = 2000

/**
 * The last question's scope, which the next question carries. A greeting, thanks or a follow-up
 * on a reply has none of its own and is passed over, so "and for Spain?" after "thanks" still
 * carries what the question before it was about.
 */
export function carriedOf(messages: readonly AskMessage[]): TryItScope | null {
  for (let at = messages.length - 1; at >= 0; at--) {
    const message = messages[at]!
    if (message.role !== 'user') continue
    const question = readQuestion(message)
    const replied = messages.slice(0, at).some((earlier) => earlier.role === 'assistant')
    if (!aboutTheChat(question.text, replied)) return question.scope
  }
  return null
}

/** How the words are read: not yet, being read, read, or not readable now (no edition, offline). */
export type ReadState = 'idle' | 'reading' | 'read' | 'failed'

/**
 * What Heed reads for the question being typed: the chips in it (`tagged`), the words the chips
 * leave (`text`, `draftReading`) read by the service once typing rests, the scope picked for it,
 * and what is carried from the last question less what the person took off. `about` is the terms
 * the service read in the words, and `reading` its reading of exactly these words, or null while
 * it is not there.
 */
export function useAskReads(
  text: string,
  picked: TryItScope | null,
  tagged: TaggedScope | null = null,
) {
  const words = text.trim()
  // Chips alone leave no words to read.
  const hasWords = /[\p{L}\p{N}]/u.test(words)
  const settled = useDebouncedValue(hasWords ? words : '', READ_DEBOUNCE_MS)
  const readable = settled.length > 0 && settled.length <= MAX_QUESTION
  const query = useQuery({
    ...tryItReadingQuery(settled),
    enabled: readable,
    // While more words are read, the line keeps what it read of the words before them; a new
    // question never shows the last one's reading.
    placeholderData: (previous, before) => {
      const words = before?.queryKey[2]
      return settled && words && (settled.startsWith(words) || words.startsWith(settled))
        ? previous
        : undefined
    },
    retry: false,
  })
  const { messages } = useAskChat()
  const { dropped } = useAskDropped()
  const library = useLibrary()
  const reading = hasWords && readable && query.data ? query.data : null
  const state: ReadState = !words
    ? 'idle'
    : !hasWords
      ? 'read'
      : query.isError
        ? 'failed'
        : query.data && settled === words && !query.isPlaceholderData
          ? 'read'
          : 'reading'
  const carried = useMemo(() => carriedOf(messages), [messages])
  // A greeting, thanks or a follow-up on the last reply ("what do you mean?") is about the chat:
  // it reads nothing, so the line shows no scope, carried or assumed, for it.
  const chat = isChatQuestion(words, messages, picked, tagged, reading)
  const reads = useMemo(
    () =>
      readsOf({
        reading,
        tagged,
        picked,
        carried,
        dropped: new Set(dropped),
        today: library.today,
      }),
    [reading, tagged, picked, carried, dropped, library.today],
  )
  // Nothing is read for it, nothing is carried to it, and no day is assumed for it.
  const quiet = useMemo(
    () =>
      readsOf({
        reading: null,
        tagged: null,
        picked: null,
        carried: null,
        dropped: new Set(),
        today: library.today,
      }),
    [library.today],
  )
  return {
    reads: chat ? quiet : reads,
    state: chat ? ('idle' as const) : state,
    about: reading?.about ?? noTerms,
    reading: state === 'read' ? reading : null,
    chat,
  }
}

const noTerms: TryItReading['about'] = []

const chipClass =
  'inline-flex badge-md max-w-full min-w-0 items-center gap-1 rounded-badge border border-border bg-background text-foreground'
/**
 * A choice on the line, drawn as a chip that answers a click: it reads as one of the line's
 * terms in the panel's quiet footer too, where an outline button is drawn without its box. A
 * touch target under a finger.
 */
export const choiceClass = cn(
  chipClass,
  'cursor-pointer hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:min-h-control-touch',
)
/** The pin: a chip's height, so the line stays one chip high; a touch target under a finger. */
const pinClass =
  'flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:size-control-touch'
const removeClass =
  'flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

/** A term's view: the reading's names first, which come with the words, then the vocabulary's. */
function useTermViews(reads: Reads, reading: TryItReading['about']) {
  const keys = reads.terms.map((term) => term.key)
  const named = useScopeTerms(keys)
  return useMemo(() => {
    const views = new Map(named)
    const viewOf = (term: TryItReading['about'][number]): ScopeTermView => ({
      kind: term.kind === 'metric_group' ? 'metric' : term.kind,
      name: term.name,
      dimensionName: term.dimension,
    })
    for (const term of reading) views.set(term.key, viewOf(term))
    for (const words of reads.undecided)
      for (const option of words.options) views.set(option.key, viewOf(option))
    return {
      viewOf: (key: string): ScopeTermView =>
        views.get(key) ?? { kind: scopeTermKind(key), name: key.slice(key.indexOf(':') + 1) },
    }
  }, [named, reading, reads.undecided])
}

/** The days of the question as a chip reads them: "1 Jan to 31 Dec 2026". */
const daysOf = (reads: Reads) =>
  reads.window ? rangeWords(reads.window.from, reads.window.to, formatDay) : null

/** The line in words, for the live region and the box's description. */
export function readsWords(reads: Reads, viewOf: (key: string) => ScopeTermView): string {
  const days = daysOf(reads)
  const named = reads.terms.map((term) => scopeTermWords(viewOf(term.key)))
  const dates =
    reads.windowSource === 'unreadable' && reads.datesProblem
      ? `no dates: “${reads.datesProblem.words}” can’t be read as dates`
      : days
        ? `${days}${reads.datesNote ? `, ${reads.datesNote}` : ''}`
        : reads.today
          ? `${dayWords(reads.today, formatDay)} (no dates given)`
          : null
  const carried = reads.terms
    .filter((term) => term.source === 'carried')
    .map((term) => scopeTermWords(viewOf(term.key)))
  if (reads.windowSource === 'carried' && days) carried.push(days)
  const sentences = [
    `About: ${list([...named, ...(dates ? [dates] : [])]) || 'nothing yet'}.`,
    carried.length ? `From your last question: ${list(carried)}.` : '',
    ...reads.undecided.map(
      (words) =>
        `“${words.words}” could be ${list(
          words.options.map((option) => option.name),
          'or',
        )}.`,
    ),
  ]
  return sentences.filter(Boolean).join(' ')
}

const list = (names: string[], last = 'and') =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} ${last} ${names.at(-1)}`

/** A plain button that takes a chip off, with the words a screen reader says. */
function Remove({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className={removeClass}>
      <XIcon aria-hidden="true" className="size-icon-sm" />
    </button>
  )
}

/**
 * The line. A choice for words that name more than one term makes those words a chip of it in
 * the question (`onChoose`), or, in the plain box, adds it to what was picked for this question,
 * through `onPickedChange`, as removing a picked chip takes it off; `onPickDates` opens the dates
 * for dates the words name but Heed cannot read. The question's own chips are changed in it, so
 * here they have no remove button.
 */
export function AskReads({
  id,
  reads,
  state,
  reading,
  picked,
  onPickedChange,
  onChoose,
  onPickDates,
  onDone,
  className,
}: {
  /** The live region's id, which the box's description names. */
  id: string
  reads: Reads
  state: ReadState
  /** The terms the words name, as the service read them: their names come with them. */
  reading: TryItReading['about']
  picked: TryItScope | null
  onPickedChange: (scope: TryItScope | null) => void
  /** Makes words that name more than one term a chip of one; false when it cannot. */
  onChoose?: (words: string, key: string) => boolean
  onPickDates: () => void
  /** After a choice or a removal, whose button is gone: the focus goes back to the words. */
  onDone: () => void
  className?: string
}) {
  const { viewOf } = useTermViews(reads, reading)
  const { ref: railRef, start: clipStart, end: clipEnd } = useScrollEdges<HTMLUListElement>()
  const [pinned, setPinned] = useAskPinned()
  const { drop } = useAskDropped()
  const shown = readsSomething(reads) || state !== 'idle'
  const words = readsWords(reads, viewOf)
  const days = daysOf(reads)
  const pick = (key: string, words: string) => {
    if (onChoose?.(words, key)) return
    const base = picked ?? { scope: emptyScope, from: null, to: null }
    onPickedChange({ ...base, scope: addToScope(base.scope, key) })
    onDone()
  }
  const keep = (next: TryItScope) => {
    onPickedChange(hasAnything(next) ? next : null)
    onDone()
  }
  const unpick = (key: string) => {
    if (!picked) return
    keep({ ...picked, scope: removeFromScope(picked.scope, key) })
  }
  const items: ReactNode[] = []
  for (const term of reads.terms) {
    const view = viewOf(term.key)
    const named = scopeTermWords(view)
    items.push(
      <li key={`${term.source}:${term.key}`} className="relative flex max-w-full shrink-0">
        <span
          data-slot="reads-chip"
          data-source={term.source}
          className={cn(
            chipClass,
            term.source === 'carried' && 'border-dashed text-muted-foreground',
          )}
        >
          <ScopeTermLabel term={view} />
          <span className="sr-only">
            {term.source === 'tagged'
              ? ', in your question'
              : term.source === 'typed'
                ? ', from your words'
                : term.source === 'picked'
                  ? ', picked'
                  : ', carried from your last question'}
          </span>
          {term.source === 'picked' ? (
            <Remove label={`Remove ${named}`} onClick={() => unpick(term.key)} />
          ) : term.source === 'carried' ? (
            <Remove
              label={`Remove ${named}, carried from your last question`}
              onClick={() => {
                drop(term.key)
                onDone()
              }}
            />
          ) : null}
        </span>
      </li>,
    )
  }
  if (
    picked &&
    (reads.terms.some((term) => term.source === 'picked') || reads.windowSource === 'picked')
  )
    items.push(
      <li key="pin" className="flex shrink-0">
        <Tooltip>
          <TooltipTrigger
            type="button"
            aria-pressed={pinned}
            aria-label="Keep what you picked for the next questions"
            onClick={() => setPinned(!pinned)}
            className={cn(pinClass, 'aria-pressed:bg-status-info-bg aria-pressed:text-foreground')}
          >
            <PinIcon aria-hidden="true" className="size-4" />
          </TooltipTrigger>
          <TooltipContent>
            {pinned
              ? 'Kept for the next questions. Press to use it for this question only.'
              : 'For this question only. Press to keep it for the next questions.'}
          </TooltipContent>
        </Tooltip>
      </li>,
    )
  for (const undecided of reads.undecided)
    items.push(
      <li
        key={`undecided:${undecided.words}`}
        data-slot="reads-undecided"
        className="flex shrink-0 items-center gap-1"
      >
        <span
          className={cn(
            chipClass,
            'border-status-warning-border bg-status-warning-bg text-status-warning-fg',
          )}
        >
          <TriangleAlertIcon aria-hidden="true" className="size-icon-sm shrink-0" />
          <span className="min-w-0 truncate">
            <b className="font-bold">“{undecided.words}”</b>: which one?
          </span>
        </span>
        {undecided.options.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-label={`Use ${scopeTermWords(viewOf(option.key))} for “${undecided.words}”`}
            onClick={() => pick(option.key, undecided.words)}
            className={choiceClass}
          >
            <ScopeTermLabel term={viewOf(option.key)} />
          </button>
        ))}
      </li>,
    )
  items.push(
    reads.windowSource === 'unreadable' && reads.datesProblem ? (
      <li key="dates" data-slot="reads-undecided" className="flex shrink-0 items-center gap-1">
        <span
          data-slot="reads-chip"
          data-source="unreadable"
          className={cn(
            chipClass,
            'border-status-warning-border bg-status-warning-bg text-status-warning-fg',
          )}
          title={reads.datesProblem.message}
        >
          <TriangleAlertIcon aria-hidden="true" className="size-icon-sm shrink-0" />
          <span className="min-w-0 truncate">
            <b className="font-bold">“{reads.datesProblem.words}”</b>: not dates that can be read
          </span>
        </span>
        <button type="button" onClick={onPickDates} className={choiceClass}>
          <CalendarIcon
            aria-hidden="true"
            className="size-icon-sm shrink-0 text-muted-foreground"
          />
          Pick dates
        </button>
      </li>
    ) : (
      <li key="dates" className="relative flex max-w-full shrink-0">
        <span
          data-slot="reads-chip"
          data-source={reads.windowSource}
          className={cn(
            chipClass,
            (reads.windowSource === 'carried' || reads.windowSource === 'assumed') &&
              'border-dashed text-muted-foreground',
          )}
        >
          <CalendarIcon
            aria-hidden="true"
            className="size-icon-sm shrink-0 text-muted-foreground"
          />
          <span className="min-w-0 truncate">
            {reads.windowSource === 'assumed' ? (
              <>
                <span className="text-foreground">
                  {reads.today ? upperFirst(dayWords(reads.today, formatDay)) : 'Today'}
                </span>{' '}
                · no dates given
              </>
            ) : (
              <>
                <span className={reads.windowSource === 'carried' ? 'text-foreground' : undefined}>
                  {days}
                </span>
                {reads.windowSource === 'carried' ? ' · carried' : null}
                {reads.datesNote ? (
                  <span className="text-muted-foreground"> · {reads.datesNote}</span>
                ) : null}
              </>
            )}
          </span>
          {reads.windowSource === 'picked' && picked ? (
            <Remove
              label={`Remove the dates ${days ?? ''}`}
              onClick={() => {
                keep({ ...picked, from: null, to: null })
              }}
            />
          ) : reads.windowSource === 'carried' ? (
            <Remove
              label={`Remove the dates ${days ?? ''}, carried from your last question`}
              onClick={() => {
                drop('window')
                onDone()
              }}
            />
          ) : null}
        </span>
      </li>
    ),
  )
  return (
    <div
      data-slot="ask-reads"
      data-state={state}
      hidden={!shown}
      className={cn(
        'flex min-w-0 flex-col gap-1 rounded-sm has-[>ul:focus-visible]:outline-2 has-[>ul:focus-visible]:outline-offset-2 has-[>ul:focus-visible]:outline-ring',
        className,
      )}
    >
      {/* One line, one chip high, at every width: what does not fit scrolls sideways, under a
          fade at each edge that hides some. A focused chip scrolls clear of the fade; while some
          is hidden, the line is a tab stop of its own, which the arrow keys scroll. */}
      <ul
        ref={railRef}
        aria-label="About"
        data-clip-start={clipStart || undefined}
        data-clip-end={clipEnd || undefined}
        tabIndex={clipStart || clipEnd ? 0 : undefined}
        onFocus={(event) => {
          if (event.target === event.currentTarget) return
          // A chip's remove button brings the whole chip into view. The first and the last chip
          // bring the line to its own edge, so no sliver of it stays under the fade.
          const rail = event.currentTarget
          const shown = event.target.closest('[data-slot="reads-chip"]') ?? event.target
          const chips = rail.querySelectorAll('[data-slot="reads-chip"]')
          if (shown === chips[0]) rail.scrollTo({ left: 0 })
          else if (shown === chips[chips.length - 1]) rail.scrollTo({ left: rail.scrollWidth })
          else shown.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        }}
        className="scroll-fade-x no-scrollbar flex min-w-0 scroll-px-6 items-center gap-2 overflow-x-auto overscroll-x-contain scroll-smooth outline-none **:ring-inset motion-reduce:scroll-auto"
      >
        <li aria-hidden="true" className="shrink-0 text-caption text-muted-foreground">
          About
        </li>
        {items}
      </ul>
      {state === 'failed' ? (
        <span className="text-caption text-muted-foreground">
          We couldn’t read your words just now, so the assistant reads them itself.
        </span>
      ) : null}
      <span id={id} aria-live="polite" className="sr-only">
        {shown ? words : ''}
      </span>
    </div>
  )
}

const upperFirst = (words: string) => words.charAt(0).toUpperCase() + words.slice(1)

const hasAnything = (scope: TryItScope) => scope.from !== null || hasTerms(scope.scope)
