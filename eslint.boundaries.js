import boundaries from 'eslint-plugin-boundaries'

/*
  Module boundaries for the whole repository (CONTRIBUTING.md, "Module boundaries").

  - domain    pure and shared; imports nothing else from the repository
  - contract  the typed API; imports domain only
  - web       the front end; imports domain and contract, never the service
  - app       the new front end in src/app, under the same rules, until it replaces web
  - server    the service (Heed); imports domain, contract and the modules' index files
  - modules   src/server/modules/<name>; other code reaches a module only through its index.ts
  - cli       imports contract and domain only
  - connectors  src/connectors, the built-in connectors: import domain only. Their manifests are
              data the front end may read; their runtimes and index.ts are for the service only

  Patterns match the end of a path, so tests/lint/fixtures/boundaries/src/... is classified the
  same way as src/... and tests/lint/boundaries.test.ts can prove each rule fails.
*/

const element = (type) => ({ to: { element: { type } } })

/** A connector's code, which only the service runs: its runtime, and the list that pairs them. */
const connectorRuntime = {
  to: { element: { type: 'connectors', fileInternalPath: ['index.ts', '*/runtime.ts'] } },
}

const throughIndex = {
  to: { element: { type: 'server-module', fileInternalPath: 'index.ts' } },
}

const dependencies = {
  default: 'disallow',
  message:
    'Module boundary: {{ from.element.type }} may not import {{ to.element.type }} code. ' +
    'See "Module boundaries" in CONTRIBUTING.md.',
  policies: [
    { from: { element: { type: 'contract' } }, allow: element('domain') },
    {
      from: { element: { types: { anyOf: ['web', 'app'] } } },
      allow: [element('domain'), element('contract'), element('connectors')],
    },
    { from: { element: { type: 'connectors' } }, allow: element('domain') },
    {
      from: { element: { type: 'server' } },
      allow: [element('domain'), element('contract'), element('connectors'), throughIndex],
    },
    {
      from: { element: { type: 'server-module' } },
      allow: [
        element('domain'),
        element('contract'),
        element('server'),
        element('connectors'),
        throughIndex,
      ],
    },
    { from: { element: { type: 'cli' } }, allow: [element('domain'), element('contract')] },
    // Later policies win, so these refine the message for the common mistakes.
    {
      from: { element: { types: { anyOf: ['web', 'app'] } } },
      disallow: [element('server'), element('server-module')],
      message:
        'Module boundary: the front end never imports the service. It talks to it through the ' +
        'API. See "Module boundaries" in CONTRIBUTING.md.',
    },
    {
      from: { element: { types: { anyOf: ['web', 'app'] } } },
      disallow: connectorRuntime,
      message:
        "Module boundary: a connector's runtime runs in the service only. The front end reads its " +
        'manifest. See "Module boundaries" in CONTRIBUTING.md.',
    },
    {
      from: { element: { types: { anyOf: ['server', 'server-module'] } } },
      disallow: {
        to: { element: { type: 'server-module', fileInternalPath: '!index.ts' } },
      },
      message:
        'Module boundary: import the {{ to.element.captured.module }} module through its ' +
        'index.ts, not its internal files. See "Module boundaries" in CONTRIBUTING.md.',
    },
  ],
}

// Pure code: no input or output, no clock, no network. Time comes in as an argument.
const domainPurity = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          regex: String.raw`^(?!zod/mini$|\.{1,2}/)`,
          message: 'src/domain is pure: it may import zod/mini and other domain files only.',
        },
      ],
    },
  ],
  'no-restricted-globals': [
    'error',
    { name: 'fetch', message: 'src/domain is pure: no network. Pass the data in.' },
    { name: 'process', message: 'src/domain is pure: no environment. Pass the value in.' },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
      message: 'src/domain is pure: no clock. Take `today` as an argument.',
    },
    {
      selector: "NewExpression[callee.name='Date'][arguments.length=0]",
      message: 'src/domain is pure: no clock. Take `today` as an argument.',
    },
  ],
}

// A connector touches nothing but what its context hands it (docs/connectors/security.md).
const connectorPurity = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          regex: String.raw`^(?!zod/mini$|\.{1,2}/)`,
          message:
            'A connector may import zod/mini, the domain and its own files only. It reaches the tool through ctx.',
        },
      ],
    },
  ],
  'no-restricted-globals': [
    'error',
    { name: 'fetch', message: 'A connector reaches the network through ctx.fetch only.' },
    { name: 'process', message: 'A connector reads no environment. Its settings come in ctx.' },
  ],
}

// Packages that belong to the service. The web bundle must never pull them in.
export const serverOnlyImports = [
  {
    group: [
      'pg',
      'pg-*',
      'pino',
      'pino-*',
      'fastify',
      '@fastify/*',
      'kysely',
      'better-auth',
      '@modelcontextprotocol/*',
      'jose',
      '@cubejs-backend/*',
      // The API's server side. The front end uses @orpc/client and @orpc/openapi-client only.
      '@orpc/server',
      '@orpc/openapi',
      '@orpc/zod',
      '@orpc/json-schema',
    ],
    message: 'This package belongs to the service. The front end talks to it through the API.',
  },
]

export const boundaryConfigs = [
  {
    files: ['src/**/*.{ts,tsx}', 'tests/lint/fixtures/boundaries/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'import/resolver': {
        typescript: {
          project: 'tsconfig.json',
        },
      },
      'boundaries/elements': [
        { type: 'server-module', pattern: 'src/server/modules/*', capture: ['module'] },
        { type: 'server', pattern: 'src/server' },
        { type: 'domain', pattern: 'src/domain' },
        { type: 'contract', pattern: 'src/contract' },
        { type: 'web', pattern: 'src/web' },
        { type: 'app', pattern: 'src/app' },
        { type: 'cli', pattern: 'src/cli' },
        { type: 'connectors', pattern: 'src/connectors' },
      ],
    },
    rules: {
      'boundaries/dependencies': ['error', dependencies],
    },
  },
  {
    // The new app has its own `@/` (tsconfig.app.json), so its imports resolve through its own
    // config: through tsconfig.json they would land in src/web.
    files: ['src/app/**/*.{ts,tsx}'],
    settings: {
      'import/resolver': { typescript: { project: 'tsconfig.app.json' } },
    },
  },
  {
    files: ['src/domain/**', 'tests/lint/fixtures/boundaries/src/domain/**'],
    rules: domainPurity,
  },
  {
    files: ['src/connectors/**', 'tests/lint/fixtures/boundaries/src/connectors/**'],
    rules: connectorPurity,
  },
  {
    // A connector's worker (`ctx.worker`, T1) runs in a child process of its own under Node's
    // permission model, with no network, no writes and no programs, so it may load the packages
    // it parses with. It still imports nothing of the service (the boundaries above).
    files: [
      'src/connectors/*/worker.ts',
      'tests/lint/fixtures/boundaries/src/connectors/*/worker.ts',
    ],
    rules: { 'no-restricted-imports': 'off', 'no-restricted-globals': 'off' },
  },
]
