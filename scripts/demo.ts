import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { databaseName, migrateDatabase, onDatabase } from '../db/prepare.ts'
import { loadDemo } from '../db/seed/demo.ts'
import { norwayLibrary, norwayShow } from '../db/seed/norway.ts'
import { identifier } from '../src/server/db/roles.ts'

/*
  The Norway show (docs/demo.md): Heed on the show's library (db/seed/norway.ts), on a
  database of its own (`heed_demo`) and its own ports (3300 and 5300), apart from everything else
  on this computer. It needs Node and the local PostgreSQL 18, as the service does.

    npm run demo          builds the show's database again from nothing (about a minute), builds the
                          web app, then runs the service and the web app until Ctrl+C, and prints
                          what to open and the line that connects Claude Code
    npm run demo:check    the daily check: the whole show, headless, on a database of its own
                          (tests/demo/norway.spec.ts); fails loudly at the first step that
                          breaks. `-- --screenshots <folder>` saves the screen of each step,
                          `-- --keep` keeps its database to look at afterwards.

  HEED_DEMO_PORT and HEED_DEMO_WEB_PORT move the show's ports; PW_DEMO_API_PORT and
  PW_DEMO_WEB_PORT the check's (3310 and 5310). Keys and the web build live in ~/.heed-demo.
*/

const usage = `Usage: npm run demo | npm run demo:check [-- --screenshots <folder>] [--keep]
See docs/demo.md.`

class ShowError extends Error {}

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const vite = join(repoRoot, 'node_modules/vite/bin/vite.js')
const home = join(homedir(), '.heed-demo')
/** The local PostgreSQL server as its superuser, who creates, drops and seeds the show's database. */
const postgres = 'postgres://localhost:5432/postgres'

type Show = { database: string; port: number; webPort: number }

const urls = (show: Show) => {
  const as = (user: string) => {
    const url = new URL(onDatabase(postgres, show.database))
    url.username = user
    return url.href
  }
  return {
    seed: onDatabase(postgres, show.database),
    owner: as('context_layer_owner'),
    api: as('context_layer_api'),
    serve: as('context_layer_serve'),
    service: `http://127.0.0.1:${show.port}`,
    web: `http://localhost:${show.webPort}`,
    mcp: `http://localhost:${show.port}/mcp`,
  }
}

async function withServer<T>(use: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: postgres })
  try {
    await client.connect()
  } catch (error) {
    throw new ShowError(
      `PostgreSQL is not reachable at localhost:5432 (${(error as Error).message}). Start it with: brew services start postgresql@18`,
    )
  }
  try {
    return await use(client)
  } finally {
    await client.end()
  }
}

async function dropDatabase(show: Show) {
  await withServer((client) =>
    client.query(`drop database if exists ${identifier(show.database)} with (force)`),
  )
}

/** Drops the show's database when it is there, then creates, migrates and seeds it again. */
async function build(show: Show) {
  const started = performance.now()
  await dropDatabase(show)
  try {
    const { applied } = await migrateDatabase({
      bootstrapUrl: postgres,
      migrateUrl: urls(show).owner,
    })
    const client = new pg.Client({ connectionString: urls(show).seed })
    await client.connect()
    try {
      const added = await loadDemo(client, { items: norwayLibrary() })
      console.log(
        `Built ${databaseName(urls(show).seed)}: ${applied} migrations, ${added.items.toLocaleString('en')} demo items, their quality history and gaps, in ${((performance.now() - started) / 1000).toFixed(0)} s`,
      )
    } finally {
      await client.end()
    }
  } catch (error) {
    await dropDatabase(show)
    throw error
  }
}

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

async function freePorts(ports: number[], hint: string) {
  for (const port of ports)
    if (await portInUse(port))
      throw new ShowError(`Port ${port} is taken. Stop what runs there, or set ${hint}.`)
}

/** Only what a process needs: no variable of the calling shell leaks in. */
function baseEnv(): Record<string, string> {
  return Object.fromEntries(
    ['PATH', 'HOME', 'TMPDIR', 'LANG', 'TZ'].flatMap((name) =>
      process.env[name] ? [[name, process.env[name]]] : [],
    ),
  )
}

function run(args: string[], env: Record<string, string>): ChildProcess {
  return spawn(process.execPath, args, { cwd: repoRoot, env, stdio: 'inherit' })
}

function exited(child: ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) resolve(child.exitCode)
    else child.once('exit', (code) => resolve(code ?? 1))
  })
}

/** Waits until an address answers, or the process stops; two minutes at most. */
async function waitUntilUp(url: string, child: ChildProcess, what: string) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new ShowError(`The ${what} stopped; its output is above.`)
    const up = await fetch(url, { signal: AbortSignal.timeout(2000) }).then(
      (response) => response.ok,
      () => false,
    )
    if (up) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new ShowError(`The ${what} did not answer within two minutes; its output is above.`)
}

async function start(show: Show) {
  const at = urls(show)
  await freePorts([show.port, show.webPort], 'HEED_DEMO_PORT and HEED_DEMO_WEB_PORT')
  await build(show)
  const keys = join(home, 'keys')
  const webBuild = join(home, 'web')
  await mkdir(keys, { recursive: true, mode: 0o700 })
  const webEnv = { ...baseEnv(), VITE_API_MODE: 'http', HEED_API_URL: at.service }
  console.log('Building the web app...')
  const built = await exited(
    spawn(
      process.execPath,
      [vite, 'build', '--outDir', webBuild, '--emptyOutDir', '--logLevel', 'warn'],
      {
        cwd: repoRoot,
        env: webEnv,
        stdio: 'inherit',
      },
    ),
  )
  if (built !== 0) throw new ShowError('The web app did not build; its output is above.')

  const service = run(['src/server/main.ts'], {
    ...baseEnv(),
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: String(show.port),
    LOG_LEVEL: 'warn',
    DATABASE_URL: at.api,
    CL_AUTH: 'dev',
    CL_DEV_PEOPLE_FILE: 'db/seed/people.local.yml',
    CL_WEB_ORIGINS: at.web,
    MODELS: 'mock',
    CUBE_MODEL_DIR: 'db/seed/cube',
    MCP_RESOURCE_URL: at.mcp,
    MCP_DEV_KEY_FILE: join(keys, 'mcp-dev-key.pem'),
    CL_MCP_STATE_KEY_FILE: join(keys, 'mcp-state.key'),
    CL_OAUTH_SIGNING_KEY_FILE: join(keys, 'oauth-key.pem'),
  })
  const web = run(
    [vite, 'preview', '--outDir', webBuild, '--port', String(show.webPort), '--strictPort'],
    webEnv,
  )
  const stop = () => {
    service.kill('SIGTERM')
    web.kill('SIGTERM')
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    await waitUntilUp(`${at.service}/health/ready`, service, 'service')
    await waitUntilUp(at.web, web, 'web app')
  } catch (error) {
    stop()
    throw error
  }
  console.log(`
The Norway show is running: database ${show.database}, models mock (scripted, nothing spent).

  Web app   ${at.web}   sign in as Maria Lindqvist, Jon Abara or Ravi Kapoor
  Service   ${at.service}

Connect Claude Code to the show once (it signs in through the web app's consent page):

  claude mcp add --transport http heed-demo ${at.mcp}

Then follow docs/demo.md. Ask Claude: "${norwayShow.questions.norway}"
Ctrl+C stops it; the next npm run demo builds the show fresh.`)
  // Whichever stops first, the other follows.
  const code = await Promise.race([exited(service), exited(web)])
  stop()
  await Promise.all([exited(service), exited(web)])
  process.exitCode = code === 0 || code === null ? 0 : code
}

/** The daily check: the show, headless, on a database and ports of its own. */
async function check(args: string[]) {
  const at = args.indexOf('--screenshots')
  const screenshots = at >= 0 ? args[at + 1] : undefined
  if (
    (at >= 0 && !screenshots) ||
    args.some((arg, i) => arg !== '--keep' && i !== at && i !== at + 1)
  )
    throw new ShowError(usage)
  const show: Show = {
    database: 'heed_demo_check',
    port: Number(process.env.PW_DEMO_API_PORT ?? 3310),
    webPort: Number(process.env.PW_DEMO_WEB_PORT ?? 5310),
  }
  await freePorts(
    [show.port, show.webPort],
    'PW_DEMO_API_PORT and PW_DEMO_WEB_PORT; the check starts servers of its own',
  )
  await build(show)
  try {
    const code = await exited(
      spawn('npx', ['playwright', 'test', '-c', 'playwright.demo.config.ts', '--workers=1'], {
        cwd: repoRoot,
        stdio: 'inherit',
        env: {
          ...process.env,
          PW_DEMO_API_PORT: String(show.port),
          PW_DEMO_WEB_PORT: String(show.webPort),
          DEMO_DATABASE_URL: urls(show).api,
          DEMO_DATABASE_SERVE_URL: urls(show).serve,
          ...(screenshots ? { DEMO_SCREENSHOTS: screenshots } : {}),
        },
      }),
    )
    console.log(
      code === 0
        ? 'The Norway show runs end to end.'
        : 'THE NORWAY SHOW IS BROKEN: the step above failed. Fix it before the next rehearsal.',
    )
    process.exitCode = code
  } finally {
    if (args.includes('--keep')) console.log(`Kept the check's database ${show.database}.`)
    else await dropDatabase(show)
  }
}

const [command, ...args] = process.argv.slice(2)
try {
  if (command === 'start' && !args.length)
    await start({
      database: 'heed_demo',
      port: Number(process.env.HEED_DEMO_PORT ?? 3300),
      webPort: Number(process.env.HEED_DEMO_WEB_PORT ?? 5300),
    })
  else if (command === 'check') await check(args)
  else throw new ShowError(usage)
} catch (error) {
  if (!(error instanceof ShowError)) throw error
  console.error(error.message)
  process.exitCode = 1
}
