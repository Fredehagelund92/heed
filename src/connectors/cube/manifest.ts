import { defineManifest } from '../../domain/define-manifest.ts'

/**
 * Cube model files (CON-501, CON-502): the YAML model of a Cube project, read from a Git
 * repository an admin names, or from the folder whoever runs the server names. Its public members
 * become the definitions Heed checks context against. Read only and offline: never a Cube server,
 * a warehouse or data, and never a calculation kept.
 */
export const manifest = defineManifest({
  id: 'cube',
  version: '2.1.0',
  heed: '^3.0',
  kind: 'definitions',
  tool: 'Cube',
  title: 'Cube model in a Git repository',
  summary:
    'Reads the YAML model files of a Cube project from a Git repository every hour, at the branch, tag or commit you name. We keep names, short descriptions and change marks, never a calculation or data.',
  icon: 'database',
  docs: './README.md',
  maintainer: { name: 'Core team' },
  support: 'core',
  maturity: 'stable',
  refPrefix: 'cube',
  config: {
    fields: [
      {
        key: 'repository',
        kind: 'address',
        label: 'Repository',
        description: 'The https address of the Git repository that holds the model.',
        required: true,
        placeholder: 'https://git.example.com/analytics/semantic-layer.git',
      },
      {
        key: 'ref',
        kind: 'ref',
        label: 'Branch, tag or commit',
        description:
          'We read the model as it is there. A tag or a commit stays the same, and a branch moves with each change.',
        required: true,
        default: 'main',
      },
      {
        key: 'folder',
        kind: 'path',
        label: 'Model folder',
        description:
          'The folder of model files in the repository, such as model or cube/model. Leave it empty when they are at the top.',
      },
      {
        key: 'username',
        kind: 'text',
        label: 'User name for the token',
        description:
          'Some Git hosts ask for a user name with the token, and most accept any. If you leave it empty, we send x-access-token.',
        pattern: '^[A-Za-z0-9._@+-]{1,100}$',
        patternMessage: 'Use letters, digits and . _ @ + - only.',
      },
      {
        key: 'modelUrl',
        kind: 'address',
        label: 'Model folder address',
        description:
          'The model folder in the Git host’s web view, so each view links to its file. We never open it.',
        placeholder: 'https://git.example.com/analytics/semantic-layer/tree/main/model',
      },
      {
        key: 'domainNames',
        kind: 'domain_map',
        label: 'Domain names',
        description:
          'When the model’s meta.domain names a domain differently, choose the domain it means. A name that is already a domain id needs no line.',
      },
    ],
  },
  secrets: [
    {
      key: 'token',
      label: 'Read-only token',
      description:
        'A token that can read this repository and nothing else. We keep it in a secret store and never show it again. Leave it empty for a public repository.',
      required: false,
      boundTo: ['repository'],
    },
  ],
  access: [
    'Read access to this one repository. We never write to it.',
    'We read only the model files, never a Cube server, a warehouse or data.',
  ],
  egress: { hosts: [{ fromField: 'repository' }], git: true },
  capabilities: {
    discover: false,
    incremental: false,
    deletions: 'full-listing',
    domain: 'hint',
    marks: 'meaning',
  },
  schedule: { default: 'PT1H', minimum: 'PT15M' },
  staleAfter: 'PT6H',
  // A fetch of at most a minute, then a compile of at most two (the worker's own limit).
  limits: { timeoutSeconds: 180, maxRecords: 100_000 },
  warnings: {},
  markVersion: 1,
})
