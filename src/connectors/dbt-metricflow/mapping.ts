import * as z from 'zod/mini'
import type { RuntimeDefinition, RuntimeMessage } from '../../domain/connector-runtime.ts'
import {
  descriptionCopy,
  domainHint,
  meaningMark,
  synonymsOf,
} from '../../domain/definition-helpers.ts'
import { manifest } from './manifest.ts'

/*
  dbt's semantic manifest, made into definitions: pure, with no Git, no folder and no clock. A
  semantic model is a group; its dimensions and the metrics built on it are the definitions.
  Measures are inputs and entities are join keys: neither is one. A metric takes the semantic
  model all its inputs come from, or `_shared`, which dbt's names cannot be.

  dbt has two YAML specs, which write this file in two shapes: under the legacy one a metric
  names measures of a semantic model; under the latest one measures are gone and a simple metric
  holds its own aggregation. So a mark never hashes the file's shape. A simple calculation is
  worked out the same way from either, and each metric built on others takes their calculations'
  digests, so a migration moves no mark, a change underneath moves all that sit on top, and a
  metric shared by many is worked out once.
*/

const nameSchema = z.string().check(z.regex(/^[a-z][a-z0-9_]{0,99}$/))
const metaSchema = z.optional(
  z.nullable(
    z.object({
      meta: z.optional(z.nullable(z.record(z.string(), z.unknown()))),
    }),
  ),
)
const filterSchema = z.optional(
  z.nullable(z.object({ where_filters: z.array(z.object({ where_sql_template: z.string() })) })),
)
/** A metric's reference to a measure or to another metric, with what it changes about it. */
const inputSchema = z.object({
  name: z.string(),
  filter: filterSchema,
  alias: z.optional(z.nullable(z.string())),
  offset_window: z.optional(z.unknown()),
  offset_to_grain: z.optional(z.unknown()),
  join_to_timespine: z.optional(z.nullable(z.boolean())),
  fill_nulls_with: z.optional(z.nullable(z.number())),
})
const dimensionSchema = z.object({
  name: nameSchema,
  label: z.optional(z.nullable(z.string())),
  description: z.optional(z.nullable(z.string())),
  type: z.optional(z.nullable(z.string())),
  is_partition: z.optional(z.nullable(z.boolean())),
  type_params: z.optional(z.unknown()),
  /** A calculation: kept out of every definition, and part of the mark. */
  expr: z.optional(z.nullable(z.string())),
  config: metaSchema,
})
const measureSchema = z.object({
  name: nameSchema,
  agg: z.optional(z.nullable(z.string())),
  expr: z.optional(z.nullable(z.string())),
  agg_params: z.optional(z.unknown()),
  non_additive_dimension: z.optional(z.unknown()),
  agg_time_dimension: z.optional(z.nullable(z.string())),
})
const semanticModelSchema = z.object({
  name: nameSchema,
  defaults: z.optional(
    z.nullable(z.object({ agg_time_dimension: z.optional(z.nullable(z.string())) })),
  ),
  /** Where the model was built: only its alias is read, never the database or the schema. */
  node_relation: z.optional(z.nullable(z.object({ alias: z.optional(z.nullable(z.string())) }))),
  config: metaSchema,
  dimensions: z.optional(z.nullable(z.array(dimensionSchema))),
  measures: z.optional(z.nullable(z.array(measureSchema))),
})
const typeParamsSchema = z.object({
  measure: z.optional(z.nullable(inputSchema)),
  numerator: z.optional(z.nullable(inputSchema)),
  denominator: z.optional(z.nullable(inputSchema)),
  expr: z.optional(z.nullable(z.string())),
  window: z.optional(z.unknown()),
  grain_to_date: z.optional(z.unknown()),
  metrics: z.optional(z.nullable(z.array(inputSchema))),
  conversion_type_params: z.optional(
    z.nullable(
      z.object({
        base_measure: z.optional(z.nullable(inputSchema)),
        base_metric: z.optional(z.nullable(inputSchema)),
        conversion_measure: z.optional(z.nullable(inputSchema)),
        conversion_metric: z.optional(z.nullable(inputSchema)),
        entity: z.optional(z.nullable(z.string())),
        calculation: z.optional(z.nullable(z.string())),
        window: z.optional(z.unknown()),
        constant_properties: z.optional(z.unknown()),
      }),
    ),
  ),
  cumulative_type_params: z.optional(
    z.nullable(
      z.object({
        window: z.optional(z.unknown()),
        grain_to_date: z.optional(z.unknown()),
        period_agg: z.optional(z.nullable(z.string())),
        metric: z.optional(z.nullable(inputSchema)),
      }),
    ),
  ),
  metric_aggregation_params: z.optional(
    z.nullable(
      z.object({
        semantic_model: z.string(),
        agg: z.optional(z.nullable(z.string())),
        agg_params: z.optional(z.unknown()),
        agg_time_dimension: z.optional(z.nullable(z.string())),
        non_additive_dimension: z.optional(z.unknown()),
      }),
    ),
  ),
  join_to_timespine: z.optional(z.nullable(z.boolean())),
  fill_nulls_with: z.optional(z.nullable(z.number())),
  /** A hidden metric: read as an input of others, and never a definition. */
  is_private: z.optional(z.nullable(z.boolean())),
})
const metricSchema = z.object({
  name: nameSchema,
  label: z.optional(z.nullable(z.string())),
  description: z.optional(z.nullable(z.string())),
  type: z.string(),
  type_params: typeParamsSchema,
  filter: filterSchema,
  time_granularity: z.optional(z.unknown()),
  config: metaSchema,
})
/** The file, as far as this connector reads it. Unknown keys are ignored, so a newer dbt reads. */
export const semanticManifestSchema = z.object({
  semantic_models: z.array(semanticModelSchema),
  metrics: z.array(metricSchema),
})
export type SemanticManifest = z.infer<typeof semanticManifestSchema>
type SemanticModel = z.infer<typeof semanticModelSchema>
type Metric = z.infer<typeof metricSchema>
type Measure = z.infer<typeof measureSchema>
type Input = z.infer<typeof inputSchema>
type Warning = Extract<RuntimeMessage, { type: 'warning' }>

/** Where a metric goes when its inputs span semantic models: a name dbt's own names cannot be. */
export const SHARED_GROUP = '_shared'

const dimensionTypes = new Set(['categorical', 'time'])
const metricTypes = new Set(['ratio', 'derived', 'cumulative', 'conversion'])
/** MetricFlow's aggregations: a simple metric's value type. */
const aggregations = new Set([
  'sum',
  'min',
  'max',
  'count',
  'count_distinct',
  'sum_boolean',
  'average',
  'percentile',
  'median',
])

/** The file's text as dbt's semantic manifest, or null when it is not one. */
export function parseSemanticManifest(text: string): SemanticManifest | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = semanticManifestSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

/** Its filters, as written, in an order that does not matter: they all apply. */
const filtersOf = (filter: Metric['filter']) =>
  (filter?.where_filters ?? []).map((where) => where.where_sql_template.trim()).sort()

const metaOf = (entry: { config?: z.infer<typeof metaSchema> }) => entry.config?.meta ?? {}

/** A label that says more than the name: dbt fills a missing metric label with the name. */
const titleOf = (entry: { name: string; label?: string | null | undefined }) => {
  const label = entry.label?.trim()
  return label && label !== entry.name ? label : null
}

/** A simple calculation, the same from a legacy measure and from a latest metric. */
function simpleCalculation(
  model: SemanticModel,
  source: Omit<Measure, 'name'> & { name: string },
): unknown {
  return {
    type: 'simple',
    calculation: {
      agg: source.agg,
      expr: source.expr ?? source.name,
      aggParams: source.agg_params,
      nonAdditive: source.non_additive_dimension,
      aggTime: source.agg_time_dimension ?? model.defaults?.agg_time_dimension,
      relation: model.node_relation?.alias,
    },
  }
}

/** What a reference changes about its input, with the digest of the input's calculation. */
const inputMeaning = (input: Input, digest: string) => ({
  input: digest,
  filter: filtersOf(input.filter),
  offsetWindow: input.offset_window,
  offsetToGrain: input.offset_to_grain,
  joinToTimespine: input.join_to_timespine,
  fillNullsWith: input.fill_nulls_with,
})

/** The metrics a metric is built on, as it names them. */
function metricInputs({ type_params: params }: Metric): Input[] {
  const conversion = params.conversion_type_params
  return [
    params.numerator,
    params.denominator,
    ...(params.metrics ?? []),
    params.cumulative_type_params?.metric,
    conversion?.base_metric,
    conversion?.conversion_metric,
  ].filter((input) => input !== null && input !== undefined)
}

/** The measures a metric is built on directly: the legacy spec's. */
function measureInputs({ type_params: params }: Metric): Input[] {
  const conversion = params.conversion_type_params
  return [params.measure, conversion?.base_measure, conversion?.conversion_measure].filter(
    (input) => input !== null && input !== undefined,
  )
}

/** A metric once its inputs are known: the semantic models it comes from, and its calculation. */
interface Resolved {
  models: ReadonlySet<SemanticModel>
  /** The digest of what it calculates, without its words: what a metric on top of it hashes. */
  calculation: string
  valueType: string | null
  known: boolean
}

/**
 * Each metric resolved after those it is built on, without recursion, so a long chain is as safe
 * as a short one. One that names something the file does not hold, or that is built on itself,
 * never resolves, and neither does what is built on it.
 */
async function resolveMetrics(
  metrics: readonly Metric[],
  models: ReadonlyMap<string, SemanticModel>,
  measures: ReadonlyMap<string, { model: SemanticModel; measure: Measure }>,
): Promise<Map<string, Resolved>> {
  const resolved = new Map<string, Resolved>()
  const byName = new Map<string, Metric>()
  for (const metric of metrics) if (!byName.has(metric.name)) byName.set(metric.name, metric)

  const measureDigests = new Map<string, Promise<string>>()
  const measureDigest = (name: string) => {
    const owned = measures.get(name)!
    const digest =
      measureDigests.get(name) ?? meaningMark(simpleCalculation(owned.model, owned.measure))
    measureDigests.set(name, digest)
    return digest
  }

  const resolve = async (metric: Metric): Promise<Resolved | null> => {
    const params = metric.type_params
    const owners = new Set<SemanticModel>()
    const refer = async (input: Input, isMetric: boolean) => {
      if (isMetric) {
        const known = resolved.get(input.name)!
        for (const model of known.models) owners.add(model)
        return inputMeaning(input, known.calculation)
      }
      owners.add(measures.get(input.name)!.model)
      return inputMeaning(input, await measureDigest(input.name))
    }
    const measureInputsKnown = measureInputs(metric).every((input) => measures.has(input.name))
    if (!measureInputsKnown) return null

    // The legacy spec keeps these on the measure a metric names, the latest on the metric.
    const named = params.measure
    const shared = {
      type: metric.type,
      grain: metric.time_granularity,
      filter: [...filtersOf(metric.filter)],
      joinToTimespine: params.join_to_timespine || named?.join_to_timespine,
      fillNullsWith: params.fill_nulls_with ?? named?.fill_nulls_with,
    }
    const withoutCarried = (input: Input) => ({
      ...input,
      join_to_timespine: null,
      fill_nulls_with: null,
    })
    const window = {
      window: params.cumulative_type_params?.window ?? params.window,
      grainToDate: params.cumulative_type_params?.grain_to_date ?? params.grain_to_date,
    }

    let meaning: unknown
    let valueType: string | null = null
    let known = true
    if (metric.type === 'simple') {
      const aggregated = params.metric_aggregation_params
      const legacy = named ? measures.get(named.name) : undefined
      const model = aggregated ? models.get(aggregated.semantic_model) : legacy?.model
      if (!model) return null
      owners.add(model)
      const source = aggregated
        ? { ...aggregated, name: metric.name, expr: params.expr }
        : legacy!.measure
      const simple = simpleCalculation(model, source) as { calculation: unknown }
      meaning = {
        ...shared,
        filter: [...shared.filter, ...filtersOf(named?.filter)].sort(),
        calculation: simple.calculation,
      }
      const agg = source.agg ?? null
      known = agg !== null && aggregations.has(agg)
      valueType = known ? agg : null
    } else if (metric.type === 'ratio') {
      if (!params.numerator || !params.denominator) return null
      meaning = {
        ...shared,
        numerator: await refer(params.numerator, true),
        denominator: await refer(params.denominator, true),
      }
    } else if (metric.type === 'derived') {
      const inputs = await Promise.all(
        (params.metrics ?? []).map(async (input) => ({
          name: input.alias ?? input.name,
          ...(await refer(input, true)),
        })),
      )
      meaning = {
        ...shared,
        expr: params.expr,
        inputs: inputs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
      }
    } else if (metric.type === 'cumulative') {
      const input = params.cumulative_type_params?.metric
      if (!input && !named) return null
      meaning = {
        ...shared,
        ...window,
        periodAgg: params.cumulative_type_params?.period_agg,
        input: input ? await refer(input, true) : await refer(withoutCarried(named!), false),
      }
    } else if (metric.type === 'conversion') {
      const conversion = params.conversion_type_params
      const base = conversion?.base_metric ?? conversion?.base_measure
      const converted = conversion?.conversion_metric ?? conversion?.conversion_measure
      if (!base || !converted) return null
      meaning = {
        ...shared,
        entity: conversion?.entity,
        calculation: conversion?.calculation,
        window: conversion?.window,
        constantProperties: conversion?.constant_properties,
        base: await refer(base, !!conversion?.base_metric),
        conversion: await refer(converted, !!conversion?.conversion_metric),
      }
    } else {
      // A type a newer dbt added: it exists, so it is kept, hashed as dbt writes it.
      for (const input of metricInputs(metric)) await refer(input, true)
      for (const input of measureInputs(metric)) await refer(input, false)
      const own = params.metric_aggregation_params?.semantic_model
      if (own !== undefined) {
        const model = models.get(own)
        if (!model) return null
        owners.add(model)
      }
      if (!owners.size) return null
      meaning = { ...shared, params }
      known = false
    }
    if (metricTypes.has(metric.type)) valueType = metric.type
    return { models: owners, calculation: await meaningMark(meaning), valueType, known }
  }

  // Each metric waits for the metrics it names; when the last arrives, it is ready.
  const waiting = new Map<Metric, Set<string>>()
  const dependents = new Map<string, Metric[]>()
  const ready: Metric[] = []
  for (const metric of byName.values()) {
    const needs = new Set(metricInputs(metric).map((input) => input.name))
    if (!needs.size) ready.push(metric)
    waiting.set(metric, needs)
    for (const name of needs) dependents.set(name, [...(dependents.get(name) ?? []), metric])
  }
  for (let next = ready.pop(); next; next = ready.pop()) {
    const done = await resolve(next)
    if (!done) continue
    resolved.set(next.name, done)
    for (const dependent of dependents.get(next.name) ?? []) {
      const needs = waiting.get(dependent)!
      needs.delete(next.name)
      if (!needs.size) ready.push(dependent)
    }
  }
  return resolved
}

/**
 * Every definition the file holds, sorted by ref, with the warnings to send before them, sorted
 * too, and whether the read is whole: the order of the file never matters.
 */
export async function mapDefinitions(
  file: SemanticManifest,
  domainNames: Readonly<Record<string, string>> = {},
): Promise<{ definitions: RuntimeDefinition[]; warnings: Warning[]; complete: boolean }> {
  const definitions = new Map<string, RuntimeDefinition>()
  const warned = new Map<string, Warning>()
  let complete = true
  const warn = (code: string, target: string) =>
    warned.set(`${code}:${target}`, { type: 'warning', code, target })

  const models = new Map(file.semantic_models.map((model) => [model.name, model]))
  const measures = new Map(
    file.semantic_models.flatMap((model) =>
      (model.measures ?? []).map((measure) => [measure.name, { model, measure }] as const),
    ),
  )
  const domains = new Map<string, ReturnType<typeof domainHint>>()
  for (const model of models.values()) {
    const domain = domainHint(metaOf(model).domain, domainNames)
    domains.set(model.name, domain)
    if (domain.invalid) warn('invalid_domain', model.name)
    else if (domain.areaHint === null) warn('missing_domain', model.name)
  }

  const add = async (
    kind: 'metric' | 'dimension',
    group: string,
    entry: {
      name: string
      label?: string | null
      description?: string | null
      config?: z.infer<typeof metaSchema>
    },
    domain: Pick<ReturnType<typeof domainHint>, 'areaHint' | 'domainSource'>,
    valueType: string | null,
    meaning: unknown,
  ) => {
    const name = `${group}.${entry.name}`
    const description = entry.description?.trim()
    const copy = descriptionCopy(description)
    if (copy.cut) warn(`${manifest.id}.description_cut`, name)
    definitions.set(`${manifest.refPrefix}:${name}`, {
      ref: `${manifest.refPrefix}:${name}`,
      kind,
      name,
      title: titleOf(entry),
      descriptionCopy: copy.copy,
      valueType,
      visibleGroups: null,
      areaHint: domain.areaHint,
      domainSource: domain.domainSource,
      modelFile: null,
      synonyms: synonymsOf(metaOf(entry).synonyms),
      changeMark: await meaningMark({
        kind,
        meaning,
        title: titleOf(entry),
        description,
      }),
    })
  }

  const resolved = await resolveMetrics(file.metrics, models, measures)
  for (const metric of file.metrics) {
    const known = resolved.get(metric.name)
    const hidden = metric.type_params.is_private === true
    if (!known) {
      // Its group cannot be told, so it is named alone. A hidden one was never a definition.
      if (!hidden) {
        warn(`${manifest.id}.unresolved_metric`, metric.name)
        complete = false
      }
      continue
    }
    if (hidden) continue
    if (!known.known) warn(`${manifest.id}.unknown_type`, metric.name)
    const owners = [...known.models]
    const group = owners.length === 1 ? owners[0]!.name : SHARED_GROUP
    const own = domainHint(metaOf(metric).domain, domainNames)
    if (own.invalid) warn('invalid_domain', `${group}.${metric.name}`)
    const hints = new Set(owners.map((model) => domains.get(model.name)!.areaHint))
    const agreed = hints.size === 1 ? domains.get(owners[0]!.name)! : null
    // Its own valid domain wins, then the one its semantic models agree on.
    const domain =
      own.areaHint !== null ? own : (agreed ?? { areaHint: null, domainSource: 'none' as const })
    if (group === SHARED_GROUP && domain.areaHint === null)
      warn('missing_domain', `${group}.${metric.name}`)
    await add('metric', group, metric, domain, known.valueType, {
      calculation: known.calculation,
    })
  }

  for (const model of models.values()) {
    const modelDomain = domains.get(model.name)!
    for (const dimension of model.dimensions ?? []) {
      const name = `${model.name}.${dimension.name}`
      if (definitions.has(`${manifest.refPrefix}:${name}`)) {
        warn(`${manifest.id}.same_name`, name)
        continue
      }
      // dbt copies a model's meta onto its dimensions: only a value of its own is the dimension's.
      const value = metaOf(dimension).domain
      const own = domainHint(value === metaOf(model).domain ? undefined : value, domainNames)
      if (own.invalid) warn('invalid_domain', name)
      const type = dimension.type && dimensionTypes.has(dimension.type) ? dimension.type : null
      if (type === null) warn(`${manifest.id}.unknown_type`, name)
      await add(
        'dimension',
        model.name,
        dimension,
        own.areaHint === null ? modelDomain : own,
        type,
        {
          type: dimension.type,
          expr: dimension.expr ?? dimension.name,
          partition: dimension.is_partition,
          params: dimension.type_params,
          relation: model.node_relation?.alias,
        },
      )
    }
  }

  const byKey =
    <T>(key: (value: T) => string) =>
    (a: T, b: T) =>
      key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0
  return {
    definitions: [...definitions.values()].sort(byKey((definition) => definition.ref)),
    warnings: [...warned.values()].sort(byKey((warning) => `${warning.code}:${warning.target}`)),
    complete,
  }
}
