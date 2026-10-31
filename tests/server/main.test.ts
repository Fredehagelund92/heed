import { spawn } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { request, type IncomingHttpHeaders } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mintDevToken } from '../../src/server/mcp/auth.ts'

/** Runs the real entry point with Node, as `npm run dev:server` does. Needs no database. */

const root = fileURLToPath(new URL('../../', import.meta.url))

function start(env: Record<string, string>) {
  const child = spawn(process.execPath, ['src/server/main.ts'], {
    cwd: root,
    env: { PATH: process.env.PATH ?? '', ...env },
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve))
  const listening = new Promise<string>((resolve, reject) => {
    child.stdout.on('data', () => {
      const match = /Server listening at (http:\/\/[^"]+)/.exec(stdout)
      if (match?.[1]) resolve(match[1])
    })
    void exited.then(() => reject(new Error(`exited before listening:\n${stdout}${stderr}`)))
  })
  // A test that expects a refusal never awaits `listening`.
  listening.catch(() => undefined)
  return { child, exited, listening, output: () => stdout + stderr }
}

// Each test starts a fresh Node process that loads the whole service, which takes several
// seconds on a machine busy with other suites; 5 seconds made them flaky.
describe('the service entry point', { timeout: 30_000 }, () => {
  it('starts, answers /health, and stops cleanly on SIGTERM', async () => {
    const server = start({
      DATABASE_URL: 'postgres://127.0.0.1:1/context_layer_none',
      PORT: '0',
    })
    const url = await server.listening
    const response = await fetch(`${url}/health`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', service: 'heed' })

    server.child.kill('SIGTERM')
    expect(await server.exited).toBe(0)
    expect(server.output()).toContain('"msg":"stopped"')
    // The picker lets anyone in as anyone: the start says so.
    expect(server.output()).toContain('Sign-in is the people picker (CL_AUTH=dev)')
  })

  it('refuses to start with invalid configuration and says why', async () => {
    const server = start({ NODE_ENV: 'production', DATABASE_URL: 'postgres://localhost/x' })
    expect(await server.exited).toBe(1)
    expect(server.output()).toContain('CL_OIDC_ISSUER: Required when CL_AUTH=oidc')
    expect(server.output()).toContain('set NODE_ENV=development, as compose.yaml does')
  })

  it('starts in production with company sign-in, and serves MCP on its own address', async () => {
    const keys = await mkdtemp(join(tmpdir(), 'heed-production-'))
    try {
      // Production makes no key of its own: the operator creates the signing key (owner-only).
      const signingKey = join(keys, 'oauth-key.pem')
      const { privateKey } = generateKeyPairSync('ed25519')
      await writeFile(signingKey, privateKey.export({ format: 'pem', type: 'pkcs8' }), {
        mode: 0o600,
      })
      const resource = 'https://heed.example.test/mcp'
      const server = start({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://127.0.0.1:1/context_layer_none',
        PORT: '0',
        CL_OIDC_ISSUER: 'http://127.0.0.1:1/realms/heed',
        CL_OIDC_CLIENT_ID: 'heed',
        MCP_RESOURCE_URL: resource,
        CL_WEB_ORIGINS: 'https://heed.example.test',
        CL_OAUTH_SIGNING_KEY_FILE: signingKey,
        CL_MCP_STATE_KEY_FILE: join(keys, 'state.key'),
        MCP_DEV_KEY_FILE: join(keys, 'dev-key.pem'),
      })
      const url = await server.listening
      expect((await fetch(`${url}/health`)).status).toBe(200)
      // fetch always sends the address's own host, so these go out with node:http.
      const mcp = (headers: Record<string, string>) =>
        new Promise<{ status: number; headers: IncomingHttpHeaders }>((resolve, reject) => {
          const sent = request(`${url}/mcp`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
              ...headers,
            },
          })
          sent.on('error', reject)
          sent.on('response', (response) => {
            response.resume()
            response.on('end', () =>
              resolve({ status: response.statusCode ?? 0, headers: response.headers }),
            )
          })
          sent.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))
        })
      // The MCP address's own host passes the host check and gets the sign-in challenge.
      const anonymous = await mcp({ host: 'heed.example.test' })
      expect(anonymous.status).toBe(401)
      expect(anonymous.headers['www-authenticate']).toContain(
        'resource_metadata="https://heed.example.test/.well-known/oauth-protected-resource/mcp"',
      )
      expect((await mcp({ host: 'rebound.example' })).status).toBe(403)
      // Production holds no dev key, so a dev token names an issuer nobody configured.
      const devToken = await mintDevToken(generateKeyPairSync('ed25519').privateKey, resource)
      expect(
        (await mcp({ host: 'heed.example.test', authorization: `Bearer ${devToken}` })).status,
      ).toBe(401)
      const metadata = await fetch(`${url}/.well-known/oauth-protected-resource/mcp`)
      expect(await metadata.json()).toMatchObject({
        resource,
        authorization_servers: ['https://heed.example.test'],
      })

      server.child.kill('SIGTERM')
      expect(await server.exited).toBe(0)
      const output = server.output()
      expect(output).toContain('"nodeEnv":"production"')
      expect(output).toContain('"auth":"oidc"')
      expect(output).not.toContain('people picker')
      expect(output).toContain('"reason":"unknown_issuer"')
    } finally {
      await rm(keys, { recursive: true, force: true })
    }
  })
})
