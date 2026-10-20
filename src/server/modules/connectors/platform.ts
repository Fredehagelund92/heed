import {
  checkManifest,
  checkManifests,
  manifestFromInterface2,
  secretsBoundTo,
  type ConnectorManifest,
  type ManifestProblem,
} from '../../../domain/connector-manifest.ts'
import { connectorIdPattern } from '../../../domain/connector-id.ts'
import { connectorConfigDomains, parseConnectorConfig } from '../../../domain/connector-config.ts'
import {
  checkReportSchema,
  runtimeMessageSchema,
  SourceError,
  type CheckReport,
  type ConnectorModule,
  type ConnectorRuntime,
  type GuardedFetch,
  type RuntimeContext,
} from '../../../domain/connector-runtime.ts'
import type { SourceConfig } from '../../../contract/sources.ts'
import { sourceWarningCodes } from '../../../contract/operations.ts'
import { isFetchableAddress } from './git.ts'
import {
  INTERFACE_VERSION,
  SourceReadError,
  type ConnectorType,
  type Definition,
  type DefinitionSource,
  type FieldProblem,
  type ReadContext,
  type SourceSnapshot,
  type SourceWarning,
  type WorkspaceConnector,
} from './types.ts'

/*
  Interface 3.0 in the core (docs/connectors.md, "Interface 3.0"): a connector is a manifest and
  a runtime. The registry checks every manifest at start and keeps each connector here as one
  shape, whether it was written to interface 3 or to interface 2 and adapted, so Sources lists,
  checks and reads them all the same way.

  A runtime's read is a stream of messages. Until the core's own pipelines take messages, a
  definitions read is gathered into interface 2's snapshot and goes through the one pipeline
  every definition source uses (ConnectorService.syncSource), with all its rules: a ref belongs
  to one source, only a complete read marks absent definitions missing, a failed read changes
  nothing.
*/

/** The interface a registered connector was written to. */
export type WrittenTo = 2 | 3

/** A source's stored settings and the secrets the store holds for it (null when it lost them). */
export interface StoredSource {
  id: string
  name: string
  config: SourceConfig
  secrets: Readonly<Record<string, string>> | null
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
  /** The runtime's own check, ordered steps that change nothing; absent for interface 2. */
  check?(stored: StoredSource): Promise<CheckReport>
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
function buildProblems(manifest: ConnectorManifest): ManifestProblem[] {
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
 * The fetch a runtime gets (CON-113): GET or HEAD only, to an address Heed may fetch (https to a
 * public host), on a host the manifest declares, by name or from an address setting, with no
 * redirect followed and the read's time limit.
 */
export function guardedFetch(
  manifest: ConnectorManifest,
  config: SourceConfig,
  signal: AbortSignal,
): GuardedFetch {
  const hosts = new Set<string>()
  for (const host of manifest.egress.hosts) {
    if ('host' in host) hosts.add(host.host)
    else {
      const value = config[host.fromField]
      const url = typeof value === 'string' ? URL.parse(value) : null
      if (url) hosts.add(url.hostname.toLowerCase())
    }
  }
  return async (address, init = {}) => {
    const url = URL.parse(address)
    if (!url || !isFetchableAddress(address) || !hosts.has(url.hostname.toLowerCase()))
      throw new SourceError({
        code: 'private_address',
        target: url?.host ?? 'address',
        class: 'config',
      })
    return fetch(url, {
      method: init.method ?? 'GET',
      headers: init.headers,
      redirect: 'error',
      signal,
    })
  }
}

/** A log for a runtime: codes and targets only, which go nowhere a secret could follow. */
const quietLog = { info: () => {}, warn: () => {} }

function contextFor(
  manifest: ConnectorManifest,
  stored: StoredSource,
  cursor: string | null,
  signal: AbortSignal,
): RuntimeContext {
  return {
    config: stored.config,
    scopes: [],
    cursor,
    secret: (key) =>
      manifest.secrets.some((secret) => secret.key === key)
        ? (stored.secrets?.[key] ?? null)
        : null,
    fetch: guardedFetch(manifest, stored.config, signal),
    signal,
    log: quietLog,
    now: () => new Date(),
  }
}

/** A failure of a runtime, as the warnings of a failed read: its code and target only. */
function failureOf(manifest: ConnectorManifest, error: unknown, signal: AbortSignal) {
  if (error instanceof SourceReadError) return error
  if (error instanceof SourceError && knownWarning(manifest, error.code))
    return new SourceReadError([{ code: error.code, target: error.target }])
  if (signal.aborted)
    return new SourceReadError([{ code: 'timed_out', target: `${manifest.limits.timeoutSeconds}` }])
  // Anything else says nothing about the tool, and could hold what it read: it is not kept.
  return new SourceReadError([{ code: 'invalid_output', target: manifest.id }])
}

/** A stored definition source of a runtime's: a read gathers its messages into a snapshot. */
function runtimeSource(
  manifest: ConnectorManifest,
  runtime: ConnectorRuntime,
  stored: StoredSource,
): DefinitionSource {
  return {
    id: stored.id,
    type: manifest.id,
    name: stored.name,
    // The pipeline it feeds speaks interface 2; the connector's own interface is on its row.
    interfaceVersion: INTERFACE_VERSION,
    serverSettings: [],
    async read(context?: ReadContext): Promise<SourceSnapshot> {
      const signal = AbortSignal.timeout(manifest.limits.timeoutSeconds * 1000)
      if (stored.secrets === null && manifest.secrets.length)
        throw new SourceReadError([{ code: 'secret_missing', target: manifest.secrets[0]!.key }])
      const definitions: Definition[] = []
      const warnings: SourceWarning[] = []
      const refs = new Set<string>()
      const invalid = () => new SourceReadError([{ code: 'invalid_output', target: manifest.id }])
      let capped = false
      try {
        const messages = runtime.read(contextFor(manifest, stored, context?.cursor ?? null, signal))
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
            return {
              sourceVersion: message.version,
              complete: message.complete && !capped,
              definitions,
              warnings,
              ...(message.cursor === undefined ? {} : { cursor: message.cursor }),
            }
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
        throw failureOf(manifest, error, signal)
      }
      // A read that never says it ended may have stopped anywhere: it is not kept.
      throw invalid()
    },
  }
}

/** A connector written to interface 3: its manifest's rules, then its runtime's own. */
export function fromModule(module: ConnectorModule): RegisteredConnector {
  const { manifest, runtime } = module
  return {
    manifest,
    writtenTo: 3,
    parse(config) {
      const parsed = parseConnectorConfig(manifest, config)
      if ('problems' in parsed) return parsed
      const problems = runtime.parse?.(parsed.config) ?? []
      return problems.length ? { problems } : { config: parsed.config }
    },
    domains: (config) => connectorConfigDomains(manifest, config),
    secretsBoundTo: secretsBoundTo(manifest),
    source: (stored) => runtimeSource(manifest, runtime, stored),
    async check(stored) {
      const signal = AbortSignal.timeout(manifest.limits.timeoutSeconds * 1000)
      if (stored.secrets === null && manifest.secrets.length)
        throw new SourceReadError([{ code: 'secret_missing', target: manifest.secrets[0]!.key }])
      try {
        return checkReportSchema.parse(
          await runtime.check(contextFor(manifest, stored, null, signal)),
        )
      } catch (error) {
        throw failureOf(manifest, error, signal)
      }
    },
  }
}

/**
 * A connector type written to interface 2, adapted: its manifest comes from what it declares,
 * and its own code checks the settings and makes the source, as before (no regression for Cube).
 */
export function fromInterface2(
  type: ConnectorType & { workspace: WorkspaceConnector },
): RegisteredConnector {
  const { workspace } = type
  return {
    manifest: manifestFromInterface2({
      type: type.type,
      tool: type.tool,
      title: workspace.title,
      description: workspace.description,
      access: workspace.access,
      fields: workspace.fields,
      secretsBoundTo: workspace.secretsBoundTo,
    }),
    writtenTo: 2,
    parse: (config) => workspace.parse(config),
    domains: (config) => workspace.domains(config),
    secretsBoundTo: workspace.secretsBoundTo,
    source: (stored) => workspace.create(stored),
  }
}

/**
 * The connectors to register, checked: every manifest valid and in a range this build speaks,
 * each id once and in form, and each ref prefix with one tool. Interface 2 types that admins
 * cannot add (the demo) are not connectors here, but no connector may take their id.
 */
export function registerConnectors(
  modules: readonly ConnectorModule[],
  types: readonly ConnectorType[],
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
    const unsupported = buildProblems(checked.manifest)
    if (unsupported.length) {
      problems.push(...unsupported.map((problem) => ({ id, problem })))
      continue
    }
    connectors.push(fromModule({ manifest: checked.manifest, runtime: module.runtime }))
  }
  for (const type of types) {
    if (!connectorIdPattern.test(type.type))
      problems.push({ id: type.type, problem: { path: 'type', message: 'Not a connector id.' } })
    else if (type.workspace) connectors.push(fromInterface2({ ...type, workspace: type.workspace }))
  }
  const typeIds = new Set(types.map((type) => type.type))
  for (const connector of connectors)
    if (connector.writtenTo === 3 && typeIds.has(connector.manifest.id))
      problems.push({
        id: connector.manifest.id,
        problem: { path: 'id', message: `Another connector has the id ${connector.manifest.id}.` },
      })
  problems.push(...checkManifests(connectors.map((connector) => connector.manifest)))
  if (problems.length) throw new ConnectorRegistryError(problems)
  return connectors
}
