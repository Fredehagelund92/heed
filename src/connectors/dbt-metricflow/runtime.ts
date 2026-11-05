import { contentDigest } from '../../domain/canonical.ts'
import {
  defineRuntime,
  SourceError,
  type CheckReport,
  type CheckStep,
  type FolderTree,
  type RuntimeContext,
  type RuntimeMessage,
} from '../../domain/connector-runtime.ts'
import { mapDefinitions, parseSemanticManifest, type SemanticManifest } from './mapping.ts'
import { manifest } from './manifest.ts'
import { linkExpiry, regionOf, sasQuery, sasReadsOnly, signedHeaders } from './object-storage.ts'

/** The settings, as the manifest's form checked them. */
interface Config {
  location?: string
  provider?: string
  objectAddress?: string
  region?: string
  repository?: string
  ref?: string
  folder?: string
  file?: string
  username?: string
  domainNames?: Record<string, string>
}

/** The largest file a read takes, as a Git read does. */
const FILE_BYTES_MAX = 2_000_000
/** The longest cursor kept: the core's 500, less what it puts in front of it. */
const CURSOR_MAX = 480
/** How long before a signed link stops working a check says so. */
const SOON_MS = 14 * 24 * 60 * 60 * 1000

/** The file's name when an address says nothing a person may be shown of it. */
const REMOTE_FILE = 'semantic_manifest.json'

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`

/** The file, or that it is not dbt's semantic manifest, such as its manifest.json. */
function parsed(text: string, path: string): SemanticManifest {
  const file = parseSemanticManifest(text)
  if (file === null)
    throw new SourceError({
      code: `${manifest.id}.not_a_semantic_manifest`,
      target: path,
      class: 'config',
    })
  return file
}

/**
 * The semantic manifest of the tree: read and parsed, or a failure that says why in a code. A
 * file that is not there is for an administrator to fix; one the tree cannot hand over (over
 * 2 MB, a link, not text) is unreadable; one that is not dbt's semantic manifest, such as its
 * manifest.json, is the wrong file.
 */
async function semanticManifest(
  tree: FolderTree,
  path: string,
): Promise<{ file: SemanticManifest; text: string }> {
  const text = await tree.text(path)
  if (text === null) {
    // The listing stops at 10,000 entries, so it only tells which failure this is.
    const listed = await tree.files()
    if (!listed.some((file) => file.path === path))
      throw new SourceError({ code: 'not_found', target: path, class: 'config' })
    throw new SourceError({ code: 'unreadable_file', target: path, class: 'source' })
  }
  return { file: parsed(text, path), text }
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

/** One request for the file: where it goes, and how it is signed. A host, never the address. */
interface Request {
  address: string
  headers: Record<string, string>
  host: string
}

const missing = (key: string) =>
  new SourceError({ code: 'secret_missing', target: key, class: 'config' })

/** The request of the address route or the storage route, as the settings and secrets say it. */
async function requestOf(context: RuntimeContext<Config>): Promise<Request> {
  const secret = (key: string) => {
    const value = context.secret(key)
    if (value === null) throw missing(key)
    return value
  }
  if (context.config.location === 'address') {
    const address = secret('fileAddress')
    return { address, headers: {}, host: URL.parse(address)?.host ?? 'address' }
  }
  const { objectAddress = '', provider = 's3', region } = context.config
  const url = new URL(objectAddress)
  if (provider === 'azure') {
    const signature = secret('sasToken')
    if (!sasReadsOnly(signature))
      throw new SourceError({
        code: `${manifest.id}.not_read_only`,
        target: 'sasToken',
        class: 'config',
      })
    return {
      address: `${url.origin}${url.pathname}?${sasQuery(signature)}`,
      headers: {},
      host: url.host,
    }
  }
  const key = {
    accessKey: secret('accessKey'),
    secretKey: secret('secretKey'),
    region: regionOf(url, provider, region),
  }
  return {
    address: url.href,
    headers: await signedHeaders(url, key, context.now()),
    host: url.host,
  }
}

/** What a good read leaves for the next: the file's marks, and the mapping that read it. */
interface Mark {
  reader: string
  version: string
  etag?: string
  modified?: string
}

const reader = `${manifest.version}/${manifest.markVersion}`

/** The cursor's mark, unless it is a commit's or a mapping before this one read the file. */
function markOf(cursor: string | null): Mark | null {
  if (cursor === null) return null
  try {
    const mark = JSON.parse(cursor) as Mark
    return mark.reader === reader ? mark : null
  } catch {
    return null
  }
}

const seconds = (value: string | null) =>
  value !== null && /^\d{1,6}$/.test(value.trim()) ? { retryAfter: Number(value.trim()) } : {}

/** Why the host would not hand the file over. */
function refusal(response: Response, host: string): SourceError {
  const { status } = response
  if (status === 401 || status === 403)
    return new SourceError({ code: 'unauthorized', target: host, class: 'config' })
  if (status === 404) return new SourceError({ code: 'not_found', target: host, class: 'config' })
  const wait = seconds(response.headers.get('retry-after'))
  if (status === 429)
    return new SourceError({ code: 'rate_limited', target: host, class: 'transient', ...wait })
  if (status >= 500)
    return new SourceError({ code: 'unreachable', target: host, class: 'transient', ...wait })
  return new SourceError({ code: 'fetch_failed', target: host, class: 'config' })
}

/** The file as bytes the mapping can read: no compression, and UTF-8. */
async function textOf(response: Response, host: string, signal: AbortSignal): Promise<string> {
  const unreadable = new SourceError({ code: 'unreadable_file', target: host, class: 'source' })
  const encoding = response.headers.get('content-encoding')
  if (encoding && encoding !== 'identity') throw unreadable
  let bytes: ArrayBuffer
  try {
    bytes = await response.arrayBuffer()
  } catch (error) {
    if (error instanceof SourceError || signal.aborted) throw error
    throw new SourceError({ code: 'unreachable', target: host, class: 'transient' })
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw unreadable
  }
}

/** The file at its address, or null when the host says it is as `mark` names it. */
async function fetched(
  context: RuntimeContext<Config>,
  mark: Mark | null,
): Promise<{ text: string; marks: Pick<Mark, 'etag' | 'modified'> } | null> {
  const { address, headers, host } = await requestOf(context)
  const response = await context.fetch(address, {
    headers: {
      ...headers,
      ...(mark?.etag ? { 'if-none-match': mark.etag } : {}),
      ...(mark?.modified ? { 'if-modified-since': mark.modified } : {}),
    },
    maxBytes: FILE_BYTES_MAX,
  })
  if (mark && response.status === 304) return null
  if (!response.ok) {
    void response.body?.cancel()
    throw refusal(response, host)
  }
  const etag = response.headers.get('etag')
  const modified = response.headers.get('last-modified')
  return {
    text: await textOf(response, host, context.signal),
    marks: { ...(etag ? { etag } : {}), ...(modified ? { modified } : {}) },
  }
}

/** Whether the settings read an address or an object: a server folder is never either. */
const remote = (context: RuntimeContext<Config>) =>
  !context.folder &&
  (context.config.location === 'address' || context.config.location === 'storage')

/** Where a remote read's file is, for a step: the host alone, as a signature may follow it. */
const hostOf = (context: RuntimeContext<Config>) =>
  URL.parse(
    context.config.location === 'address'
      ? (context.secret('fileAddress') ?? '')
      : (context.config.objectAddress ?? ''),
  )?.host ?? 'the address'

/** The steps a signed link adds: when it stops working, when that is soon or past. */
function linkSteps(context: RuntimeContext<Config>): CheckStep[] {
  if (context.config.location !== 'address') return []
  const expiry = linkExpiry(context.secret('fileAddress') ?? '')
  if (!expiry) return []
  const day = expiry.toISOString().slice(0, 10)
  const left = expiry.getTime() - context.now().getTime()
  if (left <= 0)
    return [
      {
        id: 'link',
        title: 'Check the link',
        status: 'failed',
        detail: `It stopped working on ${day}.`,
        fix: 'Make a new link, and paste it here.',
      },
    ]
  return [
    left < SOON_MS
      ? {
          id: 'link',
          title: 'Check the link',
          status: 'warning',
          detail: `It stops working on ${day}.`,
          fix: 'Make a new one before then, or use Object storage with a key that does not expire.',
        }
      : { id: 'link', title: 'Check the link', status: 'ok', detail: `It works until ${day}.` },
  ]
}

/** The steps of a read of the file: what it holds, and whether each domain is named. */
async function readSteps(
  context: RuntimeContext<Config>,
  file: SemanticManifest,
): Promise<CheckStep[]> {
  const { definitions, warnings } = await mapDefinitions(file, context.config.domainNames)
  const metrics = definitions.filter((definition) => definition.kind === 'metric').length
  // A group's warning names the group alone; `_shared.<metric>` is a metric's.
  const without = warnings.filter(
    (warning) => warning.code === 'missing_domain' && !warning.target.includes('.'),
  ).length
  return [
    {
      id: 'read',
      title: 'Read the semantic manifest',
      status: definitions.length ? 'ok' : 'warning',
      detail: `${plural(metrics, 'metric')} and ${plural(definitions.length - metrics, 'dimension')} in ${plural(file.semantic_models.length, 'semantic model')}.`,
      ...(definitions.length
        ? {}
        : {
            fix: `Run dbt parse in a project that defines metrics, and ${remote(context) ? 'upload' : 'commit'} its file.`,
          }),
    },
    without
      ? {
          id: 'domains',
          title: 'Find each domain',
          status: 'warning',
          detail: `${plural(without, 'semantic model')} ${without === 1 ? 'names' : 'name'} no domain.`,
          fix: 'Map each one to a domain in the next step, or set meta.domain in dbt.',
        }
      : { id: 'domains', title: 'Find each domain', status: 'ok' },
  ]
}

/**
 * The runtime of dbt MetricFlow: `semantic_manifest.json`, read through `ctx.fetch`, `ctx.git` or
 * `ctx.folder`, made into definitions by the pure mapping. It runs no dbt and reaches no warehouse
 * (CON-701).
 */
export const runtime = defineRuntime<Config>({
  async check(context) {
    if (remote(context)) {
      const link = linkSteps(context)
      if (link.some((step) => step.status === 'failed')) return { steps: link }
      const found = await fetched(context, null)
      const file = parsed(found!.text, REMOTE_FILE)
      return {
        steps: [
          {
            id: 'reach',
            title: 'Reach the file',
            status: 'ok',
            detail: `Read it at ${hostOf(context)}.`,
          },
          ...link,
          ...(await readSteps(context, file)),
        ],
      }
    }
    const path = context.config.file ?? REMOTE_FILE
    return onTree(context, async (tree, commit): Promise<CheckReport> => {
      const { file } = await semanticManifest(tree, path)
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
          ...(await readSteps(context, file)),
        ],
      }
    })
  },

  async *read(context): AsyncIterable<RuntimeMessage> {
    const path = context.config.file ?? REMOTE_FILE
    let file: SemanticManifest
    let text: string
    let commit: string | null = null
    let marks: Pick<Mark, 'etag' | 'modified'> = {}
    if (remote(context)) {
      const mark = markOf(context.cursor)
      const found = await fetched(context, mark)
      if (found === null) {
        // `mark` is what the last read left: the core keeps what that read found.
        yield {
          type: 'end',
          version: mark!.version,
          complete: true,
          unchanged: true,
          cursor: context.cursor!,
        }
        return
      }
      ;({ text, marks } = found)
      file = parsed(text, REMOTE_FILE)
    } else {
      ;({ file, text, commit } = await onTree(context, async (tree, at) => ({
        ...(await semanticManifest(tree, path)),
        commit: at,
      })))
    }
    const { definitions, warnings, complete } = await mapDefinitions(
      file,
      context.config.domainNames,
    )
    // Warnings first, so a read that stops still names what it left out.
    yield* warnings
    for (const definition of definitions) yield { type: 'definition', definition }
    // A commit says the version; a folder or an object, the digest of what was read.
    const version = commit ?? (await contentDigest(text))
    const cursor = commit ?? remoteCursor(marks, version)
    yield { type: 'end', version, complete, ...(cursor ? { cursor } : {}) }
  },
})

/** What the next read sends to ask whether the file changed; none when the host gave no mark. */
function remoteCursor(marks: Pick<Mark, 'etag' | 'modified'>, version: string) {
  if (!marks.etag && !marks.modified) return undefined
  const cursor = JSON.stringify({ reader, version, ...marks })
  return cursor.length <= CURSOR_MAX ? cursor : undefined
}
