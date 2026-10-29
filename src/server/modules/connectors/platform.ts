import {
  checkManifest,
  checkManifests,
  secretsBoundTo,
  type ConnectorManifest,
  type ManifestProblem,
} from '../../../domain/connector-manifest.ts'
import { connectorIdPattern } from '../../../domain/connector-id.ts'
import { connectorConfigDomains, parseConnectorConfig } from '../../../domain/connector-config.ts'
import {
  checkReportSchema,
  figureResultSchema,
  runtimeMessageSchema,
  scopeSchema,
  SourceError,
  type CheckReport,
  type ChosenScope,
  type ConnectorModule,
  type ConnectorRuntime,
  type FigureQuery,
  type FigureResult,
  type GuardedFetch,
  type RuntimeContext,
  type Scope,
  type SourceDocument,
} from '../../../domain/connector-runtime.ts'
import {
  DOCUMENT_TEXT_MAX,
  READ_TEXT_MAX,
  unreadDocumentCodes,
} from '../../../domain/content-document.ts'
import type { SourceConfig } from '../../../contract/sources.ts'
import { sourceWarningCodes } from '../../../contract/operations.ts'
import { folderTree, guardedGit } from './egress-git.ts'
import { isFetchableAddress } from './git.ts'
import { pinnedGet } from './pinned-fetch.ts'
import {
  SourceReadError,
  type ConnectorType,
  type Definition,
  type DefinitionSource,
  type FieldProblem,
  type ReadContext,
  type SourceSnapshot,
  type SourceWarning,
} from './types.ts'
import { runWorker, workerLimits, type WorkerLimits } from './worker.ts'

/*
  Interface 3.0 in the core (docs/connectors.md, "Interface 3.0"): a connector is a manifest and
  a runtime. The registry checks every manifest at start and keeps each connector here as one
  shape, so Sources lists, checks and reads them all the same way.

  A runtime's read is a stream of messages. Until the core's own pipelines take messages, a
  definitions read is gathered into a snapshot and goes through the one pipeline every
  definition source uses (ConnectorService.syncSource), with all its rules: a ref belongs to one
  source, only a complete read marks absent definitions missing, a failed read changes nothing.
*/

/** The interface a registered connector was written to: every connector this build runs is 3. */
export type WrittenTo = 3

/**
 * A scope an administrator chose, as stored: a content source's folder with its domain, or a
 * definitions source's group (a Cube view) with its domain, or none to leave it shared.
 */
export interface StoredScope {
  id: string
  title: string
  domain: string | null
}

/** A source's stored settings and the secrets the store holds for it (null when it lost them). */
export interface StoredSource {
  id: string
  name: string
  config: SourceConfig
  secrets: Readonly<Record<string, string>> | null
  /**
   * The scopes an administrator chose: a content source's, each with its domain; a definitions
   * source's groups, which the core reads alone (every group when none is chosen).
   */
  scopes?: readonly StoredScope[]
  /**
   * The folder on the server that whoever runs it named for the source (`CUBE_MODEL_DIR`), which
   * the runtime reads as `ctx.folder`; only for a source the server's configuration selects.
   */
  folder?: string
}

/**
 * One read of a content source, its messages checked and gathered: the documents, whose text
 * lives in memory for this read only (CON-605), the tombstones of a delta read, the documents it
 * saw but did not hand over (too long), its warnings, and how it ended.
 */
export interface ContentRead {
  version: string
  complete: boolean
  cursor?: string
  documents: SourceDocument[]
  deleted: string[]
  /** Documents the read saw and left out: they are not gone, only not read this time. */
  unread: string[]
  warnings: SourceWarning[]
}

/** A stored content source of a connector: what the content pipeline reads. */
export interface ContentSource {
  readonly id: string
  readonly type: string
  readonly name: string
  readonly manifest: ConnectorManifest
  readonly scopes: readonly ChosenScope[]
  /** One read, a full one when the cursor is null; a failure is a `SourceReadError`. */
  read(context: { cursor: string | null }): Promise<ContentRead>
}

/** A connector as the registry keeps it: what Sources lists, checks, adds and reads. */
export interface RegisteredConnector {
  readonly manifest: ConnectorManifest
  readonly writtenTo: WrittenTo
  /** The settings as stored, or what is wrong with them, by field. Never sees a secret. */
  parse(config: SourceConfig): { config: SourceConfig } | { problems: FieldProblem[] }
  /** The domains the settings name, which must exist. */
  domains(config: SourceConfig): readonly string[]
  /** The settings its secrets are bound to. */
  readonly secretsBoundTo: readonly string[]
  /** The source for stored settings, read by the definitions pipeline. */
  source(stored: StoredSource): DefinitionSource
  /** The source for stored settings, read by the content pipeline; content connectors only. */
  content?(stored: StoredSource): ContentSource
  /** The runtime's own check, ordered steps that change nothing. */
  check(stored: StoredSource): Promise<CheckReport>
  /** The scopes an administrator may choose, each with a suggested domain; changes nothing. */
  discover?(stored: StoredSource): Promise<Scope[]>
  /**
   * One figure from the data endpoint an administrator set, with its token, within the signal's
   * time; only a connector whose manifest declares figures. A failure is a `FigureReadError`.
   */
  figure?(
    connection: FigureConnection,
    query: FigureQuery,
    signal: AbortSignal,
  ): Promise<FigureResult>
}

/** Where a source's figures are read: the data endpoint an administrator set, and its token. */
export interface FigureConnection {
  endpoint: string
  token: string
}

/** The codes a figure's read fails with: what Ask and the integration's page say. */
export const figureFailureCodes = [
  'unauthorized',
  'not_found',
  'rate_limited',
  'unreachable',
  'timed_out',
  'private_address',
  'invalid_output',
] as const
export type FigureFailureCode = (typeof figureFailureCodes)[number]

/** Why a figure could not be read: a code only, never what the tool said. */
export class FigureReadError extends Error {
  override name = 'FigureReadError'
  readonly code: FigureFailureCode
  constructor(code: FigureFailureCode) {
    super(`Figure not read: ${code}`)
    this.code = code
  }
}

/**
 * The fetch a figure gets: GET only, to the data endpoint's own origin (its scheme, host and port:
 * the declared host) at an address Heed may fetch (https to a public host in production), the
 * host's name looked up once and the connection pinned to an answer that is public (no DNS
 * rebinding), no redirect followed, within the figure's time limit. The token goes nowhere else.
 */
export function figureFetch(endpoint: string, signal: AbortSignal): GuardedFetch {
  const declared = URL.parse(endpoint)?.origin
  return async (address, init = {}) => {
    const url = URL.parse(address)
    const fetchable =
      url !== null &&
      !url.username &&
      !url.password &&
      !url.hash &&
      isFetchableAddress(`${url.origin}${url.pathname}`)
    if (!url || !fetchable || !declared || url.origin !== declared)
      throw new SourceError({
        code: 'private_address',
        target: url?.host ?? 'address',
        class: 'config',
      })
    if ((init.method ?? 'GET') !== 'GET' || init.body !== undefined)
      throw new SourceError({ code: 'invalid_output', target: 'fetch', class: 'source' })
    return pinnedGet(url, { ...(init.headers ? { headers: init.headers } : {}), signal })
  }
}

/** A runtime's figure, run and checked: a known code says why it failed, anything else nothing. */
async function figureOf(
  runtime: ConnectorRuntime,
  connection: FigureConnection,
  query: FigureQuery,
  signal: AbortSignal,
): Promise<FigureResult> {
  const known = (code: string): code is FigureFailureCode =>
    (figureFailureCodes as readonly string[]).includes(code)
  try {
    const result = await runtime.figure!(
      {
        endpoint: connection.endpoint,
        token: connection.token,
        fetch: figureFetch(connection.endpoint, signal),
        signal,
        now: () => new Date(),
      },
      query,
    )
    const checked = figureResultSchema.safeParse(result)
    if (!checked.success) throw new FigureReadError('invalid_output')
    return checked.data
  } catch (error) {
    if (error instanceof FigureReadError) throw error
    if (signal.aborted) throw new FigureReadError('timed_out')
    if (error instanceof SourceError && known(error.code)) throw new FigureReadError(error.code)
    throw new FigureReadError('invalid_output')
  }
}

/** Why the registry would not start: every problem with every connector it was given. */
export class ConnectorRegistryError extends Error {
  readonly problems: readonly { id: string; problem: ManifestProblem }[]
  constructor(problems: readonly { id: string; problem: ManifestProblem }[]) {
    super(
      `Connectors refused: ${problems.map(({ id, problem }) => `${id} ${problem.path}: ${problem.message}`).join(' ')}`,
    )
    this.name = 'ConnectorRegistryError'
    this.problems = problems
  }
}

/**
 * What this build can run, beyond what a manifest may say: the definitions pipeline takes full
 * listings only, so a connector that sends tombstones waits for the next interface minor.
 */
function buildProblems(manifest: ConnectorManifest, runtime: ConnectorRuntime): ManifestProblem[] {
  if (manifest.capabilities.figures && typeof runtime.figure !== 'function')
    return [
      {
        path: 'capabilities.figures',
        message: 'The runtime reads no figure. Give it a figure function, or leave figures out.',
      },
    ]
  if (manifest.kind === 'definitions' && manifest.capabilities.deletions !== 'full-listing')
    return [
      {
        path: 'capabilities.deletions',
        message: 'This build reads definitions as full listings only. Use full-listing.',
      },
    ]
  return []
}

/** The connector's own warning codes, namespaced, and the core's. */
function knownWarning(manifest: ConnectorManifest, code: string): boolean {
  if ((sourceWarningCodes as readonly string[]).includes(code)) return true
  const prefix = `${manifest.id}.`
  return code.startsWith(prefix) && code.slice(prefix.length) in manifest.warnings
}

/**
 * The fetch a runtime gets (CON-113): GET or HEAD, to an address Heed may fetch (https to a
 * public host, with a query if it needs one), on a host the manifest declares, by name or from an address setting, with no
 * redirect followed and the read's time limit. A POST, with its body, goes only to a host the
 * manifest declares for signing in: a connector trades its credential for a short-lived token
 * there, and writes nothing to the tool (CON-102).
 */
export function guardedFetch(
  manifest: ConnectorManifest,
  config: SourceConfig,
  signal: AbortSignal,
): GuardedFetch {
  const hosts = new Set<string>()
  const signIn = new Set<string>()
  for (const host of manifest.egress.hosts) {
    let name: string | undefined
    if ('host' in host) name = host.host
    else {
      const value = config[host.fromField]
      name = (typeof value === 'string' ? URL.parse(value) : null)?.hostname.toLowerCase()
    }
    if (name === undefined) continue
    hosts.add(name)
    if (host.signIn) signIn.add(name)
  }
  return async (address, init = {}) => {
    const url = URL.parse(address)
    // A request may carry a query (an API's parameters); the address it goes to is checked as a
    // settings address is, without it.
    const fetchable =
      url !== null &&
      !url.username &&
      !url.password &&
      !url.hash &&
      isFetchableAddress(`${url.origin}${url.pathname}`)
    if (!url || !fetchable || !hosts.has(url.hostname.toLowerCase()))
      throw new SourceError({
        code: 'private_address',
        target: url?.host ?? 'address',
        class: 'config',
      })
    const method = init.method ?? 'GET'
    const post = method === 'POST'
    if ((post && !signIn.has(url.hostname.toLowerCase())) || (!post && init.body !== undefined))
      throw new SourceError({ code: 'invalid_output', target: 'fetch', class: 'source' })
    return fetch(url, {
      method,
      headers: init.headers,
      ...(post ? { body: init.body ?? '' } : {}),
      redirect: 'error',
      signal,
    })
  }
}

/** A log for a runtime: codes and targets only, which go nowhere a secret could follow. */
const quietLog = { info: () => {}, warn: () => {} }

/** A connector as the core runs it: its manifest, its runtime, and its worker if it has one. */
interface Running {
  manifest: ConnectorManifest
  runtime: ConnectorRuntime
  worker?: URL
  limits: WorkerLimits
}

/**
 * How long one piece of a runtime's work may take: the manifest's limit, or, for a connector
 * with a worker the server gave longer, that long and a minute to fetch what it reads.
 */
const timeLimitMs = ({ manifest, worker, limits }: Running) =>
  Math.max(manifest.limits.timeoutSeconds * 1000, worker ? limits.timeoutMs + 60_000 : 0)

function contextFor(
  running: Running,
  stored: StoredSource,
  cursor: string | null,
  signal: AbortSignal,
): RuntimeContext {
  const { manifest, worker, limits } = running
  return {
    config: stored.config,
    // A runtime is handed a content source's scopes; a definitions source's groups are the core's.
    scopes:
      manifest.kind === 'content'
        ? (stored.scopes ?? []).flatMap(({ domain, ...scope }) =>
            domain === null ? [] : [{ ...scope, domain }],
          )
        : [],
    cursor,
    secret: (key) =>
      manifest.secrets.some((secret) => secret.key === key)
        ? (stored.secrets?.[key] ?? null)
        : null,
    fetch: guardedFetch(manifest, stored.config, signal),
    git: guardedGit(manifest, stored.config, stored.secrets),
    folder: stored.folder === undefined ? null : folderTree(stored.folder),
    worker: (input) =>
      worker
        ? runWorker(worker, input, { signal, limits })
        : Promise.reject(
            new SourceError({ code: 'invalid_output', target: 'worker', class: 'source' }),
          ),
    signal,
    log: quietLog,
    now: () => new Date(),
  }
}

/** A failure of a runtime, as the warnings of a failed read: its code and target only. */
function failureOf(running: Running, error: unknown, signal: AbortSignal) {
  const { manifest } = running
  if (error instanceof SourceReadError) return error
  if (error instanceof SourceError && knownWarning(manifest, error.code))
    return new SourceReadError([{ code: error.code, target: error.target }], {
      class: error.errorClass,
      ...(error.retryAfter === undefined ? {} : { retryAfter: error.retryAfter }),
    })
  if (signal.aborted)
    return new SourceReadError(
      [{ code: 'timed_out', target: `${Math.round(timeLimitMs(running) / 1000)}` }],
      { class: 'transient' },
    )
  // Anything else says nothing about the tool, and could hold what it read: it is not kept.
  return new SourceReadError([{ code: 'invalid_output', target: manifest.id }])
}

/** A definition's group: its name up to the last dot (a Cube view); none without a dot. */
export const groupOf = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : null
}

/**
 * A read of a definitions source narrowed to the groups an administrator chose, each with the
 * domain they mapped it to: that domain for every definition of the group (`domain_override`),
 * or none, which leaves them shared. A group left out is not read, so a complete read marks its
 * definitions missing, as when the tool drops them. With no group chosen, the read is as the
 * tool gave it.
 */
export function withChosenGroups(
  snapshot: SourceSnapshot,
  scopes: readonly StoredScope[],
): SourceSnapshot {
  if (!scopes.length) return snapshot
  const chosen = new Map(scopes.map((scope) => [scope.id, scope.domain]))
  const mapped: SourceWarning[] = []
  const definitions = snapshot.definitions.flatMap((definition): Definition[] => {
    const group = groupOf(definition.name)
    if (group === null || !chosen.has(group)) return []
    const domain = chosen.get(group) ?? null
    if (domain === null) return [{ ...definition, areaHint: null, domainSource: 'none' }]
    mapped.push({ code: 'domain_override', target: definition.ref })
    return [{ ...definition, areaHint: domain, domainSource: 'override' }]
  })
  // A warning names a definition (by its ref or its name), a group, or neither (a file).
  const kept = new Set(definitions.flatMap((definition) => [definition.ref, definition.name]))
  const named = new Set(snapshot.definitions.flatMap((d) => [d.ref, d.name]))
  const groups = new Set(snapshot.definitions.flatMap((d) => groupOf(d.name) ?? []))
  // What it said of a group left out, of its definitions, or of a group mapped says nothing now.
  const warnings = snapshot.warnings.filter((warning) =>
    named.has(warning.target)
      ? kept.has(warning.target)
      : groups.has(warning.target)
        ? chosen.has(warning.target) && chosen.get(warning.target) === null
        : true,
  )
  return { ...snapshot, definitions, warnings: [...warnings, ...mapped] }
}

/** A stored definition source of a runtime's: a read gathers its messages into a snapshot. */
function runtimeSource(running: Running, stored: StoredSource): DefinitionSource {
  const { manifest, runtime } = running
  return {
    id: stored.id,
    type: manifest.id,
    name: stored.name,
    interfaceVersion: 3,
    serverSettings: [],
    async read(context?: ReadContext): Promise<SourceSnapshot> {
      const signal = AbortSignal.timeout(timeLimitMs(running))
      if (stored.secrets === null && manifest.secrets.length)
        throw new SourceReadError([{ code: 'secret_missing', target: manifest.secrets[0]!.key }])
      const definitions: Definition[] = []
      const warnings: SourceWarning[] = []
      const refs = new Set<string>()
      const invalid = () => new SourceReadError([{ code: 'invalid_output', target: manifest.id }])
      let capped = false
      try {
        const messages = runtime.read(contextFor(running, stored, context?.cursor ?? null, signal))
        for await (const raw of messages) {
          if (signal.aborted) throw signal.reason
          const parsed = runtimeMessageSchema.safeParse(raw)
          if (!parsed.success) throw invalid()
          const message = parsed.data
          if (message.type === 'progress') continue
          if (message.type === 'warning') {
            if (!knownWarning(manifest, message.code)) throw invalid()
            if (warnings.length < 1_000)
              warnings.push({ code: message.code, target: message.target })
            continue
          }
          if (message.type === 'end') {
            return withChosenGroups(
              {
                sourceVersion: message.version,
                complete: message.complete && !capped,
                definitions,
                warnings,
                ...(message.cursor === undefined ? {} : { cursor: message.cursor }),
              },
              stored.scopes ?? [],
            )
          }
          // A definitions connector sends definitions, under its tool's prefix, each once.
          if (message.type !== 'definition') throw invalid()
          const { definition } = message
          if (!definition.ref.startsWith(`${manifest.refPrefix}:`) || refs.has(definition.ref))
            throw invalid()
          if (definitions.length >= manifest.limits.maxRecords) {
            if (!capped)
              warnings.push({ code: 'too_many_records', target: `${manifest.limits.maxRecords}` })
            capped = true
            continue
          }
          refs.add(definition.ref)
          // Interface 2's pipeline still names a domain from the tool for its first connector.
          definitions.push({
            ...definition,
            domainSource: definition.domainSource === 'source' ? 'cube' : definition.domainSource,
          })
        }
      } catch (error) {
        // Why it failed first, then what it warned about on the way: each file it left out.
        const failure = failureOf(running, error, signal)
        if (failure.warnings[0]?.code === 'invalid_output') throw failure
        throw new SourceReadError([...failure.warnings, ...warnings].slice(0, 1_000), {
          class: failure.errorClass,
          ...(failure.retryAfter === undefined ? {} : { retryAfter: failure.retryAfter }),
        })
      }
      // A read that never says it ended may have stopped anywhere: it is not kept.
      throw invalid()
    },
  }
}

/**
 * A stored content source of a runtime's: a read's messages are checked one by one and gathered.
 * A document must be in a chosen scope, sent once, under the record limit; a tombstone comes only
 * from a connector that sends them; a definition never. Anything else fails the read with
 * `invalid_output` and keeps nothing, like a definitions read.
 */
function runtimeContent(running: Running, stored: StoredSource): ContentSource {
  const { manifest, runtime } = running
  // Every scope of a content source has its domain: the service refuses one without.
  const scopes = (stored.scopes ?? []).flatMap(({ domain, ...scope }) =>
    domain === null ? [] : [{ ...scope, domain }],
  )
  return {
    id: stored.id,
    type: manifest.id,
    name: stored.name,
    manifest,
    scopes,
    async read({ cursor }) {
      const signal = AbortSignal.timeout(timeLimitMs(running))
      if (stored.secrets === null && manifest.secrets.length)
        throw new SourceReadError([{ code: 'secret_missing', target: manifest.secrets[0]!.key }])
      const chosen = new Set(scopes.map((scope) => scope.id))
      const documents: SourceDocument[] = []
      const deleted = new Set<string>()
      const unread: string[] = []
      const warnings: SourceWarning[] = []
      const ids = new Set<string>()
      const invalid = () => new SourceReadError([{ code: 'invalid_output', target: manifest.id }])
      const warn = (warning: SourceWarning) => {
        if (warnings.length < 1_000) warnings.push(warning)
      }
      let text = 0
      let capped = false
      try {
        const messages = runtime.read(contextFor(running, { ...stored, scopes }, cursor, signal))
        for await (const raw of messages) {
          if (signal.aborted) throw signal.reason
          const parsed = runtimeMessageSchema.safeParse(raw)
          if (!parsed.success) throw invalid()
          const message = parsed.data
          if (message.type === 'progress') continue
          if (message.type === 'warning') {
            if (!knownWarning(manifest, message.code)) throw invalid()
            warn({ code: message.code, target: message.target })
            if (unreadDocumentCodes.includes(message.code)) unread.push(message.target)
            continue
          }
          if (message.type === 'end')
            return {
              version: message.version,
              complete: message.complete && !capped,
              ...(message.cursor === undefined ? {} : { cursor: message.cursor }),
              documents,
              deleted: [...deleted].filter((id) => !ids.has(id)),
              unread,
              warnings,
            }
          if (message.type === 'deleted') {
            if (manifest.capabilities.deletions === 'full-listing') throw invalid()
            deleted.add(message.id)
            continue
          }
          if (message.type !== 'document') throw invalid()
          const { document } = message
          if (!chosen.has(document.scope) || ids.has(document.id)) throw invalid()
          ids.add(document.id)
          if (documents.length + unread.length >= manifest.limits.maxRecords) {
            if (!capped) warn({ code: 'too_many_records', target: `${manifest.limits.maxRecords}` })
            capped = true
            continue
          }
          const length = document.text.length
          if (length > DOCUMENT_TEXT_MAX) {
            warn({ code: 'document_too_large', target: document.id })
            unread.push(document.id)
            continue
          }
          if (text + length > READ_TEXT_MAX) {
            if (!capped) warn({ code: 'too_much_text', target: `${READ_TEXT_MAX}` })
            capped = true
            continue
          }
          text += length
          documents.push(document)
        }
      } catch (error) {
        throw failureOf(running, error, signal)
      }
      // A read that never says it ended may have stopped anywhere: it is not kept.
      throw invalid()
    },
  }
}

/** A content connector's scopes, checked; a failure is a `SourceReadError`, as for a read. */
async function discoverOf(running: Running, stored: StoredSource): Promise<Scope[]> {
  const { manifest, runtime } = running
  if (!runtime.discover) return []
  const signal = AbortSignal.timeout(timeLimitMs(running))
  if (stored.secrets === null && manifest.secrets.length)
    throw new SourceReadError([{ code: 'secret_missing', target: manifest.secrets[0]!.key }])
  try {
    const scopes = await runtime.discover(contextFor(running, stored, null, signal))
    if (!Array.isArray(scopes) || scopes.length > 200) throw new Error('too many scopes')
    const checked = scopes.map((scope) => scopeSchema.parse(scope))
    if (new Set(checked.map((scope) => scope.id)).size !== checked.length)
      throw new Error('a scope twice')
    return checked
  } catch (error) {
    throw failureOf(running, error, signal)
  }
}

/**
 * The hosts a source's settings name, refused with the settings when Heed may not reach them: in
 * production a private address or plain http (CON-113), as `ctx.fetch` and `ctx.git` refuse them.
 */
function unreachable(manifest: ConnectorManifest, config: SourceConfig): FieldProblem[] {
  return manifest.egress.hosts.flatMap((host) => {
    if (!('fromField' in host)) return []
    const value = config[host.fromField]
    return typeof value === 'string' && !isFetchableAddress(value)
      ? [
          {
            field: host.fromField,
            message:
              'Use an https address on a public host, without a user name, password, query or fragment.',
          },
        ]
      : []
  })
}

/** A connector written to interface 3: its manifest's rules, then its runtime's own. */
export function fromModule(
  module: ConnectorModule,
  limits: WorkerLimits = workerLimits(),
): RegisteredConnector {
  const { manifest, runtime } = module
  const running: Running = {
    manifest,
    runtime,
    ...(module.worker ? { worker: module.worker } : {}),
    limits,
  }
  return {
    manifest,
    writtenTo: 3,
    parse(config) {
      const parsed = parseConnectorConfig(manifest, config)
      if ('problems' in parsed) return parsed
      const problems = [
        ...unreachable(manifest, parsed.config),
        ...(runtime.parse?.(parsed.config) ?? []),
      ]
      return problems.length ? { problems } : { config: parsed.config }
    },
    domains: (config) => connectorConfigDomains(manifest, config),
    secretsBoundTo: secretsBoundTo(manifest),
    source: (stored) => runtimeSource(running, stored),
    ...(manifest.kind === 'content'
      ? {
          content: (stored: StoredSource) => runtimeContent(running, stored),
          discover: (stored: StoredSource) => discoverOf(running, stored),
        }
      : {}),
    ...(manifest.capabilities.figures && runtime.figure
      ? {
          figure: (connection: FigureConnection, query: FigureQuery, signal: AbortSignal) =>
            figureOf(runtime, connection, query, signal),
        }
      : {}),
    async check(stored) {
      const signal = AbortSignal.timeout(timeLimitMs(running))
      if (stored.secrets === null && manifest.secrets.length)
        throw new SourceReadError([{ code: 'secret_missing', target: manifest.secrets[0]!.key }])
      try {
        return checkReportSchema.parse(
          await runtime.check(contextFor(running, stored, null, signal)),
        )
      } catch (error) {
        throw failureOf(running, error, signal)
      }
    },
  }
}

/**
 * The connectors to register, checked: every manifest valid and in a range this build speaks,
 * each id once and in form, and each ref prefix with one tool. No connector may take the id of a
 * type of source the server's configuration selects (the demo), unless it is the connector that
 * reads that source (Cube, for the server's model folder).
 */
export function registerConnectors(
  modules: readonly ConnectorModule[],
  types: readonly ConnectorType[],
  { worker = workerLimits() }: { worker?: WorkerLimits } = {},
): RegisteredConnector[] {
  const problems: { id: string; problem: ManifestProblem }[] = []
  const connectors: RegisteredConnector[] = []
  for (const module of modules) {
    const named = (module.manifest as { id?: unknown }).id
    const id = typeof named === 'string' ? named : 'manifest'
    const checked = checkManifest(module.manifest)
    if (!checked.ok) {
      problems.push(...checked.problems.map((problem) => ({ id, problem })))
      continue
    }
    const unsupported = buildProblems(checked.manifest, module.runtime)
    if (unsupported.length) {
      problems.push(...unsupported.map((problem) => ({ id, problem })))
      continue
    }
    connectors.push(fromModule({ ...module, manifest: checked.manifest }, worker))
  }
  for (const type of types)
    if (!connectorIdPattern.test(type.type))
      problems.push({ id: type.type, problem: { path: 'type', message: 'Not a connector id.' } })
  for (const connector of connectors) {
    const type = types.find((candidate) => candidate.type === connector.manifest.id)
    if (type && type.tool !== connector.manifest.tool)
      problems.push({
        id: connector.manifest.id,
        problem: { path: 'id', message: `Another connector has the id ${connector.manifest.id}.` },
      })
  }
  problems.push(...checkManifests(connectors.map((connector) => connector.manifest)))
  if (problems.length) throw new ConnectorRegistryError(problems)
  return connectors
}
