import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { docFiles, helpDocs, loadDocs } from './scripts/docs-plugin.ts'
import { llmsFullTxt, llmsTxt } from './src/domain/docs.ts'
import { storageKey } from './src/web/lib/brand.ts'
import { productNameFrom } from './src/domain/brand.ts'

/*
  The web app in src/web: the approved mockup (apps/mockup) on the repository's router, icon
  module and class merge. `npm run dev` serves it and `npm run build` builds it to dist/web. Its
  pages read their data through one typed API (src/web/api): the mock binding by default, the Heed
  service with VITE_API_MODE=http.
*/

const apiProxy = { '/api/v1': process.env.HEED_API_URL ?? 'http://127.0.0.1:3000' }

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
}

/**
 * The product's name in the page title before the app runs (src/web/lib/brand.ts): the same
 * `CL_PRODUCT_NAME` the app and the service read, so the tab does not flash another name.
 */
export function productTitle(): Plugin {
  let name = productNameFrom(undefined)
  return {
    name: 'heed-web:product-title',
    configResolved(config) {
      name = productNameFrom((config.env as Record<string, string | undefined>).CL_PRODUCT_NAME)
    },
    transformIndexHtml: (html) =>
      html.replace('%PRODUCT_NAME%', () =>
        name.replace(/[&<>"]/g, (char) => HTML_ENTITIES[char] ?? char),
      ),
  }
}

const root = fileURLToPath(new URL('.', import.meta.url))
const webRoot = fileURLToPath(new URL('./src/web', import.meta.url))
const bootstrapPath = fileURLToPath(new URL('./src/web/theme-bootstrap.js', import.meta.url))

/**
 * Inlines theme-bootstrap.js into <head>, with the storage key from lib/brand.ts, so the theme is
 * applied before first paint. tests/web/theme-bootstrap.test.ts runs the same file.
 */
export function themeBootstrap(): Plugin {
  return {
    name: 'heed-web:theme-bootstrap',
    transformIndexHtml: {
      order: 'pre',
      handler: () => [
        {
          tag: 'script',
          // Drop full-line comments: the file is documented for people, not for the wire.
          children: readFileSync(bootstrapPath, 'utf8')
            .replace(/^\s*\/\/.*\n/gm, '')
            .replaceAll('THEME_KEY', JSON.stringify(storageKey('theme'))),
          injectTo: 'head-prepend',
        },
      ],
    },
  }
}

/**
 * The plain-text files a crawler or an agent asks the app's address for, which would otherwise get
 * the app's page: robots.txt, which keeps search engines out of a company's own workspace, and the
 * docs for agents (llmstxt.org) as the docs site writes them (scripts/docs-build.ts): llms.txt at
 * the top, where an agent looks first, and at /docs/llms.txt, where the Docs page links to it,
 * with every page in one file at /docs/llms-full.txt. Not in public/, which the docs site shares:
 * hosted on its own, it is meant to be found.
 */
export function crawlerFiles(): Plugin {
  // Where the docs open in the app (src/web/lib/doc-links.ts).
  const base = '/docs'
  return {
    name: 'heed-web:crawler-files',
    apply: 'build',
    generateBundle() {
      const files = docFiles()
      const docs = loadDocs(files)
      const emit = (fileName: string, source: string) =>
        this.emitFile({ type: 'asset', fileName, source })
      emit('robots.txt', 'User-agent: *\nDisallow: /\n')
      emit('llms.txt', llmsTxt(docs, base))
      emit('docs/llms.txt', llmsTxt(docs, base))
      emit('docs/llms-full.txt', llmsFullTxt(docs, files, base))
    },
  }
}

export default defineConfig(({ mode }) => ({
  root: webRoot,
  envDir: root,
  // VITE_ variables, the product's name the service reads too (src/web/lib/brand.ts), and the
  // support address Contact support and Report a problem write to (src/web/lib/help-content.ts).
  envPrefix: ['VITE_', 'CL_PRODUCT_NAME', 'CL_SUPPORT_EMAIL'],
  resolve: {
    tsconfigPaths: true,
    // The binding the app talks to (src/web/api/binding.ts): the mock, unless VITE_API_MODE=http
    // asks for the Heed service, so neither build carries the other.
    alias:
      loadEnv(mode, root, 'VITE_').VITE_API_MODE === 'http'
        ? [{ find: /^\.\/binding$/, replacement: `${webRoot}/api/binding-http.ts` }]
        : [],
  },
  plugins: [
    // The Inbox and Ask load with the app; every other page is a lazy route of its own
    // (routes/**/*.lazy.tsx), fetched when a link to it is hovered or once the browser is idle
    // after the first page (main.tsx). scripts/check-bundle-size.mjs holds the first load to its
    // budget.
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: false,
      routesDirectory: `${webRoot}/routes`,
      generatedRouteTree: `${webRoot}/routeTree.gen.ts`,
    }),
    react(),
    tailwindcss(),
    // The documentation's pages (docs/help), read at build time.
    helpDocs(),
    themeBootstrap(),
    productTitle(),
    crawlerFiles(),
  ],
  // With VITE_API_MODE=http the app calls the Heed service at /api/v1 on its own origin; these
  // forward it there (`npm run dev:server`).
  server: { port: 5173, strictPort: true, proxy: apiProxy },
  preview: { port: 4173, strictPort: true, proxy: apiProxy },
  build: {
    outDir: fileURLToPath(new URL('./dist/web', import.meta.url)),
    emptyOutDir: true,
    sourcemap: 'hidden',
  },
}))
