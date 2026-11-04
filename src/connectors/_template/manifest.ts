import { defineManifest } from '../../domain/define-manifest.ts'

/**
 * The template of a definitions connector (docs/connectors/authoring.md): copy this folder to
 * `src/connectors/<id>/` and change every value below for your tool. As it is, it reads an
 * invented tool's metrics file, `metrics.json`, from a Git repository or from the server's
 * folder, and the conformance kit runs against it (tests/server/connectors/conformance.test.ts),
 * so what you copy works. It is not listed in `index.ts` or `manifests.ts`: Integrations never
 * offers it.
 */
export const manifest = defineManifest({
  // Stable for good, since sources store it: lowercase letters, digits and dashes.
  id: 'template',
  // The connector's own semantic version. Move it when the connector changes.
  version: '1.0.0',
  // The connector interface range it is written to (CON-109).
  heed: '^3.2',
  // `definitions` (which metrics and dimensions exist) or `content` (documents to draft from).
  kind: 'definitions',
  // The tool, as people say it. Every word on screen that names the tool comes from here.
  tool: 'Example metrics',
  // The title of its README and its source pages.
  title: 'Example metrics file in a Git repository',
  // One line on its Integrations cell: what it reads, in a person's words.
  summary: 'Metrics and dimensions, read from an example metrics file in Git.',
  // Its picture when Integrations has no logo for it: database, git, file, list, cloud or book.
  icon: 'database',
  // Its README, relative to this folder.
  docs: './README.md',
  maintainer: { name: 'Core team' },
  // `core` for a connector in this repository.
  support: 'core',
  // `experimental` until it has run against a real tool, then `beta`, then `stable`.
  maturity: 'experimental',
  // The prefix of its refs, which belongs to the tool for good (CON-117): `<prefix>:<group>.<name>`.
  refPrefix: 'example',
  config: {
    fields: [
      {
        key: 'repository',
        kind: 'address',
        label: 'Repository',
        description: 'The https address of the Git repository that holds the metrics file.',
        required: true,
        placeholder: 'https://git.example.com/analytics/metrics.git',
      },
      {
        key: 'ref',
        kind: 'ref',
        label: 'Branch, tag or commit',
        description:
          'We read the file as it is there. A tag or a commit stays the same, and a branch moves with each change.',
        required: true,
        default: 'main',
      },
      {
        key: 'folder',
        kind: 'path',
        label: 'Folder',
        description:
          'The folder of the repository that holds the file. Leave it empty when it is at the top.',
      },
      {
        key: 'file',
        kind: 'path',
        label: 'File',
        description: 'The metrics file, in that folder.',
        required: true,
        default: 'metrics.json',
      },
      {
        key: 'username',
        kind: 'text',
        label: 'User name for the token',
        description:
          'Some Git hosts ask for a user name with the token, and most accept any. If you leave it empty, we send x-access-token.',
        pattern: '^[A-Za-z0-9._@+-]{1,100}$',
        patternMessage: 'Use letters, digits and . _ @ + - only.',
        advanced: true,
      },
      {
        key: 'domainNames',
        kind: 'domain_map',
        label: 'Domain names',
        description:
          'When the file names a domain differently from your domains, choose the domain it means. A name that is already a domain id needs no line.',
        advanced: true,
      },
    ],
  },
  // Each secret is kept in the secret store and sent only toward the settings it is bound to.
  secrets: [
    {
      key: 'token',
      label: 'Read-only token',
      description:
        'A token that can read this repository and nothing else. We keep it in a secret store and never show it again. Leave it empty for a public repository.',
      boundTo: ['repository'],
    },
  ],
  // The least access it needs, said before anything is given (CON-106).
  access: [
    'Read access to this one repository. We never write to it.',
    'A read takes only the metrics file, never the tool itself, a warehouse or data.',
  ],
  // Every host it may reach (CON-113): here the repository's host, through Git.
  egress: { hosts: [{ fromField: 'repository' }], git: true },
  capabilities: {
    // Definitions connectors discover nothing: Integrations lists the groups a test read finds.
    discover: false,
    incremental: false,
    // Each read lists every definition, so one that is gone is marked missing.
    deletions: 'full-listing',
    domain: 'hint',
    // `meaning` when the change mark sees the calculation, `metadata` when it cannot (CON-505).
    marks: 'meaning',
    // `by-name` when same-named dimensions of different groups are one dimension in the tool,
    // `never` when each group's is its own (CON-201).
    mergeDimensions: 'never',
    // True when `read` works from `ctx.folder` with no settings: whoever runs the server can then
    // name a folder for it (HEED_SERVER_FOLDERS). Leave it out, and the core never hands one.
    serverFolder: true,
  },
  schedule: { default: 'PT1H', minimum: 'PT15M' },
  staleAfter: 'PT6H',
  limits: { timeoutSeconds: 90, maxRecords: 100_000 },
  // Its own warnings and failures, worded here, sent as `template.<code>`.
  warnings: {
    not_this_format: {
      level: 'warning',
      title: 'This is not an example metrics file',
      detail: 'Point the file setting at the metrics file the tool writes.',
    },
    description_cut: {
      level: 'info',
      title: 'A description was cut',
      detail: 'Only the first 500 characters of a description are kept, as a copy.',
    },
    unresolved_metric: {
      level: 'warning',
      title: 'A metric is built on one the file does not hold',
      detail:
        'It is left out, and the read is in part, so what was read of it before stays as it was.',
    },
  },
  // Move it when the connector changes how it computes marks (CON-116).
  markVersion: 1,
})
