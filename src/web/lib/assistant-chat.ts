import { useEffect, useSyncExternalStore } from 'react'
import { QUESTION_SCOPE_PART } from '../../contract/assistant.ts'
import { api, type AssistantChatInput, type RatingInput } from '@/api'
import { draftText, textDraft, type AskDraft } from '@/lib/ask-draft'
import { applyChunk, newStreamState } from '@/lib/ask-stream'
import type { AskMessage } from '@/lib/assistant'
import type { TryItScope } from '@/lib/try-it'
import { useSession } from '@/lib/use-session'

/*
  The Ask tab's conversation (Assistant board, gap G1): a chat over the assistant's one streaming
  endpoint, in the AI SDK's message shape. The service keeps no conversation (FR-603), so the browser holds it and
  sends it every turn. It lives in this module, not in the panel, so it stays as the panel
  closes and opens, and as it expands to its page. It is kept in memory only, never in storage:
  a reload ends it, and so does another person signing in, so a question never outlives the tab
  or reaches someone else on a shared computer. Nothing is sent anywhere else.

  The scope the person picked is shared the same way: Ask and What an agent would get read and
  set one scope, so a question and the facts an agent gets are always about the same thing. So is
  the question being typed, so it stays as the panel expands to its page, and New chat knows
  whether starting afresh would lose it.
*/

type Listener = () => void
/** Thumbs up or down on an answer. */
export type RatingVerdict = RatingInput['verdict']

/** Ready, waiting for the first chunk, streaming, or stopped by an error. */
export type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error'

/** Chat state the React tree subscribes to: each change makes a new snapshot. */
class AskState {
  #status: ChatStatus = 'ready'
  #error: Error | undefined
  #messages: AskMessage[]
  readonly #listeners = new Set<Listener>()
  #snapshot: AskSnapshot

  constructor(messages: AskMessage[]) {
    this.#messages = messages
    this.#snapshot = this.#take()
  }

  #take(): AskSnapshot {
    return { messages: this.#messages, status: this.#status, error: this.#error }
  }

  #emit() {
    this.#snapshot = this.#take()
    for (const listener of this.#listeners) listener()
  }

  get status() {
    return this.#status
  }
  set status(status: ChatStatus) {
    this.#status = status
    this.#emit()
  }
  get error() {
    return this.#error
  }
  set error(error: Error | undefined) {
    this.#error = error
    this.#emit()
  }
  get messages() {
    return this.#messages
  }
  set messages(messages: AskMessage[]) {
    this.#messages = messages
    this.#emit()
  }

  pushMessage = (message: AskMessage) => {
    this.messages = [...this.#messages, message]
  }
  popMessage = () => {
    this.messages = this.#messages.slice(0, -1)
  }
  replaceMessage = (index: number, message: AskMessage) => {
    this.messages = this.#messages.map((m, i) => (i === index ? message : m))
  }
  subscribe = (listener: Listener) => {
    this.#listeners.add(listener)
    return () => void this.#listeners.delete(listener)
  }
  read = () => this.#snapshot
}

export type AskSnapshot = {
  messages: AskMessage[]
  status: ChatStatus
  error: Error | undefined
}

/**
 * The conversation as the service reads it: the scope line joins each question as text the model
 * reads, and its scope as get_context's fields (`data-scope`), which the service binds the
 * latest question's tool calls to; a step that never finished (a stop, a failure) is left out, as
 * the model never saw it.
 */
export function toWire(messages: readonly AskMessage[]): AssistantChatInput['messages'] {
  return messages.flatMap((message): AssistantChatInput['messages'] => {
    if (message.role === 'system') return []
    if (message.role === 'user') {
      const line = message.metadata?.scopeText
      const read = message.metadata?.read
      return [
        {
          ...message,
          role: 'user',
          parts: [
            ...message.parts,
            ...(line ? [{ type: 'text' as const, text: line }] : []),
            // The scope the person saw, as fields the service binds the tool calls to.
            ...(read ? [{ type: QUESTION_SCOPE_PART, data: read } as const] : []),
          ],
        },
      ]
    }
    const parts = message.parts.filter(
      (part) =>
        !(
          part.type === 'dynamic-tool' &&
          (part.state === 'input-streaming' || part.state === 'input-available')
        ),
    )
    return parts.some((part) => part.type === 'text' || part.type === 'dynamic-tool')
      ? [{ ...message, role: 'assistant', parts }]
      : []
  })
}

/** The person's time zone, so "today" and "last week" are theirs; none when the browser says none. */
function timeZone(): { timeZone?: string } {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return zone ? { timeZone: zone } : {}
}

/** A message id: random, and unique within the conversation. */
const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')

/**
 * The chat: sends the conversation, reads the answer as it streams (lib/ask-stream.ts), and can
 * stop, ask again and confirm a draft. Each change goes to the store the React tree reads.
 */
class AskChat {
  readonly store: AskState
  #controller: AbortController | null = null

  constructor(store: AskState) {
    this.store = store
  }

  /**
   * Asks a question: the person's message, then the answer. The message shows at once. With
   * `ready`, the answer waits for it, the scope the question goes with once its words are read,
   * and the message takes it; until then, and if it fails, the message has `metadata`.
   */
  sendMessage({
    text,
    metadata = {},
    ready,
  }: {
    text: string
    metadata?: AskMessage['metadata']
    ready?: Promise<AskMessage['metadata']>
  }) {
    this.store.pushMessage({
      id: newId(),
      role: 'user',
      parts: [{ type: 'text', text }],
      metadata: { ...metadata, at: new Date().toISOString() },
    })
    return this.#answer(ready)
  }

  /** Asks the last question again: the answer that failed or was stopped goes. */
  regenerate() {
    if (this.store.messages.at(-1)?.role === 'assistant') this.store.popMessage()
    return this.#answer()
  }

  /** The person's answer to a draft the assistant proposed; the assistant then goes on. */
  addToolApprovalResponse({ id, approved }: { id: string; approved: boolean }) {
    const index = this.store.messages.length - 1
    const last = this.store.messages[index]
    if (last?.role !== 'assistant') return Promise.resolve()
    this.store.replaceMessage(index, {
      ...last,
      parts: last.parts.map((part) =>
        part.type === 'dynamic-tool' &&
        part.state === 'approval-requested' &&
        part.approval.id === id
          ? // The request's signature goes back with the answer: the service runs only the call
            // it signed.
            { ...part, state: 'approval-responded', approval: { ...part.approval, approved } }
          : part,
      ),
    })
    return this.#answer()
  }

  /** Stops the answer where it is: what came stays. */
  stop() {
    this.#controller?.abort()
    return Promise.resolve()
  }

  /** Starts a new conversation: nothing of the old one is kept. */
  clear() {
    this.#controller?.abort()
    this.#controller = null
    this.store.messages = []
    this.store.error = undefined
    this.store.status = 'ready'
  }

  /**
   * Streams the answer to the conversation as it is. After a confirmation the last message is the
   * assistant's, and the answer goes on in it; otherwise a new one starts.
   */
  async #answer(ready?: Promise<AskMessage['metadata']>) {
    this.#controller?.abort()
    const controller = new AbortController()
    this.#controller = controller
    const store = this.store
    store.error = undefined
    store.status = 'submitted'
    if (ready) {
      const question = store.messages.length - 1
      const metadata = await Promise.race([
        ready.catch(() => undefined),
        new Promise<undefined>((resolve) =>
          controller.signal.addEventListener('abort', () => resolve(undefined), { once: true }),
        ),
      ])
      if (this.#controller !== controller) return
      if (controller.signal.aborted) {
        this.#controller = null
        store.status = 'ready'
        return
      }
      const asked = store.messages[question]
      if (metadata && asked?.role === 'user')
        store.replaceMessage(question, { ...asked, metadata: { ...asked.metadata, ...metadata } })
    }
    const goesOn = store.messages.at(-1)?.role === 'assistant'
    let index = goesOn ? store.messages.length - 1 : -1
    let message: AskMessage = goesOn
      ? store.messages[index]!
      : { id: newId(), role: 'assistant', parts: [], metadata: { at: new Date().toISOString() } }
    const state = newStreamState()
    const write = (next: AskMessage) => {
      message = next
      if (index < 0) {
        store.pushMessage(message)
        index = store.messages.length - 1
      } else store.replaceMessage(index, message)
    }
    try {
      const chunks = await api.assistantChat(
        { messages: toWire(store.messages), ...timeZone() },
        { signal: controller.signal },
      )
      for await (const chunk of chunks) {
        if (controller.signal.aborted) break
        write(applyChunk(message, chunk, state))
        // How the answer ended goes on the message, so a cut answer says so.
        if (chunk.type === 'finish' && chunk.finishReason)
          write({ ...message, metadata: { ...message.metadata, finishReason: chunk.finishReason } })
        if (store.status === 'submitted') store.status = 'streaming'
      }
      if (this.#controller === controller) store.status = 'ready'
    } catch (error) {
      if (this.#controller !== controller) return
      if (controller.signal.aborted) store.status = 'ready'
      else {
        store.error = error instanceof Error ? error : new Error(String(error))
        store.status = 'error'
      }
    } finally {
      if (this.#controller === controller) this.#controller = null
    }
  }
}

let chat: AskChat | null = null
/** Whose conversation it is: another person signed in starts a new one. */
let owner: string | undefined

/** The one conversation of this tab. */
export function askChat(): AskChat {
  chat ??= new AskChat(new AskState([]))
  return chat
}

/** The conversation as React reads it: messages, whether it is answering, and its error. */
export function useAskChat(): AskSnapshot & { chat: AskChat } {
  const current = askChat()
  const snapshot = useSyncExternalStore(current.store.subscribe, current.store.read)
  const personId = useSession().data?.person.id
  useEffect(() => {
    if (personId === undefined) return
    if (owner !== undefined && owner !== personId) startNewChat()
    owner = personId
  }, [personId, current])
  return { ...snapshot, chat: current }
}

/** Starts the module's conversation afresh: for tests and stories. */
export function resetAskChat(messages: AskMessage[] = []) {
  chat?.clear()
  chat = new AskChat(new AskState(messages))
  owner = undefined
  composer = freshComposer
  emitComposer()
  forgetRatings()
}

/**
 * The composer's state the panel and the page share: the question being typed, whether New chat
 * is asking before it drops that question, whether what was picked is kept for the next
 * questions (pinned), the carried terms the person took off the next question, by key, with
 * `window` for the dates, and a question asked from outside the assistant that waits to be sent.
 */
type ComposerState = {
  /** The question being typed: its words and the chips in them. */
  draft: AskDraft
  confirming: boolean
  pinned: boolean
  dropped: string[]
  /** A question asked elsewhere (Home's search field), for the Ask tab on screen to send. */
  handoff: string | null
}
const freshComposer: ComposerState = {
  draft: [],
  confirming: false,
  pinned: false,
  dropped: [],
  handoff: null,
}
let composer: ComposerState = freshComposer
const composerListeners = new Set<Listener>()
function emitComposer() {
  for (const listener of composerListeners) listener()
}
function setComposer(next: Partial<ComposerState>) {
  composer = { ...composer, ...next }
  emitComposer()
}
const subscribeComposer = (listener: Listener) => {
  composerListeners.add(listener)
  return () => void composerListeners.delete(listener)
}

/** The question being typed, as words and chips, shared by the panel and the page. */
export function useAskDraft(): [AskDraft, (draft: AskDraft) => void] {
  const draft = useSyncExternalStore(subscribeComposer, () => composer.draft)
  return [draft, setAskDraft]
}
export const setAskDraft = (draft: AskDraft) => setComposer({ draft })
/** The question being typed as words, each chip as its words. */
export const askDraftText = () => draftText(composer.draft)
/** Puts words in the box, without chips. */
export const setAskDraftText = (text: string) => setAskDraft(textDraft(text))

/** Starts a new conversation at once: the chat so far and the question being typed go. */
export function startNewChat() {
  askChat().clear()
  setComposer({ draft: [], confirming: false, dropped: [], handoff: null })
  forgetRatings()
}

/**
 * Asks a question typed outside the assistant (Home's search field) in a new chat: the chat so
 * far goes at once, an answer still coming included, as New chat drops it, and the Ask tab on
 * screen sends the question (`useAskHandoff`), with the scope its words name, as Send does. A
 * question typed in the composer and not sent stays there, so no typed words are lost.
 */
export function askInNewChat(question: string) {
  const words = question.trim()
  if (!words) return
  askChat().clear()
  setComposer({ confirming: false, dropped: [], handoff: words })
  forgetRatings()
}

/**
 * The question `askInNewChat` handed over, and a way to take it, once: the Ask tab that takes it
 * sends it, so it is sent once even if the panel and the page both show for a moment.
 */
export function useAskHandoff(): [string | null, () => string | null] {
  const handoff = useSyncExternalStore(subscribeComposer, () => composer.handoff)
  return [handoff, takeAskHandoff]
}
function takeAskHandoff() {
  const { handoff } = composer
  if (handoff !== null) setComposer({ handoff: null })
  return handoff
}

/**
 * Whether what was picked with the scope picker stays for the next questions. Unpinned, it
 * applies to the question it was picked for, and the next one shows it as carried.
 */
export function useAskPinned(): [boolean, (pinned: boolean) => void] {
  const pinned = useSyncExternalStore(subscribeComposer, () => composer.pinned)
  return [pinned, (next) => setComposer({ pinned: next })]
}

/** The carried terms taken off the next question, and a way to take one off or start afresh. */
export function useAskDropped(): {
  dropped: readonly string[]
  drop: (key: string) => void
  reset: () => void
} {
  const dropped = useSyncExternalStore(subscribeComposer, () => composer.dropped)
  return {
    dropped,
    drop: (key) => setComposer({ dropped: [...new Set([...composer.dropped, key])] }),
    reset: () => setComposer({ dropped: [] }),
  }
}

/**
 * The answers of this conversation the person rated (FR-712), by message id, so each answer is
 * rated once, in the panel and on the page alike. Kept like the conversation, in memory only; a
 * new chat forgets them. The service keeps no link from a rating to an answer or a person.
 */
let ratings: ReadonlyMap<string, RatingVerdict> = new Map()
const ratingListeners = new Set<Listener>()
const subscribeRatings = (listener: Listener) => {
  ratingListeners.add(listener)
  return () => void ratingListeners.delete(listener)
}
function forgetRatings() {
  ratings = new Map()
  for (const listener of ratingListeners) listener()
}

/** Records that the person rated an answer, once the service counted it. */
export function setAnswerRated(id: string, verdict: RatingVerdict) {
  ratings = new Map([...ratings, [id, verdict]])
  for (const listener of ratingListeners) listener()
}

/** The verdicts given in this conversation, by answer. */
export function useAnswerRatings(): ReadonlyMap<string, RatingVerdict> {
  return useSyncExternalStore(subscribeRatings, () => ratings)
}

/**
 * New chat, from the button or the command: at once, unless a question is typed and not sent,
 * which the confirmation (`useNewChatConfirm`) asks about first.
 */
export function requestNewChat() {
  if (draftText(composer.draft).trim()) setComposer({ confirming: true })
  else startNewChat()
}

/** Whether New chat is asking before it drops the question being typed, and its answer. */
export function useNewChatConfirm(): [boolean, (open: boolean) => void] {
  const confirming = useSyncExternalStore(subscribeComposer, () => composer.confirming)
  return [confirming, (open) => setComposer({ confirming: open })]
}

let scope: TryItScope | null = null
const scopeListeners = new Set<Listener>()

/** The scope Ask and What an agent would get share in the panel. */
export const sharedScope = {
  get: () => scope,
  set: (next: TryItScope | null) => {
    scope = next
    for (const listener of scopeListeners) listener()
  },
  subscribe: (listener: Listener) => {
    scopeListeners.add(listener)
    return () => void scopeListeners.delete(listener)
  },
}

export function useSharedScope(): [TryItScope | null, (next: TryItScope | null) => void] {
  const value = useSyncExternalStore(sharedScope.subscribe, sharedScope.get)
  return [value, sharedScope.set]
}
