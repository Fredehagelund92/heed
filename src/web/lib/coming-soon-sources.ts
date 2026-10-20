import type { ConnectorManifest } from '@domain/connector-manifest'

/**
 * The tools planned as sources but not built, shown under Sources as "Coming soon". Every entry is
 * a public promise: add one only when we mean to build it, and never put a date here. Edit this
 * list and nothing else to change what the page says.
 */
export type ComingSoonSource = {
  id: string
  name: string
  /** A definition source says what exists; a content source becomes drafts to review. */
  kind: ConnectorManifest['kind']
  /** The picture, from the few a connector may name. */
  icon: NonNullable<ConnectorManifest['icon']>
  /** One line on what it would do, in the voice guide's words. */
  summary: string
}

export const comingSoonSources: readonly ComingSoonSource[] = [
  {
    id: 'markdown-git',
    name: 'Markdown in a Git repository',
    kind: 'content',
    icon: 'git',
    summary: 'Turn the notes and guides in a repository into drafts for owners to review.',
  },
  {
    id: 'google-docs',
    name: 'Google Docs',
    kind: 'content',
    icon: 'file',
    summary: 'Turn the documents you choose into drafts for owners to review.',
  },
]

/** Where a request goes: a new issue on the public repository, with the title filled in. */
export const comingSoonRequestUrl = `https://github.com/Fredehagelund92/heed/issues/new?${new URLSearchParams(
  { title: 'Source request: ' },
).toString()}`
