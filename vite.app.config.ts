import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { helpDocs } from './scripts/docs-plugin.ts'
import { storageKey } from './src/app/lib/brand.ts'
import { productNameFrom } from './src/domain/brand.ts'

/*
  The web app in src/app: the approved mockup (apps/mockup) on the repository's router, icon
  module and class merge. `npm run dev` serves it and `npm run build` builds it to dist/app. Its
  pages read their data through one typed API (src/app/api): the mock binding by default, the Heed
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
 * The product's name in the page title before the app runs (src/app/lib/brand.ts): the same
 * `CL_PRODUCT_NAME` the app and the service read, so the tab does not flash another name.
 */
export function productTitle(): Plugin {
  let name = productNameFrom(undefined)
  return {
    name: 'heed-app:product-title',
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
const appRoot = fileURLToPath(new URL('./src/app', import.meta.url))
const bootstrapPath = fileURLToPath(new URL('./src/app/theme-bootstrap.js', import.meta.url))

/**
 * Inlines theme-bootstrap.js into <head>, with the storage key from lib/brand.ts, so the theme is
 * applied before first paint. tests/app/theme-bootstrap.test.ts runs the same file.
 */
export function themeBootstrap(): Plugin {
  return {
    name: 'heed-app:theme-bootstrap',
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

export default defineConfig(({ mode }) => ({
  root: appRoot,
  envDir: root,
  // VITE_ variables, the product's name the service reads too (src/app/lib/brand.ts), and the
  // support address Contact support and Report a problem write to (src/app/lib/help-content.ts).
  envPrefix: ['VITE_', 'CL_PRODUCT_NAME', 'CL_SUPPORT_EMAIL'],
  resolve: {
    tsconfigPaths: true,
    // The binding the app talks to (src/app/api/binding.ts): the mock, unless VITE_API_MODE=http
    // asks for the Heed service, so neither build carries the other.
    alias:
      loadEnv(mode, root, 'VITE_').VITE_API_MODE === 'http'
        ? [{ find: /^\.\/binding$/, replacement: `${appRoot}/api/binding-http.ts` }]
        : [],
  },
  plugins: [
    // The pages load with the app, as the mockup's do; the review and the editors, which carry
    // Tiptap, are lazy routes of their own (routes/**/*.lazy.tsx), fetched once the browser is
    // idle after the first page (main.tsx).
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: false,
      routesDirectory: `${appRoot}/routes`,
      generatedRouteTree: `${appRoot}/routeTree.gen.ts`,
    }),
    react(),
    tailwindcss(),
    // The documentation's pages (docs/help), read at build time.
    helpDocs(),
    themeBootstrap(),
    productTitle(),
  ],
  // With VITE_API_MODE=http the app calls the Heed service at /api/v1 on its own origin; these
  // forward it there (`npm run dev:server`).
  server: { port: 5173, strictPort: true, proxy: apiProxy },
  preview: { port: 4173, strictPort: true, proxy: apiProxy },
  build: {
    outDir: fileURLToPath(new URL('./dist/app', import.meta.url)),
    emptyOutDir: true,
    sourcemap: 'hidden',
  },
}))
