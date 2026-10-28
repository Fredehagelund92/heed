import childProcess from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { parseDocument } from 'yaml'
import * as z from 'zod/mini'
import { canonicalJson } from '../../domain/canonical.ts'
import type { RuntimeDefinition } from '../../domain/connector-runtime.ts'
import { libcAnswers } from './libc.ts'

/*
  Cube's compiler, in the worker the core runs for the Cube connector (`ctx.worker`, T1): a child
  process of its own under Node's permission model, with no network, no writes and no programs.
  The runtime hands it the model files it read through `ctx.git` or the server's folder; it parses
  them, compiles them with the pinned compiler and answers with the public members, their marks and
  warnings, or a fixed code that says why it could not. Compiler messages may hold SQL or file
  contents, so none of them crosses: only checked metadata does.
*/

/** The most other names Heed keeps for one member: as many as a term may have (FR-107). */
const SYNONYMS_MAX = 20

const requestSchema = z.object({
  host: z.object({ platform: z.string(), libc: z.optional(z.enum(['gnu', 'musl'])) }),
  input: z.object({
    files: z.array(z.object({ fileName: z.string(), content: z.string() })),
    /** The model's name for a domain, to the Heed domain id it means (CON-206). */
    domainAliases: z.optional(z.record(z.string(), z.string())),
  }),
})

type Warning = {
  code: 'unsupported_file' | 'unreadable_file' | 'invalid_domain' | 'missing_domain'
  target: string
}

/** A read that fails for a reason Sources names: a fixed code, never the compiler's message. */
class ReadProblem extends Error {
  readonly code: 'no_model_files' | 'compile_error' | 'compiler_unavailable'
  constructor(code: ReadProblem['code']) {
    super(code)
    this.code = code
  }
}

const areaPattern = /^[a-z][a-z0-9_]{1,39}$/

function hash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
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
  return names.slice(0, SYNONYMS_MAX)
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
    throw new ReadProblem('compiler_unavailable')
  }
}

async function compile(
  given: { fileName: string; content: string }[],
  aliases: Readonly<Record<string, string>>,
  /** What the read warns about, kept by the caller so a failed read still says it. */
  warnings: Warning[],
) {
  let complete = true
  const files: { fileName: string; content: string }[] = []
  const rawMembers = new Map<string, unknown>()
  /** The file that defines each cube or view, by name, relative to the model folder. */
  const containerFiles = new Map<string, string>()
  /** A `meta.domain` value, with the name the source's settings give it in Heed. */
  const domainOf = (value: unknown): unknown =>
    typeof value === 'string' && Object.hasOwn(aliases, value) ? aliases[value] : value

  for (const { fileName, content } of given) {
    // Templates are code: only plain YAML is passed to the compiler.
    if (/\{\{|\{%|\{#/.test(content)) {
      warnings.push({ code: 'unsupported_file', target: fileName })
      complete = false
      continue
    }
    const document = parseDocument(content, { uniqueKeys: true })
    let model: Record<string, unknown>
    try {
      if (document.errors.length) throw new Error('Not YAML')
      model = record(document.toJS({ maxAliasCount: 20 }) as unknown)
    } catch {
      warnings.push({ code: 'unreadable_file', target: fileName })
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
  if (!files.length) throw new ReadProblem('no_model_files')

  loadNative()
  const { prepareCompiler } = await import('@cubejs-backend/schema-compiler')
  const { compiler, metaTransformer, cubeEvaluator } = prepareCompiler(
    { localPath: () => '/model', dataSchemaFiles: () => Promise.resolve(files) },
    { adapter: 'postgres', allowNodeRequire: false },
  )
  try {
    await compiler.compile()
  } catch {
    throw new ReadProblem('compile_error')
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

  const definitions: RuntimeDefinition[] = []
  for (const { config } of metaTransformer.cubes) {
    if (!config.isVisible) continue
    const viewDomain = domainOf(record(config.meta).domain)
    const viewValid = typeof viewDomain === 'string' && areaPattern.test(viewDomain)
    if (viewDomain === undefined) warnings.push({ code: 'missing_domain', target: config.name })
    else if (!viewValid) warnings.push({ code: 'invalid_domain', target: config.name })
    for (const [kind, members] of [
      ['metric', config.measures],
      ['dimension', config.dimensions],
    ] as const) {
      for (const member of members) {
        if (!member.isVisible) continue
        const memberDomain = domainOf(record(member.meta).domain)
        const memberValid = typeof memberDomain === 'string' && areaPattern.test(memberDomain)
        if (memberDomain !== undefined && !memberValid)
          warnings.push({ code: 'invalid_domain', target: member.name })
        // A member's own valid domain wins over its view's.
        const areaHint = memberValid ? memberDomain : viewValid ? viewDomain : null
        definitions.push({
          ref: `cube:${member.name}`,
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
          domainSource: areaHint === null ? 'none' : 'source',
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
  return {
    ok: true as const,
    version: hash({ files }),
    complete,
    definitions,
    warnings: [
      ...new Map(
        warnings.map((warning) => [`${warning.code}:${warning.target}`, warning]),
      ).values(),
    ],
  }
}

process.once('message', (message: unknown) => {
  void (async () => {
    let answer: unknown
    const warnings: Warning[] = []
    try {
      const { host, input } = requestSchema.parse(message)
      // This process may not start programs: Cube's libc question is answered here instead,
      // before the compiler loads.
      childProcess.spawnSync = libcAnswers(
        host.libc ?? 'gnu',
      ) as unknown as typeof childProcess.spawnSync
      answer = await compile(input.files, input.domainAliases ?? {}, warnings)
    } catch (error) {
      // Compiler exceptions may embed calculations or file contents: only a fixed code says why,
      // with the files it left out on the way.
      answer = {
        ok: false,
        code: error instanceof ReadProblem ? error.code : 'compile_error',
        warnings: warnings.filter(
          (warning) => warning.code === 'unsupported_file' || warning.code === 'unreadable_file',
        ),
      }
    }
    process.send?.(answer, () => process.exit(0))
  })()
})
