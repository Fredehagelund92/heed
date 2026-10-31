import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

/** Runs `npm run keys:create` as the service image does: `node src/server/create-keys.ts`. */

const root = fileURLToPath(new URL('../../', import.meta.url))
let folder: string | undefined
afterEach(async () => {
  if (folder) await rm(folder, { recursive: true, force: true })
  folder = undefined
})

const run = (env: Record<string, string>) =>
  spawnSync(process.execPath, ['src/server/create-keys.ts'], {
    cwd: root,
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
  })

// Each test starts Node processes that load the key code; slow on a busy machine, as in main.test.ts.
describe('creating the keys production needs', { timeout: 30_000 }, () => {
  it('creates each missing key owner-only, keeps one that exists, and prints no key', async () => {
    folder = await mkdtemp(join(tmpdir(), 'heed-keys-'))
    const env = {
      CL_OAUTH_SIGNING_KEY_FILE: join(folder, 'oauth-key.pem'),
      CL_MCP_STATE_KEY_FILE: join(folder, 'mcp-state.key'),
    }
    const first = run(env)
    expect(first.status).toBe(0)
    expect(first.stdout).toBe(
      `CL_OAUTH_SIGNING_KEY_FILE: created ${env.CL_OAUTH_SIGNING_KEY_FILE}\n` +
        `CL_MCP_STATE_KEY_FILE: created ${env.CL_MCP_STATE_KEY_FILE}\n`,
    )
    for (const file of Object.values(env)) expect((await stat(file)).mode & 0o777).toBe(0o600)
    const signingKey = await readFile(env.CL_OAUTH_SIGNING_KEY_FILE, 'utf8')
    expect(signingKey).toContain('BEGIN PRIVATE KEY')
    const stateKey = await readFile(env.CL_MCP_STATE_KEY_FILE, 'utf8')

    const second = run(env)
    expect(second.status).toBe(0)
    expect(second.stdout).toContain(
      `CL_OAUTH_SIGNING_KEY_FILE: kept ${env.CL_OAUTH_SIGNING_KEY_FILE}`,
    )
    expect(second.stdout).toContain(`CL_MCP_STATE_KEY_FILE: kept ${env.CL_MCP_STATE_KEY_FILE}`)
    expect(await readFile(env.CL_OAUTH_SIGNING_KEY_FILE, 'utf8')).toBe(signingKey)
    expect(await readFile(env.CL_MCP_STATE_KEY_FILE, 'utf8')).toBe(stateKey)
    expect(second.stdout + second.stderr).not.toContain('PRIVATE KEY')
  })

  it('refuses a key others can read, and says which file', async () => {
    folder = await mkdtemp(join(tmpdir(), 'heed-keys-'))
    const file = join(folder, 'oauth-key.pem')
    expect(
      run({ CL_OAUTH_SIGNING_KEY_FILE: file, CL_MCP_STATE_KEY_FILE: join(folder, 's') }).status,
    ).toBe(0)
    await chmod(file, 0o644)
    const refused = run({
      CL_OAUTH_SIGNING_KEY_FILE: file,
      CL_MCP_STATE_KEY_FILE: join(folder, 's'),
    })
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain(`Keys not created: ${file} must be readable by its owner only`)
  })
})
