import { readFileSync } from 'node:fs'
import type { ConfigEnv, Plugin, UserConfig } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  renamedSettings,
  renamedSettingsWarning,
  withRenamedSettings,
} from '../../src/domain/renamed-settings.ts'

/*
  The settings were named CL_ before 0.1.0 (src/domain/renamed-settings.ts). For one release an
  old name still works when the new one is unset, and a process that reads one warns once.
*/

const databaseUrl = 'postgres://localhost:5432/context_layer_dev'
const token = 'f'.repeat(40)

/** env.ts as a new process loads it: it has warned of nothing yet. */
async function freshConfig() {
  vi.resetModules()
  return import('../../src/server/config/env.ts')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the renamed settings', () => {
  it('pairs each old name with the same name after HEED_', () => {
    for (const [oldName, newName] of Object.entries(renamedSettings))
      expect(newName).toBe(oldName.replace(/^CL_/, 'HEED_'))
  })

  it('lists every new name in .env.example', () => {
    const example = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8')
    for (const newName of Object.values(renamedSettings)) expect(example).toContain(`${newName}=`)
  })

  it('takes an old name only when the new one is unset or empty', () => {
    expect(withRenamedSettings({ HEED_AUTH: 'oidc' })).toEqual({
      environment: { HEED_AUTH: 'oidc' },
      oldNames: [],
    })
    expect(withRenamedSettings({ CL_AUTH: 'demo', HEED_SECRETS_DIR: '' })).toMatchObject({
      environment: { HEED_AUTH: 'demo' },
      oldNames: ['CL_AUTH'],
    })
    expect(withRenamedSettings({ CL_AUTH: 'demo', HEED_AUTH: '' }).environment.HEED_AUTH).toBe(
      'demo',
    )
    expect(withRenamedSettings({ CL_AUTH: 'demo', HEED_AUTH: 'oidc' })).toMatchObject({
      environment: { HEED_AUTH: 'oidc' },
      oldNames: [],
    })
    expect(withRenamedSettings({ CL_AUTH: '' }).oldNames).toEqual([])
  })

  it('warns with the names, never a value', () => {
    expect(renamedSettingsWarning(['CL_AUTH', 'CL_METRICS_TOKEN'])).toBe(
      'Renamed settings: CL_AUTH is now HEED_AUTH, CL_METRICS_TOKEN is now HEED_METRICS_TOKEN. The old names work in this release only (docs/operations.md, "Settings named CL_ before 0.1.0").',
    )
  })
})

describe('loadConfig with the renamed settings', () => {
  it('reads the HEED_ names without a warning', async () => {
    const { loadConfig } = await freshConfig()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(
      loadConfig({
        DATABASE_URL: databaseUrl,
        HEED_TRUSTED_PROXIES: 'uniquelocal',
        HEED_METRICS_TOKEN: token,
      }),
    ).toMatchObject({ trustedProxies: ['uniquelocal'], metricsToken: token })
    expect(warn).not.toHaveBeenCalled()
  })

  it('falls back to an old name and warns exactly once in a process', async () => {
    const { loadConfig } = await freshConfig()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const environment = {
      DATABASE_URL: databaseUrl,
      CL_TRUSTED_PROXIES: 'uniquelocal',
      CL_METRICS_TOKEN: token,
    }
    expect(loadConfig(environment)).toMatchObject({
      trustedProxies: ['uniquelocal'],
      metricsToken: token,
    })
    loadConfig(environment)
    loadConfig({ DATABASE_URL: databaseUrl, CL_AUTH: 'demo' })
    expect(warn).toHaveBeenCalledTimes(1)
    const [line] = warn.mock.calls[0] as [string]
    expect(line).toContain('CL_METRICS_TOKEN is now HEED_METRICS_TOKEN')
    expect(line).toContain('CL_TRUSTED_PROXIES is now HEED_TRUSTED_PROXIES')
    expect(line).not.toContain(token)
    expect(line).not.toContain('uniquelocal')
  })

  it('lets the HEED_ name win when both are set, without a warning', async () => {
    const { loadConfig } = await freshConfig()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(
      loadConfig({
        DATABASE_URL: databaseUrl,
        HEED_AUTH: 'demo',
        CL_AUTH: 'oidc',
        HEED_SESSION_IDLE_HOURS: '2',
        CL_SESSION_IDLE_HOURS: '30',
      }),
    ).toMatchObject({ auth: 'demo', oidc: null, sessions: { idleHours: 2 } })
    expect(warn).not.toHaveBeenCalled()
  })

  it('names the new setting when an old one has a bad value', async () => {
    const { loadConfig } = await freshConfig()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, CL_AUTH: 'nobody' })).toThrow(/HEED_AUTH:/)
  })
})

describe('the web build with the renamed settings', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  async function runConfigHook() {
    vi.resetModules()
    const { renamedWebSettings } = await import('../../vite.config.ts')
    const plugin: Plugin = renamedWebSettings()
    const config = plugin.config as (config: UserConfig, env: ConfigEnv) => void
    config({}, { mode: 'production', command: 'build' })
  }

  it('builds with an old name as its new one, warning once', async () => {
    vi.stubEnv('HEED_PRODUCT_NAME', undefined)
    vi.stubEnv('HEED_SUPPORT_EMAIL', undefined)
    vi.stubEnv('CL_PRODUCT_NAME', 'Acme Ledger')
    vi.stubEnv('CL_SUPPORT_EMAIL', 'help@acme.example')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runConfigHook()
    expect(process.env.HEED_PRODUCT_NAME).toBe('Acme Ledger')
    expect(process.env.HEED_SUPPORT_EMAIL).toBe('help@acme.example')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('CL_PRODUCT_NAME is now HEED_PRODUCT_NAME')
    expect(warn.mock.calls[0]?.[0]).not.toContain('Acme Ledger')
  })

  it('keeps a new name that is set', async () => {
    vi.stubEnv('HEED_PRODUCT_NAME', 'Heed Inc')
    vi.stubEnv('CL_PRODUCT_NAME', 'Acme Ledger')
    vi.stubEnv('CL_SUPPORT_EMAIL', undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runConfigHook()
    expect(process.env.HEED_PRODUCT_NAME).toBe('Heed Inc')
    expect(warn).not.toHaveBeenCalled()
  })
})
