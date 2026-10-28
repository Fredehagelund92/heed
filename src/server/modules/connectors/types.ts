import * as z from 'zod'
import type { SettingKey } from '../../../contract/admin.ts'
import { sourceWarningCodes, type SourceServerSettingKey } from '../../../contract/operations.ts'
import type { SourceErrorClass } from '../../../domain/connector-runtime.ts'

/**
 * The interface of the definitions pipeline's snapshot (docs/connectors.md, "Interface 2"): the
 * demo source is written to it, and an interface 3 runtime's read is gathered into it.
 */
export const INTERFACE_VERSION = 2

/** The interfaces a source this build reads may be written to (CON-109). */
export type SourceInterfaceVersion = 2 | 3

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
 * What a type of source the server's own configuration selects says about itself: its tool, for
 * the words on screen, and the administrator settings that belong to it. Core code names no
 * vendor (CON-101): the words on screen come from here or from a connector's manifest.
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
}

export type { FieldProblem } from '../../../domain/connector-config.ts'

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
  /** The interface its connector was written to: 3, or 2 for the demo. */
  readonly interfaceVersion: SourceInterfaceVersion
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
  /**
   * Why, for the schedule (CON-115): `transient` clears by itself and is tried again sooner, with
   * backoff; anything else waits for the next read, or for an administrator.
   */
  readonly errorClass: SourceErrorClass
  /** Seconds the tool asked to wait before it is read again. */
  readonly retryAfter: number | undefined
  constructor(
    warnings: SourceWarning[],
    failure: { class?: SourceErrorClass; retryAfter?: number } = {},
  ) {
    super('Source could not be read')
    this.warnings = warnings
    this.errorClass = failure.class ?? 'config'
    this.retryAfter = failure.retryAfter
  }
}
