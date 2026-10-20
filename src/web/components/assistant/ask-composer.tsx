import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { TryItReading } from '@/api'
import { editionListQuery, tryItReadingQuery, vocabularyQuery } from '@/api/queries'
import {
  ArrowUpIcon,
  AtSignIcon,
  CalendarIcon,
  CircleStopIcon,
  SlidersHorizontalIcon,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { readAnswer, readQuestion, scopeLine, type AskMessage } from '@/lib/assistant'
import { draftReading, draftText, emptyDraft, textDraft, type AskDraft } from '@/lib/ask-draft'
import { draftTagged, readsOf, readsSomething } from '@/lib/ask-reads'
import { useAskChat, useAskDraft, useAskDropped, useAskPinned } from '@/lib/assistant-chat'
import { searchOf, hasTerms, type TryItScope } from '@/lib/try-it'
import { useLibrary } from '@/lib/use-library'
import { usePermissions } from '@/lib/use-session'
import { cn } from '@/lib/utils'
import type { AskEditorHandle } from './ask-editor'
import { AskReads, carriedOf, useAskReads } from './ask-reads'
import { ScopePopover } from './ask-scope'

// The chip editor is its own chunk, as the summary's is: it starts loading with the composer.
const AskEditor = lazy(() => import('./ask-editor'))

/** get_context reads at most this many characters of a question. */
const MAX_QUESTION = 2000
/** How long a question waits for its words to be read before it goes without them. */
const READ_WAIT_MS = 3000

/*
  The composer (Assistant board, A; Heed composer, stages 1 and 2): the question, with the metric,
  the market and the dates as chips in its words (ask-editor.tsx), the "Heed reads" line under it
  with what Heed will read for the question (ask-reads.tsx), and a row with @, the dates and Send,
  or Stop while an answer comes. The scope belongs to the question: its chips, the names and
  dates its other words name, what was picked for it, and what the last question carries. Enter
  sends and Shift+Enter adds a line; Up in an empty box brings back the last question; @ at the
  start of a word lists what to mention: metrics, values, dimensions, accepted items and domains,
  never people (the shared picker, mentions/mention-picker.tsx). Focus stays in the box after
  sending. Under it, one line says the chat isn't saved (editions show only on the Editions page).
  What is typed is the shared draft (lib/assistant-chat.ts), so it stays as the panel expands to
  its page; New chat, in the header, starts over. While the chip editor loads, and for good if it
  cannot, the box is the plain text box of stage 1 with its scope picker.
*/

/** Vocabulary keys to names: for the keys a reason names ("dim:market"). */
export function useVocabularyNames(): (key: string) => string | undefined {
  const vocabulary = useQuery(vocabularyQuery()).data
  return useMemo(() => {
    const names = new Map<string, string>()
    for (const metric of vocabulary?.metrics ?? []) names.set(`metric:${metric.id}`, metric.name)
    for (const dimension of vocabulary?.dimensions ?? []) {
      names.set(`dim:${dimension.id}`, dimension.name)
      for (const value of dimension.values) names.set(`val:${dimension.id}/${value.id}`, value.name)
    }
    return (key: string) => names.get(key)
  }, [vocabulary])
}

/**
 * The live edition's label, which answers use: the one the latest answer read, or, for a person
 * who maintains a domain or administers, the editions list's. Null when neither is known yet.
 */
export function useLiveEdition(): string | null {
  const { messages } = useAskChat()
  const { permissions, isAdmin } = usePermissions()
  const maintains = isAdmin || permissions.assignments.length > 0
  const editions = useQuery({ ...editionListQuery(), enabled: maintains }).data
  const answered = useMemo(() => {
    for (const message of [...messages].reverse())
      if (message.role === 'assistant') {
        const edition = readAnswer(message).edition
        if (edition) return edition
      }
    return null
  }, [messages])
  return answered ?? editions?.find((edition) => edition.live)?.label ?? null
}

/**
 * Sends a question as the conversation's next message, with the scope Heed reads for it: what the
 * "Heed reads" line shows, from its words, what was picked and what the last question carries. Its
 * tool calls are bound to that scope (`data-scope`). The question shows in the conversation at
 * once. Words not read yet are read before the answer starts, for at most `READ_WAIT_MS`; when
 * they cannot be read in time (no live edition, offline, a slow service), it goes with what was
 * picked, as words the model reads, and binds nothing.
 */
export function useAskSend() {
  const { chat, status, messages } = useAskChat()
  const queryClient = useQueryClient()
  const library = useLibrary()
  const [pinned] = useAskPinned()
  const { dropped, reset } = useAskDropped()
  const answering = status === 'submitted' || status === 'streaming'
  return {
    /** An answer is coming: Stop ends it. */
    answering,
    /**
     * Sends the question, its words or its words and chips, with `picked` for this question.
     * `onPickedUsed` clears what was picked once it went, unless the person pinned it. False when
     * there is nothing to send.
     */
    send: (question: string | AskDraft, picked: TryItScope | null, onPickedUsed?: () => void) => {
      const draft = typeof question === 'string' ? textDraft(question) : question
      const words = draftText(draft).trim()
      if (!words || answering) return false
      // Heed reads the words the chips leave; the chips are the question's own scope.
      const read = draftReading(draft).trim()
      const tagged = draftTagged(draft)
      const scoped = picked && (hasTerms(picked.scope) || picked.from) ? picked : null
      const carried = carriedOf(messages)
      const gone = new Set(dropped)
      const metadataOf = (reading: TryItReading | null): AskMessage['metadata'] => {
        if (!reading && !tagged)
          return scoped ? { scope: searchOf(scoped), scopeText: scopeLine(scoped) } : {}
        const reads = readsOf({
          reading,
          tagged,
          picked: scoped,
          carried,
          dropped: gone,
          today: library.today,
        })
        const named = hasTerms(reads.scope.scope) || reads.scope.from !== null
        return {
          ...(named ? { scope: searchOf(reads.scope), scopeText: scopeLine(reads.scope) } : {}),
          ...(readsSomething(reads) ? { read: reads.wire } : {}),
          // Today is said only for a question about something.
          ...(reads.windowSource === 'assumed' && reads.today && reads.terms.length
            ? { assumedDay: reads.today }
            : {}),
        }
      }
      const query = tryItReadingQuery(read)
      const known = queryClient.getQueryData(query.queryKey)
      // Chips alone leave nothing to read.
      if (known || !/[\p{L}\p{N}]/u.test(read) || read.length > MAX_QUESTION)
        void chat.sendMessage({ text: words, metadata: metadataOf(known ?? null) })
      else {
        // The words are read before the answer starts, so it goes with what the line shows.
        const reading = Promise.race([
          queryClient.fetchQuery(query),
          new Promise<null>((resolve) => window.setTimeout(() => resolve(null), READ_WAIT_MS)),
        ]).catch(() => null)
        void chat.sendMessage({
          text: words,
          metadata: metadataOf(null),
          ready: reading.then(metadataOf),
        })
      }
      if (!pinned) onPickedUsed?.()
      reset()
      return true
    },
  }
}

/** A button in the composer's row: a glyph, with its words in a tooltip and to a screen reader. */
function RowButton({
  label,
  glyph: Glyph,
  onClick,
}: {
  label: string
  glyph: typeof AtSignIcon
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className="text-muted-foreground"
            onClick={onClick}
          />
        }
      >
        <Glyph />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Keeps the plain box when the chip editor cannot load or breaks: asking never stops. */
class EditorBoundary extends Component<
  { fallback: ReactNode; onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override componentDidCatch() {
    this.props.onError()
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export function AskComposer({
  scope,
  onScopeChange,
  className,
}: {
  /** The scope Ask and What an agent would get share. */
  scope: TryItScope | null
  onScopeChange: (scope: TryItScope | null) => void
  className?: string
}) {
  const id = useId()
  const { chat, messages } = useAskChat()
  const { answering, send } = useAskSend()
  const library = useLibrary()
  const edition = useLiveEdition()
  const [draft, setDraft] = useAskDraft()
  const text = draftText(draft)
  const read = draftReading(draft)
  const tagged = useMemo(() => draftTagged(draft), [draft])
  // How the scope picker of the plain box is open: as an @ mention, which a pick ends, or as the
  // whole form.
  const [scopeOpen, setScopeOpen] = useState<'mention' | 'form' | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  // The chip editor once it is on screen; until then, or if it cannot load, the plain box.
  const editor = useRef<AskEditorHandle | null>(null)
  const [chips, setChips] = useState(false)
  const [broken, setBroken] = useState(false)
  // Whether the plain box had the focus when the editor took its place: the editor takes it then.
  const plainFocused = useRef(false)
  const editorRef = useCallback((handle: AskEditorHandle | null) => {
    editor.current = handle
    setChips(handle !== null)
    if (handle && plainFocused.current) {
      plainFocused.current = false
      handle.focus()
    }
  }, [])
  const last = messages.at(-1)
  // A spending limit pauses asking until it resets; What an agent would get still works.
  const paused = last?.role === 'assistant' && readAnswer(last).limit !== null
  const lastQuestion = [...messages].reverse().find((message) => message.role === 'user')

  const { reads, state, about, reading } = useAskReads(read, scope, tagged)
  const [, setPinned] = useAskPinned()
  // Nothing picked is left to keep: a later pick is for one question again.
  const pick = (next: TryItScope | null) => {
    if (!next) setPinned(false)
    onScopeChange(next)
  }
  const focus = () => (editor.current ?? box.current)?.focus()

  const submit = () => {
    if (paused) return
    if (send(draft, scope, () => onScopeChange(null))) setDraft(emptyDraft)
    focus()
  }
  const recall = () => (lastQuestion ? textDraft(readQuestion(lastQuestion).text) : null)
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault()
      submit()
    } else if (event.key === 'ArrowUp' && text === '' && lastQuestion) {
      event.preventDefault()
      setDraft(recall() ?? emptyDraft)
    } else if (event.key === '@') {
      const at = event.currentTarget.selectionStart
      if (at === 0 || /\s/.test(text[at - 1] ?? '')) {
        event.preventDefault()
        setScopeOpen('mention')
      }
    }
  }

  const scoped = scope && (hasTerms(scope.scope) || scope.from) ? scope : null
  const placeholder = paused
    ? 'You can ask again once the limit resets'
    : 'Ask about a metric, a market or a fact'
  const describedBy = [`${id}-reads`, `${id}-note`]

  // The plain box: what stands in while the chip editor loads, and for good if it cannot. A
  // draft with chips reads as their words here.
  const plain = (
    <textarea
      ref={box}
      id={`${id}-question`}
      // What New chat and G then A focus, in either box.
      data-question
      value={text}
      onChange={(event) => setDraft(textDraft(event.target.value))}
      onKeyDown={onKeyDown}
      onFocus={() => (plainFocused.current = true)}
      onBlur={() => (plainFocused.current = false)}
      rows={1}
      disabled={paused}
      aria-label="Your question"
      aria-describedby={describedBy.join(' ')}
      aria-keyshortcuts="Enter"
      placeholder={placeholder}
      className="field-sizing-content max-h-chart min-h-control-lg w-full resize-none bg-transparent px-2 py-1 text-body outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed pointer-coarse:text-large"
    />
  )

  return (
    <div
      data-slot="ask-composer"
      // Which box is on screen: the chip editor, the plain box while it loads, or for good.
      data-box={broken ? 'plain' : chips ? 'chips' : 'loading'}
      className={cn('flex w-full min-w-0 flex-col gap-2', className)}
    >
      <form
        aria-label="Ask the assistant"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        className={cn(
          'flex flex-col gap-2 rounded-lg border bg-background p-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
          paused && 'bg-muted',
        )}
      >
        {broken ? (
          plain
        ) : (
          <EditorBoundary fallback={plain} onError={() => setBroken(true)}>
            <Suspense fallback={plain}>
              <AskEditor
                handle={editorRef}
                draft={draft}
                onDraftChange={setDraft}
                reading={reading}
                read={read}
                onSubmit={submit}
                onRecall={recall}
                today={library.today}
                id={`${id}-question`}
                label="Your question"
                describedBy={describedBy}
                placeholder={placeholder}
                disabled={paused}
              />
            </Suspense>
          </EditorBoundary>
        )}
        <AskReads
          id={`${id}-reads`}
          reads={reads}
          state={state}
          reading={about}
          picked={scoped}
          onPickedChange={pick}
          onChoose={(words, key) => editor.current?.choose(words, key) ?? false}
          onPickDates={() => (editor.current ? editor.current.openDates() : setScopeOpen('form'))}
          onDone={focus}
          className="px-2"
        />
        <div className="flex items-center gap-1">
          {chips ? (
            <>
              <RowButton
                label="Mention a metric, value, fact or domain (@)"
                glyph={AtSignIcon}
                onClick={() => editor.current?.openMention()}
              />
              <RowButton
                label="Dates of the question"
                glyph={CalendarIcon}
                onClick={() => editor.current?.openDates()}
              />
            </>
          ) : (
            <>
              <RowButton
                label="Pick what it is about (@)"
                glyph={AtSignIcon}
                onClick={() => setScopeOpen('mention')}
              />
              <ScopePopover
                scope={scope}
                onChange={pick}
                today={library.today}
                edition={edition}
                open={scopeOpen !== null}
                mention={scopeOpen === 'mention'}
                onOpenChange={(open) => {
                  setScopeOpen(open ? (scopeOpen ?? 'form') : null)
                  if (!open) focus()
                }}
                trigger={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Scope: metrics, markets and dates"
                    className="text-muted-foreground"
                  >
                    <SlidersHorizontalIcon />
                  </Button>
                }
              />
            </>
          )}
          <span className="flex-1" />
          {answering ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void chat.stop()}>
              <CircleStopIcon />
              Stop
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon-sm"
              aria-label="Send"
              disabled={paused || !text.trim()}
            >
              <ArrowUpIcon />
            </Button>
          )}
        </div>
      </form>
      <p id={`${id}-note`} className="text-caption text-muted-foreground">
        This chat isn’t saved.
      </p>
    </div>
  )
}
