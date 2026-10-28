import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll } from 'vitest'
import { builtInConnectors } from '../../../src/connectors/index.ts'
import { builtInFolder, describeConnector, type FixtureSource } from './kit.ts'
import { gitHost, type GitHost } from './git-server.ts'

/*
  The conformance kit against every connector built into this repository (CON-108): a new
  connector is added here with its fixture, and passes before it ships.
*/

const TOKEN = 'kit-token-91c2ef'
let host: GitHost

beforeAll(async () => {
  host = await gitHost({ token: TOKEN })
  await host.repository('handbook', {
    'docs/sales/orders.md': '# Orders in Norway\n\nOrders in Norway include the marketplace.\n',
    'docs/sales/returns/returns.md': '# Returns\n\nReturns are counted on the day they arrive.\n',
    'docs/marketing/spend.md': '# Spend\n\nMarketing spend is booked monthly.\n',
    'docs/notes.txt': 'Not Markdown.',
  })
  const model = await readFile(new URL('../../fixtures/cube/model.yml', import.meta.url), 'utf8')
  await host.repository('analytics', { 'cube/model/model.yml': model, 'README.md': '# Model' })
  await host.repository('analytics-partial', {
    'cube/model/model.yml': model,
    'cube/model/macros.js': 'module.exports = {}',
  })
}, 60_000)
afterAll(async () => {
  await host.close()
})

const module = (id: string) => builtInConnectors.find((candidate) => candidate.manifest.id === id)!

describeConnector(module('static-definitions'), {
  folder: builtInFolder('static-definitions'),
  good: () => ({
    config: {
      definitions:
        '[{ "kind": "metric", "name": "payments.orders", "title": "Orders" }, { "kind": "dimension", "name": "payments.market" }]',
    },
    secrets: {},
  }),
  invalid: [
    { config: { definitions: 'not json' }, field: 'definitions' },
    { config: { definitions: '[]' }, field: 'definitions' },
  ],
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

describeConnector(module('cube'), {
  folder: builtInFolder('cube'),
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
  partial: () => ({
    ...analytics(TOKEN),
    config: { ...analytics(TOKEN).config, repository: host.address('analytics-partial') },
  }),
  calculation: 'example_orders',
  planted: TOKEN,
  // Each read compiles the model in the worker: seconds on a busy machine.
  timeout: 120_000,
})
