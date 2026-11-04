import { defineManifest } from '../../domain/define-manifest.ts'

const storage = { field: 'location', equals: 'storage' }
const signedByKey = { field: 'provider', equals: ['s3', 's3-compatible', 'gcs'] }
const inGit = { field: 'location', equals: 'git' }

/**
 * dbt MetricFlow definitions (CON-701 to CON-708): the `semantic_manifest.json` a dbt project
 * writes, read from an https address, from an object in S3, an S3-compatible store, Google Cloud
 * Storage or Azure Blob, from a Git repository an admin names, or from the folder whoever runs the
 * server names (`HEED_SERVER_FOLDERS`). Its metrics and dimensions become the definitions Heed
 * checks context against. A read takes that one file: never dbt itself, dbt Cloud, a warehouse or
 * data, and it keeps no calculation and no value.
 */
export const manifest = defineManifest({
  id: 'dbt-metricflow',
  version: '1.1.0',
  heed: '^3.3',
  kind: 'definitions',
  tool: 'dbt',
  title: 'dbt MetricFlow definitions',
  summary: 'Metrics and dimensions, read from the semantic manifest your dbt pipeline writes.',
  icon: 'database',
  docs: './README.md',
  maintainer: { name: 'Core team' },
  support: 'core',
  maturity: 'experimental',
  refPrefix: 'dbt',
  config: {
    fields: [
      {
        key: 'location',
        kind: 'radio',
        label: 'Where the file lives',
        description:
          'dbt writes target/semantic_manifest.json. Tell us where your pipeline puts it, and we read that one file.',
        required: true,
        default: 'address',
        options: [
          {
            value: 'address',
            label: 'Address',
            description:
              'An https link to the file: a public file, a signed link, or your artifact server.',
            recipe: {
              lead: 'Upload target/semantic_manifest.json from your pipeline, then make a link to it. A signed link stops working when it expires (7 days at most on S3 and Google Cloud Storage), so for a source that lasts, use Object storage or a link that does not expire.',
              code: `dbt parse
aws s3 cp target/semantic_manifest.json \\
  s3://your-bucket/dbt/semantic_manifest.json
aws s3 presign \\
  s3://your-bucket/dbt/semantic_manifest.json \\
  --expires-in 604800`,
            },
          },
          {
            value: 'storage',
            label: 'Object storage',
            description:
              'An object in S3, Google Cloud Storage or Azure Blob, with a read-only key.',
          },
          {
            value: 'git',
            label: 'Git repository',
            description: 'A folder or branch your pipeline commits the file to.',
            recipe: {
              lead: 'Commit target/semantic_manifest.json from your pipeline, then make a token that can read this repository and nothing else.',
              code: `dbt parse
mkdir -p semantic
cp target/semantic_manifest.json semantic/semantic_manifest.json
git add semantic/semantic_manifest.json
git diff --cached --quiet || git commit -m "Update the semantic manifest"
git push`,
            },
          },
          {
            value: 'folder',
            label: 'Server folder',
            description: 'A folder on the machine that runs this service.',
            serverOnly: true,
            recipe: {
              lead: 'Whoever runs the service sets this up, so there is nothing to fill in here. Copy target/semantic_manifest.json to a folder on that machine and name it in the service’s settings: it then shows here as one of the server’s own sources.',
              code: `HEED_SERVER_FOLDERS='{"dbt-metricflow":"/srv/dbt/target"}'`,
            },
          },
        ],
      },
      {
        key: 'provider',
        kind: 'select',
        label: 'Storage service',
        description: 'Where the object is kept. It decides how we sign the read.',
        required: true,
        default: 's3',
        visibleIf: storage,
        options: [
          {
            value: 's3',
            label: 'Amazon S3',
            recipe: {
              lead: 'Upload target/semantic_manifest.json from your pipeline, then give us an access key whose policy allows only s3:GetObject on that object.',
              code: `dbt parse
aws s3 cp target/semantic_manifest.json \\
  s3://your-bucket/dbt/semantic_manifest.json`,
            },
          },
          {
            value: 's3-compatible',
            label: 'S3-compatible store',
            description: 'MinIO, Cloudflare R2 and other stores that speak the S3 API.',
            recipe: {
              lead: 'Upload target/semantic_manifest.json from your pipeline, then give us an access key that can read that object and nothing else.',
              code: `dbt parse
aws s3 cp target/semantic_manifest.json \\
  s3://your-bucket/dbt/semantic_manifest.json \\
  --endpoint-url https://storage.example.com`,
            },
          },
          {
            value: 'gcs',
            label: 'Google Cloud Storage',
            recipe: {
              lead: 'Upload target/semantic_manifest.json from your pipeline, then make an HMAC key for a service account that has only the Storage Object Viewer role on that bucket.',
              code: `dbt parse
gcloud storage cp target/semantic_manifest.json \\
  gs://your-bucket/dbt/semantic_manifest.json
gcloud storage hmac create \\
  reader@your-project.iam.gserviceaccount.com`,
            },
          },
          {
            value: 'azure',
            label: 'Azure Blob Storage',
            recipe: {
              lead: 'Upload target/semantic_manifest.json from your pipeline, then make a shared access signature for that blob with read permission only.',
              code: `dbt parse
az storage blob upload --account-name youraccount --container-name dbt \\
  --name semantic_manifest.json --file target/semantic_manifest.json --overwrite
az storage blob generate-sas --account-name youraccount --container-name dbt \\
  --name semantic_manifest.json --permissions r --expiry 2027-12-31 --output tsv`,
            },
          },
        ],
      },
      {
        key: 'objectAddress',
        kind: 'address',
        label: 'File address',
        description:
          'The https address of the object, with no signature or query: the keys below go in their own fields.',
        required: true,
        placeholder: 'https://your-bucket.s3.eu-west-1.amazonaws.com/dbt/semantic_manifest.json',
        visibleIf: storage,
      },
      {
        key: 'region',
        kind: 'text',
        label: 'Region',
        description:
          'The region your store signs for. An Amazon S3 address that names its region needs none. Leave it empty for us-east-1, which most stores with no regions accept.',
        pattern: '^[a-z0-9-]{1,40}$',
        patternMessage: 'Use lowercase letters, digits and dashes, such as us-east-1.',
        visibleIf: { field: 'provider', equals: ['s3', 's3-compatible'] },
      },
      {
        key: 'repository',
        kind: 'address',
        label: 'Repository',
        description: 'The https address of the Git repository that holds the semantic manifest.',
        required: true,
        placeholder: 'https://git.example.com/analytics/shop-metrics.git',
        visibleIf: inGit,
      },
      {
        key: 'ref',
        kind: 'ref',
        label: 'Branch, tag or commit',
        description:
          'We read the file as it is there. A tag or a commit stays the same, and a branch moves with each change.',
        required: true,
        default: 'main',
        visibleIf: inGit,
      },
      {
        key: 'folder',
        kind: 'path',
        label: 'Folder',
        description:
          'The folder of the repository that holds the file, such as semantic. Leave it empty when it is at the top.',
        visibleIf: inGit,
      },
      {
        key: 'file',
        kind: 'path',
        label: 'File',
        description:
          'The file dbt writes to target/semantic_manifest.json, as your project keeps it.',
        required: true,
        default: 'semantic_manifest.json',
        visibleIf: inGit,
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
        visibleIf: inGit,
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
      visibleIf: inGit,
    },
    {
      key: 'fileAddress',
      label: 'File address',
      description:
        'The https address of the file. A signed link is as good as a key, so we keep it in a secret store and never show it again.',
      required: true,
      // The address is where it goes. Moving to another route forgets it.
      boundTo: ['location'],
      visibleIf: { field: 'location', equals: 'address' },
    },
    {
      key: 'accessKey',
      label: 'Access key',
      description: 'The id of a key that can read this object and nothing else.',
      required: true,
      boundTo: ['objectAddress', 'provider'],
      visibleIf: signedByKey,
    },
    {
      key: 'secretKey',
      label: 'Secret key',
      description:
        'The key’s secret. We keep it in a secret store, sign each read with it, and never show it again.',
      required: true,
      boundTo: ['objectAddress', 'provider'],
      visibleIf: signedByKey,
    },
    {
      key: 'sasToken',
      label: 'Shared access signature',
      description:
        'A signature with read permission only, for this blob or its container. We keep it in a secret store and never show it again.',
      required: true,
      boundTo: ['objectAddress', 'provider'],
      visibleIf: { field: 'provider', equals: 'azure' },
    },
  ],
  access: [
    'Read access to this one file, or the repository that holds it. We never write to it.',
    'A read takes only the semantic manifest file: never dbt, dbt Cloud, a warehouse or data.',
    'No calculation and no value is kept.',
  ],
  egress: {
    hosts: [
      { fromField: 'repository' },
      { fromField: 'objectAddress' },
      { fromSecret: 'fileAddress' },
    ],
    git: true,
  },
  capabilities: {
    discover: false,
    // A read asks whether an address's or an object's file changed since the last.
    incremental: true,
    deletions: 'full-listing',
    domain: 'hint',
    marks: 'meaning',
    // Each semantic model's dimensions are its own: `orders.status` is not `customers.status`.
    mergeDimensions: 'never',
    serverFolder: true,
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
    not_read_only: {
      level: 'warning',
      title: 'This signature can do more than read',
      detail: 'Make a shared access signature with read permission only: sp=r.',
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
