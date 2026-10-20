import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Storybook gets its own small Vite config: no router plugin, no HTML bootstrap, no app root.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [react(), tailwindcss()],
  // The product's name (src/web/lib/brand.ts), as the app's own build reads it.
  envPrefix: ['VITE_', 'CL_PRODUCT_NAME'],
  // Stories pick a mock scenario and person (story-app.tsx); a production build ignores them
  // unless this is on (src/web/api/mock-scenario.ts).
  define: { 'import.meta.env.VITE_MOCK_CONTROLS': JSON.stringify('true') },
})
