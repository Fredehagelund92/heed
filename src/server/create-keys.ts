import { stat } from 'node:fs/promises'
import { withNewSettingNames } from './config/env.ts'
import { loadStateKey } from './mcp/state-key.ts'
import { loadKeyRing } from './modules/oauth/index.ts'

/**
 * `npm run keys:create`, or `node src/server/create-keys.ts` in the service image: creates the
 * keys production never creates on its own, each only when its file does not exist yet, readable
 * by its owner only: the login server's signing key (HEED_OAUTH_SIGNING_KEY_FILE) and the key that
 * seals suggest_context's questions (HEED_MCP_STATE_KEY_FILE). It reads an existing key to check
 * it, and prints file names only, never key material (docs/operations.md, "Run the image in
 * production mode").
 */

const env = withNewSettingNames(process.env)
const files = {
  HEED_OAUTH_SIGNING_KEY_FILE: env.HEED_OAUTH_SIGNING_KEY_FILE || '.heed-oauth-key.pem',
  HEED_MCP_STATE_KEY_FILE: env.HEED_MCP_STATE_KEY_FILE || '.heed-mcp-state.key',
}
const exists = (file: string) =>
  stat(file).then(
    () => true,
    () => false,
  )

try {
  for (const [name, file] of Object.entries(files)) {
    const had = await exists(file)
    // Outside production both loaders create a missing key, owner-only, and check one that exists.
    if (name === 'HEED_OAUTH_SIGNING_KEY_FILE')
      await loadKeyRing({ file, previousFiles: [], nodeEnv: 'development' })
    else await loadStateKey(file, 'development')
    console.log(`${name}: ${had ? 'kept' : 'created'} ${file}`)
  }
} catch (error) {
  console.error(`Keys not created: ${(error as Error).message}`)
  process.exitCode = 1
}
