import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'
import type { ConnectorManifest } from '../../../domain/connector-manifest.ts'
import { SourceError, type FolderTree, type GuardedGit } from '../../../domain/connector-runtime.ts'
import type { SourceConfig } from '../../../contract/sources.ts'
import { canonicalAddress, folderParts, GitFetchError, withGitCheckout } from './git.ts'

/*
  `ctx.git` (docs/connectors/security.md, "Git"): interface 2's Git fetch behind the same rules as
  `ctx.fetch`. A connector names a repository by the settings field that holds it; the core fetches
  only a repository its manifest declares (`egress.git` and a host from that field), sends a secret
  only when that secret is bound to the field (CON-114), and hands the connector a read-only view
  of one commit that is removed when its work ends. A connector never runs git itself.
*/

/** The most files a tree lists, and the largest file it reads. */
export const TREE_FILES_MAX = 10_000
export const TREE_FILE_BYTES_MAX = 2_000_000

/**
 * A tree over a folder: only what is inside it. A link is listed as a file, never followed: its
 * text is null. A folder that is not there is an empty tree.
 */
export function folderTree(folder: string): FolderTree {
  let real: Promise<string | null> | undefined
  const rootOf = () => (real ??= realpath(folder).catch(() => null))
  const inside = async (path: string | undefined): Promise<string | null> => {
    const root = await rootOf()
    const parts = folderParts(path ?? '')
    if (!root || !parts) return null
    try {
      const at = await realpath(join(root, ...parts))
      return at === root || at.startsWith(`${root}${sep}`) ? at : null
    } catch {
      return null
    }
  }
  const relative = (root: string, path: string) =>
    path
      .slice(root.length + 1)
      .split(sep)
      .join('/')
  return {
    async folders(path) {
      const root = await rootOf()
      const at = await inside(path)
      if (!root || !at) return []
      const entries = await readdir(at, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isDirectory() && entry.name !== '.git')
        .map((entry) => relative(root, join(at, entry.name)))
        .sort()
    },
    async files(path) {
      const root = await rootOf()
      const at = await inside(path)
      if (!root || !at) return []
      const found: { path: string; size: number }[] = []
      const walk = async (dir: string): Promise<void> => {
        const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
          a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
        )
        for (const entry of entries) {
          if (found.length >= TREE_FILES_MAX) return
          if (entry.name === '.git') continue
          const file = join(dir, entry.name)
          if (entry.isDirectory()) await walk(file)
          else if (entry.isFile() || entry.isSymbolicLink())
            found.push({ path: relative(root, file), size: (await lstat(file)).size })
        }
      }
      await walk(at)
      return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    },
    async text(path) {
      const root = await rootOf()
      const parts = folderParts(path)
      if (!root || !parts || !parts.length) return null
      const file = join(root, ...parts)
      try {
        const stats = await lstat(file)
        if (!stats.isFile() || stats.size > TREE_FILE_BYTES_MAX) return null
        if ((await realpath(file)) !== file) return null
        const bytes = await readFile(file)
        if (bytes.includes(0)) return null
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        return null
      }
    },
  }
}

const refused = (target: string) =>
  new SourceError({ code: 'private_address', target, class: 'config' })

/**
 * The git a runtime gets: the repositories its manifest declares, through the settings fields
 * that hold them, with the secrets bound to those fields only.
 */
export function guardedGit(
  manifest: ConnectorManifest,
  config: SourceConfig,
  secrets: Readonly<Record<string, string>> | null,
): GuardedGit {
  const fields = manifest.egress.hosts.flatMap((host) =>
    'fromField' in host ? [host.fromField] : [],
  )
  return async (request, work) => {
    if (!manifest.egress.git) throw refused('repository')
    const field = fields.find((key) => config[key] === request.repository)
    if (!field) throw refused('repository')
    let token: string | undefined
    if (request.secret !== undefined) {
      const slot = manifest.secrets.find((secret) => secret.key === request.secret)
      if (!slot || !slot.boundTo.includes(field))
        throw new SourceError({ code: 'secret_missing', target: request.secret, class: 'config' })
      token = secrets?.[request.secret]
      if (token === undefined && (slot.required || secrets === null))
        throw new SourceError({ code: 'secret_missing', target: request.secret, class: 'config' })
    }
    // Git is given the very form the checks read (the WHATWG URL), never a second reading of it.
    const repository = canonicalAddress(request.repository)
    if (repository === null) throw refused('repository')
    try {
      return await withGitCheckout(
        {
          repository,
          ref: request.ref,
          folder: request.folder ?? '',
          ...(token === undefined ? {} : { token }),
          ...(token === undefined || !request.username ? {} : { username: request.username }),
          timeoutMs: Math.min(manifest.limits.timeoutSeconds, 60) * 1000,
        },
        (folder, commit, committedAt) => work({ ...folderTree(folder), commit, committedAt }),
      )
    } catch (error) {
      if (!(error instanceof GitFetchError)) throw error
      const target =
        error.problem === 'ref_not_found'
          ? request.ref
          : error.problem === 'folder_missing'
            ? request.folder || '/'
            : request.repository
      throw new SourceError({
        code: error.problem,
        target,
        class: error.problem === 'unreachable' ? 'transient' : 'config',
      })
    }
  }
}
