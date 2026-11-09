import { describe, expect, it } from 'vitest'
import {
  ConfigError,
  describeDatabase,
  dynamicRegistrationEnabled,
  loadConfig,
  productionSignInHint,
} from '../../src/server/config/env.ts'

const databaseUrl = 'postgres://localhost:5432/context_layer_dev'

describe('loadConfig', () => {
  it('needs only a database URL and defaults to the local build', () => {
    expect(loadConfig({ DATABASE_URL: databaseUrl })).toEqual({
      nodeEnv: 'development',
      host: '127.0.0.1',
      port: 3000,
      logLevel: 'info',
      databaseUrl,
      databaseServeUrl: 'postgres://context_layer_serve@localhost:5432/context_layer_dev',
      mcpResourceUrl: 'http://localhost:3000/mcp',
      mcpDevKeyFile: '.heed-dev-key.pem',
      mcpStateKeyFile: '.heed-mcp-state.key',
      loginServer: {
        kind: 'builtin',
        issuer: 'http://localhost:3000',
        consentUrl: 'http://localhost:5173/connect/approve',
        signingKeyFile: '.heed-oauth-key.pem',
        previousKeyFiles: [],
        dynamicRegistration: true,
        refreshIdleHours: 168,
        connectionDays: 30,
      },
      auth: 'dev',
      oidc: null,
      sessions: { idleHours: 12, maxDays: 7 },
      devPeopleFile: 'db/seed/people.local.yml',
      webOrigins: ['http://localhost:5173', 'http://localhost:4173'],
      trustedProxies: [],
      fixedToday: undefined,
      models: 'mock',
      askLoop: false,
      modelEnv: {},
      cubeModelDir: undefined,
      serverFolders: {},
      domainOverridesFile: undefined,
      cubeCompile: {},
      webReadLoopback: false,
    })
  })

  it.each(['development', 'test'])('defaults AI sign-in settings in %s', (nodeEnv) => {
    expect(loadConfig({ DATABASE_URL: databaseUrl, NODE_ENV: nodeEnv }).loginServer).toMatchObject({
      dynamicRegistration: true,
      refreshIdleHours: 168,
      connectionDays: 30,
    })
  })

  it('honors explicit registration and lifetime overrides', () => {
    expect(
      loadConfig({
        DATABASE_URL: databaseUrl,
        HEED_OAUTH_DYNAMIC_REGISTRATION: 'off',
        HEED_OAUTH_REFRESH_IDLE_HOURS: '24',
        HEED_OAUTH_CONNECTION_DAYS: '7',
      }).loginServer,
    ).toMatchObject({ dynamicRegistration: false, refreshIdleHours: 24, connectionDays: 7 })
  })

  it('treats empty AI sign-in settings as unset', () => {
    expect(
      loadConfig({
        DATABASE_URL: databaseUrl,
        HEED_OAUTH_DYNAMIC_REGISTRATION: '',
        HEED_OAUTH_REFRESH_IDLE_HOURS: '',
        HEED_OAUTH_CONNECTION_DAYS: '',
      }).loginServer,
    ).toMatchObject({ dynamicRegistration: true, refreshIdleHours: 168, connectionDays: 30 })
  })

  it('reads every variable', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      HOST: '0.0.0.0',
      PORT: '4100',
      LOG_LEVEL: 'warn',
      DATABASE_URL: 'postgresql://heed:secret@db.internal:6543/context_layer_test',
      HEED_AUTH: 'dev',
      MODELS: 'live',
      ANTHROPIC_API_KEY: 'sk-test',
      VERCEL_AI_GATEWAY_API_KEY: 'gw-test',
      VERCEL_AI_GATEWAY_BASE_URL: 'https://gateway.example/v1',
      CUBE_MODEL_DIR: '/models/cube',
      HEED_SERVER_FOLDERS: '{"dbt-metricflow":"/models/dbt"}',
      HEED_DOMAIN_OVERRIDES: '/models/domains.json',
      CUBE_COMPILE_TIMEOUT_SECONDS: '300',
      CUBE_COMPILE_MEMORY_MB: '2048',
      HEED_METRICS_TOKEN: 'm'.repeat(32),
    })
    expect(config.cubeCompile).toEqual({ timeoutMs: 300_000, memoryMb: 2048 })
    expect(config.serverFolders).toEqual({ 'dbt-metricflow': '/models/dbt' })
    expect(config).toMatchObject({
      nodeEnv: 'test',
      host: '0.0.0.0',
      port: 4100,
      logLevel: 'warn',
      models: 'live',
      modelEnv: {
        ANTHROPIC_API_KEY: 'sk-test',
        VERCEL_AI_GATEWAY_API_KEY: 'gw-test',
        VERCEL_AI_GATEWAY_BASE_URL: 'https://gateway.example/v1',
      },
      cubeModelDir: '/models/cube',
      domainOverridesFile: '/models/domains.json',
      metricsToken: 'm'.repeat(32),
    })
  })

  it('takes a metrics token only when it is long enough to guess at', () => {
    expect(loadConfig({ DATABASE_URL: databaseUrl }).metricsToken).toBeUndefined()
    for (const token of ['short', `${'m'.repeat(31)} x`])
      expect(() => loadConfig({ DATABASE_URL: databaseUrl, HEED_METRICS_TOKEN: token })).toThrow(
        /HEED_METRICS_TOKEN/,
      )
  })

  it('treats empty values as unset, as .env files write them', () => {
    const config = loadConfig({ DATABASE_URL: databaseUrl, CUBE_MODEL_DIR: '', PORT: '' })
    expect(config.cubeModelDir).toBeUndefined()
    expect(config.port).toBe(3000)
  })

  it('names every invalid variable in one message', () => {
    const load = () =>
      loadConfig({ DATABASE_URL: 'mysql://localhost/db', PORT: 'eighty', MODELS: 'gpt' })
    expect(load).toThrow(ConfigError)
    expect(load).toThrow(/DATABASE_URL: Expected a PostgreSQL URL/)
    expect(load).toThrow(/PORT:/)
    expect(load).toThrow(/MODELS:/)
  })

  it('requires a database URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/)
  })

  it('refuses the dev and demo pickers in production, where OIDC is the default', () => {
    for (const [auth, word] of [
      ['dev', 'Dev'],
      ['demo', 'Demo'],
    ])
      expect(() =>
        loadConfig({ DATABASE_URL: databaseUrl, NODE_ENV: 'production', HEED_AUTH: auth }),
      ).toThrow(
        `HEED_AUTH: ${word} sign-in is refused when NODE_ENV=production; use HEED_AUTH=oidc`,
      )
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, NODE_ENV: 'production' })).toThrow(
      /HEED_OIDC_ISSUER: Required when HEED_AUTH=oidc[\s\S]*HEED_OIDC_CLIENT_ID: Required when HEED_AUTH=oidc/,
    )
    // Someone who started the image to look around is told how to get the demo's picker.
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, NODE_ENV: 'production' })).toThrow(
      productionSignInHint,
    )
    expect(() =>
      loadConfig({ DATABASE_URL: databaseUrl, NODE_ENV: 'production', HEED_AUTH: 'oidc' }),
    ).not.toThrow(productionSignInHint)
    const production = loadConfig({
      DATABASE_URL: databaseUrl,
      NODE_ENV: 'production',
      HEED_OIDC_ISSUER: 'https://login.example.com/realms/acme',
      HEED_OIDC_CLIENT_ID: 'heed',
    })
    expect(production.auth).toBe('oidc')
    expect(production.oidc).toEqual({
      issuer: 'https://login.example.com/realms/acme',
      clientId: 'heed',
      clientSecretFile: null,
      redirectUrl: 'http://localhost:3000/api/v1/auth/oidc/callback',
      scopes: 'openid email profile',
      groupsClaim: 'groups',
      adminGroups: [],
      memberGroups: [],
      name: null,
    })
  })

  it('reads the OIDC settings, and refuses a provider address that is not https', () => {
    expect(
      loadConfig({
        DATABASE_URL: databaseUrl,
        HEED_AUTH: 'oidc',
        HEED_OIDC_ISSUER: 'https://idp.example.com',
        HEED_OIDC_CLIENT_ID: 'heed',
        HEED_OIDC_CLIENT_SECRET_FILE: '/run/secrets/oidc',
        HEED_OIDC_REDIRECT_URL: 'https://heed.example.com/api/v1/auth/oidc/callback',
        HEED_OIDC_SCOPES: 'openid  email profile groups',
        HEED_OIDC_ADMIN_GROUPS: 'heed-admins, platform',
        HEED_OIDC_MEMBER_GROUPS: 'everyone',
        HEED_OIDC_NAME: 'Okta',
        HEED_SESSION_IDLE_HOURS: '8',
        HEED_SESSION_MAX_DAYS: '30',
      }),
    ).toMatchObject({
      auth: 'oidc',
      oidc: {
        clientSecretFile: '/run/secrets/oidc',
        scopes: 'openid email profile groups',
        adminGroups: ['heed-admins', 'platform'],
        memberGroups: ['everyone'],
        name: 'Okta',
      },
      sessions: { idleHours: 8, maxDays: 30 },
    })
    const oidc = { DATABASE_URL: databaseUrl, HEED_AUTH: 'oidc', HEED_OIDC_CLIENT_ID: 'heed' }
    expect(() => loadConfig({ ...oidc, HEED_OIDC_ISSUER: 'http://idp.example.com' })).toThrow(
      /HEED_OIDC_ISSUER: Expected https/,
    )
    expect(() =>
      loadConfig({
        ...oidc,
        HEED_OIDC_ISSUER: 'https://idp.example.com',
        HEED_OIDC_SCOPES: 'email',
      }),
    ).toThrow(/HEED_OIDC_SCOPES: Expected openid/)
    expect(() =>
      loadConfig({
        DATABASE_URL: databaseUrl,
        HEED_SESSION_IDLE_HOURS: '48',
        HEED_SESSION_MAX_DAYS: '1',
      }),
    ).toThrow(/HEED_SESSION_IDLE_HOURS/)
    expect(loadConfig({ DATABASE_URL: databaseUrl, HEED_AUTH: 'demo' })).toMatchObject({
      auth: 'demo',
      oidc: null,
    })
  })

  it('reads the dev people file and a fixed day, and refuses bad values', () => {
    expect(
      loadConfig({
        DATABASE_URL: databaseUrl,
        HEED_DEV_PEOPLE_FILE: 'people.yml',
        HEED_FIXED_TODAY: '2026-10-07',
      }),
    ).toMatchObject({ devPeopleFile: 'people.yml', fixedToday: '2026-10-07' })
    const load = () =>
      loadConfig({
        DATABASE_URL: databaseUrl,
        HEED_FIXED_TODAY: '2026-02-30',
      })
    expect(load).toThrow(/HEED_FIXED_TODAY:/)
  })

  it('validates exact web origins and ignores the removed fixed-person stub setting', () => {
    expect(
      loadConfig({ DATABASE_URL: databaseUrl, CL_DEV_PERSON: 'admin@example.test' }),
    ).not.toHaveProperty('devPerson')
    for (const origin of [
      'null',
      'https://example.test/path',
      'https://person@example.test',
      'ftp://example.test',
    ]) {
      expect(() => loadConfig({ DATABASE_URL: databaseUrl, HEED_WEB_ORIGINS: origin })).toThrow(
        /HEED_WEB_ORIGINS/,
      )
    }
    expect(
      loadConfig({
        DATABASE_URL: databaseUrl,
        HEED_WEB_ORIGINS: 'https://heed.example.test',
        MCP_RESOURCE_URL: 'https://heed.example.test/mcp',
      }).webOrigins,
    ).toEqual(['https://heed.example.test'])
  })

  it('believes forwarded addresses only from the proxies it names', () => {
    const load = (value: string) =>
      loadConfig({ DATABASE_URL: databaseUrl, HEED_TRUSTED_PROXIES: value }).trustedProxies
    expect(load('')).toEqual([])
    expect(load('uniquelocal')).toEqual(['uniquelocal'])
    expect(load(' 127.0.0.1, 10.0.0.0/8 ,fd00::/8,loopback,linklocal ')).toEqual([
      '127.0.0.1',
      '10.0.0.0/8',
      'fd00::/8',
      'loopback',
      'linklocal',
    ])
    // Believing every caller, or a hop count, would let anyone choose their own address.
    for (const value of [
      'true',
      '*',
      '1',
      '0.0.0.0/33',
      '10.0.0.0/8/8',
      'proxy.internal',
      '::1/129',
      // Vercel's edge is the only hop in front of a function, so it is never one of several.
      'vercel,10.0.0.0/8',
      'loopback, vercel',
    ])
      expect(() => load(value), value).toThrow(
        'HEED_TRUSTED_PROXIES: Expected vercel alone, or addresses or ranges such as 10.0.0.0/8, or loopback, linklocal or uniquelocal',
      )
  })

  it('believes the one hop in front behind Vercel', () => {
    expect(
      loadConfig({ DATABASE_URL: databaseUrl, HEED_TRUSTED_PROXIES: ' vercel ' }).trustedProxies,
    ).toEqual(['vercel'])
  })

  it('refuses a fixed day in production', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'production',
        HEED_FIXED_TODAY: '2026-10-07',
      }),
    ).toThrow(/HEED_FIXED_TODAY: A fixed date is refused when NODE_ENV=production/)
  })

  it('lets the tests read web pages on this machine, never in production', () => {
    expect(
      loadConfig({ DATABASE_URL: databaseUrl, HEED_WEB_READ_LOOPBACK: 'on' }).webReadLoopback,
    ).toBe(true)
    expect(() =>
      loadConfig({
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'production',
        HEED_WEB_READ_LOOPBACK: 'on',
      }),
    ).toThrow(
      /HEED_WEB_READ_LOOPBACK: Reading pages on this machine is refused when NODE_ENV=production/,
    )
  })

  it('accepts only the sign-in modes the local build has', () => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, HEED_AUTH: 'oidc' })).toThrow(/HEED_AUTH/)
  })

  it("scripts every model unless MODELS=live, and takes only the registry's variables", () => {
    const config = loadConfig({ DATABASE_URL: databaseUrl, OTHER_API_KEY: 'not-ours' })
    expect(config).toMatchObject({ models: 'mock', modelEnv: {} })
    // Which keys a live service needs depends on the models.* settings, checked at start-up.
    expect(loadConfig({ DATABASE_URL: databaseUrl, MODELS: 'live' }).models).toBe('live')
  })

  it('answers Ask with its router unless HEED_ASK_LOOP=on, and takes only on or off', () => {
    expect(loadConfig({ DATABASE_URL: databaseUrl }).askLoop).toBe(false)
    expect(loadConfig({ DATABASE_URL: databaseUrl, HEED_ASK_LOOP: 'on' }).askLoop).toBe(true)
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, HEED_ASK_LOOP: 'yes' })).toThrow(
      /HEED_ASK_LOOP/,
    )
  })

  it('refuses the replaced MODEL_PROVIDER and says what replaces it', () => {
    for (const value of ['mock', 'anthropic'])
      expect(() => loadConfig({ DATABASE_URL: databaseUrl, MODEL_PROVIDER: value })).toThrow(
        /MODEL_PROVIDER: Replaced by MODELS: MODELS=mock, or MODELS=live with each role's provider and model in the models\.\* settings/,
      )
  })
})

describe('dynamicRegistrationEnabled', () => {
  // The local auth mode is refused in production, so exercise this policy independently
  // while keeping the loadConfig production guard covered above.
  it.each(['development', 'test', 'production'] as const)(
    'honors explicit settings in %s',
    (nodeEnv) => {
      expect(dynamicRegistrationEnabled(nodeEnv, 'on')).toBe(true)
      expect(dynamicRegistrationEnabled(nodeEnv, 'off')).toBe(false)
    },
  )

  it('keeps production registration off unless explicitly enabled', () => {
    expect(dynamicRegistrationEnabled('production')).toBe(false)
  })
})

describe('describeDatabase', () => {
  it('drops the credentials', () => {
    expect(describeDatabase('postgres://heed:secret@db.internal:6543/context_layer_test')).toBe(
      'db.internal:6543/context_layer_test',
    )
    expect(describeDatabase('postgres://localhost/context_layer_dev')).toBe(
      'localhost:5432/context_layer_dev',
    )
  })

  it('reads the login server settings: issuer, addresses, keys, registration and lifetimes', () => {
    expect(
      loadConfig({
        DATABASE_URL: databaseUrl,
        MCP_RESOURCE_URL: 'https://heed.example.test/mcp',
        HEED_WEB_ORIGINS: 'http://localhost:5173,https://heed.example.test',
        HEED_OAUTH_SIGNING_KEY_FILE: '/run/secrets/oauth.pem',
        HEED_OAUTH_PREVIOUS_KEY_FILES: '/run/secrets/old-1.pem, /run/secrets/old-2.pub.pem',
        HEED_OAUTH_DYNAMIC_REGISTRATION: 'on',
        HEED_OAUTH_REFRESH_IDLE_HOURS: '168',
        HEED_OAUTH_CONNECTION_DAYS: '30',
      }).loginServer,
    ).toEqual({
      kind: 'builtin',
      issuer: 'https://heed.example.test',
      // The first web origin on the issuer's host: the sign-in cookie belongs to that host.
      consentUrl: 'https://heed.example.test/connect/approve',
      signingKeyFile: '/run/secrets/oauth.pem',
      previousKeyFiles: ['/run/secrets/old-1.pem', '/run/secrets/old-2.pub.pem'],
      dynamicRegistration: true,
      refreshIdleHours: 168,
      connectionDays: 30,
    })
    expect(loadConfig({ DATABASE_URL: databaseUrl, HEED_LOGIN_SERVER: 'off' }).loginServer).toEqual(
      {
        kind: 'off',
      },
    )
    expect(
      loadConfig({
        DATABASE_URL: databaseUrl,
        HEED_LOGIN_SERVER: 'external',
        MCP_AUTH_ISSUER: 'https://login.example.test',
        MCP_AUTH_JWKS_URL: 'https://login.example.test/jwks',
      }).loginServer,
    ).toEqual({
      kind: 'external',
      issuer: 'https://login.example.test',
      jwksUrl: 'https://login.example.test/jwks',
    })
  })

  it('refuses login server settings that would weaken a rule', () => {
    const load = (env: Record<string, string>) => () =>
      loadConfig({ DATABASE_URL: databaseUrl, ...env })
    expect(load({ HEED_LOGIN_SERVER: 'external' })).toThrow(/MCP_AUTH_ISSUER: Required/)
    expect(load({ HEED_LOGIN_SERVER: 'external' })).toThrow(/MCP_AUTH_JWKS_URL: Required/)
    expect(
      load({
        HEED_LOGIN_SERVER: 'external',
        MCP_AUTH_ISSUER: 'http://login.example.test',
        MCP_AUTH_JWKS_URL: 'https://login.example.test/jwks?x=1',
      }),
    ).toThrow(
      /MCP_AUTH_ISSUER: Expected https[\s\S]*MCP_AUTH_JWKS_URL: Expected an address without a query/,
    )
    expect(load({ HEED_OAUTH_CONSENT_URL: 'http://localhost:9999/connect/approve' })).toThrow(
      /HEED_OAUTH_CONSENT_URL: Expected an address on one of HEED_WEB_ORIGINS/,
    )
    expect(load({ HEED_WEB_ORIGINS: 'http://127.0.0.1:5173' })).toThrow(
      /HEED_OAUTH_CONSENT_URL: Expected a web origin on the issuer's host/,
    )
    expect(load({ HEED_OAUTH_ISSUER: 'http://localhost:4000' })).toThrow(
      /HEED_OAUTH_ISSUER: Expected the origin of MCP_RESOURCE_URL/,
    )
    expect(load({ HEED_OAUTH_DYNAMIC_REGISTRATION: 'yes' })).toThrow(
      /HEED_OAUTH_DYNAMIC_REGISTRATION/,
    )
    expect(load({ HEED_OAUTH_REFRESH_IDLE_HOURS: '0' })).toThrow(/HEED_OAUTH_REFRESH_IDLE_HOURS/)
    expect(load({ HEED_OAUTH_CONNECTION_DAYS: '400' })).toThrow(/HEED_OAUTH_CONNECTION_DAYS/)
  })
})
