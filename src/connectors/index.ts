import { defineConnector, type ConnectorModule } from '../domain/connector-runtime.ts'
import { manifest as staticDefinitions } from './static-definitions/manifest.ts'
import { runtime as staticDefinitionsRuntime } from './static-definitions/runtime.ts'

/**
 * The connectors built into this repository, one folder each, with their manifest and their
 * runtime (interface 3.0). Server only: the web app reads `manifests.ts`. A test fails when a
 * folder here is not listed, or when this list and `manifests.ts` differ.
 */
export const builtInConnectors: readonly ConnectorModule[] = [
  defineConnector(staticDefinitions, staticDefinitionsRuntime),
]
