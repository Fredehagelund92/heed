import type { ConnectorManifest } from './connector-manifest.ts'

/**
 * A manifest, typed: `export default defineManifest({ ... })` in a connector's folder. Kept apart
 * from the manifest's schema (connector-manifest.ts), so the web app's first load, whose trail
 * names a built-in connector by its title, carries the manifests without the schema.
 */
export const defineManifest = (manifest: ConnectorManifest): ConnectorManifest => manifest
