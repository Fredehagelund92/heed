import js from '@eslint/js'
import betterTailwind from 'eslint-plugin-better-tailwindcss'
import { boundaryConfigs, serverOnlyImports } from './eslint.boundaries.js'
import { appClassRules, appClassRulesExcept } from './eslint.class-rules.js'
import motion from './eslint.motion.js'
import { plainWordsConfigs } from './eslint.plain-words.js'
import productName from './eslint.product-name.js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/*
  Guard rails for UI code (see CONTRIBUTING.md). The Tailwind rules read the real theme from
  src/app/styles/index.css, so a class that tokens.css does not define is reported as unknown.
*/

const restrict = (rules) => rules.map(({ pattern, message }) => ({ pattern, message }))

/*
  The web app (src/app) follows design contract v2. Its pages may switch on the viewport; anything
  that can sit in the dock reads its container instead (contract 3.6). These are the dock's own
  parts.
*/
const appFiles = ['src/app/**/*.{ts,tsx}']
const appDockFiles = [
  'src/app/components/heed/fact-peek.tsx',
  'src/app/components/heed/definition-peek.tsx',
  'src/app/components/heed/peek.tsx',
  'src/app/components/heed/where-panel.tsx',
  'src/app/components/heed/share-answer.tsx',
  'src/app/components/heed/answer.tsx',
  'src/app/components/obs/answer-panel.tsx',
  'src/app/components/agent-preview.tsx',
]

const bannedImports = [
  {
    group: ['@radix-ui/*', 'radix-ui'],
    message: 'Components are built on Base UI. Do not mix a second component base.',
  },
  { group: ['vaul'], message: 'vaul is unmaintained. Use the Drawer or Sheet from components/ui.' },
  { group: ['framer-motion'], message: 'Use CSS transitions, or Motion through LazyMotion.' },
  { group: ['@magicui/*', 'magicui-cli'], message: 'No decorative animated component sets.' },
  ...serverOnlyImports,
]
const appBannedImports = [
  ...bannedImports,
  {
    group: ['lucide-react', 'lucide-react/*'],
    message: 'Import icons from "@/components/icons" so there is one icon module.',
  },
]

const styleProperties =
  '/^(padding|margin|gap|rowGap|columnGap|color|background|backgroundColor|borderColor|fill|stroke)/'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'src/app/routeTree.gen.ts',
      'src/app/lib/cn-tables.gen.ts',
      // Deliberately wrong code that tests/lint/guard-rails.test.ts lints on purpose.
      'tests/lint/fixtures/**',
      // The private overlay is never committed (.gitignore).
      'overlay/**',
      // The clickable mockup is its own package with its own lint, oxlint (apps/mockup/README.md).
      'apps/mockup/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // TanStack Router signals not found and redirects by throwing its own objects.
      '@typescript-eslint/only-throw-error': [
        'error',
        {
          allow: [
            {
              from: 'package',
              package: '@tanstack/router-core',
              name: ['NotFoundError', 'Redirect'],
            },
          ],
        },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // vite.app.config.ts puts the storage key in place of THEME_KEY when it inlines the file.
    files: ['src/app/theme-bootstrap.js'],
    languageOptions: { globals: { ...globals.browser, THEME_KEY: 'readonly' } },
  },
  {
    files: [
      '*.{js,ts}',
      'scripts/**',
      'src/server/**',
      'tests/e2e-app/**',
      'tests/e2e-seed/**',
      'tests/lint/**',
      'tests/server/**',
      'tests/integration/**',
    ],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: appFiles,
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.flat.recommended.rules },
  },
  {
    files: appFiles,
    plugins: { 'better-tailwindcss': betterTailwind, motion },
    settings: {
      'better-tailwindcss': {
        entryPoint: 'src/app/styles/index.css',
        cwd: import.meta.dirname,
      },
    },
    rules: {
      ...betterTailwind.configs['correctness-error']?.rules,
      // Classes a stylesheet of the app's own styles by name rather than as a utility: the
      // editor's (components/editor/style.css and static-renderer/style.css), the Ask composer's
      // placeholder, a mention in the editor, and sonner's toaster.
      'better-tailwindcss/no-unknown-classes': [
        'error',
        { ignore: ['^rte-', '^ask-composer$', '^mention-node$', '^toaster$'] },
      ],
      'better-tailwindcss/enforce-consistent-class-order': 'error',
      'better-tailwindcss/no-duplicate-classes': 'error',
      'better-tailwindcss/no-restricted-classes': [
        'error',
        { restrict: restrict(appClassRulesExcept('viewport-variant')) },
      ],
      'motion/animate-none': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...appBannedImports,
            {
              group: ['@/api/mock', '@/api/mock/*', '**/api/mock', '**/api/mock/*'],
              message:
                'Read and write through "@/api" and its queries; only the api folder knows the mock binding.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: `JSXAttribute[name.name='style'] > JSXExpressionContainer > ObjectExpression > Property[key.name=${styleProperties}]`,
          message: 'Spacing and colour come from tokens. Use utility classes, not inline style.',
        },
      ],
    },
  },
  {
    // The api folder binds the mock binding behind HeedApi, so it may import it.
    files: ['src/app/api/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: appBannedImports }] },
  },
  {
    // The boundaries test's front-end fixtures (tests/lint/boundaries.test.ts) meet the app's
    // import bans, as src/app does.
    files: ['tests/lint/fixtures/boundaries/src/app/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: appBannedImports }] },
  },
  {
    // The one place in the app that may import the icon library.
    files: ['src/app/components/icons.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: bannedImports }] },
  },
  {
    files: appDockFiles,
    rules: {
      'better-tailwindcss/no-restricted-classes': ['error', { restrict: restrict(appClassRules) }],
    },
  },
  {
    // A string model in AI SDK 7 routes through Vercel AI Gateway (plan section 3.1). Models come
    // from the model port as explicit objects (src/server/modules/models). A model setting names
    // its provider next to the model (`{ provider, model }`), which the port turns into an object.
    files: ['src/server/**/*.ts', 'tests/server/**/*.ts', 'tests/lint/fixtures/string-model.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "ObjectExpression:not(:has(> Property[key.name='provider'])) > Property[key.name='model'] > :matches(Literal[value=/./], TemplateLiteral)",
          message:
            'Pass an explicit model object from the model port; a string model routes through an AI gateway.',
        },
      ],
    },
  },
  {
    // The product's name comes from one setting (docs/rename-checklist.md).
    files: [
      ...['app', 'domain', 'contract', 'server', 'cli', 'connectors'].map(
        (dir) => `src/${dir}/**/*.{ts,tsx}`,
      ),
      'tests/lint/fixtures/product-name*.{ts,tsx}',
    ],
    ignores: ['src/domain/brand.ts'],
    plugins: { brand: productName },
    rules: { 'brand/no-product-name': 'error' },
  },
  // The words people read come from the glossary: src/domain/words.ts (v2, docs/design/copy.md) in
  // src/app, src/domain/words-v1.ts (docs/design/voice.md) in the server's sentences and the
  // demo's fixtures.
  ...plainWordsConfigs,
  ...boundaryConfigs,
)
