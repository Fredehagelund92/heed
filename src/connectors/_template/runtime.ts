import { contentDigest } from '../../domain/canonical.ts'
import {
  defineRuntime,
  SourceError,
  type CheckReport,
  type FolderTree,
  type RuntimeContext,
  type RuntimeMessage,
} from '../../domain/connector-runtime.ts'
import { mapDefinitions, parseMetricsFile, type MetricsFile } from './mapping.ts'
import { manifest } from './manifest.ts'

/** The settings, as the manifest's form checked them. */
interface Config {
  repository?: string
  ref?: string
  folder?: string
  file?: string
  username?: string
  domainNames?: Record<string, string>
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`

/**
 * The metrics file of the tree: read and parsed, or a failure that says why in a code. A file
 * that is not there is for an administrator to fix; one the tree cannot hand over (too large, a
 * link, not text) is unreadable; one that is not the tool's format is the wrong file.
 */
async function metricsFile(
  tree: FolderTree,
  path: string,
): Promise<{ file: MetricsFile; text: string }> {
  const text = await tree.text(path)
  if (text === null) {
    // The listing stops at 10,000 entries, so it only tells which failure this is.
    const listed = await tree.files()
    if (!listed.some((file) => file.path === path))
      throw new SourceError({ code: 'not_found', target: path, class: 'config' })
    throw new SourceError({ code: 'unreadable_file', target: path, class: 'source' })
  }
  const file = parseMetricsFile(text)
  if (file === null)
    throw new SourceError({ code: `${manifest.id}.not_this_format`, target: path, class: 'config' })
  return { file, text }
}

/**
 * The work, on the folder whoever runs the server named (`ctx.folder`), or on one commit of the
 * repository the settings name (`ctx.git`), with the commit's id; null on the folder.
 */
function onTree<T>(
  context: RuntimeContext<Config>,
  work: (tree: FolderTree, commit: string | null) => Promise<T>,
): Promise<T> {
  if (context.folder) return work(context.folder, null)
  return context.git(
    {
      repository: context.config.repository ?? '',
      ref: context.config.ref ?? '',
      folder: context.config.folder ?? '',
      ...(context.secret('token') === null ? {} : { secret: 'token' }),
      ...(context.config.username ? { username: context.config.username } : {}),
    },
    (tree) => work(tree, tree.commit),
  )
}

/**
 * The runtime of the template: one file of the tool, read through `ctx.git` or `ctx.folder`, made
 * into definitions by the pure mapping. Replace the words of the check's steps with your tool's.
 */
export const runtime = defineRuntime<Config>({
  check(context) {
    const path = context.config.file ?? 'metrics.json'
    return onTree(context, async (tree, commit): Promise<CheckReport> => {
      const { file } = await metricsFile(tree, path)
      const { definitions, warnings } = await mapDefinitions(file, context.config.domainNames)
      const metrics = definitions.filter((definition) => definition.kind === 'metric').length
      const without = warnings.filter((warning) => warning.code === 'missing_domain').length
      return {
        steps: [
          {
            id: 'reach',
            title: 'Reach the file',
            status: 'ok',
            detail: commit
              ? `Read commit ${commit.slice(0, 7)} of ${context.config.ref ?? ''}.`
              : 'Read the folder on the server.',
          },
          {
            id: 'read',
            title: 'Read the metrics file',
            status: 'ok',
            detail: `${plural(metrics, 'metric')} and ${plural(definitions.length - metrics, 'dimension')} in ${plural(file.groups.length, 'group')}.`,
          },
          without
            ? {
                id: 'domains',
                title: 'Find each domain',
                status: 'warning',
                detail: `${plural(without, 'group')} ${without === 1 ? 'names' : 'name'} no domain.`,
                fix: 'Map each group to a domain in the next step, or name it in the file.',
              }
            : { id: 'domains', title: 'Find each domain', status: 'ok' },
        ],
      }
    })
  },

  async *read(context): AsyncIterable<RuntimeMessage> {
    const path = context.config.file ?? 'metrics.json'
    const { file, text, commit } = await onTree(context, async (tree, commit) => ({
      ...(await metricsFile(tree, path)),
      commit,
    }))
    const { definitions, warnings, complete } = await mapDefinitions(
      file,
      context.config.domainNames,
    )
    // Warnings first, so a read that stops still names what it left out.
    yield* warnings
    for (const definition of definitions) yield { type: 'definition', definition }
    yield {
      type: 'end',
      // A commit says the version; a folder on the server, the digest of what was read.
      version: commit ?? (await contentDigest(text)),
      complete,
      ...(commit ? { cursor: commit } : {}),
    }
  },
})
