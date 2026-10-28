import * as z from 'zod/mini'
import {
  SourceError,
  type FigureContext,
  type FigureFormat,
  type FigureQuery,
  type FigureResult,
} from '../../domain/connector-runtime.ts'

/*
  Figures from Cube (CON-612, FR-716): one GET of Cube's REST API, `/v1/load`, at the data
  endpoint an administrator set, with the service token from the secret store, and, once in ten
  minutes, `/v1/meta` beside it for how each measure is worked out (its `aggType`), so the query
  in words can say "added up". The query is the
  core's fixed template (one measure, one date range, `equals` filters), so nothing a person or a
  model wrote reaches Cube. Cube answers from its cache or the warehouse; while a query is still
  running it says "Continue wait", and the read asks again until the figure's time limit. Nothing
  it returns is kept.
*/

/** The most of an answer read: one row is a few hundred bytes. */
export const FIGURE_ANSWER_BYTES_MAX = 256_000

/** The most of `/v1/meta` read: a large model's list of members, names and types only kept. */
export const META_ANSWER_BYTES_MAX = 5_000_000
/** How long what `/v1/meta` said of the measures is kept in this process. */
const META_KEPT_MS = 10 * 60_000

/** How long to wait before asking again while Cube says "Continue wait". */
const CONTINUE_WAIT_MS = 250

const answerSchema = z.object({
  error: z.optional(z.string()),
  data: z.optional(z.array(z.record(z.string(), z.unknown()))),
  lastRefreshTime: z.optional(z.nullable(z.string())),
  annotation: z.optional(
    z.object({
      measures: z.optional(
        z.record(
          z.string(),
          z.object({
            format: z.optional(z.unknown()),
            meta: z.optional(z.nullable(z.record(z.string(), z.unknown()))),
          }),
        ),
      ),
    }),
  ),
})

/** Cube's REST query for one figure: the measure, its days and its values. */
export function cubeQuery(query: FigureQuery) {
  return {
    measures: [query.metric],
    timeDimensions: [{ dimension: query.date, dateRange: [query.from, query.to] }],
    filters: query.filters.map((filter) => ({
      member: filter.dimension,
      operator: 'equals',
      values: [...filter.values],
    })),
  }
}

/** How the model says the measure is written: `format: currency` with `meta.currency`, or percent. */
function formatOf(
  annotation: { format?: unknown; meta?: Record<string, unknown> | null } | undefined,
) {
  const currency = annotation?.meta?.currency
  if (
    annotation?.format === 'currency' &&
    typeof currency === 'string' &&
    /^[A-Z]{3}$/.test(currency)
  )
    return { kind: 'currency', currency } satisfies FigureFormat
  if (annotation?.format === 'percent') return { kind: 'percent' } satisfies FigureFormat
  return { kind: 'number' } satisfies FigureFormat
}

const failed = (code: string, errorClass: 'config' | 'transient' | 'source', retryAfter?: number) =>
  new SourceError({
    code,
    target: 'figures',
    class: errorClass,
    ...(retryAfter === undefined ? {} : { retryAfter }),
  })

/** The answer's text, read up to its limit: a longer one is not an answer to this query. */
async function bodyOf(response: Response, max = FIGURE_ANSWER_BYTES_MAX): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) throw failed('invalid_output', 'source')
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      throw failed('invalid_output', 'source')
    }
    chunks.push(value)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw failed('invalid_output', 'source')
  }
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(failed('timed_out', 'transient'))
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(failed('timed_out', 'transient'))
      },
      { once: true },
    )
  })

const metaSchema = z.object({
  cubes: z.array(
    z.object({
      measures: z.optional(
        z.array(z.object({ name: z.string(), aggType: z.optional(z.string()) })),
      ),
    }),
  ),
})

/**
 * What `/v1/meta` said of each measure, by endpoint and token (as a digest), for a while: the
 * answer, or the request still on its way, so two reads at once ask once.
 */
const aggregations = new Map<string, { until: number; byMeasure: Promise<Map<string, string>> }>()

/** Each measure's `aggType` from `/v1/meta` beside the endpoint's `/v1/load`; empty when it can't say. */
async function measuresOf(context: FigureContext): Promise<Map<string, string>> {
  const address = new URL(context.endpoint)
  if (!/\/load$/.test(address.pathname)) return new Map()
  address.pathname = address.pathname.replace(/\/load$/, '/meta')
  address.search = ''
  try {
    const response = await context.fetch(address.href, {
      headers: { authorization: context.token, accept: 'application/json' },
    })
    if (!response.ok) {
      await response.body?.cancel()
      return new Map()
    }
    const meta = metaSchema.safeParse(await bodyOf(response, META_ANSWER_BYTES_MAX))
    if (!meta.success) return new Map()
    return new Map(
      meta.data.cubes.flatMap((cube) =>
        (cube.measures ?? []).flatMap((m) => (m.aggType ? [[m.name, m.aggType] as const] : [])),
      ),
    )
  } catch {
    return new Map()
  }
}

/** A token's SHA-256 in hex: what keeps a token's answers apart, never the token itself. */
async function digestOf(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * How Cube works a measure out (`aggType`: sum, count, avg, number...), kept ten minutes. Null
 * when Cube doesn't say, so the words claim nothing; a failure here never fails the figure.
 */
async function aggregationOf(context: FigureContext, metric: string): Promise<string | null> {
  const key = `${context.endpoint} ${await digestOf(context.token)}`
  const at = context.now().getTime()
  let kept = aggregations.get(key)
  if (!kept || kept.until <= at) {
    kept = { until: at + META_KEPT_MS, byMeasure: measuresOf(context) }
    aggregations.set(key, kept)
    if (aggregations.size > 50) aggregations.delete(aggregations.keys().next().value!)
    // An empty answer is asked again next time, rather than kept for ten minutes.
    const asked = kept
    void asked.byMeasure.then((found) => {
      if (!found.size && aggregations.get(key) === asked) aggregations.delete(key)
    })
  }
  const type = (await kept.byMeasure).get(metric)
  return type && /^[A-Za-z]{1,40}$/.test(type) ? type : null
}

/** One figure from Cube's `/v1/load`, or a `SourceError` that says why not. */
export async function readCubeFigure(
  context: FigureContext,
  query: FigureQuery,
): Promise<FigureResult> {
  const [result, aggregation] = await Promise.all([
    loadFigure(context, query),
    aggregationOf(context, query.metric),
  ])
  return { ...result, aggregation }
}

/** The figure itself, from `/v1/load`. */
async function loadFigure(
  context: FigureContext,
  query: FigureQuery,
): Promise<Omit<FigureResult, 'aggregation'>> {
  const address = new URL(context.endpoint)
  address.searchParams.set('query', JSON.stringify(cubeQuery(query)))
  for (;;) {
    let response: Response
    try {
      // Cube takes the token as it is, or after "Bearer"; its own examples send it as it is.
      response = await context.fetch(address.href, {
        headers: { authorization: context.token, accept: 'application/json' },
      })
    } catch (error) {
      if (error instanceof SourceError) throw error
      throw failed(context.signal.aborted ? 'timed_out' : 'unreachable', 'transient')
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel()
      throw failed('unauthorized', 'config')
    }
    if (response.status === 404) {
      await response.body?.cancel()
      throw failed('not_found', 'config')
    }
    if (response.status === 429) {
      await response.body?.cancel()
      const after = Number(response.headers.get('retry-after'))
      throw failed(
        'rate_limited',
        'transient',
        Number.isFinite(after) && after > 0 ? after : undefined,
      )
    }
    if (response.status >= 500) {
      await response.body?.cancel()
      throw failed('unreachable', 'transient')
    }
    const parsed = answerSchema.safeParse(await bodyOf(response))
    if (!parsed.success) throw failed('invalid_output', 'source')
    const answer = parsed.data
    if (answer.error === 'Continue wait') {
      await pause(CONTINUE_WAIT_MS, context.signal)
      continue
    }
    // Cube's own words about a query it refused may name the model: only a code is kept.
    if (!response.ok || answer.error !== undefined || !answer.data)
      throw failed('invalid_output', 'source')
    if (answer.data.length > 1) throw failed('invalid_output', 'source')
    const raw = answer.data[0]?.[query.metric]
    const value = raw === undefined || raw === null ? null : Number(raw)
    if (value !== null && !Number.isFinite(value)) throw failed('invalid_output', 'source')
    const refreshed = answer.lastRefreshTime ? new Date(answer.lastRefreshTime) : null
    return {
      value,
      asOf: refreshed && !Number.isNaN(refreshed.getTime()) ? refreshed.toISOString() : null,
      format: formatOf(answer.annotation?.measures?.[query.metric]),
    }
  }
}
