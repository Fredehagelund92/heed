import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { storageKey } from './src/app/lib/brand.ts'
import { productTitle } from './vite.config.ts'

/*
  The new web app in src/app (the golden plan's P2): the approved mockup, on the repository's
  router, icon module and class merge. It builds beside the old front end until it replaces it:
  `npm run dev:app` and `npm run build:app`, to dist/app. Its pages read their data through one
  typed API (src/app/api): the mock binding by default, the Heed service with VITE_API_MODE=http.
*/

const apiProxy = { '/api/v1': process.env.HEED_API_URL ?? 'http://127.0.0.1:3000' }

const root = fileURLToPath(new URL('.', import.meta.url))
const appRoot = fileURLToPath(new URL('./src/app', import.meta.url))
const bootstrapPath = fileURLToPath(new URL('./src/app/theme-bootstrap.js', import.meta.url))

/**
 * Inlines theme-bootstrap.js into <head>, with the storage key from lib/brand.ts, so the theme is
 * applied before first paint. tests/app/theme-bootstrap.test.ts runs the same file.
 */
function themeBootstrap(): Plugin {
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
  // VITE_ variables, and the product's name the service reads too (src/app/lib/brand.ts).
  envPrefix: ['VITE_', 'CL_PRODUCT_NAME'],
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
    themeBootstrap(),
    productTitle(),
  ],
  // With VITE_API_MODE=http the app calls the Heed service at /api/v1 on its own origin; these
  // forward it there (`npm run dev:server`), as the front end's do.
  server: { port: 5174, strictPort: true, proxy: apiProxy },
  preview: { port: 4174, strictPort: true, proxy: apiProxy },
  build: {
    outDir: fileURLToPath(new URL('./dist/app', import.meta.url)),
    emptyOutDir: true,
    sourcemap: 'hidden',
  },
}))
