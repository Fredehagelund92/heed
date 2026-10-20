import { monitorEventLoopDelay } from 'node:perf_hooks'
import type { AppFamily } from '../../domain/app-family.ts'

/**
 * The service's metrics in the Prometheus text format (version 0.0.4), served at `/metrics`.
 * Every label value comes from a closed set: a route template or API operation name, a tool,
 * a job, a connector, a status, an AI app family (never the app's own name). No path, query, header, person or question ever becomes a label,
 * so the output holds nothing that identifies who asked or what (NFR-032).
 */

export type Labels = Record<string, string>

export interface Sample {
  name: string
  help: string
  type: 'counter' | 'gauge'
  values: { labels?: Labels; value: number }[]
}

/** Seconds. The 0.3 bucket is the `get_context` p95 budget (NFR-051). */
const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.3, 0.5, 1, 2.5, 5, 10]

function escape(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')
}

function labelText(labels: Labels | undefined, extra?: Labels): string {
  const all = { ...labels, ...extra }
  const keys = Object.keys(all).sort()
  if (!keys.length) return ''
  return '{' + keys.map((key) => `${key}="${escape(all[key]!)}"`).join(',') + '}'
}

function number(value: number): string {
  if (Number.isNaN(value)) return 'NaN'
  if (value === Infinity) return '+Inf'
  if (value === -Infinity) return '-Inf'
  return String(value)
}

function counter(name: string, help: string) {
  const values = new Map<string, { labels: Labels; value: number }>()
  return {
    inc(labels: Labels = {}, by = 1) {
      const key = labelText(labels)
      const entry = values.get(key) ?? { labels, value: 0 }
      entry.value += by
      values.set(key, entry)
    },
    render: (): string[] => [
      `# HELP ${name} ${help}`,
      `# TYPE ${name} counter`,
      ...[...values.values()].map(
        (entry) => `${name}${labelText(entry.labels)} ${number(entry.value)}`,
      ),
    ],
  }
}

function histogram(name: string, help: string) {
  const values = new Map<string, { labels: Labels; counts: number[]; sum: number; count: number }>()
  return {
    observe(labels: Labels, seconds: number) {
      const key = labelText(labels)
      const entry = values.get(key) ?? { labels, counts: buckets.map(() => 0), sum: 0, count: 0 }
      buckets.forEach((bound, index) => {
        if (seconds <= bound) entry.counts[index]!++
      })
      entry.sum += seconds
      entry.count++
      values.set(key, entry)
    },
    render(): string[] {
      const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} histogram`]
      for (const entry of values.values()) {
        buckets.forEach((bound, index) =>
          lines.push(
            `${name}_bucket${labelText(entry.labels, { le: number(bound) })} ${entry.counts[index]!}`,
          ),
        )
        lines.push(`${name}_bucket${labelText(entry.labels, { le: '+Inf' })} ${entry.count}`)
        lines.push(`${name}_sum${labelText(entry.labels)} ${number(entry.sum)}`)
        lines.push(`${name}_count${labelText(entry.labels)} ${entry.count}`)
      }
      return lines
    },
  }
}

export interface Metrics {
  /** One answered HTTP request. `route` is a template or an API operation, never a raw path. */
  request(labels: { method: string; route: string; status: number }, seconds: number): void
  /**
   * One MCP request, by tool (or `protocol`), the status its anonymous record holds and the
   * family of the app that sent it, from the fixed list (FR-410).
   */
  mcpRequest(labels: { tool: string; status: string; appFamily: AppFamily }, seconds: number): void
  /** Anonymous delivery or request records the bounded queue could not write. */
  recordsDropped(count: number): void
  /** The text exposition: the counters and histograms, then the samples read at scrape time. */
  render(samples: readonly Sample[]): string
  /** Stops sampling the event loop. */
  close(): void
}

export function createMetrics(): Metrics {
  const started = Date.now()
  const loop = monitorEventLoopDelay({ resolution: 20 })
  loop.enable()
  const requests = counter(
    'heed_http_requests_total',
    'HTTP requests answered, by method, route or API operation, and status.',
  )
  const durations = histogram(
    'heed_http_request_duration_seconds',
    'Time to answer an HTTP request, by method and route or API operation.',
  )
  const mcp = counter(
    'heed_mcp_requests_total',
    'MCP requests, by tool (protocol for anything that is not a tool call), status and AI app family.',
  )
  const mcpDurations = histogram(
    'heed_mcp_request_duration_seconds',
    'Time to answer an MCP request, by tool.',
  )
  const dropped = counter(
    'heed_mcp_records_dropped_total',
    'Anonymous MCP records dropped because the write queue was full or the database failed.',
  )
  dropped.inc({}, 0)
  return {
    request({ method, route, status }, seconds) {
      requests.inc({ method, route, status: String(status) })
      durations.observe({ method, route }, seconds)
    },
    mcpRequest({ tool, status, appFamily }, seconds) {
      mcp.inc({ tool, status, app_family: appFamily })
      mcpDurations.observe({ tool }, seconds)
    },
    recordsDropped(count) {
      dropped.inc({}, count)
    },
    render(samples) {
      const memory = process.memoryUsage()
      const process_: Sample[] = [
        {
          name: 'heed_process_uptime_seconds',
          help: 'Seconds since the service started.',
          type: 'gauge',
          values: [{ value: (Date.now() - started) / 1000 }],
        },
        {
          name: 'heed_process_resident_memory_bytes',
          help: 'Resident memory of the service process.',
          type: 'gauge',
          values: [{ value: memory.rss }],
        },
        {
          name: 'heed_nodejs_heap_used_bytes',
          help: 'JavaScript heap in use.',
          type: 'gauge',
          values: [{ value: memory.heapUsed }],
        },
        {
          name: 'heed_nodejs_eventloop_delay_p99_seconds',
          help: 'The 99th percentile event loop delay since the previous scrape.',
          type: 'gauge',
          values: [{ value: loop.percentile(99) / 1e9 }],
        },
      ]
      loop.reset()
      const lines = [
        ...requests.render(),
        ...durations.render(),
        ...mcp.render(),
        ...mcpDurations.render(),
        ...dropped.render(),
      ]
      for (const sample of [...process_, ...samples]) {
        lines.push(`# HELP ${sample.name} ${sample.help}`, `# TYPE ${sample.name} ${sample.type}`)
        for (const { labels, value } of sample.values)
          lines.push(`${sample.name}${labelText(labels)} ${number(value)}`)
      }
      return lines.join('\n') + '\n'
    },
    close() {
      loop.disable()
    },
  }
}

/**
 * The API operation of a request, set by the API's authorization step. The metric label for an
 * API request is its operation, because every API route shares the one `/api/v1/*` template.
 */
const operations = new WeakMap<object, string>()

export function labelOperation(request: object, operation: string): void {
  operations.set(request, operation)
}

export function operationOf(request: object): string | undefined {
  return operations.get(request)
}
