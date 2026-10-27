import type { ChosenScope, ConnectorModule } from '../../../domain/connector-runtime.ts'
import type { SourceConfig } from '../../../contract/sources.ts'
import { builtInConnectors } from '../../../connectors/index.ts'
import type { Config } from '../../config/env.ts'
import type { Queryable } from '../../db/database.ts'
import { createCubeSource, cubeConnectorType } from './cube.ts'
import { createDemoSource, demoConnectorType } from './demo.ts'
import { registerConnectors, type ContentSource, type RegisteredConnector } from './platform.ts'
import { noSecretStore, SecretStoreError, type SecretStore } from './secrets.ts'
import { INTERFACE_VERSION, type ConnectorType, type DefinitionSource } from './types.ts'

/** Every type of connector written to interface 2 that this build knows. */
export const connectorTypes: readonly ConnectorType[] = [cubeConnectorType, demoConnectorType]

/**
 * What a type of connector says about itself, for the words on screen. An interface 3 connector
 * says it in its manifest. A stored source of a type this build no longer knows is named by its
 * own name and has no settings.
 */
export function connectorType(type: string, name: string): ConnectorType {
  const written2 = connectorTypes.find((candidate) => candidate.type === type)
  if (written2) return written2
  const manifest = builtInConnectors.find((module) => module.manifest.id === type)?.manifest
  return { type, tool: manifest?.tool ?? name, settingKeys: [] }
}

function checkSource(source: DefinitionSource) {
  if (!/^[a-z][a-z0-9_-]{1,39}$/.test(source.id)) throw new Error('Invalid connector id')
  if (source.interfaceVersion !== INTERFACE_VERSION)
    throw new Error('Unsupported connector interface version')
}

interface Row {
  id: string
  type: string
  name: string
  config: SourceConfig
  secret_ref: string | null
  scopes: ChosenScope[]
}

/**
 * The connectors this server knows and the sources it reads (docs/connectors.md).
 *
 * The connectors are checked once, at start: each built-in interface 3 connector's manifest and
 * runtime, and each interface 2 type an admin may add, through the adapter. A manifest that is
 * not valid, an interface range this build does not speak, a duplicate id, an id out of form or
 * a ref prefix claimed by two tools stops the server with every problem said.
 *
 * The sources are those the server's own configuration selects, fixed at start, and those
 * admins added in Sources, read from the database each time, so a source added or changed is
 * read at the next run without a restart. Each is made by its connector, with the secrets the
 * store holds for it.
 */
export class ConnectorRegistry {
  readonly #sources = new Map<string, DefinitionSource>()
  readonly #connectors = new Map<string, RegisteredConnector>()
  readonly #secrets: SecretStore

  constructor(
    sources: readonly DefinitionSource[],
    {
      connectors = builtInConnectors,
      types = connectorTypes,
      secrets = noSecretStore,
    }: {
      /** Interface 3 connectors: a manifest and a runtime each. */
      connectors?: readonly ConnectorModule[]
      /** Interface 2 types; those an admin may add are adapted. */
      types?: readonly ConnectorType[]
      secrets?: SecretStore
    } = {},
  ) {
    for (const connector of registerConnectors(connectors, types))
      this.#connectors.set(connector.manifest.id, connector)
    for (const source of sources) {
      checkSource(source)
      if (this.#sources.has(source.id)) throw new Error(`Duplicate connector: ${source.id}`)
      this.#sources.set(source.id, source)
    }
    this.#secrets = secrets
  }

  /** Every connector, in the order registered: interface 3 first, then adapted ones. */
  connectors(): readonly RegisteredConnector[] {
    return [...this.#connectors.values()]
  }

  /** One connector by its id (a source's `type`). */
  connector(id: string): RegisteredConnector | undefined {
    return this.#connectors.get(id)
  }

  /** One of the server's own sources. */
  get(id: string): DefinitionSource {
    const source = this.#sources.get(id)
    if (!source) throw new Error(`Unknown connector: ${id}`)
    return source
  }

  /** The server's own sources. */
  list(): readonly DefinitionSource[] {
    return [...this.#sources.values()]
  }

  /** True for a source the server's own configuration selects. */
  isServer(id: string): boolean {
    return this.#sources.has(id)
  }

  /** The secrets a source holds; null when its store entry is gone or cannot be read. */
  async secretsOf(ref: string | null): Promise<Readonly<Record<string, string>> | null> {
    if (ref === null) return {}
    try {
      return await this.#secrets.read(ref)
    } catch (error) {
      if (error instanceof SecretStoreError) return null
      throw error
    }
  }

  /** The definition sources admins added that are switched on, made by their connectors. */
  async added(database: Queryable): Promise<DefinitionSource[]> {
    const rows = await database.query<Row>(
      `select id, type, name, config, secret_ref, scopes from connectors
        where origin = 'workspace' and enabled and kind = 'definition_source' order by id`,
    )
    const sources: DefinitionSource[] = []
    for (const row of rows) {
      // A connector this build no longer knows is left out; its page still shows its last reads.
      const connector = this.#connectors.get(row.type)
      if (!connector) continue
      const source = connector.source({
        id: row.id,
        name: row.name,
        config: row.config,
        secrets: await this.secretsOf(row.secret_ref),
      })
      checkSource(source)
      sources.push(source)
    }
    return sources
  }

  /**
   * The content sources admins added that are switched on, made by their connectors with the
   * scopes chosen for them (CON-601).
   */
  async contents(database: Queryable): Promise<ContentSource[]> {
    const rows = await database.query<Row>(
      `select id, type, name, config, secret_ref, scopes from connectors
        where origin = 'workspace' and enabled and kind = 'context_source' order by id`,
    )
    const sources: ContentSource[] = []
    for (const row of rows) {
      const connector = this.#connectors.get(row.type)
      if (!connector?.content) continue
      sources.push(
        connector.content({
          id: row.id,
          name: row.name,
          config: row.config,
          secrets: await this.secretsOf(row.secret_ref),
          scopes: row.scopes,
        }),
      )
    }
    return sources
  }

  /** Every source to read now: the server's own, then those admins added. */
  async current(database: Queryable): Promise<DefinitionSource[]> {
    const added = await this.added(database)
    return [...this.list(), ...added.filter((source) => !this.#sources.has(source.id))]
  }

  /** One source to read now, by id. */
  async find(database: Queryable, id: string): Promise<DefinitionSource> {
    const server = this.#sources.get(id)
    if (server) return server
    const source = (await this.current(database)).find((candidate) => candidate.id === id)
    if (!source) throw new Error(`Unknown connector: ${id}`)
    return source
  }
}

/** The definition source the configuration selects: the Cube model folder, or the demo. */
export function configuredSource(
  config: Pick<Config, 'cubeModelDir' | 'domainOverridesFile' | 'renamesFile'> &
    Partial<Pick<Config, 'cubeCompile'>>,
): DefinitionSource {
  return config.cubeModelDir
    ? createCubeSource({
        modelDir: config.cubeModelDir,
        domainOverridesFile: config.domainOverridesFile,
        renamesFile: config.renamesFile,
        ...config.cubeCompile,
      })
    : createDemoSource()
}
