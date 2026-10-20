import type { ConnectorManifest } from '../domain/connector-manifest.ts'
import { manifest as staticDefinitions } from './static-definitions/manifest.ts'

/**
 * The manifests of the connectors built into this repository: pure data, read by the server's
 * registry and by the web app's mock, so Sources lists them without running their code.
 * `index.ts` pairs each with its runtime, for the server only.
 */
export const builtInManifests: readonly ConnectorManifest[] = [staticDefinitions]
