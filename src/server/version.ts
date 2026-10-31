import { readFileSync } from 'node:fs'

/**
 * Heed's version, read once when the service starts from package.json, the one place it is
 * written. The release pull request raises it (docs/releasing.md). The MCP server info, the
 * OpenAPI document and `GET /health` all name it, and tests/server/version.test.ts fails when one
 * of them names another.
 */
export const heedVersion: string = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
).version
