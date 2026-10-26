import js from '@eslint/js'
import betterTailwind from 'eslint-plugin-better-tailwindcss'
import { boundaryConfigs, serverOnlyImports } from './eslint.boundaries.js'
import {
  appClassRules,
  appClassRulesExcept,
  classRules,
  classRulesExcept,
} from './eslint.class-rules.js'
import motion from './eslint.motion.js'
import { plainWordsConfigs } from './eslint.plain-words.js'
import productName from './eslint.product-name.js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/*
  Guard rails for UI code (see CONTRIBUTING.md). The Tailwind rules read the real theme from
  src/web/styles/index.css, so a class that tokens.css does not define is reported as unknown.
*/

const restrict = (rules) => rules.map(({ pattern, message }) => ({ pattern, message }))

// The page templates and the shell own the gutter and may switch on the viewport. The library
// and catalogue lists, the proposal list and the gap list are the list template and the data
// table: they re-apply the gutter inside their full-bleed rows and states (contract 3.2 rule 4
// and 3.3).
const templateFiles = ['src/web/components/page/**', 'src/web/components/app-shell/**']
const listFiles = [
  'src/web/components/library/**',
  'src/web/components/catalogue/**',
  'src/web/components/proposals/**',
  'src/web/components/gaps/**',
  // What changed between two editions is a list page too: its rows and bars span the gutter.
  'src/web/components/editions/compare-list.tsx',
  'src/web/components/editions/compare-page.tsx',
]

/*
  The new web app (src/app) follows design contract v2 until it replaces src/web. Its pages may
  switch on the viewport; anything that can sit in the dock reads its container instead (contract
  3.6). These are the dock's own parts, at the mockup's paths: the pull request that brings a file
  in keeps its path here in step.
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

const styleProperties =
  '/^(padding|margin|gap|rowGap|columnGap|color|background|backgroundColor|borderColor|fill|stroke)/'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'storybook-static/**',
      'playwright-report/**',
      'test-results/**',
      'src/web/routeTree.gen.ts',
      'src/web/lib/cn-tables.gen.ts',
      'registry/r/**',
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
    files: ['src/web/theme-bootstrap.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: [
      '*.{js,ts}',
      'scripts/**',
      'src/server/**',
      'tests/e2e/**',
      'tests/lint/**',
      'tests/server/**',
      'tests/integration/**',
      '.storybook/main.ts',
    ],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/web/**/*.{ts,tsx}', '.storybook/preview.tsx', 'tests/unit/**'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.flat.recommended.rules },
  },
  {
    files: ['src/web/**/*.{ts,tsx}', '.storybook/preview.tsx', 'tests/lint/fixtures/**/*.tsx'],
    plugins: { 'better-tailwindcss': betterTailwind },
    settings: {
      'better-tailwindcss': {
        entryPoint: 'src/web/styles/index.css',
        cwd: import.meta.dirname,
      },
    },
    rules: {
      ...betterTailwind.configs['correctness-error']?.rules,
      'better-tailwindcss/enforce-consistent-class-order': 'error',
      'better-tailwindcss/no-duplicate-classes': 'error',
      // Classes a lazy chunk's own stylesheet defines, so the first load does not carry them
      // (components/assistant/answer-motion.css, home/your-drafts.css, item/mention-chip.css,
      // page/dock-panel.css, page/grid-table.css and ui/scroll-fade.css).
      'better-tailwindcss/no-unknown-classes': [
        'error',
        {
          ignore: [
            '^animate-(arrive|settle)(-fast|-instant)?$',
            '^collapsible-height$',
            '^dock-motion$',
            '^draft-columns$',
            '^latest-pill$',
            '^mention-chip$',
            '^phone-grid$',
            '^scroll-fade-x$',
            '^settle-after-[12]$',
            '^spinner-done$',
          ],
        },
      ],
      'better-tailwindcss/no-restricted-classes': ['error', { restrict: restrict(classRules) }],
      'no-restricted-imports': ['error', { patterns: bannedImports }],
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
            ...bannedImports,
            {
              group: ['lucide-react', 'lucide-react/*'],
              message: 'Import icons from "@/components/icons" so there is one icon module.',
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
    // The one place in the new app that may import the icon library.
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
    // The one place that may import the icon library.
    files: ['src/web/components/icons.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['src/web/**/*.{ts,tsx}', '.storybook/preview.tsx', 'tests/lint/fixtures/**/*.tsx'],
    ignores: ['src/web/components/icons.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...bannedImports,
            {
              group: ['lucide-react', 'lucide-react/*'],
              message: 'Import icons from "@/components/icons" so there is one icon module.',
            },
          ],
        },
      ],
    },
  },
  {
    files: templateFiles,
    rules: {
      'better-tailwindcss/no-restricted-classes': [
        'error',
        { restrict: restrict(classRulesExcept('viewport-variant', 'gutter-outside-template')) },
      ],
    },
  },
  {
    files: listFiles,
    rules: {
      'better-tailwindcss/no-restricted-classes': [
        'error',
        { restrict: restrict(classRulesExcept('gutter-outside-template')) },
      ],
    },
  },
  {
    // shadcn primitives may use `!` for state driven overrides, as shadcn does. Feature code may not.
    files: ['src/web/components/ui/**'],
    rules: {
      'better-tailwindcss/no-restricted-classes': [
        'error',
        { restrict: restrict(classRulesExcept('important')) },
      ],
    },
  },
  {
    // Shared controls own phone target sizes by viewport, including inside narrow overlays.
    // Features still use container variants; only these primitives may apply the phone rule.
    files: [
      'src/web/components/ui/sidebar.tsx',
      'src/web/components/ui/button.tsx',
      'src/web/components/ui/input-variants.ts',
      'src/web/components/ui/native-select.tsx',
      'src/web/components/ui/select.tsx',
      'src/web/components/ui/tabs.tsx',
      'src/web/components/ui/toggle.tsx',
      'src/web/components/ui/dropdown-menu.tsx',
      'src/web/components/ui/combobox.tsx',
      'src/web/components/ui/command.tsx',
      'src/web/components/ui/calendar.tsx',
      'src/web/components/form/date-field.tsx',
      'src/web/components/ui/checkbox.tsx',
      'src/web/components/ui/radio-group.tsx',
      'src/web/components/ui/switch.tsx',
    ],
    rules: {
      'better-tailwindcss/no-restricted-classes': [
        'error',
        { restrict: restrict(classRulesExcept('important', 'viewport-variant')) },
      ],
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
      ...['app', 'web', 'domain', 'contract', 'server', 'cli', 'connectors'].map(
        (dir) => `src/${dir}/**/*.{ts,tsx}`,
      ),
      'tests/lint/fixtures/product-name*.{ts,tsx}',
    ],
    ignores: ['src/domain/brand.ts'],
    plugins: { brand: productName },
    rules: { 'brand/no-product-name': 'error' },
  },
  // The words people read come from the glossary: src/domain/words.ts (v2, docs/design/copy.md) in
  // src/app, src/domain/words-v1.ts (docs/design/voice.md) in the old front end and the server.
  ...plainWordsConfigs,
  ...boundaryConfigs,
)
