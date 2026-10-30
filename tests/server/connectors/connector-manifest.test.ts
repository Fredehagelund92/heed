import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkManifest,
  checkManifests,
  durationSeconds,
  satisfiesInterface,
  type ConnectorManifest,
} from '../../../src/domain/connector-manifest.ts'
import {
  connectorConfigDomains,
  parseConnectorConfig,
} from '../../../src/domain/connector-config.ts'
import { builtInManifests } from '../../../src/connectors/manifests.ts'
import { builtInConnectors } from '../../../src/connectors/index.ts'
import {
  parseStaticEntries,
  staticCheckReport,
} from '../../../src/connectors/static-definitions/entries.ts'

/*
  Interface 3.0's manifest (docs/connectors.md, "The manifest"): one schema says what a manifest
  holds, the checks a schema cannot say are worded for the author, and a source's settings are
  checked against the manifest the same way in the form and in the service.
*/

const valid: ConnectorManifest = builtInManifests.find((m) => m.id === 'static-definitions')!
const problemsOf = (manifest: unknown) => {
  const checked = checkManifest(manifest)
  return checked.ok ? [] : checked.problems.map((problem) => `${problem.path}: ${problem.message}`)
}

describe('the built-in connectors', () => {
  it('lists every folder, with the same manifests for the server and the web app', () => {
    const root = resolve('src/connectors')
    const folders = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
      .map((entry) => entry.name)
      .sort()
    expect(builtInConnectors.map((connector) => connector.manifest.id).sort()).toEqual(folders)
    expect(builtInManifests).toEqual(builtInConnectors.map((connector) => connector.manifest))
  })

  it('has manifests that pass the checks, as a set too', () => {
    for (const manifest of builtInManifests) expect(problemsOf(manifest), manifest.id).toEqual([])
    expect(checkManifests(builtInManifests)).toEqual([])
  })

  it('has Cube as a connector of its own, its token a slot bound to the repository', () => {
    const cube = builtInManifests.find((manifest) => manifest.id === 'cube')!
    expect(cube).toMatchObject({
      kind: 'definitions',
      tool: 'Cube',
      refPrefix: 'cube',
      egress: { hosts: [{ fromField: 'repository' }], git: true },
    })
    // Its secret is a slot of its own, bound to where it is sent, never a setting.
    expect(cube.config.fields.map((field) => [field.key, field.kind])).toEqual([
      ['repository', 'address'],
      ['ref', 'ref'],
      ['folder', 'path'],
      ['username', 'text'],
      ['modelUrl', 'address'],
      ['domainNames', 'domain_map'],
    ])
    expect(cube.secrets).toEqual([
      expect.objectContaining({ key: 'token', boundTo: ['repository'] }),
    ])
  })
})

describe('checking a manifest', () => {
  it('refuses an id out of form, a version that is not semver and a range this build does not speak', () => {
    expect(problemsOf({ ...valid, id: 'Static Definitions' })).toEqual([
      'id: Use lowercase letters, digits and dashes, starting with a letter, with at most one dot for a namespace: acme.lookml.',
    ])
    expect(problemsOf({ ...valid, version: 'one' })).toEqual([
      'version: Use a semantic version, such as 1.0.0.',
    ])
    expect(problemsOf({ ...valid, heed: '^2.0' })).toEqual([
      'heed: This build speaks interface 3.0.0, which ^2.0 does not include. Write a range such as ^3.0.',
    ])
    expect(problemsOf({ ...valid, heed: '>=3' })).toHaveLength(1)
    expect(problemsOf({ ...valid, id: 'acme.lookml' })).toEqual([])
  })

  it('refuses a key a manifest does not have, and says which', () => {
    expect(problemsOf({ ...valid, owner: 'me' })).toEqual([
      'manifest: Remove owner: a manifest has no such key.',
    ])
  })

  it('keeps secrets apart from settings and bound to a setting', () => {
    expect(
      problemsOf({
        ...valid,
        secrets: [
          { key: 'definitions', label: 'Key', description: 'A key.', boundTo: ['nowhere'] },
        ],
      }),
    ).toEqual([
      'secrets[0].key: definitions is a setting too. A secret is kept apart from the settings.',
      'secrets[0].boundTo: nowhere is not a setting, so the secret cannot be bound to it.',
    ])
  })

  it("checks each field's options, pattern, bounds, group and default", () => {
    const field = valid.config.fields[0]!
    expect(
      problemsOf({
        ...valid,
        config: {
          fields: [
            field,
            { key: 'mode', kind: 'select', label: 'Mode', description: 'How.' },
            {
              key: 'rows',
              kind: 'integer',
              label: 'Rows',
              description: 'How many.',
              minimum: 5,
              maximum: 1,
            },
            {
              key: 'branch',
              kind: 'text',
              label: 'Branch',
              description: 'Which.',
              pattern: '(',
              group: 'git',
            },
            { key: 'on', kind: 'boolean', label: 'On', description: 'Whether.', default: 'yes' },
            { key: 'name', kind: 'text', label: 'Name', description: 'Taken.' },
          ],
        },
      }),
    ).toEqual([
      'config.fields[1].options: A select field needs its options.',
      'config.fields[2].maximum: Make the maximum at least the minimum.',
      'config.fields[3].pattern: Write a pattern JavaScript can read.',
      'config.fields[3].patternMessage: Say what to write when a value does not match the pattern.',
      'config.fields[3].group: Declare the group git under config.groups.',
      'config.fields[4].default: The default is not a value a boolean field holds.',
      'config.fields[5].key: Every form already has name. Choose another key.',
    ])
  })

  it('holds each kind to its own capabilities and limits', () => {
    expect(
      problemsOf({
        ...valid,
        kind: 'content',
        capabilities: { ...valid.capabilities, domain: 'per-scope' },
      }),
    ).toEqual([
      'refPrefix: Only a definitions connector has a ref prefix.',
      'capabilities.marks: Only a definitions connector has change marks of its own.',
      'limits.draftsPerDay: Say how many drafts a source may make in a day.',
    ])
    const { refPrefix: _prefix, ...unprefixed } = valid
    expect(problemsOf(unprefixed)).toEqual([
      'refPrefix: A definitions connector names the prefix of its refs, such as cube.',
    ])
  })

  it('keeps schedules in order and refuses a warning without words', () => {
    expect(
      problemsOf({
        ...valid,
        schedule: { default: 'PT15M', minimum: 'PT1H' },
        staleAfter: 'PT10M',
      }),
    ).toEqual([
      'schedule.minimum: Make the shortest schedule at most the default one.',
      'staleAfter: Make a source out of date no sooner than its default schedule reads it.',
    ])
    expect(problemsOf({ ...valid, schedule: { default: 'hourly', minimum: 'PT1H' } })).toEqual([
      'schedule.default: Use an ISO 8601 duration of days, hours and minutes, such as PT1H or P1D.',
    ])
    expect(
      problemsOf({ ...valid, warnings: { cut: { level: 'info', title: '', detail: 'x' } } }),
    ).toEqual(['warnings.cut.title: Give it some words.'])
  })

  it('refuses two connectors with one id, and one prefix for two tools', () => {
    expect(
      checkManifests([valid, valid, { ...valid, id: 'other', tool: 'Other' }]).map(
        ({ id, problem }) => `${id} ${problem.path}: ${problem.message}`,
      ),
    ).toEqual([
      'static-definitions id: Another connector has the id static-definitions.',
      'other refPrefix: Static list already writes refs under static:. A prefix belongs to one tool.',
    ])
    // Two connectors for the same tool share its prefix (CON-117).
    expect(checkManifests([valid, { ...valid, id: 'static-cloud' }])).toEqual([])
  })

  it('reads interface ranges and durations as written', () => {
    for (const range of ['^3', '^3.0', '^3.0.0', '3.x', '~3.0'])
      expect(satisfiesInterface(range, '3.0.0'), range).toBe(true)
    for (const range of ['^3.1', '^4.0', '2.x', '~3.1', '3', '*'])
      expect(satisfiesInterface(range, '3.0.0'), range).toBe(false)
    expect(satisfiesInterface('^3.0', '3.2.1')).toBe(true)
    expect(durationSeconds('PT1H')).toBe(3_600)
    expect(durationSeconds('P1DT30M')).toBe(88_200)
    expect(durationSeconds('soon')).toBeNaN()
  })
})

describe("checking a source's settings against its manifest", () => {
  const manifest: ConnectorManifest = {
    ...valid,
    config: {
      fields: [
        { key: 'site', kind: 'address', label: 'Site', description: 'Where.', required: true },
        { key: 'folder', kind: 'path', label: 'Folder', description: 'Which.' },
        { key: 'branch', kind: 'ref', label: 'Branch', description: 'Which.' },
        {
          key: 'mode',
          kind: 'select',
          label: 'Mode',
          description: 'How.',
          options: [
            { value: 'all', label: 'All' },
            { value: 'some', label: 'Some' },
          ],
        },
        {
          key: 'spaces',
          kind: 'list',
          label: 'Spaces',
          description: 'Which.',
          visibleIf: { field: 'mode', equals: 'some' },
          pattern: '^[A-Z]+$',
          patternMessage: 'Use capital letters.',
        },
        { key: 'drafts', kind: 'boolean', label: 'Drafts', description: 'Whether.' },
        {
          key: 'pages',
          kind: 'integer',
          label: 'Pages',
          description: 'How many.',
          minimum: 1,
          maximum: 100,
        },
        { key: 'extra', kind: 'json', label: 'Extra', description: 'More.' },
        { key: 'names', kind: 'domain_map', label: 'Domain names', description: 'Map.' },
      ],
    },
    secrets: [{ key: 'token', label: 'Token', description: 'A token.', boundTo: ['site'] }],
  }

  it('keeps good settings as stored, with empty ones and hidden ones left out', () => {
    expect(
      parseConnectorConfig(manifest, {
        site: ' https://wiki.example.com ',
        folder: '/docs/finance/',
        branch: '',
        mode: 'all',
        spaces: ['FIN'],
        drafts: true,
        pages: '20',
        names: { ' Finance ': 'commercial' },
      }),
    ).toEqual({
      config: {
        site: 'https://wiki.example.com',
        folder: 'docs/finance',
        mode: 'all',
        drafts: true,
        pages: 20,
        names: { Finance: 'commercial' },
      },
    })
  })

  it('keeps a tool name such as constructor or __proto__ as an ordinary domain name', () => {
    const names: unknown = JSON.parse(
      '{"constructor":"sales","__proto__":"commercial","toString":"sales"}',
    )
    const parsed = parseConnectorConfig(manifest, {
      site: 'https://wiki.example.com',
      mode: 'all',
      names,
    })
    expect('config' in parsed).toBe(true)
    const kept = 'config' in parsed ? (parsed.config.names as Record<string, string>) : {}
    expect(Object.keys(kept).sort()).toEqual(['__proto__', 'constructor', 'toString'])
    expect(Object.getOwnPropertyDescriptor(kept, '__proto__')?.value).toBe('commercial')
  })

  it('says what is wrong, by field, in words for the person who wrote it', () => {
    expect(
      parseConnectorConfig(manifest, {
        site: 'http://wiki.example.com',
        folder: '../etc',
        branch: '--upload-pack=x',
        mode: 'many',
        pages: 500,
        extra: '{',
        names: { sales: 'Sales Team' },
        token: 'pasted',
        other: 'x',
      }),
    ).toEqual({
      problems: [
        { field: 'token', message: 'A secret goes in its own field only.' },
        { field: 'other', message: 'This source has no such setting.' },
        {
          field: 'site',
          message:
            'Use an https address, without a user name, password, query or fragment. A secret goes in its own field.',
        },
        { field: 'folder', message: 'Name a folder inside it, such as model or docs/finance.' },
        {
          field: 'branch',
          message:
            'Use letters, digits, dots, dashes, underscores and slashes, as Git names a branch.',
        },
        { field: 'mode', message: 'Choose one of the options.' },
        { field: 'pages', message: 'Give 100 or less.' },
        { field: 'extra', message: 'This is not JSON. Check the brackets, commas and quotes.' },
        { field: 'names', message: 'Choose the domain for sales.' },
      ],
    })
    expect(parseConnectorConfig(manifest, {})).toEqual({
      problems: [{ field: 'site', message: 'Give the site address.' }],
    })
    expect(
      parseConnectorConfig(manifest, {
        site: 'https://wiki.example.com',
        mode: 'some',
        spaces: ['fin'],
      }),
    ).toEqual({ problems: [{ field: 'spaces', message: 'Use capital letters.' }] })
  })

  it('names the domains the settings map to, for the service to check they exist', () => {
    expect(
      connectorConfigDomains(manifest, { names: { a: 'commercial', b: 'risk', c: 'commercial' } }),
    ).toEqual(['commercial', 'risk'])
  })
})

describe('the static list of definitions', () => {
  it('reads entries and says the first thing wrong with them', () => {
    expect(
      parseStaticEntries(
        '[{"kind": "metric", "name": "payments.orders", "title": "Orders", "domain": "commercial"}]',
      ),
    ).toEqual({
      entries: [
        {
          kind: 'metric',
          name: 'payments.orders',
          title: 'Orders',
          description: null,
          type: null,
          domain: 'commercial',
        },
      ],
    })
    expect(parseStaticEntries('{}')).toEqual({
      problem: 'Write a list: start with [ and end with ], one entry per definition.',
    })
    expect(parseStaticEntries('[]')).toEqual({ problem: 'Write at least one definition.' })
    expect(parseStaticEntries('[{"kind": "measure", "name": "a"}]')).toEqual({
      problem: 'Entry 1 needs a kind: metric or dimension.',
    })
    expect(
      parseStaticEntries('[{"kind": "metric", "name": "a"}, {"kind": "dimension", "name": "a"}]'),
    ).toEqual({ problem: 'Entry 2 repeats the name a.' })
    expect(parseStaticEntries('[{"kind": "metric", "name": "a", "sql": "select 1"}]')).toEqual({
      problem:
        'Entry 1 has sql, which a definition does not have. Use kind, name, title, description, type and domain.',
    })
  })

  it('checks that each metric finds its domain', () => {
    const parsed = parseStaticEntries(
      '[{"kind": "metric", "name": "a", "domain": "Finance"}, {"kind": "metric", "name": "b"}]',
    )
    if (!('entries' in parsed)) throw new Error('not read')
    expect(staticCheckReport(parsed.entries, {}).steps.map((step) => step.status)).toEqual([
      'ok',
      'warning',
    ])
    expect(staticCheckReport(parsed.entries, { Finance: 'commercial' }).steps[1]).toMatchObject({
      status: 'warning',
      detail: '1 metric names no domain.',
    })
  })
})
