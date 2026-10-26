import { defineConfig } from "@playwright/test"

// One spec per job (e2e/j1 to j7), the v1 flows as acceptance tests. They run against the mockup
// now, on the installed Chrome, and against the real app later: set BASE_URL and nothing else.

const local = "http://localhost:5310/"

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: process.env.BASE_URL ?? local,
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  // The motion journeys run twice: as most people see them, and with reduced motion, where nothing
  // may move and every result must still arrive.
  projects: [
    { name: "chrome" },
    { name: "reduced-motion", testMatch: /j29-motion/, use: { reducedMotion: "reduce" } },
  ],
  // A production build served as is: no module is compiled on first visit, so a journey never waits
  // on the dev server under parallel load.
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "npx vite build --outDir node_modules/.e2e-dist --emptyOutDir --logLevel warn && npx vite preview --port 5310 --strictPort --outDir node_modules/.e2e-dist",
        url: local,
        reuseExistingServer: false,
      },
})
