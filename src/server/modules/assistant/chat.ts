import { ORPCError } from '@orpc/client'
import {
  convertToModelMessages,
  dynamicTool,
  InvalidToolInputError,
  isStepCount,
  NoSuchToolError,
  safeValidateUIMessages,
  streamText,
  type ModelMessage,
  type ToolSet,
  type UIMessage,
  type UIMessageChunk,
} from 'ai'
import * as z from 'zod'
import type { FastifyBaseLogger } from 'fastify'
import { boundFields, type AssistantLimit } from '../../../contract/assistant.ts'
import type { Clock } from '../../clock.ts'
import type { Database, Queryable } from '../../db/database.ts'
import { principalFor, type Session } from '../auth/index.ts'
import {
  conversationRetry,
  costMicros,
  createCallMeter,
  parseModelSetting,
  readSpendLimits,
  spendLimitReached,
  testRunRetry,
  type CallLimiter,
  type CallLimits,
  type Sleep,
  type ModelChoice,
  type ModelPort,
  type SpendLimits,
  type SpendStop,
  webSearchesPerDay,
} from '../models/index.ts'
import { repositoryHelp, type HelpLibrary } from '../help/index.ts'
import { createPageReader, type PageReader } from '../web/index.ts'
import {
  aboutKeys,
  attachedScope,
  attachmentKeys,
  attachmentsText,
  chatTurn,
  loadAttachments,
  loadNamed,
  questionScope,
} from './attachments.ts'
import { createCitationFilter, Evidence, type CitationReport } from './citations.ts'
import { assistantSystemPrompt, chatTurnNote } from './prompt.ts'
import { checkSeal, evidenceKey, sealResult, type Binding, type SealedResult } from './seals.ts'
import {
  assistantTools,
  assistantToolNames,
  modelInputSchema,
  resolveDraftInput,
  runTool,
  type CreateDraftInput,
  type ToolContext,
} from './tools.ts'
import {
  addEarlierRead,
  addEarlierSearch,
  allowLink,
  linksIn,
  type WebContext,
} from './web-tools.ts'
import {
  createDomainCache,
  loadTurnFacts,
  turnContextText,
  webSearchLine,
  type DomainCache,
} from './turn-context.ts'

/**
 * One assistant turn (FR-701 to FR-710, plan section 8.4). The client holds the conversation and
 * sends it each turn; the server keeps none of it (FR-603), only the drafts a person confirms and
 * the spend counters. Each tool result this service produces is sealed (seals.ts), so a later
 * turn may cite it. The model gets the instructions and, after them, the turn context Heed builds
 * from the session and the database (turn-context.ts). The answer streams as AI SDK UI message
 * chunks, each sentence after the citation check. A turn has at most eight model steps; before
 * every step the spend caps are checked with an estimate, and the model call meter writes each
 * step's usage to the ledger at once, or an estimate for a step that ended early (FR-409).
 */

export const MAX_STEPS = 8
export const MAX_OUTPUT_TOKENS = 2_000
/** The conversation a client may send in one turn, in characters of JSON. */
export const MAX_CONVERSATION_CHARS = 200_000

export type AssistantDeps = {
  database: Database
  clock: Clock
  models: ModelPort
  logger: FastifyBaseLogger
  /**
   * Signs each confirmation request, so a client can confirm only the exact call the assistant
   * proposed, never one it made up (the conversation is client-held input). The key that seals
   * tool results is derived from it.
   */
  approvalSecret: Uint8Array
  /** The domains of the live edition, for the turn context; left out, each turn reads them. */
  domains?: DomainCache
  /** Opens a web page for read_source; left out, the public web through Heed's own reader. */
  readPage?: PageReader
  /** Heed's help pages for search_help; left out, the pages of this checkout. */
  help?: HelpLibrary
  /**
   * False leaves About our business out of the turn context: the arm of an assistant test run
   * without it (`npm run eval:assistant -- --about-business off`). People's turns always have it.
   */
  aboutBusiness?: boolean
  /**
   * False switches web search off for every turn, whatever an administrator set: an assistant
   * test case about a turn without it. Left out, the setting decides.
   */
  webSearch?: false
}
export type TurnRequest = {
  messages: unknown[]
  /** Reads the person's session again in a tool's transaction. */
  session: (tx: Queryable) => Promise<Session | null>
  personId: string
  /** The person's time zone, from their browser. */
  timeZone?: string
  signal?: AbortSignal
  /**
   * A turn of an assistant test run (`npm run eval:assistant`): its calls are kept under the run
   * and the case try, limited like every test run's, and each failed call is reported.
   */
  testRun?: {
    runId: string
    caseTry: string
    limits: CallLimits
    limiter?: CallLimiter
    /** Tests give their own clock for the waits between tries. */
    wait?: Sleep
    /** Before every call; throws to stop it, at the run's cost ceiling. */
    admit?: () => void
    /** Every call's cost as it ends. */
    onCost?: (micros: number) => void
    /** The error that ended a model call, for the run to tell a provider failure from a fault. */
    onModelError?: (error: unknown) => void
  }
}

const feature = 'assistant'
/** The public web, as Heed reads it for every turn that has no reader of its own. */
const publicWeb = createPageReader()
const tokens = (text: string) => Math.ceil(text.length / 4)
/** The instructions and tool definitions every step sends, in estimated tokens. */
const fixedTokens =
  tokens(assistantSystemPrompt) +
  assistantToolNames.reduce(
    (sum, name) =>
      sum +
      tokens(assistantTools[name].description) +
      tokens(JSON.stringify(z.toJSONSchema(assistantTools[name].inputSchema, { io: 'input' }))),
    0,
  )

/** The AI SDK tools: each one runs through `runTool`, which checks the operation first. */
function toolSet(context: ToolContext): ToolSet {
  const set: ToolSet = {}
  for (const name of assistantToolNames) {
    const tool = assistantTools[name]
    set[name] = dynamicTool({
      description: tool.description,
      inputSchema: modelInputSchema(name),
      execute: (input, { toolCallId, abortSignal }) =>
        runTool(name, input, toolCallId, context, abortSignal),
    })
  }
  return set
}

/** A chunk stream that says one plain thing: a limit, or why there is no answer. */
function* notice(text: string, data?: { type: `data-${string}`; data: unknown }) {
  yield { type: 'text-start', id: 'notice' } as UIMessageChunk
  yield { type: 'text-delta', id: 'notice', delta: text } as UIMessageChunk
  yield { type: 'text-end', id: 'notice' } as UIMessageChunk
  if (data) yield data as UIMessageChunk
}

export async function readModel(tx: Queryable, models: ModelPort): Promise<ModelChoice> {
  const [row] = await tx.query<{ value: unknown }>(
    "select value from settings_current where key='models.assistant'",
  )
  return models.choose(feature, parseModelSetting(feature, row?.value))
}

/**
 * Checks the conversation and prepares the turn. Throws before anything streams when the
 * conversation cannot be read, so the caller answers with an ordinary error.
 */
export async function prepareTurn(deps: AssistantDeps, request: TurnRequest) {
  if (JSON.stringify(request.messages).length > MAX_CONVERSATION_CHARS)
    throw new ORPCError('UNPROCESSABLE_CONTENT', {
      message: 'This chat is too long. Start a new one.',
    })
  // The scope the composer showed for the latest question: the turn's tool calls read it.
  const shown = questionScope(request.messages)
  if (shown === 'invalid')
    throw new ORPCError('UNPROCESSABLE_CONTENT', {
      message: "We couldn't read what your question is about. Ask it again.",
    })
  // A message about the conversation ("what do you mean?", "thanks") has no scope of its own: it
  // is answered from the chat, with no tool and no scope carried from the last question.
  const chat = chatTurn(request.messages)
  const read = chat ? null : shown
  const evidence = new Evidence()
  const web: WebContext = {
    read: deps.readPage ?? publicWeb,
    links: new Map(),
    pages: new Map(),
    searchesPerDay: 0,
    provider: null,
    calls: { reads: 0, searches: 0 },
  }
  const context: ToolContext = {
    database: deps.database,
    clock: deps.clock,
    models: deps.models,
    session: request.session,
    evidence,
    produced: new Map(),
    bound: read ? boundFields(read.scope, read.question) : null,
    web,
    help: deps.help ?? repositoryHelp(),
  }
  const tools = toolSet(context)
  const validated = await safeValidateUIMessages<UIMessage>({ messages: request.messages, tools })
  if (!validated.success)
    throw new ORPCError('UNPROCESSABLE_CONTENT', {
      message: "We couldn't read this chat. Start a new one.",
    })
  const messages = validated.data
  if (messages.some((m) => m.role === 'system'))
    throw new ORPCError('UNPROCESSABLE_CONTENT', {
      message: "This chat has a message we can't accept. Start a new one.",
    })
  // The person's own words may be quoted back; they cite no item. The links in them may be read.
  for (const message of messages)
    if (message.role === 'user')
      for (const part of message.parts)
        if (part.type === 'text') {
          evidence.addPersonText(part.text)
          for (const link of linksIn(part.text)) allowLink(web, link)
        }
  const modelMessages = await convertToModelMessages(messages, { tools })
  const attached = chat ? null : attachedScope(messages)
  const { choice, limits, facts, attachments, named, searches } = await deps.database.transaction(
    request.personId,
    async (tx) => {
      // Who is asking, read afresh: their name, roles and domains go into the turn context.
      const person = await principalFor(tx, request.personId)
      if (!person) throw new ORPCError('UNAUTHORIZED', { message: 'Sign in again to continue.' })
      return {
        choice: await readModel(tx, deps.models),
        limits: await readSpendLimits(tx, feature),
        facts: await loadTurnFacts(tx, {
          clock: deps.clock,
          person,
          timeZone: request.timeZone ?? 'UTC',
          cache: deps.domains ?? createDomainCache(),
        }),
        // The scope of this question, by name and with its definitions.
        attachments: await loadAttachments(tx, attachmentKeys(attached), deps.clock.today()),
        // The accepted items and domains its chips name, as the person may read them.
        named: await loadNamed(tx, aboutKeys(attached)),
        // Web search is offered only while an administrator has it on (0 is off).
        searches: await webSearchesPerDay(tx),
      }
    },
  )
  web.searchesPerDay = deps.webSearch === false ? 0 : searches
  web.provider = choice.provider
  // An attached term's definition may be quoted back, as the model read it.
  for (const attachment of attachments)
    if (attachment.definition) evidence.addHeedText(attachment.definition)
  // What earlier turns read, under seals that still verify, is evidence too.
  const key = evidenceKey(deps.approvalSecret)
  const binding: Binding = { personId: request.personId, conversationId: messages[0]?.id ?? '' }
  let stale = 0
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    const seals = new Map(
      message.parts.flatMap((part) =>
        part.type === 'data-evidence' && 'id' in part && typeof part.id === 'string'
          ? [[part.id, (part as { data: unknown }).data] as const]
          : [],
      ),
    )
    for (const part of message.parts) {
      if (part.type !== 'dynamic-tool' || part.state !== 'output-available') continue
      if (!seals.has(part.toolCallId)) continue
      const result = { toolCallId: part.toolCallId, toolName: part.toolName, output: part.output }
      const check = checkSeal(
        key,
        binding,
        result,
        seals.get(part.toolCallId),
        deps.clock.now(),
        facts.edition,
      )
      if (check === 'valid') {
        evidence.addEarlierResult(part.output)
        // A page read earlier is evidence for a draft now; a search's links may be read now.
        if (part.toolName === 'read_source') addEarlierRead(web, part.output)
        if (part.toolName === 'search_web') addEarlierSearch(web, part.output)
      } else if (check !== 'invalid') stale++
    }
  }
  const webSearch = web.searchesPerDay > 0
  // Who switches web search on and where, in Heed's words: the setting's name may be quoted.
  evidence.addHeedText(webSearchLine({ webSearch, person: facts.person }))
  const turnContext = turnContextText({
    ...facts,
    ...(deps.aboutBusiness === false ? { about: '' } : {}),
    stale,
    webSearch,
  })
  return {
    /**
     * The domains' names, descriptions and owners' names, as the records hold them: words the
     * tone of an answer is not held to (assistant/tone.ts).
     */
    records: facts.domains
      .map((domain) => `${domain.name}: ${domain.summary} ${domain.owners.join(', ')}`)
      .join('\n'),
    stream: () =>
      streamTurn(deps, request, {
        context,
        tools,
        modelMessages,
        choice,
        limits,
        turnContext,
        attachments: chat ? chatTurnNote : attachmentsText(attached, attachments, named),
        chat,
        seal: { key, binding },
      }),
  }
}

type Prepared = {
  context: ToolContext
  tools: ToolSet
  modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>
  choice: ModelChoice
  limits: SpendLimits
  /** Heed's context for this turn: the second system block. */
  turnContext: string
  /** The scope of the person's latest question: a third block, when there is any. */
  attachments: string | null
  /** The latest message is about the conversation: the model gets no tool this turn. */
  chat: boolean
  seal: { key: Buffer; binding: Binding }
}

async function* streamTurn(
  deps: AssistantDeps,
  request: TurnRequest,
  { context, tools, modelMessages, choice, limits, turnContext, attachments, chat, seal }: Prepared,
): AsyncGenerator<UIMessageChunk> {
  const { evidence } = context
  const { database, logger } = deps
  const person = request.personId
  const estimate = (inputTokens: number) =>
    costMicros(choice.prices, { inputTokens, outputTokens: MAX_OUTPUT_TOKENS, cacheReadTokens: 0 })
  const capReached = (next: number) =>
    database.transaction(person, (tx) => spendLimitReached(tx, feature, limits, next, person))

  // Which model serves the turn, never what is asked or answered.
  logger.info(
    { provider: choice.provider, model: choice.name, vendor: choice.vendor, family: choice.family },
    'assistant turn',
  )
  // What the next step sends, conservatively: the prompt so far and everything added since.
  let promptTokens =
    fixedTokens +
    tokens(turnContext) +
    tokens(attachments ?? '') +
    tokens(JSON.stringify(modelMessages))
  const first = await capReached(estimate(promptTokens))
  if (first) {
    yield { type: 'start' }
    yield* notice(first.message, limitPart(first))
    yield { type: 'finish', finishReason: 'stop' }
    return
  }

  let stopped: SpendStop | null = null
  const run = request.testRun
  // Every step through the meter: the ledger gets each step's usage, or an estimate for a step
  // that ended before it reported any (abort, timeout, provider error mid-stream).
  const meter = createCallMeter({
    database,
    feature,
    person,
    runId: run?.runId ?? null,
    // A person's turn is not held back by the service; a test run's is.
    limits: run?.limits ?? null,
    retry: run ? testRunRetry : conversationRetry,
    ...(run?.limiter ? { limiter: run.limiter } : {}),
    ...(run?.wait ? { wait: run.wait } : {}),
    ...(run?.admit ? { admit: run.admit } : {}),
    ...(run?.onCost ? { onCall: (call) => run.onCost!(call.costMicros) } : {}),
    onRecordError: (error) => {
      logger.error({ err: safeError(error) }, 'assistant spend not recorded')
    },
  })
  const filter = createCitationFilter(evidence)
  try {
    // The tool loop: streamText with the tools, at most MAX_STEPS steps and the cap check between
    // them. create_draft waits for the person's signed confirmation.
    const result = streamText({
      model: meter.wrap(choice, { role: 'assistant', caseTry: run?.caseTry ?? null }).model,
      // The meter retries what is worth retrying.
      maxRetries: 0,
      // The tools and the instructions are the same bytes every step and turn: one cache
      // breakpoint after them lets the provider read them from its prompt cache (plan 3.2). The
      // turn context follows with a breakpoint of its own: it is the same for every step of a
      // turn, and usually for the person's next turns that day. The question's scope changes
      // with each question, so it follows the last breakpoint.
      instructions: [
        { role: 'system', content: assistantSystemPrompt, providerOptions: choice.cacheBreakpoint },
        { role: 'system', content: turnContext, providerOptions: choice.cacheBreakpoint },
        ...(attachments ? [{ role: 'system' as const, content: attachments }] : []),
      ],
      messages: modelMessages,
      tools,
      // search_web only while an administrator has web search on, and no tool at all for a
      // message about the conversation: it is answered from what was said.
      activeTools: chat
        ? []
        : assistantToolNames.filter(
            (name) => name !== 'search_web' || context.web.searchesPerDay > 0,
          ),
      toolApproval: { create_draft: 'user-approval' },
      experimental_toolApprovalSecret: deps.approvalSecret,
      // A tool call that failed before its tool ran reads to the model as a plain sentence.
      prepareStep: ({ messages }) => ({ messages: plainToolErrors(messages) }),
      // Names in a draft are matched before the person is asked to confirm it.
      experimental_refineToolInput: {
        create_draft: (input) => resolveDraftInput(input as CreateDraftInput, context),
      },
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      providerOptions: choice.options,
      timeout: { totalMs: 180_000, stepMs: 90_000 },
      ...(request.signal ? { abortSignal: request.signal } : {}),
      stopWhen: [
        isStepCount(MAX_STEPS),
        // Before the next step: the prompt so far sent again, plus a full answer.
        async ({ steps }) => {
          await meter.settled()
          const last = steps.at(-1)
          promptTokens =
            Math.max(promptTokens, last?.usage.inputTokens ?? 0) +
            (last?.usage.outputTokens ?? 0) +
            tokens(JSON.stringify(last?.toolResults ?? []))
          stopped = await capReached(estimate(promptTokens))
          return stopped !== null
        },
      ],
      // The default prints the whole error, request body and prompt included, to the console.
      onError: ({ error }) => {
        run?.onModelError?.(error)
        logger.warn({ err: safeError(error) }, 'assistant model call failed')
      },
    })
    const chunks = result.toUIMessageStream({
      sendReasoning: false,
      onError: (error) => {
        // A tool call the model got wrong goes back to the model, which may try again: the turn
        // goes on. Its message holds the model's input, so only the tool and the kind are logged.
        const tool = failedTool(error)
        if (tool) {
          logger.warn({ tool: tool.name, err: { type: tool.type } }, 'assistant tool call failed')
          return `The call to ${tool.name} did not work.`
        }
        logger.warn({ err: safeError(error) }, 'assistant turn failed')
        return "The assistant couldn't finish. Try again in a moment."
      },
    })
    for await (const chunk of chunks) {
      if (chunk.type === 'text-delta') {
        const text = filter.push(chunk.id, chunk.delta)
        if (text) yield { ...chunk, delta: text }
      } else if (chunk.type === 'text-end') {
        const text = filter.flush(chunk.id)
        if (text) yield { type: 'text-delta', id: chunk.id, delta: text }
        yield chunk
      } else if (chunk.type === 'finish') {
        await meter.settled()
        yield* closing(filter.report(), stopped, chunk.finishReason === 'content-filter')
        yield chunk
      } else if (chunk.type === 'tool-output-available') {
        yield chunk
        // A result this request's tools produced gets its seal, which a later turn checks.
        const toolName = context.produced.get(chunk.toolCallId)
        if (toolName && !chunk.preliminary && !chunk.providerExecuted) {
          const sealed = sealOf(
            seal,
            { toolCallId: chunk.toolCallId, toolName, output: chunk.output },
            deps.clock.now(),
          )
          if (sealed) yield { type: 'data-evidence', id: chunk.toolCallId, data: sealed }
        }
      } else yield chunk
    }
  } finally {
    await meter.close()
  }
}

/** A result's seal, or none for a result that is not JSON: it then counts in this turn only. */
function sealOf(seal: Prepared['seal'], result: SealedResult, now: Date) {
  try {
    return sealResult(seal.key, seal.binding, result, now)
  } catch {
    return null
  }
}

/** The data part that says a limit stopped the turn: which one, in words, and when it resets. */
const limitPart = (stop: SpendStop) =>
  ({ type: 'data-limit', data: stop satisfies AssistantLimit }) as const

/** What follows the answer: the limit or refusal notice, then the citation report. */
function* closing(report: CitationReport, stopped: SpendStop | null, refused: boolean) {
  if (stopped) yield* notice(stopped.message, limitPart(stopped))
  if (refused)
    yield* notice("I can't answer this one. Try asking it another way.", {
      type: 'data-refusal',
      data: { refused: true },
    })
  yield { type: 'data-citations', data: report } as UIMessageChunk
}

/**
 * The tool of a failed tool call: an input that failed its schema, or a tool that is not there.
 * The SDK reports one as the error, then again as its message alone in the tool's output error.
 */
export function failedTool(error: unknown): { name: string; type: string } | null {
  if (InvalidToolInputError.isInstance(error) || NoSuchToolError.isInstance(error))
    return { name: error.toolName.slice(0, 60), type: error.name }
  if (typeof error !== 'string') return null
  const invalid = /^(?:AI_\w+: )?Invalid input for tool ([\w-]{1,60}):/.exec(error)
  if (invalid) return { name: invalid[1]!, type: 'AI_InvalidToolInputError' }
  const missing = /^(?:AI_\w+: )?Model tried to call unavailable tool '([\w-]{1,60})'/.exec(error)
  if (missing) return { name: missing[1]!, type: 'AI_NoSuchToolError' }
  return null
}

/**
 * What the model reads for a tool call that failed before its tool ran, in place of the SDK's
 * error: its kind, the tool's input and a schema dump would reach the person whenever the model
 * repeats it. Heed's own reason (a name in a draft it cannot match) is kept as it is. The log
 * keeps the tool and the kind (`failedTool`). Any other text is returned unchanged.
 */
export function plainToolError(text: string): string {
  const tool = failedTool(text)
  if (!tool) return text
  if (tool.type === 'AI_NoSuchToolError')
    return 'There is no tool by that name here. Use one of the tools you have.'
  // Heed's own reason comes as a DraftInputError (tools.ts).
  const own = /^(?:AI_\w+: )?Invalid input for tool [\w-]+: DraftInputError: ([\s\S]+)$/.exec(text)
  return own
    ? own[1]!.trim()
    : 'The input did not fit what this tool takes, so nothing was done. Check the fields and try again.'
}

/** The messages with every failed tool call's error in plain words (`plainToolError`). */
export function plainToolErrors(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message) =>
    message.role === 'tool'
      ? {
          ...message,
          content: message.content.map((part) =>
            part.type === 'tool-result' && part.output.type === 'error-text'
              ? { ...part, output: { ...part.output, value: plainToolError(part.output.value) } }
              : part,
          ),
        }
      : message,
  )
}

/** An error for the log: its kind and status only, never a request body that holds a prompt. */
export function safeError(error: unknown) {
  if (!(error instanceof Error)) return { message: 'Unknown error' }
  const status = (error as { statusCode?: unknown }).statusCode
  return {
    type: error.name,
    message: error.message.slice(0, 200),
    ...(typeof status === 'number' ? { statusCode: status } : {}),
  }
}
