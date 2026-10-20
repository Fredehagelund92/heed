import childProcess from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import * as z from 'zod'
import { canonicalJson } from '../../../domain/canonical.ts'
import { libcAnswers } from './libc.ts'
import {
  DEFINITION_SYNONYMS_MAX,
  renameSchema,
  type Definition,
  type Rename,
  type SourceSnapshot,
  type SourceWarning,
} from './types.ts'

const options = z
  .object({
    modelDir: z.string().min(1),
    domainOverridesFile: z.string().optional(),
    renamesFile: z.string().optional(),
    // The model's name for a domain, to the Heed domain id it means (CON-206).
    domainAliases: z.record(z.string(), z.string()).optional(),
    // This machine's C library, which Cube asks for at import on Linux.
    libc: z.enum(['gnu', 'musl']).optional(),
  })
  .parse(JSON.parse(process.argv[2] ?? 'null') as unknown)
// This process may not start programs: Cube's libc question is answered here instead, before the
// compiler loads.
childProcess.spawnSync = libcAnswers(options.libc ?? 'gnu') as typeof childProcess.spawnSync
const aliases = options.domainAliases ?? {}
/** A `meta.domain` value, with the name configuration gives it in Heed. */
function domainOf(value: unknown): unknown {
  return typeof value === 'string' && Object.hasOwn(aliases, value) ? aliases[value] : value
}
const areaPattern = /^[a-z][a-z0-9_]{1,39}$/
const warnings: SourceWarning[] = []
let complete = true
const files: { fileName: string; content: string }[] = []
let totalBytes = 0
let entriesSeen = 0
const rawMembers = new Map<string, unknown>()
/** The file that defines each cube or view, by name, relative to the model folder. */
const containerFiles = new Map<string, string>()

function hash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}
/**
 * The other names in a member's `meta.synonyms`, trimmed, each once whatever its case, at most as
 * many as a term may have. Anything else there (a number, an empty or overlong name) is left out.
 */
function synonymsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const names: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const name = entry.trim().replace(/\s+/g, ' ')
    if (!name || Array.from(name).length > 200 || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    names.push(name)
  }
  return names.slice(0, DEFINITION_SYNONYMS_MAX)
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
function warn(code: SourceWarning['code'], target: string) {
  warnings.push({ code, target })
}

/** A read that fails for a reason Sources names: a fixed code, never the compiler's message. */
class ReadProblem extends Error {
  readonly warning: SourceWarning
  constructor(warning: SourceWarning) {
    super(warning.code)
    this.warning = warning
  }
}

async function readFolder(relative = ''): Promise<void> {
  const entries = await readdir(join(options.modelDir, relative), { withFileTypes: true }).catch(
    (error: unknown) => {
      // The model folder itself is not there: it holds no model files.
      if (!relative) throw new ReadProblem({ code: 'no_model_files', target: 'model' })
      throw error
    },
  )
  entries.sort((a, b) => (a.name < b.name ? -1 : 1))
  for (const entry of entries) {
    if (++entriesSeen > 1000) throw new Error('Model has too many files')
    const fileName = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      await readFolder(fileName)
      continue
    }
    if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) {
      warn('unsupported_file', fileName)
      complete = false
      continue
    }
    let content: string
    try {
      const path = join(options.modelDir, fileName)
      const info = await stat(path)
      totalBytes += info.size
      if (info.size > 2_000_000 || totalBytes > 20_000_000) throw new Error('Model is too large')
      content = await readFile(path, 'utf8')
    } catch {
      warn('unreadable_file', fileName)
      complete = false
      continue
    }
    if (/\{\{|\{%|\{#/.test(content)) {
      warn('unsupported_file', fileName)
      complete = false
      continue
    }
    const document = parseDocument(content, { uniqueKeys: true })
    if (document.errors.length) {
      warn('unreadable_file', fileName)
      complete = false
      continue
    }
    let model: Record<string, unknown>
    try {
      const value: unknown = document.toJS({ maxAliasCount: 20 })
      model = record(value)
    } catch {
      warn('unreadable_file', fileName)
      complete = false
      continue
    }
    for (const kind of ['cubes', 'views']) {
      const containers = model[kind]
      if (!Array.isArray(containers)) continue
      for (const value of containers as unknown[]) {
        const container = record(value)
        if (typeof container.name !== 'string') continue
        containerFiles.set(container.name, fileName)
        for (const memberKind of ['measures', 'dimensions']) {
          const members = container[memberKind]
          if (!Array.isArray(members)) continue
          for (const value of members as unknown[]) {
            const member = record(value)
            if (typeof member.name === 'string')
              rawMembers.set(`${container.name}.${member.name}`, member)
          }
        }
      }
    }
    files.push({ fileName, content })
  }
}

// Functions here are compiler-generated expressions. Hash their text; never call a SQL expression.
function semanticValue(value: unknown): unknown {
  if (typeof value === 'function') return Function.prototype.toString.call(value)
  if (value === undefined) return null
  if (Array.isArray(value)) return value.map(semanticValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, semanticValue(entry)]),
    )
  }
  return value
}

/**
 * Cube's compiler needs its native part, which `npm ci` downloads and may skip without failing
 * (its postinstall swallows the error). Loaded first, so a missing one is named, not guessed.
 */
function loadNative(): void {
  try {
    const native = createRequire(import.meta.url)('@cubejs-backend/native') as {
      loadNative(): unknown
    }
    native.loadNative()
  } catch {
    throw new ReadProblem({ code: 'compiler_unavailable', target: '@cubejs-backend/native' })
  }
}

async function compile(): Promise<SourceSnapshot> {
  loadNative()
  const { prepareCompiler } = await import('@cubejs-backend/schema-compiler')
  await readFolder()
  if (!files.length) throw new ReadProblem({ code: 'no_model_files', target: 'model' })
  let overrides: Record<string, unknown> = {}
  if (options.domainOverridesFile) {
    const value: unknown = JSON.parse(await readFile(options.domainOverridesFile, 'utf8'))
    overrides = z.record(z.string(), z.unknown()).parse(value)
  }
  const { compiler, metaTransformer, cubeEvaluator } = prepareCompiler(
    {
      localPath: () => options.modelDir,
      dataSchemaFiles: () => Promise.resolve(files),
    },
    { adapter: 'postgres', allowNodeRequire: false },
  )
  try {
    await compiler.compile()
  } catch {
    throw new ReadProblem({ code: 'compile_error', target: 'model' })
  }

  function memberMeaning(name: string, seen = new Set<string>()): unknown {
    if (seen.has(name)) return name
    seen.add(name)
    const [cubeName, memberName] = name.split('.')
    const cube = cubeEvaluator.evaluatedCubes[cubeName!]
    const member = cube?.measures[memberName!] ?? cube?.dimensions[memberName!]
    if (!member) throw new Error('Unresolved compiled member')
    const alias: unknown = record(member).aliasMember
    return {
      raw: rawMembers.get(name) ?? null,
      compiled: semanticValue(member),
      source: typeof alias === 'string' ? memberMeaning(alias, seen) : null,
      relation: semanticValue(cube?.sql ?? cube?.sqlTable),
    }
  }

  /**
   * A view member's own name when the view joins it with a prefix: Cube names `store.store_name`
   * joined with `prefix: true` `traffic.store_store_name`, and its own name is `store_name`. Null
   * when the name after the view is already its own, or the view renamed it otherwise.
   */
  function baseNameOf(name: string): string | null {
    const [view, own] = name.split('.')
    const cube = cubeEvaluator.evaluatedCubes[view!]
    const alias: unknown = record(cube?.measures[own!] ?? cube?.dimensions[own!]).aliasMember
    if (typeof alias !== 'string') return null
    const [from, base] = alias.split('.')
    if (!from || !base || own === base) return null
    const prefix = `${from}_`
    return own!.startsWith(prefix) && own!.length > prefix.length ? own!.slice(prefix.length) : null
  }

  const definitions: Definition[] = []
  for (const { config } of metaTransformer.cubes) {
    if (!config.isVisible) continue
    const viewDomain = domainOf(record(config.meta).domain)
    // A view the server's domain names map has a domain: the override says so, as information.
    const override = Object.hasOwn(overrides, config.name) ? overrides[config.name] : undefined
    const mapped = typeof override === 'string' && areaPattern.test(override) ? override : null
    if (viewDomain === undefined) {
      if (mapped === null) warn('missing_domain', config.name)
    } else if (typeof viewDomain !== 'string' || !areaPattern.test(viewDomain)) {
      warn('invalid_domain', config.name)
    }
    for (const [kind, members] of [
      ['metric', config.measures],
      ['dimension', config.dimensions],
    ] as const) {
      for (const member of members) {
        if (!member.isVisible) continue
        const ref = `cube:${member.name}`
        const memberDomain = domainOf(record(member.meta).domain)
        const memberValid = typeof memberDomain === 'string' && areaPattern.test(memberDomain)
        const viewValid = typeof viewDomain === 'string' && areaPattern.test(viewDomain)
        if (memberDomain !== undefined && !memberValid) warn('invalid_domain', member.name)
        let areaHint: string | null = null
        let domainSource: Definition['domainSource'] = 'none'
        if (memberValid) areaHint = memberDomain
        else if (viewValid) areaHint = viewDomain
        if (areaHint !== null) domainSource = 'cube'
        // Local configuration fills gaps until Cube owns the domain. Cube always wins. An empty
        // value is a line still to fill (the pilot writes them), so the view only has no domain.
        if (areaHint === null && override !== undefined && override !== '') {
          if (mapped !== null) {
            areaHint = mapped
            domainSource = 'override'
            warn('domain_override', ref)
          } else warn('invalid_domain', `override:${config.name}`)
        }
        definitions.push({
          ref,
          kind,
          synonyms: synonymsOf(record(member.meta).synonyms),
          baseName: baseNameOf(member.name),
          name: member.name,
          title: member.title ?? null,
          descriptionCopy: member.description
            ? Array.from(member.description).slice(0, 500).join('')
            : null,
          valueType: member.type ?? null,
          visibleGroups: null,
          areaHint,
          domainSource,
          modelFile: containerFiles.get(config.name) ?? null,
          // Type, calculation, description and visibility (CON-505). The domain stays out: a
          // changed domain informs the owner and never flags an item (plan 4.3, step 7).
          changeMark: hash({
            member: memberMeaning(member.name),
            type: member.type,
            description: member.description ?? null,
            public: member.isVisible,
          }),
        })
      }
    }
  }
  definitions.sort((a, b) => (a.ref < b.ref ? -1 : 1))
  const renames: Rename[] = []
  if (options.renamesFile) {
    const value: unknown = JSON.parse(await readFile(options.renamesFile, 'utf8'))
    const known = new Set(definitions.map((definition) => definition.ref))
    for (const [from, to] of Object.entries(z.record(z.string(), z.unknown()).parse(value))) {
      const rename = renameSchema.safeParse({ from, to })
      // A rename names a member that left the model and one that is in it now.
      if (rename.success && !known.has(rename.data.from) && known.has(rename.data.to))
        renames.push(rename.data)
      else warn('invalid_rename', from)
    }
  }
  return {
    sourceVersion: hash({ files, overrides, renames }),
    complete,
    definitions,
    warnings: [
      ...new Map(
        warnings.map((warning) => [`${warning.code}:${warning.target}`, warning]),
      ).values(),
    ],
    renames,
  }
}

try {
  process.send?.(await compile())
} catch (error) {
  // Compiler exceptions may embed calculations or file contents, which must not enter snapshots:
  // only a fixed code says why.
  if (error instanceof ReadProblem) warnings.unshift(error.warning)
  process.send?.({ error: 'Cube model could not be compiled', warnings })
}
