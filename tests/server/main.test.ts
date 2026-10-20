import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

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
  })

  it('refuses to start with invalid configuration and says why', async () => {
    const server = start({ NODE_ENV: 'production', DATABASE_URL: 'postgres://localhost/x' })
    expect(await server.exited).toBe(1)
    expect(server.output()).toContain('CL_AUTH: Dev sign-in is refused when NODE_ENV=production')
  })
})
