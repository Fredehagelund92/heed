import { readFile } from 'node:fs/promises'
import * as z from 'zod'
import { builtInConnectors } from '../../../connectors/index.ts'
import { manifest as cubeManifest } from '../../../connectors/cube/manifest.ts'
import { contentDigest } from '../../../domain/canonical.ts'
import { fromModule } from './platform.ts'
import {
  renameSchema,
  type ConnectorType,
  type Definition,
  type DefinitionSource,
  type Rename,
  type SourceSnapshot,
  type SourceWarning,
} from './types.ts'
import { workerLimits } from './worker.ts'

/*
  The source the server's own configuration selects (docs/connectors/cube.md, "Configuration of
  the server's model"): a Cube model folder on the server (`CUBE_MODEL_DIR`), read by the same
  Cube connector an administrator adds a repository of, which gets the folder as `ctx.folder`.
  What only whoever runs the server can say is applied here, the same for any definitions
  connector: the domains of views the model names none for (`CL_DOMAIN_OVERRIDES`), and the
  members renamed (`CUBE_RENAMES_FILE`, CON-512).
*/

/** The type of the server's model folder: Cube's, with the setting of its page in Sources. */
export const cubeServerType: ConnectorType = {
  type: cubeManifest.id,
  tool: cubeManifest.tool,
  settingKeys: ['sources.cube_model_url'],
}

export interface CubeSourceOptions {
  modelDir: string
  /** JSON object of views to the domain they mean, for views the model names none for. */
  domainOverridesFile?: string
  /** JSON object of renamed members, old id to new id (CON-512). */
  renamesFile?: string
  /** The compiler's limits, when the server sets them. */
  timeoutMs?: number
  memoryMb?: number
}

const areaPattern = /^[a-z][a-z0-9_]{1,39}$/

/** A member's view: its name up to the last dot (`sales` of `sales.revenue`). */
const viewOf = (name: string) => name.slice(0, Math.max(name.lastIndexOf('.'), 0))

const jsonObject = async (file: string) =>
  z.record(z.string(), z.unknown()).parse(JSON.parse(await readFile(file, 'utf8')) as unknown)

/**
 * The server's domains for views the model names none for, applied to a read. They fill gaps
 * only: a domain the tool gives always wins. A member that takes one says so (`domain_override`),
 * a view it maps no longer misses a domain, and a value that is not a domain id is reported once
 * per view. An empty value is a line still to fill: the view only has no domain.
 */
export function withOverrides(
  snapshot: SourceSnapshot,
  overrides: Readonly<Record<string, unknown>>,
): SourceSnapshot {
  const warnings: SourceWarning[] = []
  const mapped = (view: string) => {
    const value = Object.hasOwn(overrides, view) ? overrides[view] : undefined
    return typeof value === 'string' && areaPattern.test(value) ? value : null
  }
  const definitions = snapshot.definitions.map((definition): Definition => {
    if (definition.areaHint !== null) return definition
    const view = viewOf(definition.name)
    const override = Object.hasOwn(overrides, view) ? overrides[view] : undefined
    if (override === undefined || override === '') return definition
    const domain = mapped(view)
    if (domain === null) {
      warnings.push({ code: 'invalid_domain', target: `override:${view}` })
      return definition
    }
    warnings.push({ code: 'domain_override', target: definition.ref })
    return { ...definition, areaHint: domain, domainSource: 'override' }
  })
  return {
    ...snapshot,
    definitions,
    warnings: [
      ...new Map(
        [
          ...snapshot.warnings.filter(
            (warning) => warning.code !== 'missing_domain' || mapped(warning.target) === null,
          ),
          ...warnings,
        ].map((warning) => [`${warning.code}:${warning.target}`, warning]),
      ).values(),
    ],
  }
}

/**
 * The server's renamed members, for a read: each from a member that is gone to one that is
 * there. Any other entry is reported (`invalid_rename`).
 */
export function renamesOf(
  definitions: readonly Definition[],
  entries: Readonly<Record<string, unknown>>,
): { renames: Rename[]; warnings: SourceWarning[] } {
  const known = new Set(definitions.map((definition) => definition.ref))
  const renames: Rename[] = []
  const warnings: SourceWarning[] = []
  for (const [from, to] of Object.entries(entries)) {
    const rename = renameSchema.safeParse({ from, to })
    if (rename.success && !known.has(rename.data.from) && known.has(rename.data.to))
      renames.push(rename.data)
    else warnings.push({ code: 'invalid_rename', target: from })
  }
  return { renames, warnings }
}

/**
 * The server's Cube model folder (`CUBE_MODEL_DIR`), with its domains and renames, read by the
 * Cube connector. Its settings are shown read only in Sources, with "Set on the server".
 */
export function createCubeSource(options: CubeSourceOptions): DefinitionSource {
  const module = builtInConnectors.find((candidate) => candidate.manifest.id === cubeManifest.id)!
  const limits = workerLimits({
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.memoryMb === undefined ? {} : { memoryMb: options.memoryMb }),
  })
  const source = fromModule(module, limits).source({
    id: 'cube',
    name: 'Cube local model',
    config: {},
    secrets: {},
    folder: options.modelDir,
  })
  return {
    ...source,
    serverSettings: [
      { key: 'model_folder', variable: 'CUBE_MODEL_DIR', value: options.modelDir },
      {
        key: 'domain_overrides',
        variable: 'CL_DOMAIN_OVERRIDES',
        value: options.domainOverridesFile ?? null,
      },
      { key: 'renames', variable: 'CUBE_RENAMES_FILE', value: options.renamesFile ?? null },
    ],
    async read(context) {
      // The files are read at each read, so a change to them applies from the next one.
      const overrides = options.domainOverridesFile
        ? await jsonObject(options.domainOverridesFile)
        : {}
      const entries = options.renamesFile ? await jsonObject(options.renamesFile) : {}
      const read = withOverrides(await source.read(context), overrides)
      const { renames, warnings } = renamesOf(read.definitions, entries)
      return {
        ...read,
        sourceVersion:
          options.domainOverridesFile || options.renamesFile
            ? await contentDigest({ version: read.sourceVersion, overrides, renames })
            : read.sourceVersion,
        warnings: [...read.warnings, ...warnings],
        renames,
      }
    },
  }
}
