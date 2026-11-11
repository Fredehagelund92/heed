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
  minutes, `/v1/meta` before it for what the model says of each measure: how it is worked out (its
  `aggType`), so the query in words can say "added up"; which of its view's dates the days apply
  to (`meta.default_time_dimension`); and whether it adds up over days at all
  (`meta.non_additive_dimension`): a snapshot is read on the last day only. The query is the core's fixed template (one measure,
  one date range, `equals` filters), so nothing a person or a model wrote reaches Cube. Cube
  answers from its cache or the warehouse; while a query is still running it says "Continue wait",
  and the read asks again until the figure's time limit. Nothing it returns is kept.
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
            currency: z.optional(z.unknown()),
            meta: z.optional(z.nullable(z.record(z.string(), z.unknown()))),
          }),
        ),
      ),
    }),
  ),
})

/** Cube's REST query for one figure: the measure, its days on the date given, and its values. */
export function cubeQuery(query: FigureQuery, date: string) {
  return {
    measures: [query.metric],
    timeDimensions: [{ dimension: date, dateRange: [query.from, query.to] }],
    filters: query.filters.map((filter) => ({
      member: filter.dimension,
      operator: 'equals',
      values: [...filter.values],
    })),
  }
}

/** What Cube says of how a measure is written: its `format`, its `currency` and its `meta`. */
interface Written {
  format?: unknown
  currency?: unknown
  meta?: Record<string, unknown> | null
}

/** A three-letter currency code, as ISO 4217 writes it; null for anything else. */
const currencyCode = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z]{3}$/.test(value) ? value.toUpperCase() : null

/**
 * The kind a Cube format names: `currency`, `percent` or `number`, or one of their named forms,
 * such as `percent_1`, that Cube answers as an object with its alias. Null for none, or another.
 */
function kindOf(format: unknown): 'currency' | 'percent' | 'number' | null {
  const name = typeof format === 'string' ? format : (format as { alias?: unknown } | null)?.alias
  if (typeof name !== 'string') return null
  return (/^(currency|percent|number)(?:_\d)?$/.exec(name)?.[1] ?? null) as ReturnType<
    typeof kindOf
  >
}

/**
 * How the measure is written. The model says first: its `format`, then its `currency` (Cube's own
 * property, or `meta.currency`), from the answer or else from `/v1/meta`; a measure with a
 * currency and no format is money. Where the model says nothing, the server's settings do. A
 * currency with no code is written as a number: which money it is is never guessed.
 */
function formatOf(written: Written[], settings: FigureQuery['settings']): FigureFormat {
  const first = <T>(read: (w: Written) => T | null) =>
    written.map(read).find((found) => found !== null) ?? null
  const named = first((w) => kindOf(w.format))
  const code = first((w) => currencyCode(w.currency) ?? currencyCode(w.meta?.currency))
  const kind =
    named ??
    (code ? 'currency' : null) ??
    settings?.format ??
    (settings?.currency ? 'currency' : 'number')
  const money = code ?? currencyCode(settings?.currency)
  if (kind === 'currency' && money) return { kind: 'currency', currency: money }
  if (kind === 'percent') return { kind: 'percent' }
  return { kind: 'number' }
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

const memberMeta = z.optional(z.nullable(z.record(z.string(), z.unknown())))
const metaSchema = z.object({
  cubes: z.array(
    z.object({
      meta: memberMeta,
      measures: z.optional(
        z.array(
          z.object({
            name: z.string(),
            aggType: z.optional(z.string()),
            format: z.optional(z.unknown()),
            currency: z.optional(z.unknown()),
            meta: memberMeta,
          }),
        ),
      ),
    }),
  ),
})

/**
 * What `/v1/meta` says of one measure: how it is worked out, how it is written, and its own and
 * its view's `meta`.
 */
interface Measure {
  aggType: string | null
  written: Written
  meta: Record<string, unknown>
  viewMeta: Record<string, unknown>
}

/**
 * What `/v1/meta` said of each measure, by endpoint and token (as a digest), for a while: the
 * answer, or the request still on its way, so two reads at once ask once.
 */
const described = new Map<string, { until: number; byMeasure: Promise<Map<string, Measure>> }>()

/**
 * Each measure as `/v1/meta` beside the endpoint's `/v1/load` describes it; empty when the
 * endpoint is not one, or the answer is not Cube's. A refusal or a failure throws, as a load's.
 */
async function measuresOf(context: FigureContext): Promise<Map<string, Measure>> {
  const address = new URL(context.endpoint)
  if (!/\/load$/.test(address.pathname)) return new Map()
  address.pathname = address.pathname.replace(/\/load$/, '/meta')
  address.search = ''
  const response = await answerOf(context, address.href)
  const meta = metaSchema.safeParse(await bodyOf(response, META_ANSWER_BYTES_MAX).catch(() => null))
  if (!response.ok || !meta.success) return new Map()
  return new Map(
    meta.data.cubes.flatMap((cube) =>
      (cube.measures ?? []).map(
        (m) =>
          [
            m.name,
            {
              aggType: m.aggType ?? null,
              written: { format: m.format, currency: m.currency, meta: m.meta ?? null },
              meta: m.meta ?? {},
              viewMeta: cube.meta ?? {},
            },
          ] as const,
      ),
    ),
  )
}

/** A token's SHA-256 in hex: what keeps a token's answers apart, never the token itself. */
async function digestOf(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * What Cube's model says of a measure, kept ten minutes; null when Cube doesn't say, so nothing
 * is claimed. A refusal or a failure is what `/v1/meta` threw, for a read that needs it to throw.
 */
async function measureOf(context: FigureContext, metric: string): Promise<Measure | SourceError> {
  const key = `${context.endpoint} ${await digestOf(context.token)}`
  const at = context.now().getTime()
  let kept = described.get(key)
  if (!kept || kept.until <= at) {
    kept = { until: at + META_KEPT_MS, byMeasure: measuresOf(context) }
    described.set(key, kept)
    if (described.size > 50) described.delete(described.keys().next().value!)
    // An empty or a failed answer is asked again next time, rather than kept for ten minutes.
    const asked = kept
    const forget = () => {
      if (described.get(key) === asked) described.delete(key)
    }
    asked.byMeasure.then((found) => {
      if (!found.size) forget()
    }, forget)
  }
  try {
    return (
      (await kept.byMeasure).get(metric) ?? { aggType: null, written: {}, meta: {}, viewMeta: {} }
    )
  } catch (error) {
    return error instanceof SourceError ? error : failed('invalid_output', 'source')
  }
}

/** A name the model or the settings give a date by: the view's own (`order_day`) or in full. */
const dateNamed = (query: FigureQuery, name: unknown) => {
  if (typeof name !== 'string' || !name) return null
  const view = query.metric.slice(0, query.metric.lastIndexOf('.'))
  const full = name.includes('.') ? name : `${view}.${name}`
  return query.dates.includes(full) ? full : null
}

/**
 * The date the days apply to: the view's only one; else the one the model names, the measure's
 * own `meta.default_time_dimension` before its view's; else the one the server's figure settings
 * name. With several and none named, the read says so (`several_dates`) rather than pick one.
 */
function dateOf(query: FigureQuery, measure: Measure | SourceError): string {
  if (query.dates.length === 1) return query.dates[0]!
  const named =
    (measure instanceof SourceError
      ? null
      : (dateNamed(query, measure.meta.default_time_dimension) ??
        dateNamed(query, measure.viewMeta.default_time_dimension))) ??
    dateNamed(query, query.settings?.date)
  if (named) return named
  // Cube couldn't be asked what the model names: that says why, not that there are several.
  if (measure instanceof SourceError) throw measure
  throw failed('several_dates', 'config')
}

/**
 * Whether the measure does not add up over days, a snapshot such as a balance: the model marks it
 * with `meta.non_additive_dimension` (the date it is taken on, as in dbt's semantic models), else
 * the server's settings say `additive: false`. The model's mark wins.
 */
function snapshotOf(query: FigureQuery, measure: Measure | SourceError): boolean {
  const mark = measure instanceof SourceError ? undefined : measure.meta.non_additive_dimension
  if (mark !== undefined && mark !== null && mark !== false && mark !== '') return true
  return query.settings?.additive === false
}

/** One figure from Cube's `/v1/load`, or a `SourceError` that says why not. */
export async function readCubeFigure(
  context: FigureContext,
  query: FigureQuery,
): Promise<FigureResult> {
  const measure = await measureOf(context, query.metric)
  const date = dateOf(query, measure)
  const snapshot = snapshotOf(query, measure)
  // A snapshot added up over days is no figure at all: it is read on the last day.
  const { written, ...result } = await loadFigure(
    context,
    snapshot ? { ...query, from: query.to } : query,
    date,
  )
  const described = measure instanceof SourceError ? null : measure
  const type = described?.aggType
  return {
    ...result,
    format: formatOf(described ? [written, described.written] : [written], query.settings),
    aggregation: type && /^[A-Za-z]{1,40}$/.test(type) ? type : null,
    date,
    ...(snapshot ? { snapshot } : {}),
  }
}

/**
 * Cube's answer at an address with the service token, or a `SourceError` that says why there is
 * none: a refused token, a member it may not read, an address with nothing there, a request to
 * slow down, or no answer.
 */
async function answerOf(context: FigureContext, address: string): Promise<Response> {
  let response: Response
  try {
    // Cube takes the token as it is, or after "Bearer"; its own examples send it as it is.
    response = await context.fetch(address, {
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
    // Cube answers a member the token may not read, hidden by the model's access policy, with
    // 500 and "You requested hidden member": it is not down. Only the code is kept of its words.
    const answer = response.status === 500 ? await bodyOf(response).catch(() => null) : null
    if (response.status !== 500) await response.body?.cancel()
    const error = (answer as { error?: unknown } | null)?.error
    if (typeof error === 'string' && /\bhidden member\b/i.test(error))
      throw failed('not_allowed', 'config')
    throw failed('unreachable', 'transient')
  }
  return response
}

/** The figure itself, from `/v1/load`. */
async function loadFigure(
  context: FigureContext,
  query: FigureQuery,
  date: string,
): Promise<Pick<FigureResult, 'value' | 'asOf'> & { written: Written }> {
  const address = new URL(context.endpoint)
  address.searchParams.set('query', JSON.stringify(cubeQuery(query, date)))
  for (;;) {
    const response = await answerOf(context, address.href)
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
      written: answer.annotation?.measures?.[query.metric] ?? {},
    }
  }
}
