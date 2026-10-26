/// <reference types="vitest/config" />
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { PRODUCT } from './src/lib/brand.ts'

// The page title and description name the product from the one constant in src/lib/brand.ts.
const brand: Plugin = { name: 'brand', transformIndexHtml: (html) => html.replaceAll('%PRODUCT%', PRODUCT) }

export default defineConfig({
  // Relative asset paths, so the static build opens from any folder or host path.
  base: './',
  plugins: [react(), tailwindcss(), brand],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: { port: 5192 },
  // The app chunk is React DOM and Base UI (about 260 kB gzipped), which every screen needs; the
  // editor's Tiptap loads as its own chunk. Warn only past that.
  build: { chunkSizeWarningLimit: 900 },
  // Unit tests only: the Playwright journeys in e2e/ run with `npm run e2e`.
  test: { include: ['src/**/*.test.ts'] },
})
