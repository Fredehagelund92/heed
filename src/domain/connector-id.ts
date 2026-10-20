/**
 * A connector's id: `cube-files`, or a third party's namespaced `acme.lookml`. Kept apart from the
 * manifest's schema (connector-manifest.ts), so the web app's first load can check an address
 * without it.
 */
export const connectorIdPattern = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?$/
