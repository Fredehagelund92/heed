import { defineConfig, devices } from '@playwright/test'

/*
  The daily check of the Norway show (docs/demo.md): tests/demo on a production build in http
  mode against the service, on a fresh show database. `npm run demo:check` (scripts/demo.ts)
  makes that database, names it in DEMO_DATABASE_URL and DEMO_DATABASE_SERVE_URL, runs this and
  drops the database again. Its ports are its own (3310 and 5310 unless PW_DEMO_API_PORT and
  PW_DEMO_WEB_PORT say otherwise), so it never tests a server another run left behind.
*/

const webPort = Number(process.env.PW_DEMO_WEB_PORT ?? 5310)
const apiPort = Number(process.env.PW_DEMO_API_PORT ?? 3310)
const apiUrl = `http://127.0.0.1:${apiPort}`
const database = process.env.DEMO_DATABASE_URL

export default defineConfig({
  testDir: 'tests/demo',
  outputDir: 'test-results/demo',
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    reducedMotion: 'reduce',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 } }],
  webServer: [
    {
      command: 'node src/server/main.ts',
      url: `${apiUrl}/health/ready`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        PORT: String(apiPort),
        LOG_LEVEL: 'warn',
        DATABASE_URL: database ?? '',
        ...(process.env.DEMO_DATABASE_SERVE_URL
          ? { DATABASE_URL_SERVE: process.env.DEMO_DATABASE_SERVE_URL }
          : {}),
        CL_WEB_ORIGINS: `http://localhost:${webPort}`,
        MCP_RESOURCE_URL: `http://localhost:${apiPort}/mcp`,
        CL_DEV_PEOPLE_FILE: 'db/seed/people.local.yml',
        CUBE_MODEL_DIR: 'db/seed/cube',
        MODELS: 'mock',
      },
    },
    {
      command:
        'vite build --mode e2e --outDir ../../dist/demo --emptyOutDir && ' +
        `vite preview --outDir ../../dist/demo --port ${webPort} --strictPort`,
      url: `http://localhost:${webPort}`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { VITE_API_MODE: 'http', HEED_API_URL: apiUrl },
    },
  ],
})
