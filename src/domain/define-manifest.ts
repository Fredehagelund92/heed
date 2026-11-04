import type { ConnectorManifest } from './connector-manifest.ts'

/**
 * A manifest, typed: `export default defineManifest({ ... })` in a connector's folder. Kept apart
 * from the manifest's schema (connector-manifest.ts), so the web app's Integrations catalogue
 * (src/web/model/catalogue.ts) carries the manifests without the schema.
 */
export const defineManifest = (manifest: ConnectorManifest): ConnectorManifest => manifest
