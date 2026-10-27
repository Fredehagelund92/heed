import { defineManifest } from '../../domain/define-manifest.ts'

/**
 * Markdown files in a Git repository (CON-601, CON-611): the folders an admin chooses become
 * suggestions for the owners of the domain each folder maps to, one per document. Read only, with
 * a token for that one repository when it is private. A read never publishes: an owner does.
 */
export const manifest = defineManifest({
  id: 'git-markdown',
  version: '1.0.0',
  heed: '^3.0',
  kind: 'content',
  tool: 'Markdown in Git',
  title: 'Markdown in Git',
  summary: 'Markdown files in a repository become suggestions for owners.',
  icon: 'git',
  docs: './README.md',
  maintainer: { name: 'Core team' },
  support: 'core',
  maturity: 'beta',
  config: {
    fields: [
      {
        key: 'repository',
        kind: 'address',
        label: 'Repository address',
        description: 'The address you clone the repository from, over https.',
        required: true,
        placeholder: 'https://github.com/acme/handbook.git',
      },
      {
        key: 'ref',
        kind: 'ref',
        label: 'Branch or tag',
        description: 'The documents are read as they are on this branch or tag.',
        required: true,
        default: 'main',
      },
      {
        key: 'folder',
        kind: 'path',
        label: 'Folder',
        description:
          'The folder that holds the documents, relative to the top of the repository. You choose which of its folders to read next. Leave it empty for the top.',
        placeholder: 'docs',
      },
      {
        key: 'fileLink',
        kind: 'text',
        label: 'Link to a file',
        description:
          'How to link to a file on your Git host, with {commit} and {path} where they go. Leave it empty for GitHub, GitLab or Bitbucket.',
        placeholder: 'https://git.example.com/acme/handbook/src/commit/{commit}/{path}',
        pattern: '^https://[^\\s]*\\{path\\}[^\\s]*$',
        patternMessage: 'Write an https address with {path} in it.',
        advanced: true,
      },
      {
        key: 'username',
        kind: 'text',
        label: 'User name for the token',
        description: 'Most Git hosts take any name with a token. Change it only if yours asks.',
        placeholder: 'x-access-token',
        advanced: true,
      },
    ],
  },
  secrets: [
    {
      key: 'token',
      label: 'Read-only token',
      description:
        'A token that may only read this repository. Leave it empty for a public repository.',
      required: false,
      boundTo: ['repository'],
    },
  ],
  access: [
    'Read access to this one repository. Nothing is ever written to it.',
    'Who may read a document is not copied: once an owner publishes a suggestion, everyone in the workspace reads it.',
  ],
  egress: { hosts: [{ fromField: 'repository' }], git: true },
  capabilities: {
    discover: 'folders',
    incremental: true,
    deletions: 'full-listing',
    domain: 'per-scope',
    links: false,
  },
  schedule: { default: 'P1D', minimum: 'PT15M' },
  staleAfter: 'P2D',
  limits: { timeoutSeconds: 120, maxRecords: 5000, draftsPerDay: 5 },
  warnings: {},
  markVersion: 1,
})
