import {
  memo,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { toApiError } from '@/api'
import { areasQuery, useApiWrite } from '@/api/queries'
import { showToast } from '@/lib/toast'
import { scopeTermWords } from '@/components/mentions/scope-term'
import { formatDay } from '@/lib/library'
import {
  answerAsMarkdown,
  dayWords,
  factCountWords,
  rangeWords,
  readAnswer,
  readQuestion,
  type AnswerView,
  type AskMessage,
  type Starter,
} from '@/lib/assistant'
import {
  requestNewChat,
  setAnswerRated,
  useAnswerRatings,
  useAskChat,
  useAskHandoff,
} from '@/lib/assistant-chat'
import { searchOf, type TryItScope } from '@/lib/try-it'
import { scopeKeys } from '@/lib/mention-targets'
import { useLibrary } from '@/lib/use-library'
import { cn } from '@/lib/utils'
import {
  AnswerFailed,
  AskAnswer,
  type AnswerActions,
  type FactLookup,
  type RatingVerdict,
} from './ask-answer'
import { useAskSend, useVocabularyNames } from './ask-composer'
import { AskEmpty } from './ask-empty'
import { LatestPill, useConversationScroll } from './ask-scroll'
import { AssistantLabel, YouLabel } from './ask-turn'
import { ScopeChips, scopeWords, useScopeTerms } from './ask-scope'
import './answer-motion.css'

/*
  The Ask tab's conversation (Assistant board, direction A): the empty state with its suggested
  questions, then each question on the right with the scope it was asked with (what the composer's
  "Heed reads" line showed), and each answer under it. The transcript is a log that is not read word by word: one polite status says
  "Working on it" when a question is sent and "Answer ready" with the counts when it is done.
  The panel and the page both show it, over the one conversation of the tab. A question just
  sent rises into place at the top of the view, with room under it for its answer, and a Latest
  pill goes to the newest words when they are below the fold (`ask-scroll.tsx`).
*/

/** The assistant's own words when its service stops part way (assistant/chat.ts). */
const COULD_NOT_FINISH = "The assistant couldn't finish. Try again in a moment."

/** Why there is no answer, in words, and what a person can do about it. */
function failureWords(error: Error) {
  if (error.message === COULD_NOT_FINISH)
    return {
      title: 'The assistant couldn’t finish',
      description: 'Try again in a moment. Your question wasn’t saved, and nothing was recorded.',
      tooLong: false,
    }
  const failure = toApiError(error)
  if (failure.kind === 'invalid' && /too long/i.test(failure.message))
    return {
      title: 'This chat is too long',
      description:
        'The assistant reads the whole chat each time, and this one is now too long. Copy what you need, then start a new chat.',
      tooLong: true,
    }
  if (failure.kind === 'signed-out')
    return {
      title: 'You’re signed out',
      description: 'Sign in again, then ask again. Your question wasn’t sent.',
      tooLong: false,
    }
  if (failure.kind === 'unavailable')
    return {
      title: 'The assistant couldn’t answer',
      description:
        'It’s busy or didn’t respond. Try again in a moment. Your question wasn’t saved.',
      tooLong: false,
    }
  return {
    title: 'The assistant couldn’t answer',
    description: 'Something went wrong with this question. Try again, or ask it another way.',
    tooLong: false,
  }
}

/**
 * The person's question, on the right, with the chips of the scope it was asked with: what the
 * "Heed reads" line showed. Under them, what was carried from the question before, and the day it
 * was read at when it gave no dates. Just sent, it rises into place.
 */
const Question = memo(function Question({
  message,
  sent,
  ref,
}: {
  message: AskMessage
  sent: boolean
  ref?: Ref<HTMLDivElement>
}) {
  const [arrived] = useState(sent)
  const question = readQuestion(message)
  const carried = question.carried.filter((key) => key !== 'window')
  const terms = useScopeTerms(carried)
  const carriedWords = [
    ...carried.map((key) => {
      const term = terms.get(key)
      return term ? scopeTermWords(term) : key
    }),
    ...(question.carried.includes('window') && question.scope
      ? [rangeWords(question.scope.from, question.scope.to, formatDay) ?? '']
      : []),
  ].filter(Boolean)
  const notes = [
    carriedWords.length ? `Also about ${carriedWords.join(', ')}, from your last question.` : null,
    question.assumedDay
      ? `No dates given, so I used ${dayWords(question.assumedDay, (day) => formatDay(day, 'long'))}.`
      : null,
  ].filter(Boolean)
  return (
    <div
      ref={ref}
      data-slot="ask-question"
      className={cn('flex flex-col items-end gap-2', arrived && 'animate-arrive-fast')}
    >
      <YouLabel />
      <p className="max-w-10/12 rounded-lg bg-muted px-3 py-2 text-body break-words whitespace-pre-line">
        <span className="sr-only">You asked: </span>
        {question.text}
      </p>
      {question.scope ? (
        <ScopeChips scope={question.scope} label="Asked about" className="justify-end" />
      ) : null}
      {notes.length ? (
        <p data-slot="ask-question-notes" className="text-right text-caption text-muted-foreground">
          {notes.join(' ')}
        </p>
      ) : null}
    </div>
  )
})

const noAreas: { id: string; name: string }[] = []

/**
 * Each message's answer as read, kept while the message and what reads it stay the same. While an
 * answer streams, only its own message changes, so every answer before it keeps its reading and
 * is not drawn again: a long conversation stays quick.
 */
const readings = new WeakMap<AskMessage, { names: AnswerNames; answer: AnswerView }>()
type AnswerNames = NonNullable<Parameters<typeof readAnswer>[1]>

function readOnce(message: AskMessage, names: AnswerNames): AnswerView {
  const kept = readings.get(message)
  if (
    kept &&
    kept.names.titleOf === names.titleOf &&
    kept.names.areas === names.areas &&
    kept.names.nameOf === names.nameOf
  )
    return kept.answer
  const answer = readAnswer(message, names)
  readings.set(message, { names, answer })
  return answer
}

/** Library facts for chips and rows, by id. */
function useFactLookup() {
  const library = useLibrary()
  const areas = useQuery(areasQuery()).data ?? noAreas
  return useMemo(() => {
    const byId = new Map(library.rows.map((row) => [row.id, row]))
    const lookup: FactLookup = (id) => byId.get(id) ?? null
    const titleOf = (id: string) => byId.get(id)?.title
    return { lookup, titleOf, areas }
  }, [library.rows, areas])
}

/** "Answer ready. 2 facts apply, 2 don’t." for the one live status. */
function readyWords(answer: AnswerView): string {
  if (answer.limit) return 'The assistant has reached a spending limit.'
  if (answer.refused) return 'The assistant can’t answer this one.'
  if (answer.notFound) return 'Answer ready. Nothing is written down for this.'
  const apply = answer.facts.filter(
    (f) => f.verdict === 'applies' || f.verdict === 'partial',
  ).length
  const not = answer.facts.filter((f) => f.verdict === 'not').length
  const counts = [
    apply ? `${factCountWords(apply)} ${apply === 1 ? 'applies' : 'apply'}` : null,
    not ? `${not.toLocaleString('en')} ${not === 1 ? 'doesn’t' : 'don’t'}` : null,
  ].filter(Boolean)
  return `Answer ready.${counts.length ? ` ${counts.join(', ')}.` : ''}`
}

const pending: AskMessage = { id: 'pending', role: 'assistant', parts: [] }

/**
 * The thumbs under each answer (FR-712): one rating an answer, sent with the metrics of its scope
 * so it counts in that domain, and nothing else. Who rated, the question and the answer stay here.
 */
function useAnswerRating() {
  const rate = useApiWrite('rateAnswer')
  const given = useAnswerRatings()
  const [sending, setSending] = useState<string | null>(null)
  const ratingOf = (id: string, scope: TryItScope | null): AnswerActions['rating'] => ({
    given: given.get(id) ?? null,
    sending: sending === id,
    onRate: (verdict: RatingVerdict) => {
      if (sending !== null) return
      setSending(id)
      const metrics = scope?.scope.metrics ?? []
      rate.mutate(
        { verdict, ...(metrics.length ? { metrics: metrics.slice(0, 10) } : {}) },
        {
          onSuccess: () => setAnswerRated(id, verdict),
          onError: (error) =>
            toApiError(error).status === 429
              ? showToast('Too many ratings', 'Wait a minute, then rate this answer again.')
              : showToast("The rating wasn't saved", 'Try again shortly.'),
          onSettled: () => setSending(null),
        },
      )
    },
  })
  return ratingOf
}

export function AskTranscript({
  scope,
  onScopeChange,
  onOpenAgent,
  agentHref,
  onLeave,
  factsClassName,
  className,
}: {
  scope: TryItScope | null
  onScopeChange: (scope: TryItScope | null) => void
  onOpenAgent: AnswerActions['onOpenAgent']
  agentHref: AnswerActions['agentHref']
  onLeave?: () => void
  /** Classes for each answer's facts: the page hides them where its side column lists them. */
  factsClassName?: string
  className?: string
}) {
  const { messages, status, error, chat } = useAskChat()
  const { send } = useAskSend()
  const { lookup, titleOf, areas } = useFactLookup()
  const nameOf = useVocabularyNames()
  const ratingOf = useAnswerRating()
  const busy = status === 'submitted' || status === 'streaming'

  const last = messages.at(-1)
  const answers = useMemo(
    () =>
      new Map(
        messages.flatMap((message) =>
          message.role === 'assistant'
            ? [[message.id, readOnce(message, { titleOf, areas, nameOf })]]
            : [],
        ),
      ),
    [messages, titleOf, areas, nameOf],
  )
  // Names for the scope in words (copy, Start a draft): every term asked about or used.
  const keys = useMemo(() => {
    const all = new Set<string>()
    for (const message of messages) {
      const about = message.metadata?.scope?.about
      if (about) for (const key of about.split(',')) all.add(key)
    }
    for (const answer of answers.values())
      if (answer.scopeUsed) for (const key of scopeKeys(answer.scopeUsed.scope)) all.add(key)
    return [...all].sort()
  }, [messages, answers])
  const terms = useScopeTerms(keys)
  // A question just sent comes to the top of the view, and the answer grows under it: the
  // person reads from its start, and the view does not chase the words as they arrive.
  const newest = last?.role === 'user' ? last.id : null
  const lastQuestionIndex = messages.findLastIndex((m) => m.role === 'user')
  const root = useRef<HTMLDivElement>(null)
  const log = useRef<HTMLDivElement>(null)
  const lastQuestion = useRef<HTMLDivElement>(null)
  const { below, toLatest } = useConversationScroll({
    root,
    log,
    question: lastQuestion,
    questionId: messages[lastQuestionIndex]?.id ?? null,
    answerId:
      messages.length - 1 > lastQuestionIndex
        ? (last?.id ?? null)
        : busy
          ? 'pending'
          : status === 'error'
            ? 'failed'
            : null,
    sent: newest,
    shown: messages,
    status,
  })

  // A starter's own scope goes with it; without one, it takes what was picked, as Send does.
  const ask = (starter: Starter) =>
    starter.scope
      ? send(starter.question, starter.scope)
      : send(starter.question, scope, () => onScopeChange(null))

  // A question asked outside the assistant (Home's search field) is this new chat's first: it is
  // sent as Send sends it, as soon as the panel or the page shows it.
  const [handoff, takeHandoff] = useAskHandoff()
  const sendHandoff = useEffectEvent(() => {
    const question = takeHandoff()
    if (question) send(question, scope, () => onScopeChange(null))
  })
  useEffect(() => {
    if (handoff !== null) sendHandoff()
  }, [handoff])

  const announcement = useMemo(() => {
    if (status === 'submitted' || status === 'streaming') return 'Working on it.'
    if (status === 'error') return 'The assistant couldn’t answer.'
    const answer = last?.role === 'assistant' ? answers.get(last.id) : undefined
    return answer ? readyWords(answer) : ''
  }, [status, last, answers])

  if (!messages.length)
    return (
      <div className={className}>
        <AskEmpty onAsk={ask} />
        <span role="status" className="sr-only" />
      </div>
    )

  const failed = status === 'error' && error ? failureWords(error) : null
  const actionsFor = (
    id: string,
    answer: AnswerView,
    question: AskMessage | undefined,
  ): AnswerActions => ({
    onOpenAgent,
    agentHref,
    onLeave,
    onCopy: () => {
      const asked = answer.scopeUsed ?? (question ? readQuestion(question).scope : null)
      const scopeText = asked ? scopeWords(asked, terms) : null
      const markdown = answerAsMarkdown(answer, {
        origin: window.location.origin,
        titleOf: (id) => answer.facts.find((f) => f.id === id)?.title ?? titleOf(id) ?? id,
        scopeWords: scopeText,
      })
      void navigator.clipboard.writeText(markdown).then(
        () => showToast('Answer copied', 'Each fact is a link to its page.'),
        () => showToast('Couldn’t copy the answer', 'Your browser didn’t allow it.'),
      )
    },
    onRetry: () => void chat.regenerate(),
    onContinue: () => {
      send('Continue.', scope, () => onScopeChange(null))
    },
    onNewChat: requestNewChat,
    onApprove: (approval, approved) =>
      void chat.addToolApprovalResponse({ id: approval, approved }),
    rating: ratingOf(id, answer.scopeUsed ?? (question ? readQuestion(question).scope : null)),
  })
  const items: ReactNode[] = []
  messages.forEach((message, index) => {
    if (message.role === 'user') {
      items.push(
        <Question
          key={message.id}
          message={message}
          sent={message.id === newest}
          ref={index === lastQuestionIndex ? lastQuestion : undefined}
        />,
      )
      return
    }
    if (message.role !== 'assistant') return
    const question = messages.slice(0, index).findLast((m) => m.role === 'user')
    const answer = answers.get(message.id)!
    const asked = question ? readQuestion(question).scope : null
    const scopeOf = answer.scopeUsed ?? asked
    const isLast = index === messages.length - 1
    const actions = actionsFor(message.id, answer, question)
    items.push(
      <AskAnswer
        key={message.id}
        answer={answer}
        scope={scopeOf}
        scopeText={scopeOf ? scopeWords(scopeOf, terms) : null}
        lookup={lookup}
        working={isLast && busy}
        latest={isLast}
        factsClassName={factsClassName}
        failed={
          isLast && failed ? (
            <AnswerFailed
              {...failed}
              canRetry
              canCopy={answer.plain.length > 0}
              actions={actions}
            />
          ) : null
        }
        actions={actions}
      />,
    )
  })
  // Asked, and nothing has come back yet: the answer's frame, working or failed.
  if (lastQuestionIndex === messages.length - 1) {
    const actions = actionsFor(pending.id, readAnswer(pending), last)
    items.push(
      busy ? (
        <AskAnswer
          key="pending"
          answer={readAnswer(pending)}
          scope={null}
          scopeText={null}
          lookup={lookup}
          working
          latest
          failed={null}
          actions={actions}
        />
      ) : failed ? (
        <article
          key="pending"
          data-slot="ask-answer"
          data-state="failed"
          aria-label="Answer"
          className="flex flex-col gap-3"
        >
          <AssistantLabel />
          <AnswerFailed {...failed} canRetry canCopy={false} actions={actions} />
        </article>
      ) : null,
    )
  }

  return (
    <div ref={root} className={cn('flex min-w-0 flex-col', className)}>
      <div
        ref={log}
        role="log"
        aria-label="Conversation with the assistant"
        aria-live="off"
        data-slot="ask-transcript"
        className="flex min-w-0 flex-col gap-8"
      >
        {items}
      </div>
      <LatestPill shown={below} onClick={toLatest} />
      <span role="status" data-slot="ask-announcer" className="sr-only">
        {announcement}
      </span>
    </div>
  )
}

/** The address of What an agent would get for a scope, as a full link to copy. */
export function agentHrefOf(scope: TryItScope | null): string {
  const search = new URLSearchParams()
  if (scope)
    for (const [key, value] of Object.entries(searchOf(scope))) if (value) search.set(key, value)
  const query = search.toString()
  return `${window.location.origin}/try-it${query ? `?${query}` : ''}`
}
