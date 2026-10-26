import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { storageKey } from './src/app/lib/brand.ts'
import { productTitle } from './vite.config.ts'

/*
  The new web app in src/app (the golden plan's P2): the approved mockup, on the repository's
  router, icon module and class merge. It builds beside the old front end until it replaces it:
  `npm run dev:app` and `npm run build:app`, to dist/app. Its pages read the mockup's store and
  fixtures, the mock binding.
*/

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

export default defineConfig({
  root: appRoot,
  envDir: fileURLToPath(new URL('.', import.meta.url)),
  // VITE_ variables, and the product's name the service reads too (src/app/lib/brand.ts).
  envPrefix: ['VITE_', 'CL_PRODUCT_NAME'],
  resolve: { tsconfigPaths: true },
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
  server: { port: 5174, strictPort: true },
  preview: { port: 4174, strictPort: true },
  build: {
    outDir: fileURLToPath(new URL('./dist/app', import.meta.url)),
    emptyOutDir: true,
    sourcemap: 'hidden',
  },
})
