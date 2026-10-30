import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { helpDocs } from './scripts/docs-plugin.ts'
import { productTitle, themeBootstrap } from './vite.app.config.ts'

/*
  The static docs site (npm run docs:build): the documentation's pages (docs/help) in the new app's
  design, on their own, with search and an index for agents. scripts/docs-build.ts builds it with
  this config twice, for the browser and to draw each page ahead of time, into dist/docs.
  DOCS_BASE is the path it is served under (default /docs, as in the app); VITE_DOCS_APP_URL is
  where the app is, when the site is hosted apart from it.
*/

const root = fileURLToPath(new URL('.', import.meta.url))
const appRoot = fileURLToPath(new URL('./src/app', import.meta.url))

/** The path the site is served under, without a trailing slash: `/docs`, or `` at the root. */
export const docsBase = (process.env.DOCS_BASE ?? '/docs').replace(/\/+$/, '')

export default defineConfig({
  root: fileURLToPath(new URL('./src/app/docs', import.meta.url)),
  base: `${docsBase}/`,
  envDir: root,
  envPrefix: ['VITE_', 'CL_PRODUCT_NAME', 'CL_SUPPORT_EMAIL'],
  publicDir: `${appRoot}/public`,
  define: { 'import.meta.env.VITE_DOCS_BASE': JSON.stringify(docsBase) },
  resolve: {
    tsconfigPaths: true,
    // The site talks to no service, so it carries neither binding nor the demo week.
    alias: [{ find: /^@\/api$/, replacement: `${appRoot}/docs/no-api.ts` }],
  },
  plugins: [react(), tailwindcss(), themeBootstrap(), productTitle(), helpDocs()],
  // Each page is a file of its own (privacy.html opens at /docs/privacy); no address falls back to another.
  appType: 'mpa',
  preview: { port: 4176, strictPort: true },
  build: {
    outDir: fileURLToPath(new URL('./dist/docs', import.meta.url)),
    emptyOutDir: true,
    // One script for every page: React, the search and the pages' words, about 170 KB gzipped.
    // Each page arrives drawn, so nothing waits for it to read.
    chunkSizeWarningLimit: 700,
  },
})
