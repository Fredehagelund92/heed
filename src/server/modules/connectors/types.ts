import * as z from 'zod'
import type { SettingKey } from '../../../contract/admin.ts'
import { sourceWarningCodes, type SourceServerSettingKey } from '../../../contract/operations.ts'
import type { Interface2Declaration } from '../../../domain/connector-manifest.ts'
import type { SourceConfig } from '../../../contract/sources.ts'

/** The connector interface this build speaks (CON-109): docs/connectors.md, contract v2. */
export const INTERFACE_VERSION = 2

/** The most other names Heed keeps for one member: as many as a term may have (FR-107). */
export const DEFINITION_SYNONYMS_MAX = 20

export const definitionSchema = z.object({
  ref: z.string().regex(/^[a-z][a-z0-9_]*:[A-Za-z0-9_.:/-]+$/),
  kind: z.enum(['metric', 'dimension']),
  name: z.string().min(1),
  title: z.string().nullable(),
  descriptionCopy: z
    .string()
    .refine((value) => Array.from(value).length <= 500)
    .nullable(),
  valueType: z.string().nullable(),
  visibleGroups: z.null(),
  areaHint: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,39}$/)
    .nullable(),
  domainSource: z.enum(['cube', 'override', 'none']),
  /**
   * The model file that defines the member's public view or cube, relative to the model folder
   * (`payments.yml`); null when the source has no files. Not part of the change mark: moving a
   * member to another file changes nothing it means.
   */
  modelFile: z.string().min(1).max(500).nullable(),
  /**
   * The other names the model's authors give the member (Cube's `meta.synonyms`), each once.
   * Absent from a connector that reads none.
   */
  synonyms: z.array(z.string().min(1).max(200)).max(DEFINITION_SYNONYMS_MAX).optional(),
  /**
   * The member's own name when a view joins it with a prefix (`store_name` of
   * `traffic.store_store_name`); null or absent when the name after the view is its own.
   */
  baseName: z.string().min(1).max(500).nullable().optional(),
  changeMark: z.string().regex(/^[a-f0-9]{64}$/),
})
export type Definition = z.infer<typeof definitionSchema>
export const warningSchema = z.object({
  /** One of the core's codes, or an interface 3 connector's own as `<connector>.<code>`. */
  code: z.union([
    z.enum(sourceWarningCodes),
    z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?\.[a-z][a-z0-9_]{0,39}$/),
  ]),
  target: z.string(),
})
export type SourceWarning = z.infer<typeof warningSchema>
const refSchema = definitionSchema.shape.ref
/** A member the source renamed, from configuration (CON-512): flags and links name the new id. */
export const renameSchema = z.object({ from: refSchema, to: refSchema })
export type Rename = z.infer<typeof renameSchema>
export const snapshotSchema = z.object({
  sourceVersion: z.string().min(1),
  complete: z.boolean(),
  definitions: z.array(definitionSchema),
  warnings: z.array(warningSchema),
  renames: z.array(renameSchema).optional(),
  /** Where the next read may start (a commit, a change token); the core stores it. */
  cursor: z.string().min(1).max(500).optional(),
})
export type SourceSnapshot = z.infer<typeof snapshotSchema>

/**
 * What a type of connector says about itself, the same for every source of the type (the
 * connector contract, docs/connectors.md). Core code names no vendor (CON-101): the words on
 * screen come from here.
 */
export interface ConnectorType {
  readonly type: string
  /** The tool it reads, as people say it, for the words on screen: "Changed in Cube". */
  readonly tool: string
  /**
   * The administrator settings (FR-809) that belong to the source the server's configuration
   * selects, shown on its page in Sources.
   */
  readonly settingKeys: readonly SettingKey[]
  /** How an administrator adds a source of the type in Sources; absent when they cannot. */
  readonly workspace?: WorkspaceConnector
}

export type { FieldProblem } from '../../../domain/connector-config.ts'
import type { FieldProblem } from '../../../domain/connector-config.ts'

/** One field of an interface 2 type's form: text, an address, a secret or domain names. */
export type SourceField = Interface2Declaration['fields'][number]

/**
 * What a type declares so an administrator can add a source of it: what it reads and the least
 * access it needs (CON-106), the fields of its form, how it checks the settings, and how it makes
 * the source from them. Secrets are fields of kind `secret`: the core keeps them in the secret
 * store and hands them to `create` only (CON-105).
 */
export interface WorkspaceConnector {
  readonly kind: 'definition_source'
  readonly title: string
  readonly description: string
  readonly access: readonly string[]
  readonly fields: readonly SourceField[]
  /**
   * The settings a source's secrets are bound to: where they are sent. When one changes, the
   * stored secrets are not sent there; only secrets given again with the change are.
   */
  readonly secretsBoundTo: readonly string[]
  /** The settings as stored, or what is wrong with them. Never sees a secret. */
  parse(config: SourceConfig): { config: SourceConfig } | { problems: FieldProblem[] }
  /** The domains the settings name, which must be Heed domains. */
  domains(config: SourceConfig): readonly string[]
  /**
   * The source for stored settings. `secrets` is null when the store does not hold the source's
   * secrets any more; its reads then fail with `secret_missing`.
   */
  create(source: {
    id: string
    name: string
    config: SourceConfig
    secrets: Readonly<Record<string, string>> | null
  }): DefinitionSource
}

/** A part of the server's configuration a source reads: set by whoever runs the server. */
export interface ServerSetting {
  readonly key: SourceServerSettingKey
  /** The environment variable that sets it. */
  readonly variable: string
  /** A path on the server, or null when it is not set. Never a secret. */
  readonly value: string | null
}

/** What the core hands a read: the cursor the newest good read returned, or null. */
export interface ReadContext {
  readonly cursor: string | null
}

export interface DefinitionSource {
  readonly id: string
  readonly type: string
  readonly name: string
  readonly interfaceVersion: typeof INTERFACE_VERSION
  /** The server's configuration it reads, shown read only in Sources. */
  readonly serverSettings: readonly ServerSetting[]
  /**
   * One read: a snapshot, or a `SourceReadError` with warnings when the source cannot be read at
   * all. It changes nothing anywhere (CON-102), so the core also tests settings with it.
   */
  read(context?: ReadContext): Promise<SourceSnapshot>
}

export function domainCoverage(definitions: readonly Definition[]) {
  const coverage = { cube: 0, override: 0, none: 0 }
  for (const definition of definitions) {
    if (definition.kind === 'metric') coverage[definition.domainSource]++
  }
  return coverage
}

export const sourceFailureSchema = z.object({
  error: z.literal('Cube model could not be compiled'),
  warnings: z.array(warningSchema),
})
export class SourceReadError extends Error {
  readonly warnings: SourceWarning[]
  constructor(warnings: SourceWarning[]) {
    super('Definition source could not be read')
    this.warnings = warnings
  }
}
