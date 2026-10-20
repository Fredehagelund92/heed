import { fork } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SourceConfig } from '../../../contract/sources.ts'
import {
  canonicalAddress,
  folderParts,
  GitFetchError,
  isFetchableAddress,
  isSafeRef,
  withGitCheckout,
} from './git.ts'
import { hostLibc } from './libc.ts'
import {
  INTERFACE_VERSION,
  snapshotSchema,
  sourceFailureSchema,
  SourceReadError,
  type ConnectorType,
  type DefinitionSource,
  type FieldProblem,
  type SourceField,
  type SourceSnapshot,
} from './types.ts'
import { productName } from '../../brand.ts'

const areaPattern = /^[a-z][a-z0-9_]{1,39}$/

/** The form of a Cube model in a Git repository, as Sources shows it (CON-502). */
const gitFields: SourceField[] = [
  {
    key: 'repository',
    kind: 'address',
    label: 'Repository',
    description: 'The https address of the Git repository that holds the model.',
    required: true,
    placeholder: 'https://git.example.com/analytics/semantic-layer.git',
    initial: null,
  },
  {
    key: 'ref',
    kind: 'text',
    label: 'Branch, tag or commit',
    description:
      'We read the model as it is there. A tag or a commit stays the same, and a branch moves with each change.',
    required: true,
    placeholder: null,
    initial: 'main',
  },
  {
    key: 'folder',
    kind: 'text',
    label: 'Model folder',
    description:
      'The folder of model files in the repository, such as model or cube/model. Leave it empty when they are at the top.',
    required: false,
    placeholder: null,
    initial: null,
  },
  {
    key: 'token',
    kind: 'secret',
    label: 'Read-only token',
    description:
      'A token that can read this repository and nothing else. We keep it in a secret store and never show it again. Leave it empty for a public repository.',
    required: false,
    placeholder: null,
    initial: null,
  },
  {
    key: 'username',
    kind: 'text',
    label: 'User name for the token',
    description:
      'Some Git hosts ask for a user name with the token, and most accept any. If you leave it empty, we send x-access-token.',
    required: false,
    placeholder: null,
    initial: null,
  },
  {
    key: 'modelUrl',
    kind: 'address',
    label: 'Model folder address',
    description:
      'The model folder in the Git host’s web view, so each view links to its file. We never open it.',
    required: false,
    placeholder: 'https://git.example.com/analytics/semantic-layer/tree/main/model',
    initial: null,
  },
  {
    key: 'domainNames',
    kind: 'domain_names',
    label: 'Domain names',
    description: `When the model’s meta.domain names a domain differently, choose the ${productName} domain it means. A name that is already a ${productName} domain id needs no line.`,
    required: false,
    placeholder: null,
    initial: null,
  },
]

const text = (config: SourceConfig, key: string): string => {
  const value = config[key]
  return typeof value === 'string' ? value.trim() : ''
}

/** The domain names as stored: the model's name to the domain it means. */
const nameMap = (config: SourceConfig): Record<string, string> => {
  const names = config.domainNames
  return typeof names === 'object' && !Array.isArray(names) ? names : {}
}

/** A Cube model in Git, as stored: the settings with empty ones left out. */
function parseGitConfig(
  config: SourceConfig,
): { config: SourceConfig } | { problems: FieldProblem[] } {
  const problems: FieldProblem[] = []
  const known = new Set(
    gitFields.filter((field) => field.kind !== 'secret').map((field) => field.key),
  )
  for (const key of Object.keys(config))
    if (!known.has(key)) problems.push({ field: key, message: 'This source has no such setting.' })
  // Kept in the form git is given, so what was checked is what is fetched.
  const repository = canonicalAddress(text(config, 'repository')) ?? text(config, 'repository')
  if (!repository) problems.push({ field: 'repository', message: 'Give the repository’s address.' })
  else if (!isFetchableAddress(repository))
    problems.push({
      field: 'repository',
      message:
        'Use an https address on a public host, without a user name, password, query or fragment. The token goes in its own field.',
    })
  const ref = text(config, 'ref')
  if (!ref) problems.push({ field: 'ref', message: 'Name a branch, a tag or a commit.' })
  else if (!isSafeRef(ref))
    problems.push({
      field: 'ref',
      message: 'Use letters, digits, dots, dashes, underscores and slashes, as Git names a branch.',
    })
  const folder = text(config, 'folder').replace(/^\/+|\/+$/g, '')
  if (folderParts(folder) === null)
    problems.push({
      field: 'folder',
      message: 'Name a folder inside the repository, such as model or cube/model.',
    })
  const username = text(config, 'username')
  if (username && !/^[A-Za-z0-9._@+-]{1,100}$/.test(username))
    problems.push({
      field: 'username',
      message: 'Use letters, digits and . _ @ + - only.',
    })
  const modelUrl = text(config, 'modelUrl')
  if (modelUrl) {
    const url = URL.parse(modelUrl)
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      problems.push({
        field: 'modelUrl',
        message: 'Use an https address without a user name, password, query or fragment.',
      })
  }
  const names = config.domainNames ?? {}
  const domainNames = new Map<string, string>()
  if (typeof names !== 'object' || Array.isArray(names))
    problems.push({ field: 'domainNames', message: 'Write a list of names.' })
  else {
    if (Object.keys(names).length > 200)
      problems.push({ field: 'domainNames', message: 'Give at most 200 domain names.' })
    for (const [from, to] of Object.entries(names)) {
      const name = from.trim()
      if (!name)
        problems.push({ field: 'domainNames', message: 'Each line needs the model’s name.' })
      else if (!areaPattern.test(to))
        problems.push({
          field: 'domainNames',
          message: `Choose the ${productName} domain for ${name}.`,
        })
      else domainNames.set(name, to)
    }
  }
  if (problems.length) return { problems }
  return {
    config: {
      repository,
      ref,
      ...(folder ? { folder } : {}),
      ...(username ? { username } : {}),
      ...(modelUrl ? { modelUrl } : {}),
      ...(domainNames.size ? { domainNames: Object.fromEntries(domainNames) } : {}),
    },
  }
}

/**
 * Cube model files, read offline: from the server's model folder (set where the server runs), or
 * from a Git repository an administrator adds in Sources. The model folder's web address is an
 * administrator setting of the server's source.
 */
export const cubeConnectorType: ConnectorType = {
  type: 'cube',
  tool: 'Cube',
  settingKeys: ['sources.cube_model_url'],
  workspace: {
    kind: 'definition_source',
    title: 'Cube model in a Git repository',
    description:
      'Reads the YAML model files of a Cube project from a Git repository every hour, at the branch, tag or commit you name. We keep names, short descriptions and change marks, never a calculation or data.',
    access: [
      'Read access to this one repository. We never write to it.',
      'We read only the model files, never a Cube server, a warehouse or data.',
    ],
    fields: gitFields,
    // The token goes to the repository's host only.
    secretsBoundTo: ['repository'],
    parse: parseGitConfig,
    domains: (config) => Object.values(nameMap(config)),
    create: ({ id, name, config, secrets }) =>
      createCubeGitSource({
        id,
        name,
        repository: text(config, 'repository'),
        ref: text(config, 'ref'),
        folder: text(config, 'folder'),
        username: text(config, 'username') || undefined,
        domainAliases: nameMap(config),
        token: secrets ? (secrets.token ?? null) : undefined,
      }),
  },
}

/**
 * How long Cube's compiler may take on a model, and how much memory it may use, unless the server
 * sets them (CUBE_COMPILE_TIMEOUT_SECONDS, CUBE_COMPILE_MEMORY_MB). A model of 10,000 members
 * compiles in about 45 seconds, and a busy computer takes longer, so the defaults leave room.
 */
export const CUBE_COMPILE_TIMEOUT_MS = 120_000
export const CUBE_COMPILE_MEMORY_MB = 1024

export interface CubeSourceOptions {
  modelDir: string
  domainOverridesFile?: string
  /** JSON object of renamed members, old id to new id (CON-512). */
  renamesFile?: string
  timeoutMs?: number
  memoryMb?: number
}

export interface CompileOptions {
  modelDir: string
  domainOverridesFile?: string
  renamesFile?: string
  /** The model's name for a domain, to the Heed domain id it means (CON-206). */
  domainAliases?: Readonly<Record<string, string>>
  timeoutMs: number
  memoryMb: number
}

function checkLimits(timeoutMs: number, memoryMb: number) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('Invalid compile timeout')
  if (!Number.isSafeInteger(memoryMb) || memoryMb < 16)
    throw new Error('Invalid compiler memory limit')
}

/**
 * What the compiler process may read, and nothing else: the service's source and its
 * dependencies, the project's package file, the model folder and the files the server names.
 * Never the repository's other files (its
 * local keys and settings), the secret store or a home folder: a model from a repository whose
 * writers are not Heed's administrators must not reach a secret, even through a compiler flaw.
 */
export function readablePaths(options: CompileOptions): string[] {
  const source = fileURLToPath(new URL('../../../', import.meta.url))
  const compiler = createRequire(import.meta.url).resolve('@cubejs-backend/schema-compiler')
  const modules = compiler.slice(0, compiler.lastIndexOf(`${sep}node_modules${sep}`) + 14)
  const project = fileURLToPath(new URL('../../../../package.json', import.meta.url))
  return [
    source,
    modules,
    project,
    options.modelDir,
    ...(options.domainOverridesFile ? [options.domainOverridesFile] : []),
    ...(options.renamesFile ? [options.renamesFile] : []),
  ].map((path) => (path.endsWith(sep) ? path.slice(0, -1) : path) || dirname(path))
}

/** Compiles a folder of model files in a child process and returns its validated snapshot. */
function compileCubeModel(options: CompileOptions): Promise<SourceSnapshot> {
  return new Promise<SourceSnapshot>((resolve, reject) => {
    // Cube 1.7.39's native logger aborts on a second worker_threads load in one process.
    // A process worker also contains native crashes and lets us deny network and writes.
    const worker = fork(
      new URL('./cube-worker.ts', import.meta.url),
      [
        JSON.stringify({
          modelDir: options.modelDir,
          domainOverridesFile: options.domainOverridesFile,
          renamesFile: options.renamesFile,
          domainAliases: options.domainAliases,
          ...(process.platform === 'linux' ? { libc: hostLibc() } : {}),
        }),
      ],
      {
        execArgv: [
          `--max-old-space-size=${options.memoryMb}`,
          '--permission',
          ...readablePaths(options).map((path) => `--allow-fs-read=${path}`),
          // Cube's native build; the operating system loads it, outside Node's file checks.
          '--allow-addons',
          // The compiler's own transpiler threads. No child processes: Cube's libc question is
          // answered in the process (libc.ts), and writes and network stay denied.
          '--allow-worker',
        ],
        silent: true,
        env: { PATH: process.env.PATH, NODE_ENV: 'production' },
      },
    )
    // Compiler diagnostics may contain SQL. Only validated metadata crosses this boundary.
    worker.stdout?.resume()
    worker.stderr?.resume()
    let settled = false
    const finish = (result?: SourceSnapshot, error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const done = () => {
        if (result) resolve(result)
        else reject(error ?? new Error('Cube model could not be compiled'))
      }
      if (worker.pid === undefined || worker.exitCode !== null || worker.signalCode !== null) done()
      else {
        worker.once('exit', done)
        worker.kill('SIGKILL')
      }
    }
    const timer = setTimeout(
      () => finish(undefined, new SourceReadError([{ code: 'compile_timeout', target: 'model' }])),
      options.timeoutMs,
    )
    worker.once('message', (message: unknown) => {
      const result = snapshotSchema.safeParse(message)
      const failure = sourceFailureSchema.safeParse(message)
      finish(
        result.success ? result.data : undefined,
        failure.success ? new SourceReadError(failure.data.warnings) : undefined,
      )
    })
    worker.once('error', () => finish())
    worker.once('exit', () => finish())
  })
}

/** The server's Cube model folder (`CUBE_MODEL_DIR`), with its overrides and renames. */
export function createCubeSource(options: CubeSourceOptions): DefinitionSource {
  const timeoutMs = options.timeoutMs ?? CUBE_COMPILE_TIMEOUT_MS
  const memoryMb = options.memoryMb ?? CUBE_COMPILE_MEMORY_MB
  checkLimits(timeoutMs, memoryMb)
  return {
    id: 'cube',
    type: 'cube',
    name: 'Cube local model',
    interfaceVersion: INTERFACE_VERSION,
    serverSettings: [
      { key: 'model_folder', variable: 'CUBE_MODEL_DIR', value: options.modelDir },
      {
        key: 'domain_overrides',
        variable: 'CL_DOMAIN_OVERRIDES',
        value: options.domainOverridesFile ?? null,
      },
      { key: 'renames', variable: 'CUBE_RENAMES_FILE', value: options.renamesFile ?? null },
    ],
    read: () =>
      compileCubeModel({
        modelDir: options.modelDir,
        domainOverridesFile: options.domainOverridesFile,
        renamesFile: options.renamesFile,
        timeoutMs,
        memoryMb,
      }),
  }
}

export interface CubeGitSourceOptions {
  id: string
  name: string
  repository: string
  ref: string
  folder: string
  username?: string
  /** The read-only token; null for a public repository, undefined when the store lost it. */
  token: string | null | undefined
  domainAliases?: Readonly<Record<string, string>>
  fetchTimeoutMs?: number
  timeoutMs?: number
  memoryMb?: number
}

/**
 * A Cube model in a Git repository (CON-502): each read fetches the commit the ref names, reads
 * its model folder as the server's folder is read, and forgets it. The version is the commit,
 * which is also the cursor. A failure says why in a warning on the repository, the ref or the
 * folder; the token is never in one.
 */
export function createCubeGitSource(options: CubeGitSourceOptions): DefinitionSource {
  const timeoutMs = options.timeoutMs ?? CUBE_COMPILE_TIMEOUT_MS
  const memoryMb = options.memoryMb ?? CUBE_COMPILE_MEMORY_MB
  checkLimits(timeoutMs, memoryMb)
  return {
    id: options.id,
    type: 'cube',
    name: options.name,
    interfaceVersion: INTERFACE_VERSION,
    serverSettings: [],
    async read() {
      if (options.token === undefined)
        throw new SourceReadError([{ code: 'secret_missing', target: 'token' }])
      try {
        return await withGitCheckout(
          {
            repository: options.repository,
            ref: options.ref,
            folder: options.folder,
            username: options.username,
            token: options.token ?? undefined,
            timeoutMs: options.fetchTimeoutMs,
          },
          async (modelDir, commit) => ({
            ...(await compileCubeModel({
              modelDir,
              domainAliases: options.domainAliases,
              timeoutMs,
              memoryMb,
            })),
            sourceVersion: commit,
            cursor: commit,
          }),
        )
      } catch (error) {
        if (!(error instanceof GitFetchError)) throw error
        const target =
          error.problem === 'ref_not_found'
            ? options.ref
            : error.problem === 'folder_missing'
              ? options.folder || '/'
              : options.repository
        throw new SourceReadError([{ code: error.problem, target }])
      }
    },
  }
}
