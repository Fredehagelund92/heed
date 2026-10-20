import { describe, expect, it } from 'vitest'
import { builtInConnectors } from '../../../src/connectors/index.ts'
import { manifest as staticManifest } from '../../../src/connectors/static-definitions/manifest.ts'
import {
  defineConnector,
  defineRuntime,
  SourceError,
  type ConnectorModule,
  type RuntimeMessage,
} from '../../../src/domain/connector-runtime.ts'
import type { ConnectorManifest } from '../../../src/domain/connector-manifest.ts'
import {
  ConnectorRegistry,
  ConnectorRegistryError,
  connectorType,
  createDemoSource,
  createWorkspaceSources,
  guardedFetch,
  noSecretStore,
  type DefinitionSource,
} from '../../../src/server/modules/connectors/index.ts'
import { SourceReadError } from '../../../src/server/modules/connectors/types.ts'

/*
  Interface 3.0 in the core (docs/connectors.md): the registry checks every connector's manifest
  at start and refuses what this build cannot run; a connector written to interface 2 keeps
  working through the adapter; and a runtime's read is checked message by message before its
  definitions reach the one definitions pipeline.
*/

const definitions = JSON.stringify([
  { kind: 'metric', name: 'payments.orders', title: 'Orders', domain: 'commercial' },
  { kind: 'dimension', name: 'payments.market', title: 'Market', domain: 'Finance' },
  { kind: 'metric', name: 'payments.fees', description: 'x'.repeat(600) },
])

/** A connector whose runtime sends the messages it is given. */
function scripted(
  messages: readonly unknown[],
  patch: Partial<ConnectorManifest> = {},
): ConnectorModule {
  return defineConnector(
    { ...staticManifest, id: 'scripted', tool: 'Script', refPrefix: 'script', ...patch },
    defineRuntime({
      check: () => Promise.resolve({ steps: [{ id: 'reach', title: 'Reach', status: 'ok' }] }),
      async *read() {
        for (const message of messages) yield await Promise.resolve(message as RuntimeMessage)
      },
    }),
  )
}

const definition = (name: string, ref = `script:${name}`) => ({
  type: 'definition',
  definition: {
    ref,
    kind: 'metric',
    name,
    title: null,
    descriptionCopy: null,
    valueType: null,
    visibleGroups: null,
    areaHint: null,
    domainSource: 'none',
    modelFile: null,
    changeMark: 'a'.repeat(64),
  },
})
const end = { type: 'end', version: 'v1', complete: true }

function sourceOf(module: ConnectorModule, config: Record<string, unknown> = {}): DefinitionSource {
  const registry = new ConnectorRegistry([], { connectors: [module] })
  return registry.connector(module.manifest.id)!.source({
    id: 'scripted-source',
    name: 'Scripted',
    config: config as never,
    secrets: {},
  })
}

const failureOf = async (source: DefinitionSource) => {
  try {
    await source.read({ cursor: null })
  } catch (error) {
    if (error instanceof SourceReadError) return error.warnings
    throw error
  }
  throw new Error('The read did not fail')
}

describe('the registry of connectors', () => {
  it('holds the built-in connectors and the interface 2 types admins may add', () => {
    const registry = new ConnectorRegistry([createDemoSource()])
    expect(
      registry.connectors().map((connector) => [connector.manifest.id, connector.writtenTo]),
    ).toEqual([
      ['static-definitions', 3],
      ['cube', 2],
    ])
    // The demo type has no form, so it is not a connector to add; its words still come from it.
    expect(registry.connector('demo')).toBeUndefined()
    expect(connectorType('static-definitions', 'My list').tool).toBe('Static list')
    expect(connectorType('gone', 'Old source').tool).toBe('Old source')
  })

  it('refuses a version this build does not speak, a duplicate id and an id out of form', () => {
    const [list] = builtInConnectors
    const refused = (connectors: ConnectorModule[]) => {
      try {
        new ConnectorRegistry([], { connectors })
      } catch (error) {
        if (error instanceof ConnectorRegistryError)
          return error.problems.map(({ id, problem }) => `${id} ${problem.path}`)
        throw error
      }
      return []
    }
    expect(refused([{ ...list!, manifest: { ...list!.manifest, heed: '^4.0' } }])).toEqual([
      'static-definitions heed',
    ])
    expect(refused([list!, list!])).toEqual(['static-definitions id'])
    expect(refused([{ ...list!, manifest: { ...list!.manifest, id: 'Bad_Id' } }])).toEqual([
      'Bad_Id id',
    ])
    // No connector may take the id of an interface 2 type, even one admins cannot add.
    expect(refused([{ ...list!, manifest: { ...list!.manifest, id: 'demo' } }])).toEqual([
      'demo id',
    ])
    // A definitions connector that sends tombstones waits for a pipeline that takes them.
    expect(
      refused([
        scripted([], { capabilities: { ...staticManifest.capabilities, deletions: 'tombstones' } }),
      ]),
    ).toEqual(['scripted capabilities.deletions'])
    expect(() => new ConnectorRegistry([], { connectors: [list!, list!] })).toThrow(
      'Another connector has the id static-definitions.',
    )
  })

  it('keeps the server sources it was given, as interface 2 did', () => {
    const demo = createDemoSource()
    expect(() => new ConnectorRegistry([demo, demo])).toThrow('Duplicate connector')
    expect(new ConnectorRegistry([demo]).isServer('demo')).toBe(true)
  })
})

describe('an interface 2 type through the adapter', () => {
  it("checks settings with the type's own rules, as before", () => {
    const cube = new ConnectorRegistry([]).connector('cube')!
    expect(cube.parse({ repository: 'https://git.example.com/a.git', ref: 'main' })).toEqual({
      config: { repository: 'https://git.example.com/a.git', ref: 'main' },
    })
    expect(cube.parse({ repository: 'ftp://x', ref: '--x' })).toMatchObject({
      problems: [{ field: 'repository' }, { field: 'ref' }],
    })
    expect(cube.secretsBoundTo).toEqual(['repository'])
    expect('check' in cube).toBe(false)
  })
})

describe('a runtime read, checked message by message', () => {
  it('reads the static list into definitions, with its warnings', async () => {
    const list = new ConnectorRegistry([]).connector('static-definitions')!
    expect(list.parse({ definitions })).toEqual({ config: { definitions } })
    expect(list.parse({ definitions: '[]' })).toEqual({
      problems: [{ field: 'definitions', message: 'Write at least one definition.' }],
    })
    const stored = { id: 'finance', name: 'Finance', config: { definitions }, secrets: {} }
    expect((await list.check!(stored)).steps.map((step) => step.status)).toEqual(['ok', 'warning'])
    const snapshot = await list.source(stored).read({ cursor: null })
    expect(snapshot.complete).toBe(true)
    expect(snapshot.sourceVersion).toMatch(/^[a-f0-9]{64}$/)
    expect(
      snapshot.definitions.map((entry) => [entry.ref, entry.areaHint, entry.domainSource]),
    ).toEqual([
      ['static:payments.orders', 'commercial', 'cube'],
      ['static:payments.market', null, 'none'],
      ['static:payments.fees', null, 'none'],
    ])
    expect(snapshot.definitions[2]!.descriptionCopy).toHaveLength(500)
    expect(snapshot.warnings).toEqual([
      { code: 'invalid_domain', target: 'payments.market' },
      { code: 'static-definitions.description_cut', target: 'payments.fees' },
    ])
    // The same list gives the same marks; a changed title moves only its own.
    const again = await list.source(stored).read({ cursor: null })
    expect(again.definitions.map((entry) => entry.changeMark)).toEqual(
      snapshot.definitions.map((entry) => entry.changeMark),
    )
    const retitled = definitions.replace('"Orders"', '"Orders made"')
    const moved = await list
      .source({ ...stored, config: { definitions: retitled } })
      .read({ cursor: null })
    expect(
      moved.definitions.map(
        (entry, at) => entry.changeMark === snapshot.definitions[at]!.changeMark,
      ),
    ).toEqual([false, true, true])
  })

  it('refuses a read that sends what the contract does not allow, and keeps nothing', async () => {
    const invalid = [{ code: 'invalid_output', target: 'scripted' }]
    // A definition with SQL in it: the object is strict.
    const withSql = definition('a')
    expect(
      await failureOf(
        sourceOf(
          scripted([{ ...withSql, definition: { ...withSql.definition, sql: 'select 1' } }, end]),
        ),
      ),
    ).toEqual(invalid)
    // A ref under another tool's prefix, the same ref twice, a document, no end.
    expect(await failureOf(sourceOf(scripted([definition('a', 'cube:a'), end])))).toEqual(invalid)
    expect(await failureOf(sourceOf(scripted([definition('a'), definition('a'), end])))).toEqual(
      invalid,
    )
    expect(await failureOf(sourceOf(scripted([definition('a')])))).toEqual(invalid)
    // A warning that is neither the core's nor the connector's own.
    expect(
      await failureOf(
        sourceOf(scripted([{ type: 'warning', code: 'other.thing', target: 'x' }, end])),
      ),
    ).toEqual(invalid)
  })

  it("says why a read failed in the runtime's code, and keeps anything else out", async () => {
    const failing = (error: Error) =>
      defineConnector(
        { ...staticManifest, id: 'failing', tool: 'Failing', refPrefix: 'failing' },
        defineRuntime({
          check: () => Promise.reject(error),
          // eslint-disable-next-line require-yield -- it fails before it sends anything
          async *read() {
            await Promise.reject(error)
          },
        }),
      )
    expect(
      await failureOf(
        sourceOf(
          failing(new SourceError({ code: 'unauthorized', target: 'wiki', class: 'config' })),
        ),
      ),
    ).toEqual([{ code: 'unauthorized', target: 'wiki' }])
    // An error that is not a SourceError could hold what it read: only a code is kept.
    expect(await failureOf(sourceOf(failing(new Error('secret-ish text'))))).toEqual([
      { code: 'invalid_output', target: 'failing' },
    ])
  })

  it('stops at the record limit and says the read is in part', async () => {
    const capped = sourceOf(
      scripted([definition('a'), definition('b'), definition('c'), end], {
        limits: { timeoutSeconds: 10, maxRecords: 2 },
      }),
    )
    const snapshot = await capped.read({ cursor: null })
    expect(snapshot.definitions.map((entry) => entry.name)).toEqual(['a', 'b'])
    expect(snapshot.complete).toBe(false)
    expect(snapshot.warnings).toEqual([{ code: 'too_many_records', target: '2' }])
  })

  it('fails with secret_missing when the store lost the secrets of a source that has some', async () => {
    const withSecret = scripted([end], {
      config: {
        fields: [{ key: 'site', kind: 'address', label: 'Site', description: 'Where.' }],
      },
      secrets: [{ key: 'token', label: 'Token', description: 'A token.', boundTo: ['site'] }],
      egress: { hosts: [{ fromField: 'site' }] },
    })
    const connector = new ConnectorRegistry([], { connectors: [withSecret] }).connector('scripted')!
    await expect(
      connector.source({ id: 'x', name: 'X', config: {}, secrets: null }).read({ cursor: null }),
    ).rejects.toMatchObject({ warnings: [{ code: 'secret_missing', target: 'token' }] })
  })
})

describe("a runtime's fetch", () => {
  it('reaches only the hosts the manifest declares', async () => {
    const manifest = {
      ...staticManifest,
      config: {
        fields: [{ key: 'site', kind: 'address' as const, label: 'Site', description: 'Where.' }],
      },
      egress: { hosts: [{ fromField: 'site' }, { host: 'api.example.com' }] },
    }
    const fetch = guardedFetch(
      manifest,
      { site: 'https://wiki.example.com/space' },
      AbortSignal.timeout(1_000),
    )
    await expect(fetch('https://elsewhere.example.com/x')).rejects.toBeInstanceOf(SourceError)
    await expect(fetch('http://wiki.example.com/x')).rejects.toBeInstanceOf(SourceError)
    await expect(fetch('https://user:pw@api.example.com/x')).rejects.toBeInstanceOf(SourceError)
  })
})

describe('the sources admins add, over the registry', () => {
  it('lists every connector of a kind admins add, with its manifest', () => {
    const service = createWorkspaceSources({
      secrets: noSecretStore,
      registry: new ConnectorRegistry([]),
    })
    expect(service.types().map((listing) => [listing.manifest.id, listing.writtenTo])).toEqual([
      ['static-definitions', 3],
      ['cube', 2],
    ])
  })
})
