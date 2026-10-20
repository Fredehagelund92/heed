import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { productNameFrom } from './src/domain/brand.ts'

const webRoot = fileURLToPath(new URL('./src/web', import.meta.url))
const bootstrapPath = fileURLToPath(new URL('./src/web/theme-bootstrap.js', import.meta.url))

/**
 * Inlines theme-bootstrap.js into <head> so the appearance is applied before first paint.
 * The same file is unit tested, so the inlined code and the tested code cannot drift.
 */
function appearanceBootstrap(): Plugin {
  return {
    name: 'context-layer:appearance-bootstrap',
    transformIndexHtml: {
      order: 'pre',
      handler: () => [
        {
          tag: 'script',
          // Drop full-line comments: the file is documented for people, not for the wire.
          children: readFileSync(bootstrapPath, 'utf8').replace(/^\s*\/\/.*\n/gm, ''),
          injectTo: 'head-prepend',
        },
      ],
    },
  }
}

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
    name: 'context-layer:product-title',
    configResolved(config) {
      name = productNameFrom((config.env as Record<string, string | undefined>).CL_PRODUCT_NAME)
    },
    transformIndexHtml: (html) =>
      html.replace('%PRODUCT_NAME%', () =>
        name.replace(/[&<>"]/g, (char) => HTML_ENTITIES[char] ?? char),
      ),
  }
}

const apiVersionPath = fileURLToPath(new URL('./src/web/api/api-version.json', import.meta.url))

/**
 * Serves the contract the build speaks at /heed-version.json, beside the app: the app reads it when
 * the service names another contract, to tell a page left open from before an update from a
 * service started before it (src/web/api/api-version.ts).
 */
function versionFile(): Plugin {
  const fileName = 'heed-version.json'
  return {
    name: 'context-layer:version-file',
    configureServer(server) {
      server.middlewares.use(`/${fileName}`, (_request, response) => {
        response.setHeader('content-type', 'application/json')
        response.setHeader('cache-control', 'no-store')
        response.end(readFileSync(apiVersionPath))
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName, source: readFileSync(apiVersionPath, 'utf8') })
    },
  }
}

// With VITE_API_MODE=http the app calls /api/v1 on its own origin; the dev and preview servers
// forward it to the Heed service (`npm run dev:server`). Only the versioned prefix: the dev server
// serves the web's own src/web/api modules under /api.
const apiProxy = { '/api/v1': process.env.HEED_API_URL ?? 'http://127.0.0.1:3000' }

export default defineConfig({
  root: webRoot,
  envDir: fileURLToPath(new URL('.', import.meta.url)),
  // VITE_ variables, and the product's name the service reads too (src/web/lib/brand.ts).
  envPrefix: ['VITE_', 'CL_PRODUCT_NAME'],
  resolve: { tsconfigPaths: true },
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: `${webRoot}/routes`,
      generatedRouteTree: `${webRoot}/routeTree.gen.ts`,
    }),
    react(),
    tailwindcss(),
    appearanceBootstrap(),
    versionFile(),
    productTitle(),
  ],
  server: { port: 5173, strictPort: true, proxy: apiProxy },
  preview: { port: 4173, strictPort: true, proxy: apiProxy },
  build: {
    outDir: fileURLToPath(new URL('./dist/web', import.meta.url)),
    emptyOutDir: true,
    sourcemap: 'hidden',
    // The first load (every module the entry imports, Rolldown's `$initial`) in three files rather
    // than the fifty-odd small shared chunks automatic splitting cut it into: each file is
    // compressed alone and binds its imports by name, which cost about 18 KB gzip. React and the
    // other libraries change less often than the app, so they keep their own cached files. Lazy
    // route chunks still split automatically.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              tags: ['$initial'],
              priority: 2,
            },
            { name: 'libs', test: /[\\/]node_modules[\\/]/, tags: ['$initial'], priority: 1 },
            { name: 'app', tags: ['$initial'] },
          ],
        },
      },
    },
  },
})
