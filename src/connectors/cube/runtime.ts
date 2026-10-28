import * as z from 'zod/mini'
import {
  defineRuntime,
  runtimeDefinitionSchema,
  SourceError,
  type CheckReport,
  type RuntimeDefinition,
  type FolderTree,
  type GitTree,
  type RuntimeContext,
  type RuntimeMessage,
} from '../../domain/connector-runtime.ts'
import { readCubeFigure } from './figures.ts'

interface Config {
  repository?: string
  ref?: string
  folder?: string
  username?: string
  modelUrl?: string
  domainNames?: Record<string, string>
}

/** The most files a model folder may hold, the largest file and the most text in all. */
export const MODEL_FILES_MAX = 1_000
export const MODEL_FILE_BYTES_MAX = 2_000_000
export const MODEL_BYTES_MAX = 20_000_000

const yaml = /\.ya?ml$/i

const fileWarning = z.object({
  code: z.enum(['unsupported_file', 'unreadable_file', 'invalid_domain', 'missing_domain']),
  target: z.string().check(z.maxLength(500)),
})

/** The worker's answer, checked before anything of it is passed on (I-7). */
const answerSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    version: z.string().check(z.minLength(1), z.maxLength(200)),
    complete: z.boolean(),
    definitions: z.array(runtimeDefinitionSchema),
    warnings: z.array(fileWarning),
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum(['no_model_files', 'compile_error', 'compiler_unavailable']),
    warnings: z.array(fileWarning),
  }),
])

type Warning = Extract<RuntimeMessage, { type: 'warning' }>

/**
 * The model files of a folder, as the compiler is given them: YAML only, each at most 2 MB and
 * 20 MB in all. Anything else is left out with a warning, and the read is then in part.
 */
export async function modelFiles(tree: FolderTree) {
  const listed = await tree.files()
  if (listed.length > MODEL_FILES_MAX)
    throw new SourceError({
      code: 'too_many_records',
      target: `${MODEL_FILES_MAX}`,
      class: 'source',
    })
  const files: { fileName: string; content: string }[] = []
  const warnings: Warning[] = []
  let total = 0
  for (const { path, size } of listed) {
    // JavaScript, Python and the rest are code: never read.
    if (!yaml.test(path)) {
      warnings.push({ type: 'warning', code: 'unsupported_file', target: path })
      continue
    }
    total += size
    const content =
      size > MODEL_FILE_BYTES_MAX || total > MODEL_BYTES_MAX ? null : await tree.text(path)
    // Too large, a link, or not text.
    if (content === null) {
      warnings.push({ type: 'warning', code: 'unreadable_file', target: path })
      continue
    }
    files.push({ fileName: path, content })
  }
  return { files, warnings }
}

/** What the worker made of the files, or why it could not, with what it warned about. */
type Compiled =
  | { warnings: Warning[]; failure: SourceError }
  | {
      warnings: Warning[]
      version: string
      complete: boolean
      definitions: RuntimeDefinition[]
    }

const failure = (code: string) =>
  new SourceError({
    code,
    target: code === 'compiler_unavailable' ? '@cubejs-backend/native' : 'model',
    // A broken model waits for its next period; a compiler that is not installed, for an admin.
    class: code === 'compiler_unavailable' ? 'config' : 'source',
  })

/** Compiles the files in the worker; a failure says why in a fixed code (CON-505). */
async function compiled(
  context: RuntimeContext<Config>,
  files: { fileName: string; content: string }[],
): Promise<Compiled> {
  let raw: unknown
  try {
    raw = await context.worker({ files, domainAliases: context.config.domainNames ?? {} })
  } catch (error) {
    if (error instanceof SourceError && error.code === 'timed_out')
      return { warnings: [], failure: failure('compile_timeout') }
    throw error
  }
  const answer = answerSchema.safeParse(raw)
  if (!answer.success) return { warnings: [], failure: failure('invalid_output') }
  const warnings = answer.data.warnings.map((warning): Warning => ({ type: 'warning', ...warning }))
  if (!answer.data.ok) return { warnings, failure: failure(answer.data.code) }
  return { ...answer.data, warnings }
}

/** One read of a model folder: its files, then what the compiler made of them. */
async function readModel(context: RuntimeContext<Config>, tree: FolderTree): Promise<Compiled> {
  const { files, warnings } = await modelFiles(tree)
  if (!files.length) return { warnings, failure: failure('no_model_files') }
  const model = await compiled(context, files)
  const all = [...warnings, ...model.warnings]
  if ('failure' in model) return { warnings: all, failure: model.failure }
  return { ...model, complete: model.complete && warnings.length === 0, warnings: all }
}

/** The repository's commit the ref names, its model folder handed over for the work. */
const checkout = <T>(context: RuntimeContext<Config>, work: (tree: GitTree) => Promise<T>) =>
  context.git(
    {
      repository: context.config.repository ?? '',
      ref: context.config.ref ?? '',
      folder: context.config.folder ?? '',
      ...(context.secret('token') === null ? {} : { secret: 'token' }),
      ...(context.config.username ? { username: context.config.username } : {}),
    },
    work,
  )

/**
 * The runtime of Cube: one commit of the repository the settings name (through `ctx.git`), or
 * the folder whoever runs the server named (`ctx.folder`); its YAML model files compiled in the
 * worker (`ctx.worker`, T1); each public member a definition under `cube:`. A model it cannot
 * reach fails with the reason's code, which Sources words, as a read does.
 */
export const runtime = defineRuntime<Config>({
  async check(context): Promise<CheckReport> {
    const inspect = async (tree: FolderTree, reached: string): Promise<CheckReport> => {
      const { files, warnings } = await modelFiles(tree)
      return {
        steps: [
          { id: 'reach', title: 'Reach the model', status: 'ok', detail: reached },
          {
            id: 'files',
            title: 'Find the model files',
            // None is said by the read that follows: why first, then each file left out.
            status: files.length ? 'ok' : 'warning',
            detail: `${files.length} YAML ${files.length === 1 ? 'file' : 'files'}${warnings.length ? `, ${warnings.length} left out` : ''}.`,
            ...(files.length
              ? {}
              : { fix: 'Choose the folder that holds the model’s .yml files.' }),
          },
        ],
      }
    }
    if (context.folder) return inspect(context.folder, 'Read the folder on the server.')
    return checkout(context, (tree) =>
      inspect(tree, `Read commit ${tree.commit.slice(0, 7)} of ${context.config.ref ?? ''}.`),
    )
  },

  async *read(context): AsyncIterable<RuntimeMessage> {
    // The server's folder is read as it is; a repository at the commit its ref names, which is
    // the read's version and its cursor.
    const model = context.folder
      ? { ...(await readModel(context, context.folder)), commit: null }
      : await checkout(context, async (tree) => ({
          ...(await readModel(context, tree)),
          commit: tree.commit,
        }))
    // What it warned about comes first, so a read that fails still names each file left out.
    yield* model.warnings
    if ('failure' in model) throw model.failure
    for (const definition of model.definitions) yield { type: 'definition', definition }
    yield {
      type: 'end',
      version: model.commit ?? model.version,
      complete: model.complete,
      ...(model.commit ? { cursor: model.commit } : {}),
    }
  },

  // One figure from Cube's REST API, apart from the model's read (figures.ts).
  figure: readCubeFigure,
})
