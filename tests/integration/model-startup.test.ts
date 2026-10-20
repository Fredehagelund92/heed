import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { testDatabase } from './support.ts'

/*
  With real models the service checks every role's provider and model before it listens, against
  the settings in its database, and names the setting that cannot be served. No model is called.
*/

const { client, url } = testDatabase()
const root = fileURLToPath(new URL('../../', import.meta.url))

function start(env: Record<string, string>) {
  const child = spawn(process.execPath, ['src/server/main.ts'], {
    cwd: root,
    // USER is the database user when the URL names none, as it does in the local test setup.
    env: {
      PATH: process.env.PATH ?? '',
      USER: process.env.USER ?? '',
      DATABASE_URL: url,
      PORT: '0',
      ...env,
    },
  })
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve))
  return { exited, output: () => output }
}

const setJudge = (value: unknown) =>
  client.query(
    `insert into settings_versions(key,version,value,reason)
     select 'models.judge',max(version)+1,$1,'test' from settings_versions where key='models.judge'`,
    [JSON.stringify(value)],
  )

describe('the model settings at start-up', () => {
  it('refuses to start live without the key of a role provider, naming the setting', async () => {
    const server = start({ MODELS: 'live' })
    expect(await server.exited).toBe(1)
    expect(server.output()).toContain(
      'models.eval_answer uses provider anthropic, which needs ANTHROPIC_API_KEY',
    )
  }, 60_000)

  it('names the judge setting when it asks for a provider without its key', async () => {
    await setJudge({ provider: 'vercel-gateway', model: 'anthropic/claude-opus-5.5' })
    const secret = 'sk-ant-placeholder-not-a-key'
    const server = start({ MODELS: 'live', ANTHROPIC_API_KEY: secret })
    expect(await server.exited).toBe(1)
    expect(server.output()).toContain(
      'models.judge uses provider vercel-gateway, which needs VERCEL_AI_GATEWAY_API_KEY',
    )
    // The key that was given is never printed.
    expect(server.output()).not.toContain(secret)
    await setJudge('different_family')
  }, 60_000)
})
