import { createHash, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  createMcpHandler,
  createRequestStateCodec,
  inputRequired,
  inputResponse,
  McpServer,
  type ServerContext,
} from '@modelcontextprotocol/server'
import type { FastifyInstance } from 'fastify'
import { appFamilyOf, type AppFamily } from '../../domain/app-family.ts'
import { productName } from '../brand.ts'
import type { EditionSource, ServingBundle } from '../modules/editions/index.ts'
import { personScopes, TokenError, type TokenVerifier } from './auth.ts'
import {
  createAnonymousQueue,
  resultStatuses,
  type AnonymousRecord,
  type AnonymousStore,
  type RequestRecord,
  type ResultStatus,
} from './records.ts'
import { invalidInputOf, invalidInputResult, lenientInputSchema } from './invalid-input.ts'
import { createLimiter } from '../http/rate-limit.ts'
import type { Metrics } from '../observability/metrics.ts'
import { ROUND_SECONDS, type DraftRound, type DraftTool, type QuestionRound } from './draft-tool.ts'
import { byteSize, createToolService, failure, withNote } from './service.ts'
import type { ServingReads } from './reads.ts'
import type { HelpLibrary } from '../modules/help/index.ts'
import { resolverStatusOf } from '../../domain/answer-state.ts'
import { deprecatedNote } from '../../domain/mcp-text.ts'
import {
  toolCalledBy,
  aliasesOf,
  isDeprecated,
  listedTool,
  personOnly,
  servedNameOf,
  serverInstructions,
  toolNames,
  tools,
  toolSchemaDigest,
  toolOutputSchema,
  type ListedName,
  type ToolName,
} from './tools.ts'

export interface McpDependencies {
  source: EditionSource
  store: AnonymousStore
  verifier: TokenVerifier
  resource: string
  /**
   * The login servers whose tokens the verifier accepts, as issuers (RFC 9728). An AI client
   * reads them from the protected resource metadata to find where a person signs in.
   */
  authorizationServers?: readonly string[]
  /** The instant answers are as of: what is current, and the hour on each record. */
  now?: () => Date
  /**
   * The instant request limits count their minutes by, which must move on: `now` when not given.
   * The eval runner answers as of a fixed day, so it gives the wall clock here.
   */
  wallClock?: () => Date
  /**
   * `suggest_context` (FR-121), which writes a suggestion as the signed-in person through the
   * application's database, and `draft_context`, its deprecated id, which saves a draft. Without
   * it neither is offered.
   */
  drafts?: DraftTool
  /**
   * The HMAC key (at least 32 bytes) that seals `suggest_context`'s question rounds, shared by
   * every instance (CL_MCP_STATE_KEY_FILE). Without it the questions are never asked in the
   * person's agent: the result lists them with the link instead.
   */
  stateKey?: Uint8Array
  /**
   * What a domain's definition source has beyond the vocabulary, which find_context names when the
   * words name a domain. Without it find_context leaves that out.
   */
  reads?: ServingReads
  /**
   * The web app's address (the first of CL_WEB_ORIGINS, as for the draft link), for each delivered
   * item's page in Heed (FR-347). Without it the pages are paths on the web app.
   */
  web?: string | null
  /** Heed's help pages for search_help (FR-348), read at start; left out, this checkout's pages. */
  help?: HelpLibrary
}

/** The data tools the definition sources name, by their own label (CON-101). */
function dataTools(bundle: ServingBundle): string[] {
  return [...new Set(bundle.terms.flatMap((term) => (term.described ? [term.described.tool] : [])))]
    .filter(Boolean)
    .sort()
}

/**
 * The family of the app that sent a request (FR-410): from the client's name, which protocol
 * 2026-07-28 sends with every request and earlier protocols when a session starts. Only the
 * family leaves this function; the name, its version and the rest of clientInfo are dropped.
 */
function appFamilyOfBody(body: unknown): AppFamily {
  type Info = { name?: unknown } | null | undefined
  const params = (
    body as { params?: { _meta?: Record<string, Info>; clientInfo?: Info } | null } | undefined
  )?.params
  return appFamilyOf((params?._meta?.[CLIENT_INFO_META_KEY] ?? params?.clientInfo)?.name)
}

/**
 * What a read tool's result said, from the closed set the request log keeps. Partial and Outdated
 * answers are matches there, as they were before the answer states (FR-349).
 */
function resultStatusOf(result: { structuredContent?: Record<string, unknown> }) {
  const said = result.structuredContent?.status
  const status = typeof said === 'string' ? resolverStatusOf(said) : said
  return (resultStatuses as readonly unknown[]).includes(status) ? (status as ResultStatus) : null
}

/** The key of the one form `suggest_context` asks in a round. */
const QUESTIONS = 'draft_questions'

/**
 * Whether the client declared form-mode elicitation on this request: on protocol 2026-07-28 it
 * sends its capabilities with every request, and an empty `elicitation` means form mode. A
 * 2025-era request carries none, so it is never asked.
 */
function canElicitForm(ctx: ServerContext): boolean {
  const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined
  const capabilities = envelope?.[CLIENT_CAPABILITIES_META_KEY] as
    { elicitation?: { form?: unknown; url?: unknown } } | undefined
  const elicitation = capabilities?.elicitation
  return (
    elicitation !== undefined && (elicitation.form !== undefined || elicitation.url === undefined)
  )
}

export function registerMcpRoutes(app: FastifyInstance, deps: McpDependencies, metrics?: Metrics) {
  const now = deps.now ?? (() => new Date())
  const execute = createToolService(
    deps.source,
    deps.store,
    now,
    deps.reads,
    deps.web ?? null,
    deps.help,
  )
  let droppedRecords = 0
  const queue = createAnonymousQueue(deps.store, (count) => {
    droppedRecords += count
    metrics?.recordsDropped(count)
    app.log.warn({ droppedRecords }, 'anonymous MCP records dropped')
  })
  // Local-process limits use ephemeral token digests, discarded after each minute. They never enter records.
  const limit = createLimiter(deps.wallClock ?? now)
  const resource = new URL(deps.resource)
  const metadata = new URL('/.well-known/oauth-protected-resource/mcp', resource).href
  const servers = deps.authorizationServers ?? []
  app.get('/.well-known/oauth-protected-resource/mcp', { logLevel: 'silent' }, (request, reply) => {
    reply.header('cache-control', 'no-store')
    // Discovery is public, so it has a rate per caller address, like the login server's own.
    const retry = limit([{ key: `discovery:${request.ip}`, limit: 120 }])
    if (retry) {
      reply.header('Retry-After', retry)
      return reply.code(429).send({ error: 'Request limit reached' })
    }
    return Promise.resolve({
      resource: resource.href,
      ...(servers.length ? { authorization_servers: [...servers] } : {}),
      bearer_methods_supported: ['header'],
      scopes_supported: [...personScopes],
      resource_name: productName,
    })
  })
  // The scopes a client asks for when it signs in for the first time: all three, so the person
  // grants suggest_context at consent (FR-121 as changed).
  const challengeScope = 'read feedback propose'
  app.all('/mcp', { bodyLimit: 32768, logLevel: 'silent' }, async (request, reply) => {
    const started = performance.now()
    const body = request.body as
      { id?: unknown; method?: unknown; params?: { name?: unknown } } | undefined
    // An old tool id counts as the tool that replaced it, so it is checked, limited and logged as that.
    const name = body?.method === 'tools/call' ? toolCalledBy(body.params?.name) : null
    const pending: AnonymousRecord[] = []
    const family = appFamilyOfBody(body)
    let client = 'unknown',
      edition: string | null = null
    let status: RequestRecord['status'] = 'error'
    let resultStatus: ResultStatus | null = null
    let responseBytes = 0
    reply.raw.once('finish', () => {
      // A delivery is counted by the kind of agent that asked (FR-410), as its request is.
      for (const record of pending)
        queue.enqueue(
          record.kind === 'delivery' ? { ...record, value: { ...record.value, family } } : record,
        )
      const duration = performance.now() - started
      metrics?.mcpRequest({ tool: name ?? 'protocol', status, appFamily: family }, duration / 1000)
      queue.enqueue({
        kind: 'request',
        value: {
          id: randomUUID(),
          hour: now().toISOString().slice(0, 13) + ':00:00.000Z',
          client,
          family,
          tool: name ?? 'protocol',
          status,
          result: resultStatus,
          duration: Math.round(duration),
          edition,
          bytes: responseBytes,
        },
      })
    })
    const deny = (code: number, message: string, recordStatus: RequestRecord['status']) => {
      status = recordStatus
      return reply.code(code).send({ error: message })
    }
    if (!['POST', 'GET', 'DELETE'].includes(request.method))
      return deny(405, 'Method not allowed', 'error')
    const localHosts = ['localhost', '127.0.0.1', '[::1]']
    try {
      if (!localHosts.includes(new URL(`http://${request.headers.host}`).hostname))
        return deny(403, 'Invalid host', 'forbidden')
      if (request.headers.origin && !localHosts.includes(new URL(request.headers.origin).hostname))
        return deny(403, 'Invalid origin', 'forbidden')
    } catch {
      return deny(403, 'Invalid origin or host', 'forbidden')
    }
    const authorization = request.headers.authorization
    const token = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1]
    if (!token) {
      reply.header(
        'WWW-Authenticate',
        `Bearer resource_metadata="${metadata}", scope="${challengeScope}"`,
      )
      return deny(401, 'Bearer token required', 'unauthorized')
    }
    let principal
    try {
      principal = await deps.verifier.verify(token)
      client = principal.client
    } catch (error) {
      reply.header(
        'WWW-Authenticate',
        `Bearer error="invalid_token", resource_metadata="${metadata}", scope="${challengeScope}"`,
      )
      // A reason code and the client label only (FR-411): never the token or anything in it.
      const refusal = error instanceof TokenError ? error : new TokenError('malformed')
      app.log.warn({ reason: refusal.reason, client: refusal.client }, 'MCP token rejected')
      return deny(401, 'Invalid token', 'unauthorized')
    }
    // A JSON-RPC batch carries many calls in one request, and every check below reads one call:
    // let through, it would be charged as one request and logged as one `protocol` call (FR-408,
    // FR-410). The protocols served (2026-07-28 and 2025-11-25) have no batches since 2025-06-18.
    if (Array.isArray(request.body)) {
      app.log.warn({ client }, 'MCP batch request refused')
      status = 'error'
      return reply.code(400).send({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32600,
          message:
            'Invalid Request: batch requests are not supported. Send one JSON-RPC message per request.',
        },
      })
    }
    const required = name ? tools[name].scope : 'read feedback'
    if (!required.split(' ').some((scope) => principal.scopes.includes(scope))) {
      reply.header(
        'WWW-Authenticate',
        `Bearer error="insufficient_scope", scope="${required}", resource_metadata="${metadata}"`,
      )
      return deny(403, 'Insufficient scope', 'forbidden')
    }
    // A token that names no person (a dev or service token) has nobody to write a draft for.
    if (name && personOnly(name) && !principal.subject)
      return deny(
        403,
        `${name} needs a person signed in to ${productName} through an AI agent. A dev or service token names no person.`,
        'forbidden',
      )
    if (request.method !== 'POST') {
      reply.header('Allow', 'POST')
      return deny(405, 'Method not allowed', 'error')
    }
    if (typeof body?.id === 'string' && body.id.length > 128)
      return deny(400, 'Request id is too long', 'error')
    let policy
    try {
      policy = await deps.source.policy(client)
    } catch {
      return deny(503, 'Serving policy unavailable', 'error')
    }
    if (!policy.client?.enabled) return deny(403, 'Client is not enabled', 'forbidden')
    const allowed = toolNames.filter(
      (n) =>
        principal.scopes.includes(tools[n].scope) &&
        (!personOnly(n) || (principal.subject !== undefined && deps.drafts !== undefined)) &&
        policy.tools.includes(n) &&
        (policy.client!.tools_allowed === null || policy.client!.tools_allowed.includes(n)),
    )
    if (name && !allowed.includes(name))
      return deny(403, 'Tool is not enabled for this client', 'forbidden')
    const perMinute = (value: number) => Math.max(1, Math.min(value, 10000))
    // A client's own rate wins over the default; each person has a smaller budget of their own, so
    // one person cannot spend everyone's share of the client label (FR-408). A person a login
    // server signed in counts by who they are, across their apps and refreshed tokens; a dev
    // token, which names no person, counts as one. The eval runner's token is no person: a run
    // counts against the eval client only.
    const clientLimit = perMinute(policy.client.rate_per_minute ?? policy.rates.client)
    const personLimit = principal.caller === 'agent' ? perMinute(policy.rates.person) : undefined
    // A tool's own limit applies per client; feedback tools are tighter even without one (FR-408).
    const toolLimit =
      name === null
        ? undefined
        : (policy.limits[name] ?? (tools[name].scope === 'feedback' ? 10 : undefined))
    const retry = limit([
      { key: `client:${client}`, limit: clientLimit },
      ...(personLimit === undefined
        ? []
        : [
            {
              key: principal.subject
                ? `person:${createHash('sha256').update(principal.subject).digest('hex')}`
                : `token:${createHash('sha256').update(token).digest('hex')}`,
              limit: personLimit,
            },
          ]),
      ...(toolLimit === undefined
        ? []
        : [{ key: `tool:${client}:${name}`, limit: Math.min(toolLimit, clientLimit) }]),
    ])
    if (retry) {
      reply.header('Retry-After', retry)
      return deny(429, 'Request limit reached; retry after the indicated seconds', 'rate_limited')
    }
    const maxBytes = Math.max(1000, Math.min(policy.client.max_response_bytes ?? 100000, 100000))
    // A question round of suggest_context (or draft_context) is sealed for this tool, this person
    // and this app only (MCP basic/patterns/mrtr, server requirements 4 and 5): signed with the
    // shared key, bound to all three, and expiring; the tool also binds it to the call's arguments
    // and uses it once.
    const called = typeof body?.params?.name === 'string' ? body.params.name : ''
    const codec = deps.stateKey
      ? createRequestStateCodec<QuestionRound>({
          key: deps.stateKey,
          ttlSeconds: ROUND_SECONDS,
          bind: () => `${called}\0${principal.subject ?? ''}\0${principal.client}`,
        })
      : null
    const roundOf = async (ctx: ServerContext): Promise<DraftRound> => {
      const raw = ctx.mcpReq.requestState()
      const response = inputResponse(ctx.mcpReq.inputResponses, QUESTIONS)
      return {
        canAsk: codec !== null && canElicitForm(ctx),
        ...(typeof raw === 'string'
          ? {
              state: codec
                ? await codec.verify(raw, ctx).then(
                    (payload) => ({ payload }),
                    () => 'refused' as const,
                  )
                : ('refused' as const),
            }
          : {}),
        ...(response.kind === 'elicit'
          ? {
              response: {
                action: response.action,
                ...(response.content ? { content: response.content } : {}),
              },
            }
          : {}),
        seal: (round) =>
          codec ? codec.mint(round, ctx) : Promise.reject(new Error('No state key')),
      }
    }
    // What the server tells a client that connects (FR-343), with the data tool its definition
    // sources name and About our business last. Only a request that reads the instructions loads
    // the served edition for it.
    const describes = body?.method === 'initialize' || body?.method === 'server/discover'
    const instructions = serverInstructions(
      describes ? await deps.source.bundle().then(dataTools, () => []) : [],
      policy.about,
    )
    const handler = createMcpHandler(
      () => {
        const server = new McpServer(
          // The id stays `heed`, since AI agents register the server by it; the title follows
          // the product's name (docs/rename-checklist.md).
          { name: 'heed', title: productName, version: '0.1.0' },
          {
            instructions,
            cacheHints: {
              'tools/list': { ttlMs: 0, cacheScope: 'private' },
              'server/discover': { ttlMs: 0, cacheScope: 'private' },
            },
          },
        )
        // A tool is listed by its id, and each old id (src/domain/mcp-text.ts) beside it, which
        // answers with its old arguments and reply for one release, plus a note naming the tool.
        const list = (listed: ListedName, tool: ToolName) => {
          const deprecated = isDeprecated(listed)
          const definition = listedTool(listed)
          const outputSchema = toolOutputSchema(listed)
          server.registerTool(
            listed,
            {
              // The title is what people see when their agent calls the tool.
              title: definition.title,
              description: definition.description,
              // Arguments that do not fit reach the tool marked, so it answers them itself.
              inputSchema: lenientInputSchema(listed),
              ...(outputSchema ? { outputSchema } : {}),
              annotations: definition.annotations,
            },
            // The typed callback has no room for an input-required return, which the SDK accepts
            // on tools/call (protocol 2026-07-28).
            (async (args: unknown, ctx: ServerContext): Promise<unknown> => {
              const issues = invalidInputOf(args)
              if (issues) {
                status = 'invalid_input'
                return {
                  ...invalidInputResult(listed, issues),
                  _meta: { tool_schema_digest: toolSchemaDigest },
                }
              }
              // An old id's reply says which tool to use instead.
              const noted = (result: Parameters<typeof withNote>[0]) =>
                deprecated ? withNote(result, deprecatedNote(listed)) : result
              if (tool === 'suggest_context') {
                // draft_context saves a draft and never sends it, as it did; suggest_context sends
                // the suggestion to the owner.
                const outcome = await deps.drafts!(
                  args,
                  principal,
                  await roundOf(ctx),
                  deprecated ? 'draft' : 'suggest',
                )
                if ('ask' in outcome) {
                  status = 'ok'
                  return inputRequired({
                    inputRequests: {
                      [QUESTIONS]: inputRequired.elicit({
                        mode: 'form',
                        ...outcome.ask,
                      } as Parameters<typeof inputRequired.elicit>[0]),
                    },
                    requestState: outcome.requestState,
                  })
                }
                const result = noted(
                  byteSize(outcome) > maxBytes
                    ? failure('The result cannot fit the client response limit.')
                    : outcome,
                )
                status = result.isError ? 'error' : 'ok'
                return { ...result, _meta: { tool_schema_digest: toolSchemaDigest } }
              }
              let result = await execute(
                // An old id runs the code it had (search_context runs search_facts).
                isDeprecated(listed)
                  ? servedNameOf(listed as Exclude<typeof listed, 'draft_context'>)
                  : tool,
                args,
                principal,
                maxBytes,
                (record) => {
                  pending.push(record)
                },
                (seq) => {
                  edition = seq
                },
              )
              result = noted(result)
              if (byteSize(result) > maxBytes)
                result = failure('The result cannot fit the client response limit.')
              status = result.isError ? 'error' : 'ok'
              resultStatus = resultStatusOf(result)
              // The overlay and cache hints the service put in _meta stay there (FR-346).
              return { ...result, _meta: { ...result._meta, tool_schema_digest: toolSchemaDigest } }
            }) as never,
          )
        }
        for (const tool of allowed) {
          list(tool, tool)
          for (const alias of aliasesOf(tool)) list(alias, tool)
        }
        return server
      },
      {
        maxSubscriptions: 0,
        onerror: () => {
          status = 'error'
        },
      },
    )
    try {
      const headers = new Headers()
      for (const [key, value] of Object.entries(request.headers))
        if (typeof value === 'string' && !['authorization', 'cookie'].includes(key))
          headers.set(key, value)
      const response = await handler.fetch(new Request(resource, { method: 'POST', headers }), {
        parsedBody: request.body,
      })
      reply.code(response.status)
      response.headers.forEach((value, key) => {
        reply.header(key, value)
      })
      reply.header('Cache-Control', 'no-store')
      // eslint-disable-next-line brand/no-product-name -- an HTTP header name, a technical name (docs/rename-checklist.md)
      reply.header('X-Heed-Tool-Digest', toolSchemaDigest)
      if (!name) status = response.ok ? 'ok' : 'error'
      // The SDK's legacy stateless transport uses SSE. Forward its stream without buffering subscriptions.
      if (response.body) {
        // The DOM library (tsconfig.node.json, through scripts/generate-api.ts) types the body as
        // the web stream; Node's own type is the one Readable.fromWeb takes.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        const stream = Readable.fromWeb(response.body as NodeReadableStream)
        stream.on('data', (chunk: Buffer) => {
          responseBytes += chunk.length
        })
        stream.once('close', () => {
          void handler.close()
        })
        return reply.send(stream)
      }
      await handler.close()
      return reply.send()
    } catch {
      await handler.close()
      return deny(500, 'MCP request failed', 'error')
    }
  })
  app.addHook('onClose', async () => {
    await queue.flush()
  })
  return {
    flush: queue.flush,
    get droppedRecords() {
      return droppedRecords
    },
  }
}
