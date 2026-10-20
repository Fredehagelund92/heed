import { ORPCError } from '@orpc/client'
import type {
  AddSourceInput,
  ConnectorListing,
  SourceCheck,
  SourceConfig,
  SourceSettings,
  TestSourceInput,
  UpdateSourceInput,
} from '../../../contract/sources.ts'
import { reservedSourceIds, sourceIdFrom } from '../../../domain/source-id.ts'
import type { Queryable } from '../../db/database.ts'
import { plainReason, recordAudit } from '../admin/index.ts'
import type { RegisteredConnector } from './platform.ts'
import type { ConnectorRegistry } from './registry.ts'
import { SecretStoreError, type SecretStore } from './secrets.ts'
import {
  snapshotSchema,
  SourceReadError,
  type DefinitionSource,
  type FieldProblem,
  type SourceSnapshot,
  type SourceWarning,
} from './types.ts'
import { productName } from '../../brand.ts'

/**
 * The sources an administrator adds in Administration › Sources, each of a connector the registry
 * holds (interface 3.0, or 2 through the adapter): their settings are configuration in the
 * database (`connectors.config`), checked against the connector's manifest and then its own
 * rules; their secrets are in the secret store and only named in the database
 * (`connectors.secret_ref`, CON-105). A secret goes in once and comes out only to the source's
 * reader: the API says whether one is set, never what it is, and the history log records that it
 * was set or replaced.
 */

/** Runs after the request's transaction: on commit, or on rollback. */
export interface TransactionHooks {
  onCommit(work: () => Promise<void>): void
  onRollback(work: () => Promise<void>): void
}

interface Row {
  id: string
  type: string
  name: string
  config: SourceConfig
  secret_ref: string | null
  revision: number
  changed_at: Date | null
  changed_by: string | null
}

const columns = 'id, type, name, config, secret_ref, revision, changed_at, changed_by::text'

const invalid = (problems: readonly FieldProblem[]): never => {
  throw new ORPCError('UNPROCESSABLE_CONTENT', {
    message:
      problems[0]?.message ??
      'Some settings need attention. Fix the problems shown, then try again.',
    data: {
      findings: problems.map((problem) => ({
        code: 'invalid_setting',
        field: problem.field,
        message: problem.message,
        severity: 'error' as const,
      })),
    },
  })
}

/** How many views, metrics and dimensions a read holds, as a test says it. */
function summary(
  snapshot: SourceSnapshot,
  warnings: SourceWarning[],
  steps: SourceCheck['steps'],
): SourceCheck {
  const views = new Set(
    snapshot.definitions.flatMap((definition) => {
      const dot = definition.name.lastIndexOf('.')
      return dot > 0 ? [definition.name.slice(0, dot)] : []
    }),
  )
  return {
    ok: true,
    steps,
    version: snapshot.sourceVersion,
    complete: snapshot.complete && warnings.every((warning) => warning.code !== 'taken'),
    views: views.size,
    metrics: snapshot.definitions.filter((definition) => definition.kind === 'metric').length,
    dimensions: snapshot.definitions.filter((definition) => definition.kind === 'dimension').length,
    warnings: warnings.slice(0, 200),
  }
}

/** True when settings a source's secrets are bound to differ: its secrets must not follow. */
function rebinds(connector: RegisteredConnector, before: SourceConfig, after: SourceConfig) {
  return connector.secretsBoundTo.some(
    (key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null),
  )
}

const failed = (warnings: SourceWarning[], steps: SourceCheck['steps'] = []): SourceCheck => ({
  ok: false,
  steps,
  version: null,
  complete: false,
  views: 0,
  metrics: 0,
  dimensions: 0,
  warnings: warnings.slice(0, 200),
})

export function createWorkspaceSources({
  secrets,
  registry,
}: {
  secrets: SecretStore
  /** The connectors, and the sources the server's own configuration selects (their ids). */
  registry: Pick<ConnectorRegistry, 'connectors' | 'list'>
}) {
  // An admin adds definition sources today; content sources come with their pipeline.
  const addable = () =>
    registry.connectors().filter((connector) => connector.manifest.kind === 'definitions')
  const typeOf = (type: string) => addable().find((candidate) => candidate.manifest.id === type)
  const secretKeys = (connector: RegisteredConnector) =>
    connector.manifest.secrets.map((secret) => secret.key)
  /** The secrets a source holds; null when its store entry is gone or cannot be read. */
  const held = async (ref: string | null): Promise<Readonly<Record<string, string>> | null> => {
    if (ref === null) return {}
    try {
      return await secrets.read(ref)
    } catch (error) {
      if (error instanceof SecretStoreError) return null
      throw error
    }
  }

  const settingsOf = (row: Row, held: Readonly<Record<string, string>> | null): SourceSettings => {
    const connector = typeOf(row.type)
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      revision: row.revision,
      config: row.config,
      secrets: (connector ? secretKeys(connector) : []).map((key) => ({
        key,
        set: held !== null && typeof held[key] === 'string',
      })),
      changedAt: row.changed_at?.toISOString() ?? null,
      changedBy: row.changed_by,
    }
  }

  /** The settings checked by the connector, the secrets checked against its slots, the reason. */
  async function checkInput(
    tx: Queryable,
    connector: RegisteredConnector,
    input: { name: string; config: SourceConfig; secrets: Record<string, string>; reason: string },
    needsSecrets: boolean,
  ): Promise<SourceConfig> {
    plainReason(input.reason)
    const problems: FieldProblem[] = []
    if (!input.name.trim()) problems.push({ field: 'name', message: 'Give the source a name.' })
    const parsed = connector.parse(input.config)
    if ('problems' in parsed) problems.push(...parsed.problems)
    const keys = secretKeys(connector)
    for (const key of Object.keys(input.secrets))
      if (!keys.includes(key))
        problems.push({ field: key, message: 'This source has no such secret.' })
    if (needsSecrets)
      for (const secret of connector.manifest.secrets)
        if (secret.required && !input.secrets[secret.key])
          problems.push({ field: secret.key, message: `Give the ${secret.label.toLowerCase()}.` })
    if (Object.keys(input.secrets).length && !secrets.available)
      for (const key of Object.keys(input.secrets))
        problems.push({
          field: key,
          message:
            "There's no secret store, so we can't keep a secret. The data team sets one up with CL_SECRETS_DIR.",
        })
    // A secret pasted into another field would be kept in plain text and in the history log.
    const plain = JSON.stringify([input.name, input.config, input.reason])
    for (const [key, value] of Object.entries(input.secrets))
      if (value.length >= 8 && plain.includes(value))
        problems.push({
          field: key,
          message: 'The secret is in another field too. Keep it in its own field only.',
        })
    // Every problem at once: the domains are checked even when another field is wrong.
    const named = [
      ...new Set(connector.domains(input.config).filter((id) => /^[a-z][a-z0-9_]{1,39}$/.test(id))),
    ]
    const mapField =
      connector.manifest.config.fields.find((field) => field.kind === 'domain_map')?.key ??
      'domainNames'
    if (named.length) {
      const found = await tx.query<{ id: string }>(
        'select id from areas where id = any($1::text[])',
        [named],
      )
      const known = new Set(found.map((row) => row.id))
      for (const id of named)
        if (!known.has(id))
          problems.push({
            field: mapField,
            message: `${id} isn't a domain in ${productName}.`,
          })
    }
    if (problems.length || !('config' in parsed)) invalid(problems)
    return (parsed as { config: SourceConfig }).config
  }

  async function workspaceRow(tx: Queryable, id: string, lock = false): Promise<Row | null> {
    const [row] = await tx.query<Row>(
      `select ${columns} from connectors where id = $1 and origin = 'workspace'${lock ? ' for update' : ''}`,
      [id],
    )
    return row ?? null
  }

  /** One read of a source with these settings, kept nowhere; with the members others read. */
  async function testRead(
    tx: Queryable,
    source: DefinitionSource,
    steps: SourceCheck['steps'],
  ): Promise<SourceCheck> {
    let snapshot: SourceSnapshot
    try {
      snapshot = snapshotSchema.parse(await source.read({ cursor: null }))
    } catch (error) {
      return failed(error instanceof SourceReadError ? error.warnings : [], steps)
    }
    const taken = await tx.query<{ ref: string }>(
      `select ref from definitions where ref = any($1::text[]) and connector_id <> $2 order by ref`,
      [snapshot.definitions.map((definition) => definition.ref), source.id],
    )
    return summary(
      snapshot,
      [...snapshot.warnings, ...taken.map(({ ref }) => ({ code: 'taken' as const, target: ref }))],
      steps,
    )
  }

  return {
    /** The connectors an admin may add a source of: each manifest, with its access and form. */
    types(): ConnectorListing[] {
      return addable().map(({ manifest, writtenTo }) => ({
        writtenTo,
        manifest: structuredClone(manifest),
      }))
    },

    async get(tx: Queryable, id: string): Promise<SourceSettings | null> {
      const row = await workspaceRow(tx, id)
      return row && settingsOf(row, await held(row.secret_ref))
    },

    async add(
      tx: Queryable,
      input: AddSourceInput,
      hooks: TransactionHooks,
    ): Promise<SourceSettings> {
      const connector = typeOf(input.type)
      if (!connector) invalid([{ field: 'type', message: "We can't add a source of this type." }])
      const config = await checkInput(tx, connector!, input, true)
      await tx.query("select pg_advisory_xact_lock(hashtextextended('heed.sources.add', 0))")
      const existing = await tx.query<{ id: string }>('select id from connectors')
      const id = sourceIdFrom(
        input.name.trim(),
        new Set([
          ...reservedSourceIds,
          ...registry.list().map((source) => source.id),
          ...existing.map((row) => row.id),
        ]),
      )
      let ref: string | null = null
      if (Object.keys(input.secrets).length) {
        ref = await secrets.write(input.secrets)
        const written = ref
        hooks.onRollback(() => secrets.remove(written))
      }
      const [row] = await tx.query<Row>(
        `insert into connectors (id, kind, type, name, config, secret_ref, interface_version, origin, revision, changed_at, changed_by)
         values ($1, $2, $3, $4, $5, $6, $7, 'workspace', 1, now(), cl_person())
         returning ${columns}`,
        [
          id,
          connector!.manifest.kind === 'definitions' ? 'definition_source' : 'context_source',
          connector!.manifest.id,
          input.name.trim(),
          JSON.stringify(config),
          ref,
          connector!.writtenTo,
        ],
      )
      await recordAudit(tx, {
        action: 'source.added',
        subjectType: 'source',
        subjectId: id,
        details: {
          type: connector!.manifest.id,
          version: connector!.manifest.version,
          name: input.name.trim(),
          config,
          secrets: Object.fromEntries(Object.keys(input.secrets).map((key) => [key, 'set'])),
          reason: input.reason,
        },
      })
      return settingsOf(row!, input.secrets)
    },

    async update(
      tx: Queryable,
      input: UpdateSourceInput,
      hooks: TransactionHooks,
    ): Promise<SourceSettings> {
      const row = await workspaceRow(tx, input.id, true)
      if (!row)
        throw new ORPCError('NOT_FOUND', {
          message: "We couldn't find this source among the ones an admin added.",
        })
      const connector = typeOf(row.type)
      if (!connector)
        invalid([{ field: 'type', message: "We can't change a source of this type." }])
      const config = await checkInput(tx, connector!, input, false)
      if (row.revision !== input.revision)
        throw new ORPCError('CONFLICT', {
          message:
            'Someone changed this source after you opened it. Look at the latest version, then try again.',
        })
      let ref = row.secret_ref
      const before = await held(row.secret_ref)
      // A stored secret goes only where it was given for: a new address forgets it, so an
      // administrator cannot send a token they never saw to a host of their choosing.
      const rebound = rebinds(connector!, row.config, config)
      let kept = rebound ? {} : before
      const forgotten = rebound
        ? Object.keys(before ?? {}).filter((key) => !(key in input.secrets))
        : []
      if (Object.keys(input.secrets).length || (rebound && row.secret_ref)) {
        kept = { ...kept, ...input.secrets }
        if (Object.keys(kept).length) {
          ref = await secrets.write(kept)
          const written = ref
          hooks.onRollback(() => secrets.remove(written))
        } else ref = null
        // The old secret goes once the change commits: a token replaced or forgotten is removed.
        const old = row.secret_ref
        if (old) hooks.onCommit(() => secrets.remove(old))
      }
      const [saved] = await tx.query<Row>(
        `update connectors set name = $2, config = $3, secret_ref = $4, revision = revision + 1,
           changed_at = now(), changed_by = cl_person()
         where id = $1 returning ${columns}`,
        [row.id, input.name.trim(), JSON.stringify(config), ref],
      )
      await recordAudit(tx, {
        action: 'source.changed',
        subjectType: 'source',
        subjectId: row.id,
        details: {
          from: row.revision,
          to: saved!.revision,
          name: input.name.trim(),
          config,
          secrets: Object.fromEntries([
            ...Object.keys(input.secrets).map((key) => [key, 'replaced']),
            ...forgotten.map((key) => [key, 'removed']),
          ]),
          reason: input.reason,
        },
      })
      return settingsOf(saved!, kept)
    },

    /**
     * Runs the connector's check with the settings of the form, then reads the source once,
     * keeping nothing. With an id, a secret left out of the form is the one in the store.
     */
    async test(tx: Queryable, input: TestSourceInput): Promise<SourceCheck> {
      const connector = typeOf(input.type)
      if (!connector) invalid([{ field: 'type', message: "We can't read a source of this type." }])
      const parsed = connector!.parse(input.config)
      if ('problems' in parsed) invalid(parsed.problems)
      const keys = secretKeys(connector!)
      const unknown = Object.keys(input.secrets).filter((key) => !keys.includes(key))
      if (unknown.length)
        invalid(unknown.map((key) => ({ field: key, message: 'This source has no such secret.' })))
      let stored: Readonly<Record<string, string>> | null = {}
      if (input.id !== undefined) {
        const row = await workspaceRow(tx, input.id)
        if (!row || row.type !== input.type)
          throw new ORPCError('NOT_FOUND', {
            message: "We couldn't find this source among the ones an admin added.",
          })
        // Stored secrets are tried only at the address they were given for.
        stored = rebinds(connector!, row.config, (parsed as { config: SourceConfig }).config)
          ? {}
          : await held(row.secret_ref)
      }
      const given = Object.keys(input.secrets).length > 0
      const settings = {
        id: input.id ?? 'test',
        name: 'Test',
        config: (parsed as { config: SourceConfig }).config,
        secrets: stored === null && !given ? null : { ...stored, ...input.secrets },
      }
      // The connector's own steps first; a read follows only when none of them failed.
      let steps: SourceCheck['steps'] = []
      if (connector!.check)
        try {
          steps = (await connector!.check(settings)).steps
        } catch (error) {
          return failed(error instanceof SourceReadError ? error.warnings : [])
        }
      if (steps.some((step) => step.status === 'failed')) return failed([], steps)
      return testRead(tx, connector!.source(settings), steps)
    },
  }
}
export type WorkspaceSources = ReturnType<typeof createWorkspaceSources>
