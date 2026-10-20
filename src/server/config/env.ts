import * as z from 'zod'
import { DEFAULT_WEB_ORIGINS } from '../../contract/limits.ts'
import { productNameProblem } from '../../domain/brand.ts'
import { modelProviders } from '../modules/models/index.ts'

/**
 * The service's configuration, read once from the environment at start-up. Anything invalid
 * stops the service with one message that names every bad variable, before it listens.
 */

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
    LOG_LEVEL: z.enum(logLevels).default('info'),
    DATABASE_URL: z.url({
      protocol: /^postgres(?:ql)?$/,
      error: 'Expected a PostgreSQL URL such as postgres://localhost:5432/context_layer_dev',
    }),
    DATABASE_URL_SERVE: z.url({ protocol: /^postgres(?:ql)?$/ }).optional(),
    MCP_RESOURCE_URL: z.url().default('http://localhost:3000/mcp'),
    MCP_DEV_KEY_FILE: z.string().default('.heed-dev-key.pem'),
    // The HMAC key (hex, 32 bytes or more, owner-only) that seals draft_context's questions in a
    // person's AI app (FR-121). Every instance needs the same file. Outside production a missing
    // file is created; in production a missing one turns those questions off.
    CL_MCP_STATE_KEY_FILE: z.string().default('.heed-mcp-state.key'),
    // The login server for a person's own AI client (FR-403, FR-404, docs/ai-sign-in.md).
    // `builtin` runs it in this service; `external` trusts another login server's tokens, read
    // by issuer and key set address; `off` leaves only dev tokens. Tools and items never change.
    CL_LOGIN_SERVER: z.enum(['builtin', 'external', 'off']).default('builtin'),
    // The issuer (`iss`) of the built-in login server's tokens. Default: the MCP address's origin.
    CL_OAUTH_ISSUER: z.url({ protocol: /^https?$/ }).optional(),
    // The web page where a person approves a client. Default: the first web origin's
    // /connect/approve. It must be on an allowed web origin, on the issuer's host.
    CL_OAUTH_CONSENT_URL: z.url({ protocol: /^https?$/ }).optional(),
    // The Ed25519 key that signs access tokens (PKCS #8 PEM, owner-only). Outside production a
    // missing file is created; in production it must exist. Earlier keys, listed after a
    // rotation, keep verifying the tokens they signed until those expire.
    CL_OAUTH_SIGNING_KEY_FILE: z.string().default('.heed-oauth-key.pem'),
    CL_OAUTH_PREVIOUS_KEY_FILES: z.string().optional(),
    // Dynamic client registration (RFC 7591), the fallback to client ID metadata documents.
    // Defaults on outside production; production requires an explicit opt-in.
    CL_OAUTH_DYNAMIC_REGISTRATION: z.enum(['on', 'off']).optional(),
    // A refresh token unused this long expires; a connection ends this many days after sign-in.
    CL_OAUTH_REFRESH_IDLE_HOURS: z.coerce.number().int().min(1).max(2160).default(168),
    CL_OAUTH_CONNECTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    // CL_LOGIN_SERVER=external: whose tokens the MCP server accepts, and where their keys are.
    MCP_AUTH_ISSUER: z.url({ protocol: /^https?$/ }).optional(),
    MCP_AUTH_JWKS_URL: z.url({ protocol: /^https?$/ }).optional(),
    // Sign-in. `dev` picks a person from a local file and is refused in production. Company
    // sign-in (`oidc`) arrives with the hosting stage.
    CL_AUTH: z.enum(['dev']).default('dev'),
    CL_DEV_PEOPLE_FILE: z.string().default('db/seed/people.local.yml'),
    // The web app's origins, which may send changes. The first is its public address: links to a
    // draft and to each item an AI app is given go there (FR-121, FR-347).
    CL_WEB_ORIGINS: z
      .string()
      .default(DEFAULT_WEB_ORIGINS.join(','))
      .transform((value) => value.split(',').map((origin) => origin.trim()))
      .pipe(
        z.array(
          z
            .url({ protocol: /^https?$/ })
            .refine(
              (value) => URL.canParse(value) && new URL(value).origin === value,
              'Expected an origin without a path or credentials',
            ),
        ),
      ),
    // Pins the service's "today" (a UTC day) so demo data and end-to-end screenshots stay stable.
    CL_FIXED_TODAY: z.iso.date().optional(),
    // Language models for the assistant, judges and evals. `get_context` never calls a model.
    // `mock` scripts every role; `live` uses each role's provider and model from the settings
    // (`models.<role>`), with the provider's key from this environment.
    MODELS: z.enum(['mock', 'live']).default('mock'),
    MODEL_PROVIDER: z.string().optional(),
    // A folder of Cube model files, read offline. Unset selects the demo connector.
    CUBE_MODEL_DIR: z.string().optional(),
    CL_DOMAIN_OVERRIDES: z.string().optional(),
    // A JSON file of renamed Cube members, old id to new id (CON-512).
    CUBE_RENAMES_FILE: z.string().optional(),
    // How long Cube's compiler may take on the model, and the memory it may use; a large model
    // needs more than the defaults (120 seconds, 1,024 MB).
    CUBE_COMPILE_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(1800).optional(),
    CUBE_COMPILE_MEMORY_MB: z.coerce.number().int().min(64).max(16384).optional(),
    // The local secret store: a folder outside the repository, only the server's user may open
    // (mode 0700). Sources an administrator adds keep their tokens there (CON-105). Unset, the
    // server keeps no secret, so a source that needs one cannot be added.
    CL_SECRETS_DIR: z.string().optional(),
    // `on` lets the assistant's read_source open plain http pages on this machine, where the
    // end-to-end tests serve theirs. Never another private address; refused in production.
    CL_WEB_READ_LOOPBACK: z.enum(['on', 'off']).default('off'),
    // The bearer token a scraper presents at /metrics. Unset turns the endpoint off.
    CL_METRICS_TOKEN: z
      .string()
      .regex(/^\S{32,}$/, 'Expected at least 32 characters without spaces (openssl rand -hex 32)')
      .optional(),
    // The product's name in what people and agents read. Checked here so a bad value stops the
    // start; src/server/brand.ts reads it (and the web build reads the same variable).
    CL_PRODUCT_NAME: z
      .string()
      .superRefine((value, context) => {
        const problem = productNameProblem(value)
        if (problem) context.addIssue({ code: 'custom', message: problem })
      })
      .optional(),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV === 'production' && env.CL_AUTH === 'dev') {
      context.addIssue({
        code: 'custom',
        path: ['CL_AUTH'],
        message: 'Dev sign-in is refused when NODE_ENV=production',
      })
    }
    if (env.NODE_ENV === 'production' && env.CL_WEB_READ_LOOPBACK === 'on') {
      context.addIssue({
        code: 'custom',
        path: ['CL_WEB_READ_LOOPBACK'],
        message: 'Reading pages on this machine is refused when NODE_ENV=production',
      })
    }
    if (env.NODE_ENV === 'production' && env.CL_FIXED_TODAY !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['CL_FIXED_TODAY'],
        message: 'A fixed date is refused when NODE_ENV=production',
      })
    }
    if (env.CL_LOGIN_SERVER === 'external') {
      for (const name of ['MCP_AUTH_ISSUER', 'MCP_AUTH_JWKS_URL'] as const)
        if (env[name] === undefined)
          context.addIssue({
            code: 'custom',
            path: [name],
            message: 'Required when CL_LOGIN_SERVER=external',
          })
    }
    for (const name of [
      'CL_OAUTH_ISSUER',
      'CL_OAUTH_CONSENT_URL',
      'MCP_AUTH_ISSUER',
      'MCP_AUTH_JWKS_URL',
    ] as const) {
      const value = env[name]
      if (value === undefined) continue
      const url = new URL(value)
      if (url.protocol !== 'https:' && !loopbackHosts.has(url.hostname))
        context.addIssue({
          code: 'custom',
          path: [name],
          message: 'Expected https, or http on this computer only (localhost, 127.0.0.1, [::1])',
        })
      if (url.search || url.hash || url.username || url.password)
        context.addIssue({
          code: 'custom',
          path: [name],
          message: 'Expected an address without a query, a fragment or credentials',
        })
    }
    if (env.MODEL_PROVIDER !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['MODEL_PROVIDER'],
        message:
          "Replaced by MODELS: MODELS=mock, or MODELS=live with each role's provider and model in the models.* settings",
      })
    }
  })

export type LogLevel = (typeof logLevels)[number]

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Which login server issues the tokens the MCP server accepts (FR-404). */
export type LoginServerConfig =
  | {
      kind: 'builtin'
      issuer: string
      consentUrl: string
      signingKeyFile: string
      previousKeyFiles: string[]
      dynamicRegistration: boolean
      refreshIdleHours: number
      connectionDays: number
    }
  | { kind: 'external'; issuer: string; jwksUrl: string }
  | { kind: 'off' }

export interface Config {
  nodeEnv: 'development' | 'test' | 'production'
  host: string
  port: number
  logLevel: LogLevel
  databaseUrl: string
  databaseServeUrl: string
  mcpResourceUrl: string
  mcpDevKeyFile: string
  mcpStateKeyFile: string
  loginServer: LoginServerConfig
  auth: 'dev'
  devPeopleFile: string
  webOrigins: string[]
  fixedToday: string | undefined
  models: 'mock' | 'live'
  /** The registry's key and base URL variables that are set, by name. Never logged. */
  modelEnv: Record<string, string>
  cubeModelDir: string | undefined
  domainOverridesFile: string | undefined
  renamesFile: string | undefined
  /** Cube's compile limits, when the server sets them. */
  cubeCompile: { timeoutMs?: number; memoryMb?: number }
  /** The local secret store's folder; unset keeps no secret. */
  secretsDir: string | undefined
  metricsToken: string | undefined
  /** read_source may open http pages on this machine too (tests only). */
  webReadLoopback: boolean
}

export class ConfigError extends Error {
  override name = 'ConfigError'
}

/** Parses the environment. An empty value counts as unset, as `.env` files write them. */
export function loadConfig(environment: Record<string, string | undefined>): Config {
  const present = Object.fromEntries(
    Object.entries(environment).filter(([, value]) => value !== undefined && value !== ''),
  )
  const result = envSchema.safeParse(present)
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    throw new ConfigError(`Invalid configuration:\n${lines.join('\n')}`)
  }
  const env = result.data
  const loginServer = loginServerConfig(env)
  return {
    nodeEnv: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    databaseServeUrl: env.DATABASE_URL_SERVE ?? servingUrl(env.DATABASE_URL),
    mcpResourceUrl: env.MCP_RESOURCE_URL,
    mcpDevKeyFile: env.MCP_DEV_KEY_FILE,
    mcpStateKeyFile: env.CL_MCP_STATE_KEY_FILE,
    loginServer,
    auth: env.CL_AUTH,
    devPeopleFile: env.CL_DEV_PEOPLE_FILE,
    webOrigins: env.CL_WEB_ORIGINS,
    fixedToday: env.CL_FIXED_TODAY,
    models: env.MODELS,
    modelEnv: Object.fromEntries(
      modelProviders
        .flatMap((provider) => [provider.apiKeyEnv, provider.baseUrlEnv])
        .flatMap((name) => (present[name] === undefined ? [] : [[name, present[name]]])),
    ),
    cubeModelDir: env.CUBE_MODEL_DIR,
    domainOverridesFile: env.CL_DOMAIN_OVERRIDES,
    renamesFile: env.CUBE_RENAMES_FILE,
    cubeCompile: {
      ...(env.CUBE_COMPILE_TIMEOUT_SECONDS === undefined
        ? {}
        : { timeoutMs: env.CUBE_COMPILE_TIMEOUT_SECONDS * 1000 }),
      ...(env.CUBE_COMPILE_MEMORY_MB === undefined ? {} : { memoryMb: env.CUBE_COMPILE_MEMORY_MB }),
    },
    secretsDir: env.CL_SECRETS_DIR,
    metricsToken: env.CL_METRICS_TOKEN,
    webReadLoopback: env.CL_WEB_READ_LOOPBACK === 'on',
  }
}

/** Local clients can register by default; production requires an explicit opt-in. */
export function dynamicRegistrationEnabled(
  nodeEnv: Config['nodeEnv'],
  setting?: 'on' | 'off',
): boolean {
  return setting === undefined ? nodeEnv !== 'production' : setting === 'on'
}

function loginServerConfig(env: z.infer<typeof envSchema>): LoginServerConfig {
  if (env.CL_LOGIN_SERVER === 'off') return { kind: 'off' }
  if (env.CL_LOGIN_SERVER === 'external')
    return { kind: 'external', issuer: env.MCP_AUTH_ISSUER!, jwksUrl: env.MCP_AUTH_JWKS_URL! }
  // An issuer is compared as a string (RFC 8414): the origin, without a trailing slash.
  const issuer = (env.CL_OAUTH_ISSUER ?? new URL(env.MCP_RESOURCE_URL).origin).replace(/\/$/, '')
  // By default the consent page is on the first web origin on the issuer's host: the browser
  // that starts a sign-in keeps a cookie the consent page must send back, and a cookie belongs
  // to a host, whatever its port.
  const sameHost = env.CL_WEB_ORIGINS.find((o) => new URL(o).hostname === new URL(issuer).hostname)
  const consentUrl =
    env.CL_OAUTH_CONSENT_URL ?? `${sameHost ?? env.CL_WEB_ORIGINS[0]}/connect/approve`
  const consent = new URL(consentUrl)
  const problems: string[] = []
  if (!env.CL_WEB_ORIGINS.includes(consent.origin))
    problems.push(`  CL_OAUTH_CONSENT_URL: Expected an address on one of CL_WEB_ORIGINS`)
  if (consent.hostname !== new URL(issuer).hostname)
    problems.push(
      `  CL_OAUTH_CONSENT_URL: Expected a web origin on the issuer's host (${issuer}), or CL_LOGIN_SERVER=off`,
    )
  if (new URL(env.MCP_RESOURCE_URL).origin !== issuer)
    problems.push(`  CL_OAUTH_ISSUER: Expected the origin of MCP_RESOURCE_URL, which serves it`)
  if (problems.length) throw new ConfigError(`Invalid configuration:\n${problems.join('\n')}`)
  return {
    kind: 'builtin',
    issuer,
    consentUrl: consent.href,
    signingKeyFile: env.CL_OAUTH_SIGNING_KEY_FILE,
    previousKeyFiles: (env.CL_OAUTH_PREVIOUS_KEY_FILES ?? '')
      .split(',')
      .map((file) => file.trim())
      .filter(Boolean),
    dynamicRegistration: dynamicRegistrationEnabled(
      env.NODE_ENV,
      env.CL_OAUTH_DYNAMIC_REGISTRATION,
    ),
    refreshIdleHours: env.CL_OAUTH_REFRESH_IDLE_HOURS,
    connectionDays: env.CL_OAUTH_CONNECTION_DAYS,
  }
}

/** Where the database is, without credentials, for the start-up log line. */
export function describeDatabase(databaseUrl: string): string {
  const url = new URL(databaseUrl)
  return `${url.hostname}:${url.port || '5432'}${url.pathname}`
}

function servingUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl)
  url.username = 'context_layer_serve'
  url.password = ''
  return url.href
}
