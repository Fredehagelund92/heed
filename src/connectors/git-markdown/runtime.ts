import {
  defineRuntime,
  SourceError,
  type CheckReport,
  type ChosenScope,
  type GitTree,
  type RuntimeContext,
  type RuntimeMessage,
} from '../../domain/connector-runtime.ts'
import { DOCUMENT_TEXT_MAX, READ_TEXT_MAX } from '../../domain/content-document.ts'

interface Config {
  repository: string
  ref: string
  folder?: string
  fileLink?: string
  username?: string
}

const markdown = /\.(md|markdown)$/i

/** A path in the repository from one inside the chosen folder. */
const inRepository = (config: Config, path: string) =>
  [config.folder ?? '', path].filter(Boolean).join('/')

/** A file's address on the Git host: the pattern given, or the host's own form. */
export function fileLink(config: Config, commit: string, path: string): string | null {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  if (config.fileLink)
    return config.fileLink.replaceAll('{commit}', commit).replaceAll('{path}', encoded)
  const url = URL.parse(config.repository)
  if (!url || url.protocol !== 'https:') return null
  const base = `${url.origin}${url.pathname.replace(/\.git$/, '').replace(/\/$/, '')}`
  if (url.hostname === 'gitlab.com') return `${base}/-/blob/${commit}/${encoded}`
  if (url.hostname === 'bitbucket.org') return `${base}/src/${commit}/${encoded}`
  return `${base}/blob/${commit}/${encoded}`
}

/** A document's title: its first top heading, or its file name in words. */
export function titleOf(text: string, path: string): string {
  const heading = text.match(/^\s*#\s+(.+?)\s*#*\s*$/m)?.[1]?.trim()
  if (heading) return heading.slice(0, 300)
  const name = path.split('/').at(-1)!.replace(markdown, '').replace(/[-_]+/g, ' ').trim()
  return (name.charAt(0).toUpperCase() + name.slice(1)).slice(0, 300) || path.slice(0, 300)
}

/** The folder a domain id would most likely have: its last part, as a domain id. */
const suggestedDomain = (folder: string) => {
  const id = (folder.split('/').at(-1) ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_')
  return /^[a-z][a-z0-9_]{1,39}$/.test(id) ? id : null
}

/**
 * The scope a file belongs to: the deepest chosen folder it is in, so a folder chosen inside
 * another one takes its own documents.
 */
export function scopeOf(scopes: readonly ChosenScope[], path: string): ChosenScope | null {
  let found: ChosenScope | null = null
  for (const scope of scopes) {
    const inside = scope.id === '' || path === scope.id || path.startsWith(`${scope.id}/`)
    if (inside && (!found || scope.id.length > found.id.length)) found = scope
  }
  return found
}

const checkout = <T>(context: RuntimeContext<Config>, work: (tree: GitTree) => Promise<T>) =>
  context.git(
    {
      repository: context.config.repository,
      ref: context.config.ref,
      folder: context.config.folder ?? '',
      ...(context.secret('token') === null ? {} : { secret: 'token' }),
    },
    work,
  )

/** Words for a failed reach, as the check shows them. */
const reachFix: Record<string, string> = {
  unauthorized: 'Give a token that may read this repository.',
  not_found: 'Check the repository address. A private repository needs a token too.',
  ref_not_found: 'Check the branch or tag.',
  folder_missing: 'Check the folder: it is not on that branch or tag.',
  unreachable: 'Check the address, and that the host can be reached from the internet.',
  private_address: 'Use an address on a public host, over https.',
  secret_missing: 'Give the token again: it is gone from the secret store.',
}

/** The runtime of Markdown in Git: one commit, the chosen folders, their Markdown files. */
export const runtime = defineRuntime<Config>({
  async check(context): Promise<CheckReport> {
    try {
      return await checkout(context, async (tree) => {
        const files = (await tree.files()).filter((file) => markdown.test(file.path))
        const folders = await tree.folders()
        return {
          steps: [
            {
              id: 'reach',
              title: 'Reach the repository',
              status: 'ok',
              detail: `Read commit ${tree.commit.slice(0, 7)} of ${context.config.ref}.`,
            },
            {
              id: 'folders',
              title: 'Find the folders',
              status: folders.length ? 'ok' : 'warning',
              detail: folders.length
                ? `${folders.length} ${folders.length === 1 ? 'folder' : 'folders'} to choose from.`
                : 'No folders inside it: choose the folder itself.',
            },
            {
              id: 'documents',
              title: 'Find Markdown files',
              status: files.length ? 'ok' : 'warning',
              detail: `${files.length} Markdown ${files.length === 1 ? 'file' : 'files'}.`,
              ...(files.length ? {} : { fix: 'Choose a folder that holds .md files.' }),
            },
          ],
        }
      })
    } catch (error) {
      if (!(error instanceof SourceError) || !(error.code in reachFix)) throw error
      return {
        steps: [
          {
            id: 'reach',
            title: 'Reach the repository',
            status: 'failed',
            detail: `It could not be read (${error.code}).`,
            fix: reachFix[error.code]!,
          },
        ],
      }
    }
  },

  discover(context) {
    return checkout(context, async (tree) => {
      const top = context.config.folder ?? ''
      const scopes = [
        // The folder itself, when it holds Markdown files of its own.
        ...((await tree.files()).some(
          (file) => !file.path.includes('/') && markdown.test(file.path),
        )
          ? [{ id: '', title: top || 'Top of the repository', suggestedDomain: null }]
          : []),
        ...(await tree.folders()).map((folder) => ({
          id: folder,
          title: inRepository(context.config, folder),
          suggestedDomain: suggestedDomain(folder),
        })),
      ]
      return scopes.slice(0, 200)
    })
  },

  async *read(context): AsyncIterable<RuntimeMessage> {
    const messages = await checkout(context, async (tree) => {
      const out: RuntimeMessage[] = []
      let held = 0
      let complete = true
      for (const file of await tree.files()) {
        if (!markdown.test(file.path)) continue
        const scope = scopeOf(context.scopes, file.path)
        if (!scope) continue
        const path = inRepository(context.config, file.path)
        const link = fileLink(context.config, tree.commit, path)
        if (!link)
          throw new SourceError({ code: 'fetch_failed', target: 'fileLink', class: 'config' })
        // Seen but not read: too long for a suggestion, or not text. Its suggestion stays.
        if (file.size > DOCUMENT_TEXT_MAX * 4) {
          out.push({ type: 'warning', code: 'document_too_large', target: path })
          continue
        }
        if (held + file.size > READ_TEXT_MAX) {
          out.push({ type: 'warning', code: 'too_much_text', target: String(READ_TEXT_MAX) })
          complete = false
          break
        }
        const text = await tree.text(file.path)
        if (text === null) {
          out.push({ type: 'warning', code: 'unreadable_file', target: path })
          continue
        }
        held += file.size
        out.push({
          type: 'document',
          document: {
            id: path,
            scope: scope.id,
            title: titleOf(text, file.path),
            link,
            modifiedAt: tree.committedAt,
            version: tree.commit,
            text,
            mediaType: 'text/markdown',
          },
        })
      }
      // Every file of the chosen folders, each read: a full listing, which the core compares.
      out.push({ type: 'end', version: tree.commit, complete, cursor: tree.commit })
      return out
    })
    yield* messages
  },
})
