import * as z from 'zod/mini'
import type { ConnectorConfig, FieldProblem } from './connector-config.ts'
import type { ConnectorManifest } from './connector-manifest.ts'

/*
  A connector's runtime (interface 3.0, docs/connectors.md "The runtime and its messages"): the
  code that checks settings, lists what a source may cover and reads it. It runs on the server
  only and touches nothing but what its context hands it. What it returns is untrusted data
  (I-7): every message is checked against these schemas before the core keeps anything, and a
  definition is strict, so SQL a tool returns somewhere in its payload never crosses.

  This file holds the types and the message schemas only; the core runs a runtime.
*/

/** The ref of a definition: `<prefix>:<path>`. */
export const definitionRefPattern = /^[a-z][a-z0-9_]*:[A-Za-z0-9_.:/-]+$/
const domainId = z.string().check(z.regex(/^[a-z][a-z0-9_]{1,39}$/))
const sha256 = z.string().check(z.regex(/^[a-f0-9]{64}$/))

/** A metric or dimension a definitions connector found: interface 2's, strict, no vendor. */
export const runtimeDefinitionSchema = z.strictObject({
  ref: z.string().check(z.maxLength(500), z.regex(definitionRefPattern)),
  kind: z.enum(['metric', 'dimension']),
  name: z.string().check(z.minLength(1), z.maxLength(500)),
  title: z.nullable(z.string().check(z.maxLength(500))),
  descriptionCopy: z.nullable(z.string().check(z.refine((value) => [...value].length <= 500))),
  valueType: z.nullable(z.string().check(z.maxLength(100))),
  visibleGroups: z.null(),
  areaHint: z.nullable(domainId),
  /** Where the domain came from: the tool, the source's own domain names, or nowhere. */
  domainSource: z.enum(['source', 'override', 'none']),
  modelFile: z.nullable(z.string().check(z.minLength(1), z.maxLength(500))),
  synonyms: z.optional(
    z.array(z.string().check(z.minLength(1), z.maxLength(200))).check(z.maxLength(20)),
  ),
  baseName: z.optional(z.nullable(z.string().check(z.minLength(1), z.maxLength(500)))),
  changeMark: sha256,
})
export type RuntimeDefinition = z.infer<typeof runtimeDefinitionSchema>

/** A document a content connector found. Its text lives in memory for one read only. */
export const sourceDocumentSchema = z.strictObject({
  id: z.string().check(z.minLength(1), z.maxLength(500)),
  scope: z.string().check(z.minLength(1), z.maxLength(500)),
  title: z.string().check(z.minLength(1), z.maxLength(300)),
  link: z.url({ protocol: /^https$/ }).check(z.maxLength(2000)),
  modifiedAt: z.iso.datetime(),
  version: z.string().check(z.minLength(1), z.maxLength(200)),
  text: z.string().check(z.maxLength(1_000_000)),
  mediaType: z.enum(['text/markdown', 'text/plain', 'text/html']),
})
export type SourceDocument = z.infer<typeof sourceDocumentSchema>

/** A warning's code: one of the core's, or the connector's own as `<id>.<code>`. */
export const runtimeWarningCode = z
  .string()
  .check(z.regex(/^([a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?\.)?[a-z][a-z0-9_]{0,39}$/))

export const runtimeMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('definition'), definition: runtimeDefinitionSchema }),
  z.strictObject({ type: z.literal('document'), document: sourceDocumentSchema }),
  /** A tombstone, in a delta read. */
  z.strictObject({ type: z.literal('deleted'), id: z.string().check(z.minLength(1)) }),
  z.strictObject({
    type: z.literal('warning'),
    code: runtimeWarningCode,
    target: z.string().check(z.maxLength(500)),
  }),
  z.strictObject({
    type: z.literal('progress'),
    done: z.number().check(z.int(), z.minimum(0)),
    total: z.optional(z.number().check(z.int(), z.minimum(0))),
  }),
  z.strictObject({
    type: z.literal('end'),
    version: z.string().check(z.minLength(1), z.maxLength(200)),
    complete: z.boolean(),
    cursor: z.optional(z.string().check(z.minLength(1), z.maxLength(500))),
  }),
])
export type RuntimeMessage = z.infer<typeof runtimeMessageSchema>

/** What a source covers: a view of a definition source, a folder, space or page of content. */
export interface Scope {
  id: string
  title: string
  /** The domain it most likely belongs to, which the administrator confirms. */
  suggestedDomain: string | null
}

/** A scope an administrator chose, with the one domain its documents go to (CON-602). */
export interface ChosenScope {
  id: string
  title: string
  domain: string
}

/** A scope as `discover` returns it: checked before anyone chooses it. */
export const scopeSchema = z.strictObject({
  id: z.string().check(z.minLength(1), z.maxLength(500)),
  title: z.string().check(z.minLength(1), z.maxLength(300)),
  suggestedDomain: z.nullable(domainId),
})

/** One step of a check: reach, sign in, sample. Its words are the connector's. */
export const checkStepSchema = z.strictObject({
  id: z.string().check(z.regex(/^[a-z][a-z0-9_-]{0,39}$/)),
  title: z.string().check(z.minLength(1), z.maxLength(120)),
  status: z.enum(['ok', 'warning', 'failed', 'skipped']),
  /** What it found, or why it failed. */
  detail: z.optional(z.string().check(z.maxLength(500))),
  /** What to do about a failure. */
  fix: z.optional(z.string().check(z.maxLength(500))),
})
export type CheckStep = z.infer<typeof checkStepSchema>
export const checkReportSchema = z.strictObject({
  steps: z.array(checkStepSchema).check(z.minLength(1), z.maxLength(12)),
})
export type CheckReport = z.infer<typeof checkReportSchema>

/**
 * Why a check or a read failed: `config`, an administrator must fix it (a refused token, nothing
 * at the address); `transient`, it is tried again later (a timeout, too many requests);
 * `source`, the tool's own content is broken (the model does not compile).
 */
export type SourceErrorClass = 'config' | 'transient' | 'source'

export class SourceError extends Error {
  readonly code: string
  readonly target: string
  readonly errorClass: SourceErrorClass
  /** Seconds to wait before trying again, when the tool said. */
  readonly retryAfter: number | undefined
  constructor(failure: {
    code: string
    target: string
    class: SourceErrorClass
    retryAfter?: number
  }) {
    super(`Source error ${failure.code}`)
    this.name = 'SourceError'
    this.code = failure.code
    this.target = failure.target
    this.errorClass = failure.class
    this.retryAfter = failure.retryAfter
  }
}

/**
 * A request a connector may make: GET or HEAD, https, to a host its manifest declares; and a POST
 * with a body only to a host it declares for signing in, to trade its credential for a
 * short-lived token. Nothing is ever written to the tool (CON-102).
 */
export type GuardedFetch = (
  url: string,
  init?: { method?: 'GET' | 'HEAD' | 'POST'; headers?: Record<string, string>; body?: string },
) => Promise<Response>

/**
 * A folder of files, read only. Paths are relative to the folder handed over, with `/` between
 * parts, and nothing outside it is listed or read.
 */
export interface FolderTree {
  /** The folders directly in a folder of the tree ('' for its top), sorted. */
  folders(folder?: string): Promise<string[]>
  /**
   * The files in a folder and the folders under it, sorted, with their size in bytes. Links are
   * plain files, and nothing outside the tree is listed.
   */
  files(folder?: string): Promise<{ path: string; size: number }[]>
  /** A file's text as UTF-8; null when it is not a file in the tree, is a link or is not text. */
  text(path: string): Promise<string | null>
}

/** One commit of a Git repository, checked out for one piece of work and removed after it. */
export interface GitTree extends FolderTree {
  /** The commit's id. */
  readonly commit: string
  /** When it was committed, ISO 8601 in UTC. */
  readonly committedAt: string
}

/**
 * Git a connector may use (CON-113): one commit of the repository a settings field names, which
 * its manifest declares (`egress.git` and a host from that field), fetched read only with the
 * secret named, if any, when that secret is bound to the field. A failure is a `SourceError`.
 */
export type GuardedGit = <T>(
  request: {
    /** The repository address, exactly as a settings field holds it. */
    repository: string
    /** A branch, a tag or a full commit. */
    ref: string
    /** The folder of the repository to hand over, relative; empty or absent for the top. */
    folder?: string
    /** The key of the secret to send as the token. */
    secret?: string
    /** The user name sent with the token; most hosts accept any. */
    username?: string
  },
  work: (tree: GitTree) => Promise<T>,
) => Promise<T>

/** A log that takes codes and targets only, never a secret or a document's text. */
export interface RedactingLogger {
  info(code: string, target?: string): void
  warn(code: string, target?: string): void
}

/** What the core hands a runtime, and all it may use. */
export interface RuntimeContext<Config = ConnectorConfig> {
  /** The settings, checked against the manifest. */
  readonly config: Config
  /** What the administrator chose to cover; empty when the connector discovers nothing. */
  readonly scopes: readonly ChosenScope[]
  /** From the newest good read; null for a full read. */
  readonly cursor: string | null
  /** This source's own secrets, nothing else; null when it has none by that key. */
  secret(key: string): string | null
  readonly fetch: GuardedFetch
  readonly git: GuardedGit
  /**
   * The folder on the server that whoever runs it named for this source, read only; null for a
   * source an administrator added, which reaches its tool through `fetch` or `git`.
   */
  readonly folder: FolderTree | null
  /**
   * Runs the connector's worker with this input and returns its one answer, untrusted (T1,
   * docs/connectors/security.md): a child process of its own under Node's permission model, with
   * no network, no writes and no programs, that reads only the service's code and dependencies,
   * within the read's time limit. A connector that declares no worker is refused. Built-in
   * connectors only.
   */
  worker(input: unknown): Promise<unknown>
  /** Ends the work at the manifest's `limits.timeoutSeconds`. */
  readonly signal: AbortSignal
  readonly log: RedactingLogger
  now(): Date
}

/**
 * One figure a definitions connector with the figures capability reads (CON-612, FR-716): a
 * metric over a range of days, for some values of its dimensions. The core builds it from the
 * metric's definition and the question's scope, never from words a person or a model wrote, so
 * it is a fixed template: the tool's own member names, both days included.
 */
export interface FigureQuery {
  /** The metric as the tool names it, its ref without the prefix: `orders.orders`. */
  readonly metric: string
  /** The tool's date dimension the days apply to, in the metric's own view: `orders.order_day`. */
  readonly date: string
  /** The first and last day, both included: `2026-08-01`, `2026-08-31`. */
  readonly from: string
  readonly to: string
  /** Only these values of each dimension, as the tool names the dimension. */
  readonly filters: readonly { readonly dimension: string; readonly values: readonly string[] }[]
}

/** How the tool says a figure is written: an amount of money, a share, or a number. */
export const figureFormatSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('currency'),
    currency: z.string().check(z.regex(/^[A-Z]{3}$/)),
  }),
  z.strictObject({ kind: z.literal('percent') }),
  z.strictObject({ kind: z.literal('number') }),
])
export type FigureFormat = z.infer<typeof figureFormatSchema>

/**
 * What a connector read for one figure: the value (null when the tool has none for those days),
 * when the tool last refreshed its data, if it says, and how the value is written. Untrusted and
 * checked, like every message (I-7); the core keeps none of it.
 */
export const figureResultSchema = z.strictObject({
  value: z.nullable(z.number().check(z.refine(Number.isFinite))),
  asOf: z.nullable(z.iso.datetime({ offset: true })),
  format: figureFormatSchema,
  /**
   * How the tool works the measure out, when it says: `sum`, `count`, `countDistinct`, `avg`,
   * `min`, `max`, or `number` for its own calculation. The query in words says it.
   */
  aggregation: z.optional(z.nullable(z.string().check(z.regex(/^[A-Za-z]{1,40}$/)))),
})
export type FigureResult = z.infer<typeof figureResultSchema>

/**
 * What the core hands `figure`, and all it may use: the data endpoint an administrator set, the
 * service token kept for it in the secret store, a fetch that reaches only the endpoint's host
 * (its declared host), and a signal that ends the work at the figure's time limit. No person's
 * identity is ever in it (FR-716, CON-406).
 */
export interface FigureContext {
  readonly endpoint: string
  readonly token: string
  readonly fetch: GuardedFetch
  readonly signal: AbortSignal
  now(): Date
}

/** A connector's code. `read` ends with an `end` message; a failure throws a `SourceError`. */
export interface ConnectorRuntime<Config = ConnectorConfig> {
  /** Rules on the settings a manifest cannot say, by field. Never sees a secret. */
  parse?(config: Config): FieldProblem[]
  /** Ordered steps that change nothing. */
  check(context: RuntimeContext<Config>): Promise<CheckReport>
  /** The scopes an administrator may choose, each with a suggested domain. */
  discover?(context: RuntimeContext<Config>): Promise<Scope[]>
  /** One read: a full one when the cursor is null. */
  read(context: RuntimeContext<Config>): AsyncIterable<RuntimeMessage>
  /** Settings of an older major version, brought up to date. */
  migrateConfig?(fromVersion: string, config: ConnectorConfig): ConnectorConfig
  /**
   * Reads one figure from the tool's data endpoint, read only, when the manifest declares the
   * figures capability. A failure throws a `SourceError`.
   */
  figure?(context: FigureContext, query: FigureQuery): Promise<FigureResult>
}

/** A runtime, typed: `export default defineRuntime<Config>({ ... })` in a connector's folder. */
export const defineRuntime = <Config = ConnectorConfig>(
  runtime: ConnectorRuntime<Config>,
): ConnectorRuntime<Config> => runtime

/** A connector as its folder exports it: the manifest (data) and the runtime (code). */
export interface ConnectorModule {
  readonly manifest: ConnectorManifest
  readonly runtime: ConnectorRuntime
  /**
   * The worker the runtime hands risky parsing to (`ctx.worker`), a module of its folder that the
   * core runs in a child process of its own (T1). Built-in connectors only.
   */
  readonly worker?: URL
}

/**
 * A connector's two halves, as `src/connectors/index.ts` lists them, and its worker if it has
 * one. The core checks the settings against the manifest before the runtime sees them, so the
 * runtime may type them.
 */
export const defineConnector = <Config>(
  manifest: ConnectorManifest,
  runtime: ConnectorRuntime<Config>,
  options: { worker?: URL } = {},
): ConnectorModule => ({
  manifest,
  runtime: runtime as unknown as ConnectorRuntime,
  ...(options.worker ? { worker: options.worker } : {}),
})
