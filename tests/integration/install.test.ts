import { describe, expect, it } from 'vitest'
import { buildApp } from '../../src/server/app.ts'
import { createDevSignIn } from '../../src/server/modules/auth/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  What an install says it is, before anyone signs in (install.get): the demo, so the sign-in page
  says its company is invented, only on the demo's picker or with the demo loaded; and the label
  HEED_PROFILE_LABEL names it by, for the header and the sign-in page. An install on the dev picker
  with its own data, a private profile say, is not the demo.
*/

const { client, url } = testDatabase()
const install = (options: { method?: 'dev' | 'demo'; profileLabel?: string } = {}) => {
  const app = buildApp({
    database: apiDatabase(url),
    logger: createLogger({ level: 'silent' }),
    jobs: idleJobs(),
    signIn: createDevSignIn([], 'test', { method: options.method ?? 'dev' }),
    ...(options.profileLabel ? { profileLabel: options.profileLabel } : {}),
  })
  return app.inject({ method: 'GET', url: '/api/v1/install' })
}

describe('what an install is', () => {
  it('on the dev picker with its own data: not the demo, and no label unless one is set', async () => {
    const plain = await install()
    expect(plain.statusCode, plain.body).toBe(200)
    expect(plain.json()).toEqual({ demo: false, profileLabel: null })
    expect((await install({ profileLabel: 'Local trial' })).json()).toEqual({
      demo: false,
      profileLabel: 'Local trial',
    })
  })

  it("on the demo's picker: the demo, whatever the data", async () => {
    expect((await install({ method: 'demo' })).json()).toEqual({ demo: true, profileLabel: null })
  })

  it("with the demo loaded: the demo, by the sandbox domain only the demo's seed makes", async () => {
    await client.query(
      "insert into areas (id, name, is_demo) values ('area_sandbox', 'Sandbox', true)",
    )
    expect((await install()).json()).toEqual({ demo: true, profileLabel: null })
  })
})
