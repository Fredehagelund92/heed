import { readdir, readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { parse } from 'yaml'

/*
  A Cube on this machine for tests: the parts of Cube's REST API figures use, `GET
  /cubejs-api/v1/load?query=...` and `GET /cubejs-api/v1/meta`, over plain http on 127.0.0.1, answering from a warehouse in
  PostgreSQL (demo-warehouse.ts) through a Cube model's YAML files (the demo model in db/seed/cube
  by default). It reads each view member's cube table and SQL from the model and runs the query
  as Cube would for what figures ask: one measure (sum, count, avg, min, max, or a number's own
  SQL), one date range on a time dimension, `equals` filters. Its token is invented when it
  starts and lives in memory only: no real key or token is ever in a test, a fixture or a log.

  It answers as Cube does: the rows under `data`, numbers as strings, `lastRefreshTime`, and the
  measure's format and meta under `annotation`; a token it doesn't know with 401. It records every
  request, so a test can prove what reached it and that nothing named a person, and it can say
  "Continue wait", answer slowly or fail, to test how a read takes it.
*/

interface Member {
  table: string
  sql: string
  type: string
  title?: string
  format?: string
  meta?: Record<string, unknown>
}

export interface CubeRequest {
  path: string
  authorization: string | null
  query: unknown
  /** Every header the request carried, by name, so a test can look for one that names a person. */
  headers: Record<string, string>
}

type CubeQuery = {
  measures?: string[]
  timeDimensions?: { dimension: string; dateRange?: [string, string] }[]
  filters?: { member: string; operator: string; values: string[] }[]
}

const demoModel = fileURLToPath(new URL('../../../db/seed/cube/', import.meta.url))

/** The members of each view, from the model's YAML: `orders.orders` to its cube's table and SQL. */
async function membersOf(modelDir: string): Promise<Map<string, Member>> {
  type Raw = {
    name: string
    sql?: string
    type: string
    title?: string
    format?: string
    meta?: Record<string, unknown>
  }
  const cubes = new Map<string, { table: string; members: Map<string, Raw> }>()
  const views: { name: string; cubes: { join_path: string; includes: string[] }[] }[] = []
  for (const file of (await readdir(modelDir)).filter((f) => /\.ya?ml$/.test(f))) {
    const model = parse(await readFile(`${modelDir}/${file}`, 'utf8')) as {
      cubes?: { name: string; sql_table: string; measures?: Raw[]; dimensions?: Raw[] }[]
      views?: typeof views
    }
    for (const cube of model.cubes ?? [])
      cubes.set(cube.name, {
        table: cube.sql_table,
        members: new Map(
          [...(cube.measures ?? []), ...(cube.dimensions ?? [])].map((m) => [m.name, m]),
        ),
      })
    views.push(...(model.views ?? []))
  }
  const members = new Map<string, Member>()
  for (const view of views)
    for (const joined of view.cubes) {
      const cube = cubes.get(joined.join_path)
      if (!cube) continue
      for (const name of joined.includes) {
        const raw = cube.members.get(name)
        if (raw)
          members.set(`${view.name}.${name}`, {
            table: cube.table,
            sql: raw.sql ?? name,
            type: raw.type,
            ...(raw.title ? { title: raw.title } : {}),
            ...(raw.format ? { format: raw.format } : {}),
            ...(raw.meta ? { meta: raw.meta } : {}),
          })
      }
    }
  return members
}

/** A measure's SQL as Cube writes it for its type. */
function measureSql(member: Member) {
  const aggregate = { sum: 'sum', count: 'count', avg: 'avg', min: 'min', max: 'max' }[member.type]
  return aggregate ? `${aggregate}(${member.sql})` : `(${member.sql})`
}

/**
 * Starts the stand-in Cube over a warehouse. `token` is invented here unless a test names one;
 * `lastRefreshTime` is what it says its data was last refreshed at.
 */
export async function cubeHost({
  warehouse,
  modelDir = demoModel,
  token = `cube-test-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`,
  lastRefreshTime = new Date().toISOString(),
}: {
  /** The warehouse's connection string. */
  warehouse: string
  modelDir?: string
  token?: string
  lastRefreshTime?: string
}) {
  const members = await membersOf(modelDir)
  const pool = new pg.Pool({ connectionString: warehouse, max: 4 })
  pool.on('error', () => undefined)
  const requests: CubeRequest[] = []
  const answering = new Set<Promise<void>>()
  let waits = 0
  let delayMs = 0
  let failures: number[] = []

  /** The views and their measures with how each is worked out, as `/v1/meta` answers. */
  const meta = () => {
    const views = new Map<string, { name: string; type: 'number'; aggType: string }[]>()
    for (const [name, member] of members)
      if (!['time', 'string', 'boolean'].includes(member.type)) {
        const view = name.slice(0, name.indexOf('.'))
        views.set(view, [
          ...(views.get(view) ?? []),
          { name, type: 'number', aggType: member.type },
        ])
      }
    return { cubes: [...views].map(([name, measures]) => ({ name, type: 'view', measures })) }
  }

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  async function load(query: CubeQuery) {
    const [measure, ...more] = query.measures ?? []
    const metric = measure ? members.get(measure) : undefined
    if (!metric || more.length) throw new Error('One measure of the model, please')
    const values: unknown[] = []
    const where: string[] = []
    for (const time of query.timeDimensions ?? []) {
      const dimension = members.get(time.dimension)
      if (!dimension || dimension.type !== 'time' || dimension.table !== metric.table)
        throw new Error(`Unknown time dimension ${time.dimension}`)
      if (time.dateRange) {
        values.push(time.dateRange[0], time.dateRange[1])
        where.push(
          `${dimension.sql} >= $${values.length - 1}::date and ${dimension.sql} < $${values.length}::date + 1`,
        )
      }
    }
    for (const filter of query.filters ?? []) {
      const dimension = members.get(filter.member)
      if (!dimension || filter.operator !== 'equals' || dimension.table !== metric.table)
        throw new Error(`Unknown filter ${filter.member}`)
      values.push(filter.values)
      where.push(`${dimension.sql}::text = any($${values.length}::text[])`)
    }
    const sql = `select ${measureSql(metric)}::text as value from ${metric.table}${
      where.length ? ` where ${where.join(' and ')}` : ''
    }`
    const { rows } = await pool.query<{ value: string | null }>(sql, values)
    return {
      query,
      data: [{ [measure!]: rows[0]?.value ?? null }],
      lastRefreshTime,
      annotation: {
        measures: {
          [measure!]: {
            title: metric.title ?? measure,
            shortTitle: metric.title ?? measure,
            type: 'number',
            ...(metric.format ? { format: metric.format } : {}),
            ...(metric.meta ? { meta: metric.meta } : {}),
          },
        },
        dimensions: {},
        segments: {},
        timeDimensions: {},
      },
    }
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const answer = (async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      let query: unknown
      try {
        query = JSON.parse(url.searchParams.get('query') ?? 'null') as unknown
      } catch {
        query = null
      }
      requests.push({
        path: url.pathname,
        authorization: req.headers.authorization ?? null,
        query,
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([name, value]) => [name, String(value)]),
        ),
      })
      if (
        req.method !== 'GET' ||
        !['/cubejs-api/v1/load', '/cubejs-api/v1/meta'].includes(url.pathname)
      )
        return send(res, 404, { error: 'Not found' })
      const given = (req.headers.authorization ?? '').replace(/^Bearer /, '')
      if (given !== token) return send(res, 401, { error: 'Invalid token' })
      // The model's views and their measures, as Cube's meta lists them.
      if (url.pathname === '/cubejs-api/v1/meta') return send(res, 200, meta())
      const failure = failures.shift()
      if (failure !== undefined) return send(res, failure, { error: 'Planned failure' })
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
      if (waits > 0) {
        waits -= 1
        return send(res, 200, { error: 'Continue wait' })
      }
      try {
        send(res, 200, await load(query as CubeQuery))
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : 'Bad query' })
      }
    })()
    answering.add(answer)
    void answer.finally(() => answering.delete(answer))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    /** The data endpoint an administrator sets: Cube's `/v1/load`. */
    endpoint: `http://127.0.0.1:${port}/cubejs-api/v1/load`,
    token,
    requests,
    /** The next `n` loads say "Continue wait" before they answer. */
    continueWait(n: number) {
      waits = n
    },
    /** Every load waits this long before it answers. */
    slow(ms: number) {
      delayMs = ms
    },
    /** The next loads fail with these statuses, one each. */
    fail(...statuses: number[]) {
      failures = [...statuses]
    },
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await Promise.allSettled([...answering])
      await pool.end()
    },
  }
}
export type CubeHost = Awaited<ReturnType<typeof cubeHost>>
