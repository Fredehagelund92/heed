import { defineManifest } from '../../domain/define-manifest.ts'

/**
 * dbt MetricFlow definitions (CON-701 to CON-708): the `semantic_manifest.json` a dbt project
 * writes, read from a Git repository an admin names, or from the folder whoever runs the server
 * names. Its metrics and dimensions become the definitions Heed checks context against. A read
 * takes that one file: never dbt itself, dbt Cloud, a warehouse or data, and it keeps no
 * calculation and no value.
 */
export const manifest = defineManifest({
  id: 'dbt-metricflow',
  version: '1.0.0',
  heed: '^3.1',
  kind: 'definitions',
  tool: 'dbt',
  title: 'dbt MetricFlow definitions in a Git repository',
  summary: 'Metrics and dimensions, read from dbt’s semantic manifest in Git.',
  icon: 'database',
  docs: './README.md',
  maintainer: { name: 'Core team' },
  support: 'core',
  maturity: 'experimental',
  refPrefix: 'dbt',
  config: {
    fields: [
      {
        key: 'repository',
        kind: 'address',
        label: 'Repository',
        description: 'The https address of the Git repository that holds the semantic manifest.',
        required: true,
        placeholder: 'https://git.example.com/analytics/shop-metrics.git',
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
          'The folder of the repository that holds the file, such as semantic. Leave it empty when it is at the top.',
      },
      {
        key: 'file',
        kind: 'path',
        label: 'File',
        description:
          'The file dbt writes to target/semantic_manifest.json, as your project keeps it.',
        required: true,
        default: 'semantic_manifest.json',
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
          'When meta.domain names a domain differently from your domains, choose the domain it means. A name that is already a domain id needs no line.',
        advanced: true,
      },
    ],
  },
  secrets: [
    {
      key: 'token',
      label: 'Read-only token',
      description:
        'A token that can read this repository and nothing else. We keep it in a secret store and never show it again. Leave it empty for a public repository.',
      boundTo: ['repository'],
    },
  ],
  access: [
    'Read access to this one repository. We never write to it.',
    'A read takes only the semantic manifest file: never dbt, dbt Cloud, a warehouse or data.',
    'No calculation and no value is kept.',
  ],
  egress: { hosts: [{ fromField: 'repository' }], git: true },
  capabilities: {
    discover: false,
    incremental: false,
    deletions: 'full-listing',
    domain: 'hint',
    marks: 'meaning',
    // Each semantic model's dimensions are its own: `orders.status` is not `customers.status`.
    mergeDimensions: 'never',
  },
  schedule: { default: 'PT1H', minimum: 'PT15M' },
  staleAfter: 'PT6H',
  limits: { timeoutSeconds: 90, maxRecords: 100_000 },
  warnings: {
    not_a_semantic_manifest: {
      level: 'warning',
      title: 'This is not dbt’s semantic manifest',
      detail: 'Point the file at target/semantic_manifest.json.',
    },
    description_cut: {
      level: 'info',
      title: 'A description was cut',
      detail: 'Only the first 500 characters of a description are kept, as a copy.',
    },
    unknown_type: {
      level: 'info',
      title: 'A type we do not know',
      detail: 'The definition is kept with no type. A newer dbt may have added it.',
    },
    unresolved_metric: {
      level: 'warning',
      title: 'A metric is built on something the file does not hold',
      detail:
        'It is left out, and the read is in part, so what was read of it before stays as it was.',
    },
    same_name: {
      level: 'warning',
      title: 'A metric and a dimension share a name',
      detail: 'Only the metric is kept. Rename one of them in dbt to read both.',
    },
  },
  markVersion: 1,
})
