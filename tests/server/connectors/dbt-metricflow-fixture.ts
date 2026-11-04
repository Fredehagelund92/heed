import { readFile } from 'node:fs/promises'

/*
  The dbt MetricFlow fixture and the edits its tests make to it: dbt's semantic manifest in both
  YAML specs (tests/fixtures/dbt-metricflow/), as parsed JSON. Each edit returns a copy.
*/

/** What these tests touch of dbt's file: the file has more, which stays as it is. */
export interface Manifest {
  semantic_models: {
    config: { meta: Record<string, unknown> }
    dimensions: { name: string; type: string }[]
    measures: { name: string; expr?: string }[]
  }[]
  metrics: Metric[]
}
interface Metric {
  name: string
  label: string
  description: string
  type: string
  type_params: {
    expr: string | null
    measure: { name: string } | null
    denominator: { name: string }
    metrics: { name: string }[]
    metric_aggregation_params: unknown
    cumulative_type_params: { window: { count: number } }
  }
  filter: { where_filters: { where_sql_template: string }[] }
  config: { meta: Record<string, unknown> }
}

const artifact = async (spec: 'legacy' | 'latest') =>
  JSON.parse(
    await readFile(
      new URL(`../../fixtures/dbt-metricflow/semantic_manifest.${spec}.json`, import.meta.url),
      'utf8',
    ),
  ) as Manifest

export const legacyManifest = await artifact('legacy')
export const latestManifest = await artifact('latest')

/** The lists whose order says nothing. Others (a synonym list) are the tool's own order. */
const unorderedLists = new Set([
  'semantic_models',
  'metrics',
  'dimensions',
  'measures',
  'entities',
  'where_filters',
  'input_measures',
])

/** The same file with every key reversed at every depth, and every unordered list reversed. */
export function deepReorder(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) {
    const entries = value.map((entry) => deepReorder(entry))
    return unorderedLists.has(key) ? entries.reverse() : entries
  }
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([name, entry]) => [name, deepReorder(entry, name)]),
  )
}

export const metricOf = (file: Manifest, name: string) =>
  file.metrics.find((metric) => metric.name === name)!

/** The same project built for another target: every database and schema moves. */
export function otherTarget(file: Manifest): Manifest {
  const moved = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(moved)
    if (typeof value !== 'object' || value === null) return value
    const entries = Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [name, moved(entry)]),
    ) as Record<string, unknown>
    if ('relation_name' in entries) {
      entries.database = 'another_db'
      entries.schema_name = 'another_schema'
      entries.relation_name = `"another_db"."another_schema"."${entries.alias as string}"`
    }
    return entries
  }
  return moved(file) as Manifest
}

/** Revenue worked out another way, wherever the spec keeps it. */
export function withChangedRevenue(file: Manifest, expr = 'amount - refunded'): Manifest {
  const changed = structuredClone(file)
  const measure = changed.semantic_models
    .flatMap((model) => model.measures)
    .find((entry) => entry.name === 'order_amount')
  if (measure) measure.expr = expr
  else metricOf(changed, 'revenue').type_params.expr = expr
  return changed
}

/** One metric edited. */
export function withMetric(file: Manifest, name: string, edit: (metric: Metric) => void): Manifest {
  const changed = structuredClone(file)
  edit(metricOf(changed, name))
  return changed
}

/** A file whose `average_order_value` names an input the file does not hold. */
export const withMissingInput = (file: Manifest) =>
  withMetric(file, 'average_order_value', (metric) => {
    metric.type_params.denominator.name = 'orders_gone'
  })
