import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { readDevPeople } from '../src/server/modules/auth/index.ts'
import { inlineScriptHashes } from './web-csp.ts'

/*
  Builds Heed for Vercel (vercel.json, docs/vercel.md): `npm run build:vercel`.

  1. The web app in http mode into dist/web, which Vercel serves as static files.
  2. Checks that vercel.json lets exactly the built page's inline scripts run.
  3. The service bundled into one file, dist/vercel/heed.mjs, which the function api/heed.js
     exports. Bundled, the function holds a few MB rather than every package in node_modules,
     which is over Vercel's limit. Cube's native compiler and pg's native driver stay out: the
     function never loads them. Heed's version and the picker's people, which the service reads
     from files beside its code, are written into the bundle (src/server/bundled.ts).
*/

const root = fileURLToPath(new URL('../', import.meta.url))
export const bundleFile = 'dist/vercel/heed.mjs'

/** What is wrong with vercel.json's Content-Security-Policy for the built page, if anything. */
export function cspProblem(vercelJson: string, html: string): string | undefined {
  const config = JSON.parse(vercelJson) as {
    headers?: { headers: { key: string; value: string }[] }[]
  }
  const policies = (config.headers ?? [])
    .flatMap((rule) => rule.headers)
    .filter((header) => header.key.toLowerCase() === 'content-security-policy')
  if (policies.length !== 1) return 'vercel.json sets no Content-Security-Policy, or more than one'
  const scriptSrc = policies[0]!.value.split('; ').find((part) => part.startsWith('script-src '))
  const expected = ["script-src 'self'", ...inlineScriptHashes(html)].join(' ')
  if (scriptSrc === expected) return undefined
  return `vercel.json's Content-Security-Policy says "${scriptSrc ?? 'no script-src'}", but the built page needs "${expected}". Put that in vercel.json.`
}

function run(command: string, args: string[], env: Record<string, string>) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`)
}

/** The service in one file, `outfile` (absolute, or under the repository), and its size in bytes. */
export async function bundleService(
  outfile: string,
  peopleFile = process.env.HEED_DEV_PEOPLE_FILE || 'db/seed/people.local.yml',
): Promise<number> {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    version: string
  }
  const people = await readDevPeople(resolve(root, peopleFile))
  await build({
    absWorkingDir: root,
    entryPoints: ['src/server/vercel.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node26',
    external: ['@cubejs-backend/native', 'pg-native'],
    // Packages written as CommonJS call require, which an ES module does not have.
    banner: {
      js: "import { createRequire as heedCreateRequire } from 'node:module'; const require = heedCreateRequire(import.meta.url);",
    },
    define: { HEED_BUNDLE: JSON.stringify(JSON.stringify({ version, people })) },
    legalComments: 'none',
    logLevel: 'warning',
  })
  return statSync(resolve(root, outfile)).size
}

async function main() {
  // A production build whatever NODE_ENV the deployment's service runs with.
  run('npx', ['vite', 'build'], { VITE_API_MODE: 'http', NODE_ENV: 'production' })
  const problem = cspProblem(
    readFileSync(join(root, 'vercel.json'), 'utf8'),
    readFileSync(join(root, 'dist/web/index.html'), 'utf8'),
  )
  if (problem) throw new Error(problem)
  const megabytes = (await bundleService(bundleFile)) / 1024 / 1024
  console.log(`Bundled the service into ${bundleFile} (${megabytes.toFixed(1)} MB)`)
}

if (import.meta.main) await main()
