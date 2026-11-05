import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll } from 'vitest'
import { manifest as templateManifest } from '../../../src/connectors/_template/manifest.ts'
import { runtime as templateRuntime } from '../../../src/connectors/_template/runtime.ts'
import { builtInConnectors } from '../../../src/connectors/index.ts'
import { defineConnector } from '../../../src/domain/connector-runtime.ts'
import {
  deepReorder,
  legacyManifest,
  otherTarget,
  withChangedRevenue,
  withMissingInput,
} from './dbt-metricflow-fixture.ts'
import { builtInFolder, describeConnector, type FixtureSource } from './kit.ts'
import { driveHost, type DriveHost } from './drive-server.ts'
import { gitHost, type GitHost } from './git-server.ts'
import { objectHost, type ObjectHost } from './object-server.ts'

/*
  The conformance kit against every connector built into this repository (CON-108): a new
  connector is added here with its fixture, and passes before it ships. So is the template
  (src/connectors/_template/), so what an author copies always works.
*/

const TOKEN = 'kit-token-91c2ef'
/** The token Cube's data API takes in the kit, invented here. */
const CUBE_TOKEN = 'kit-cube-token-5d0a7b'
let host: GitHost
let store: ObjectHost
/** Cube's `/v1/load` for the kit: one measure's figure, and what reached it. */
let cubeApi: Server
const cubeRequests: { host: string; authorization: string | null }[] = []
let drive: DriveHost
/** The fake Drive's folders and documents, by name. */
const driveIds: Record<string, string> = {}
let driveKey = ''
/** A folder on this machine that holds each file a connector reads as `ctx.folder`. */
let serverFolder = ''

beforeAll(async () => {
  cubeApi = createServer((req, res) => {
    cubeRequests.push({
      host: req.headers.host ?? '',
      authorization: req.headers.authorization ?? null,
    })
    res.setHeader('content-type', 'application/json')
    if (req.headers.authorization !== CUBE_TOKEN) {
      res.statusCode = 401
      res.end(JSON.stringify({ error: 'Invalid token' }))
      return
    }
    res.end(
      JSON.stringify({
        data: [{ 'orders.orders': '43600' }],
        lastRefreshTime: '2026-10-23T06:00:00.000Z',
        annotation: { measures: { 'orders.orders': { title: 'Orders', type: 'number' } } },
      }),
    )
  })
  await new Promise<void>((resolve) => cubeApi.listen(0, '127.0.0.1', resolve))
  host = await gitHost({ token: TOKEN })
  await host.repository('handbook', {
    'docs/sales/orders.md': '# Orders in Norway\n\nOrders in Norway include the marketplace.\n',
    'docs/sales/returns/returns.md': '# Returns\n\nReturns are counted on the day they arrive.\n',
    'docs/marketing/spend.md': '# Spend\n\nMarketing spend is booked monthly.\n',
    'docs/notes.txt': 'Not Markdown.',
  })
  const model = await readFile(
    new URL('../../fixtures/cube/model/model.yml', import.meta.url),
    'utf8',
  )
  await host.repository('analytics', { 'cube/model/model.yml': model, 'README.md': '# Model' })
  await host.repository('analytics-partial', {
    'cube/model/model.yml': model,
    'cube/model/macros.js': 'module.exports = {}',
  })
  // The same model with a comment, its keys in another order and other quotes: the same meaning.
  await host.repository('analytics-reformatted', {
    'cube/model/model.yml': `# The invented shop's model.\n${model
      .replace(
        '        type: sum\n        sql: amount\n',
        '        sql: "amount"\n        type: sum\n',
      )
      .replace(
        '      - name: country\n        type: string\n',
        "      - type: 'string'\n        name: country\n",
      )}`,
  })
  // Revenue worked out another way: it moves, and every view member that is revenue moves too.
  await host.repository('analytics-changed', {
    'cube/model/model.yml': model.replace('        sql: amount\n', '        sql: amount * 0.8\n'),
  })
  // The model written as JSON: a format the connector does not read.
  await host.repository('analytics-json', {
    'cube/model/model.json': JSON.stringify({ cubes: [{ name: 'orders' }] }),
  })
  const metrics = JSON.parse(
    await readFile(new URL('../../fixtures/template/metrics.json', import.meta.url), 'utf8'),
  ) as TemplateFile
  await host.repository('example-metrics', { 'metrics/metrics.json': JSON.stringify(metrics) })
  await host.repository('example-reformatted', {
    'metrics/metrics.json': JSON.stringify(reordered(metrics), null, 4),
  })
  await host.repository('example-changed', {
    'metrics/metrics.json': JSON.stringify(withRevenue(metrics, 'sum(amount - refunded)')),
  })
  await host.repository('example-partial', {
    'metrics/metrics.json': JSON.stringify(withoutRevenue(metrics)),
  })
  await host.repository('example-wrong', { 'metrics/metrics.json': '{ "metrics": [] }' })
  serverFolder = await mkdtemp(join(tmpdir(), 'heed-kit-folder-'))
  await writeFile(join(serverFolder, 'metrics.json'), JSON.stringify(metrics))
  await writeFile(join(serverFolder, 'semantic_manifest.json'), JSON.stringify(legacyManifest))
  const semantic = (file: unknown, space?: number) => ({
    'semantic/semantic_manifest.json': JSON.stringify(file, null, space),
  })
  await host.repository('shop-metrics', semantic(legacyManifest))
  await host.repository(
    'shop-metrics-reformatted',
    semantic(deepReorder(otherTarget(legacyManifest)), 4),
  )
  await host.repository('shop-metrics-changed', semantic(withChangedRevenue(legacyManifest)))
  await host.repository('shop-metrics-partial', semantic(withMissingInput(legacyManifest)))
  // dbt's other artifact, where these lists are objects: what a wrong file setting points at.
  await host.repository(
    'shop-metrics-wrong',
    semantic({ metadata: {}, nodes: {}, semantic_models: {}, metrics: {} }),
  )
  // The same files in an object store, each behind a signed link and behind a key.
  store = await objectHost()
  const objects = {
    good: JSON.stringify(legacyManifest),
    reformatted: JSON.stringify(deepReorder(otherTarget(legacyManifest)), null, 4),
    changed: JSON.stringify(withChangedRevenue(legacyManifest)),
    partial: JSON.stringify(withMissingInput(legacyManifest)),
    wrong: JSON.stringify({ metadata: {}, nodes: {}, semantic_models: {}, metrics: {} }),
  }
  for (const [name, text] of Object.entries(objects)) {
    store.put(`/link/${name}.json`, text)
    store.put(`/bucket/${name}.json`, text)
  }
  // Small pages, so every list is read page by page.
  drive = await driveHost({ pageSize: 2 })
  driveKey = drive.key()
  const data = (driveIds.data = drive.folder('Data team'))
  const definitions = (driveIds.definitions = drive.folder('Definitions', data))
  const marketing = (driveIds.marketing = drive.folder('Marketing'))
  driveIds.norway = drive.document(
    'Orders in Norway',
    definitions,
    '# Orders in Norway\n\nOrders in Norway include the marketplace.\n',
  )
  driveIds.returns = drive.document(
    'Returns',
    data,
    '# Returns\n\nReturns are counted on the day they arrive.\n',
  )
  driveIds.spend = drive.document(
    'Spend',
    marketing,
    '# Spend\n\nMarketing spend is booked monthly.\n',
  )
  drive.file('Budget', marketing, 'application/vnd.google-apps.spreadsheet')
  const elsewhere = drive.folder('Not shared', null, { shared: false })
  drive.document('Private', elsewhere, '# Private\n\nNot shared with the account.\n')
}, 60_000)
afterAll(async () => {
  cubeApi.closeAllConnections()
  await new Promise<void>((resolve) => cubeApi.close(() => resolve()))
  await host.close()
  await store.close()
  await drive.close()
  await rm(serverFolder, { recursive: true, force: true })
})

const module = (id: string) => builtInConnectors.find((candidate) => candidate.manifest.id === id)!

const list = await readFile(
  new URL('../../fixtures/static-definitions/list.json', import.meta.url),
  'utf8',
)
type Entry = Record<string, string>
const staticList = (entries: Entry[] = JSON.parse(list) as Entry[], space = 2): FixtureSource => ({
  config: { definitions: JSON.stringify(entries, null, space), domainNames: { Money: 'finance' } },
  secrets: {},
})

describeConnector(module('static-definitions'), {
  folder: builtInFolder('static-definitions'),
  good: () => staticList(),
  invalid: [
    { config: { definitions: 'not json' }, field: 'definitions' },
    { config: { definitions: '[]' }, field: 'definitions' },
  ],
  expected: new URL('../../fixtures/static-definitions/definitions.json', import.meta.url),
  // The same entries in another order, their keys reversed, on one line.
  reformat: () =>
    staticList(
      (JSON.parse(list) as Entry[])
        .reverse()
        .map((entry) => Object.fromEntries(Object.entries(entry).reverse())),
      0,
    ),
  meaningChange: () => ({
    source: staticList(
      (JSON.parse(list) as Entry[]).map((entry) =>
        entry.name === 'payments.orders'
          ? { ...entry, description: 'Every order paid for and not refunded.' }
          : entry,
      ),
    ),
    moved: ['static:payments.orders'],
  }),
  wrongFormat: () => ({
    config: { definitions: '{ "metrics": [{ "name": "payments.orders" }] }' },
    secrets: {},
  }),
})

const handbook = (token: string | null): FixtureSource => ({
  config: {
    repository: host.address('handbook'),
    ref: 'main',
    folder: 'docs',
    fileLink: 'https://git.example.test/handbook/blob/{commit}/{path}',
  },
  secrets: token === null ? {} : { token },
  scopes: [
    { id: 'sales', title: 'docs/sales', domain: 'sales' },
    { id: 'marketing', title: 'docs/marketing', domain: 'marketing' },
  ],
})

describeConnector(module('git-markdown'), {
  folder: builtInFolder('git-markdown'),
  good: () => handbook(TOKEN),
  refused: () => handbook('not-the-token'),
  unreachable: () => ({
    ...handbook(TOKEN),
    config: { ...handbook(TOKEN).config, repository: 'http://127.0.0.1:9/nothing.git' },
  }),
  invalid: [
    { config: { ref: 'main' }, field: 'repository' },
    { config: { repository: 'ftp://git.example.test/a.git', ref: 'main' }, field: 'repository' },
    {
      config: { repository: 'https://git.example.test/a.git', ref: '--upload-pack' },
      field: 'ref',
    },
    {
      config: { repository: 'https://git.example.test/a.git', ref: 'main', folder: '../up' },
      field: 'folder',
    },
    {
      config: {
        repository: 'https://git.example.test/a.git',
        ref: 'main',
        fileLink: 'http://git.example.test/{path}',
      },
      field: 'fileLink',
    },
  ],
  planted: TOKEN,
})

const analytics = (token: string | null): FixtureSource => ({
  config: { repository: host.address('analytics'), ref: 'main', folder: 'cube/model' },
  secrets: token === null ? {} : { token },
})
/** The model of another repository of the test host, with the token. */
const analyticsAt = (repository: string): FixtureSource => ({
  ...analytics(TOKEN),
  config: { ...analytics(TOKEN).config, repository: host.address(repository) },
})

describeConnector(module('cube'), {
  folder: builtInFolder('cube'),
  serverFolder: () => fileURLToPath(new URL('../../fixtures/cube/model/', import.meta.url)),
  good: () => analytics(TOKEN),
  refused: () => analytics('not-the-token'),
  unreachable: () => ({
    ...analytics(TOKEN),
    config: { ...analytics(TOKEN).config, repository: 'http://127.0.0.1:9/nothing.git' },
  }),
  invalid: [
    { config: { ref: 'main' }, field: 'repository' },
    { config: { repository: 'ftp://git.example.test/a.git', ref: 'main' }, field: 'repository' },
    {
      config: { repository: 'https://user:pass@git.example.test/a.git', ref: 'main' },
      field: 'repository',
    },
    {
      config: { repository: 'https://git.example.test/a.git', ref: '--upload-pack' },
      field: 'ref',
    },
    {
      config: { repository: 'https://git.example.test/a.git', ref: 'main', folder: '../up' },
      field: 'folder',
    },
    {
      config: { repository: 'https://git.example.test/a.git', ref: 'main', username: 'a b' },
      field: 'username',
    },
    {
      config: {
        repository: 'https://git.example.test/a.git',
        ref: 'main',
        domainNames: { marketing: 'Not a domain' },
      },
      field: 'domainNames',
    },
  ],
  partial: () => analyticsAt('analytics-partial'),
  calculation: ['example_orders', 'SELECT amount, country FROM'],
  expected: new URL('../../fixtures/cube/definitions.json', import.meta.url),
  reformat: () => analyticsAt('analytics-reformatted'),
  meaningChange: () => ({
    source: analyticsAt('analytics-changed'),
    moved: [
      'cube:growth.revenue',
      'cube:marketing.orders_income',
      'cube:operations.revenue',
      'cube:sales.revenue',
    ],
  }),
  wrongFormat: () => analyticsAt('analytics-json'),
  planted: TOKEN,
  figures: () => ({
    endpoint: `http://127.0.0.1:${(cubeApi.address() as AddressInfo).port}/cubejs-api/v1/load`,
    token: CUBE_TOKEN,
    refusedToken: 'not-the-cube-token',
    query: {
      metric: 'orders.orders',
      date: 'orders.order_day',
      from: '2026-08-01',
      to: '2026-08-31',
      filters: [{ dimension: 'orders.market', values: ['Norway'] }],
    },
    value: 43600,
    requests: () => cubeRequests,
  }),
  // Each read compiles the model in the worker: seconds on a busy machine.
  timeout: 120_000,
})

const driveSource = (key: string, address = drive.address, signIn = drive.signInAddress) => ({
  config: { apiAddress: address, signInAddress: signIn },
  secrets: { serviceAccountKey: key },
  scopes: [
    { id: driveIds.data!, title: 'Data team', domain: 'sales' },
    { id: driveIds.marketing!, title: 'Marketing', domain: 'marketing' },
  ],
})

const dbtSource = (name: string, token: string | null = TOKEN): FixtureSource => ({
  config: {
    location: 'git',
    repository: host.address(name),
    ref: 'main',
    folder: 'semantic',
    file: 'semantic_manifest.json',
  },
  secrets: token === null ? {} : { token },
})

describeConnector(module('dbt-metricflow'), {
  folder: builtInFolder('dbt-metricflow'),
  good: () => dbtSource('shop-metrics'),
  refused: () => dbtSource('shop-metrics', 'not-the-token'),
  unreachable: () => ({
    ...dbtSource('shop-metrics'),
    config: { ...dbtSource('shop-metrics').config, repository: 'http://127.0.0.1:9/nothing.git' },
  }),
  invalid: [
    { config: {}, field: 'location' },
    { config: { location: 'folder' }, field: 'location' },
    { config: { location: 'git', ref: 'main' }, field: 'repository' },
    {
      config: { location: 'git', repository: 'ftp://git.example.test/a.git', ref: 'main' },
      field: 'repository',
    },
    {
      config: {
        location: 'git',
        repository: 'https://user:pass@git.example.test/a.git',
        ref: 'main',
      },
      field: 'repository',
    },
    {
      config: {
        location: 'git',
        repository: 'https://git.example.test/a.git',
        ref: '--upload-pack',
      },
      field: 'ref',
    },
    {
      config: {
        location: 'git',
        repository: 'https://git.example.test/a.git',
        ref: 'main',
        folder: '../up',
      },
      field: 'folder',
    },
    {
      config: {
        location: 'git',
        repository: 'https://git.example.test/a.git',
        ref: 'main',
        file: 'a/../../b',
      },
      field: 'file',
    },
    {
      config: {
        location: 'git',
        repository: 'https://git.example.test/a.git',
        ref: 'main',
        domainNames: { 'Customer Care': 'Not a domain' },
      },
      field: 'domainNames',
    },
    { config: { location: 'storage', provider: 's3' }, field: 'objectAddress' },
    {
      config: {
        location: 'storage',
        provider: 's3',
        objectAddress: 'https://bucket.example.test/file.json?X-Amz-Signature=abc',
      },
      field: 'objectAddress',
    },
    {
      config: {
        location: 'storage',
        provider: 's3-compatible',
        objectAddress: 'https://store.example.test/bucket/file.json',
        region: 'Not A Region',
      },
      field: 'region',
    },
  ],
  partial: () => dbtSource('shop-metrics-partial'),
  calculation: [
    'case when',
    '0.6 * amount',
    "'completed'",
    'nullif',
    'revenue - discounts',
    'Dimension(',
    'order_id',
    'example_db',
    'example_schema',
  ],
  expected: new URL('../../fixtures/dbt-metricflow/definitions.json', import.meta.url),
  reformat: () => dbtSource('shop-metrics-reformatted'),
  meaningChange: () => ({
    source: dbtSource('shop-metrics-changed'),
    moved: [
      'dbt:_shared.revenue_per_customer',
      'dbt:orders.average_order_value',
      'dbt:orders.net_revenue',
      'dbt:orders.revenue',
      'dbt:orders.revenue_to_date',
    ],
  }),
  wrongFormat: () => dbtSource('shop-metrics-wrong'),
  serverFolder: () => serverFolder,
  planted: TOKEN,
})

const dbtCalculations = [
  'case when',
  '0.6 * amount',
  "'completed'",
  'nullif',
  'revenue - discounts',
  'Dimension(',
  'order_id',
  'example_db',
  'example_schema',
]
const dbtMoved = [
  'dbt:_shared.revenue_per_customer',
  'dbt:orders.average_order_value',
  'dbt:orders.net_revenue',
  'dbt:orders.revenue',
  'dbt:orders.revenue_to_date',
]

/** dbt's file at a signed link: the link itself is the source's secret. */
const dbtLink = (name: string): FixtureSource => ({
  config: { location: 'address' },
  secrets: { fileAddress: store.link(`/link/${name}.json`) },
})

describeConnector(
  module('dbt-metricflow'),
  {
    folder: builtInFolder('dbt-metricflow'),
    good: () => dbtLink('good'),
    refused: () => ({
      config: { location: 'address' },
      secrets: { fileAddress: store.address('/link/good.json?sig=not-the-signature') },
    }),
    unreachable: () => ({
      config: { location: 'address' },
      secrets: { fileAddress: 'http://127.0.0.1:9/semantic_manifest.json' },
    }),
    partial: () => dbtLink('partial'),
    calculation: dbtCalculations,
    expected: new URL('../../fixtures/dbt-metricflow/definitions.json', import.meta.url),
    reformat: () => dbtLink('reformatted'),
    meaningChange: () => ({ source: dbtLink('changed'), moved: dbtMoved }),
    wrongFormat: () => dbtLink('wrong'),
    planted: () => store.link('/link/good.json').split('?')[1],
  },
  'its file at an address',
)

/** dbt's file as an object, read with the store's own key. */
const dbtObject = (name: string, secretKey = store.secretKey): FixtureSource => ({
  config: {
    location: 'storage',
    provider: 's3-compatible',
    objectAddress: store.address(`/bucket/${name}.json`),
  },
  secrets: { accessKey: store.accessKey, secretKey },
})

describeConnector(
  module('dbt-metricflow'),
  {
    folder: builtInFolder('dbt-metricflow'),
    good: () => dbtObject('good'),
    refused: () => dbtObject('good', 'not-the-secret-key'),
    unreachable: () => ({
      ...dbtObject('good'),
      config: { ...dbtObject('good').config, objectAddress: 'http://127.0.0.1:9/bucket/file.json' },
    }),
    partial: () => dbtObject('partial'),
    calculation: dbtCalculations,
    expected: new URL('../../fixtures/dbt-metricflow/definitions.json', import.meta.url),
    reformat: () => dbtObject('reformatted'),
    meaningChange: () => ({ source: dbtObject('changed'), moved: dbtMoved }),
    wrongFormat: () => dbtObject('wrong'),
    planted: () => store.secretKey,
  },
  'its file in object storage',
)

describeConnector(module('google-drive'), {
  folder: builtInFolder('google-drive'),
  good: () => driveSource(driveKey),
  refused: () => driveSource(drive.strangerKey()),
  unreachable: () => driveSource(driveKey, 'http://127.0.0.1:9', 'http://127.0.0.1:9/token'),
  invalid: [
    { config: { apiAddress: 'ftp://drive.example.test' }, field: 'apiAddress' },
    {
      config: { signInAddress: 'https://user:pw@drive.example.test/token' },
      field: 'signInAddress',
    },
    { config: { serviceAccountKey: '{}' }, field: 'serviceAccountKey' },
  ],
  // A line of the invented private key: none of it may show in anything a read returns.
  planted: () => (JSON.parse(driveKey) as { private_key: string }).private_key.split('\n').at(5),
  delta: () => {
    drive.edit(
      driveIds.norway!,
      '# Orders in Norway\n\nOrders in Norway include the marketplace and the shop.\n',
    )
    drive.trash(driveIds.spend!)
    return Promise.resolve({ edited: driveIds.norway!, removed: driveIds.spend! })
  },
})

/** The template's metrics file (tests/fixtures/template/metrics.json), as far as the kit edits it. */
type TemplateFile = {
  environment: Record<string, string>
  groups: { name: string; metrics: { name: string; expr: string; inputs?: string[] }[] }[]
}

/** The file with every key in reverse order, its groups too, built for another warehouse. */
function reordered(file: TemplateFile): unknown {
  const reverse = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(reverse)
      : typeof value === 'object' && value !== null
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([k, v]) => [k, reverse(v)]),
          )
        : value
  const moved = reverse(file) as TemplateFile
  return {
    ...moved,
    groups: [...moved.groups].reverse(),
    environment: { schema: 'analytics_test', database: 'another_invented_warehouse' },
  }
}

/** The file with revenue worked out another way. */
const withRevenue = (file: TemplateFile, expr: string): TemplateFile => ({
  ...file,
  groups: file.groups.map((group) => ({
    ...group,
    metrics: group.metrics.map((metric) =>
      metric.name === 'revenue' ? { ...metric, expr } : metric,
    ),
  })),
})

/** The file without revenue, which average order value is built on. */
const withoutRevenue = (file: TemplateFile): TemplateFile => ({
  ...file,
  groups: file.groups.map((group) => ({
    ...group,
    metrics: group.metrics.filter((metric) => metric.name !== 'revenue'),
  })),
})

const example = (repository: string, token: string | null = TOKEN): FixtureSource => ({
  config: {
    repository: host.address(repository),
    ref: 'main',
    folder: 'metrics',
    file: 'metrics.json',
  },
  secrets: token === null ? {} : { token },
})

describeConnector(defineConnector(templateManifest, templateRuntime), {
  folder: new URL('../../../src/connectors/_template/', import.meta.url),
  good: () => example('example-metrics'),
  refused: () => example('example-metrics', 'not-the-token'),
  unreachable: () => ({
    ...example('example-metrics'),
    config: { ...example('example-metrics').config, repository: 'http://127.0.0.1:9/nothing.git' },
  }),
  invalid: [
    { config: { ref: 'main' }, field: 'repository' },
    { config: { repository: 'ftp://git.example.test/a.git', ref: 'main' }, field: 'repository' },
    {
      config: { repository: 'https://user:pass@git.example.test/a.git', ref: 'main' },
      field: 'repository',
    },
    {
      config: { repository: 'https://git.example.test/a.git', ref: '--upload-pack' },
      field: 'ref',
    },
    {
      config: { repository: 'https://git.example.test/a.git', ref: 'main', folder: '../up' },
      field: 'folder',
    },
    {
      config: { repository: 'https://git.example.test/a.git', ref: 'main', file: 'a/../../b' },
      field: 'file',
    },
    {
      config: {
        repository: 'https://git.example.test/a.git',
        ref: 'main',
        domainNames: { 'Customer Care': 'Not a domain' },
      },
      field: 'domainNames',
    },
  ],
  partial: () => example('example-partial'),
  calculation: [
    'count(distinct order_id)',
    "sum(amount) filter (where status = 'completed')",
    'revenue / nullif(orders, 0)',
    "case when channel = 'web'",
    "case when tier = 'gold'",
    'invented_warehouse',
    'analytics_prod',
  ],
  expected: new URL('../../fixtures/template/definitions.json', import.meta.url),
  reformat: () => example('example-reformatted'),
  meaningChange: () => ({
    source: example('example-changed'),
    moved: ['example:orders.revenue', 'example:orders.average_order_value'],
  }),
  wrongFormat: () => example('example-wrong'),
  serverFolder: () => serverFolder,
  planted: TOKEN,
})
