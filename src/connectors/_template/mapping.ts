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
  The tool's file, made into definitions: pure, with no Git, no folder and no clock, so a test
  compares it with the fixture's expected definitions and the web app's mock could share it.
  Replace the schema and `mapDefinitions` with your tool's format; keep the rules
  (docs/connectors/authoring.md, "Mapping rules"):

  - A ref is `<prefix>:<group>.<name>`: the group is the part before the dot, which Integrations
    lists and maps to a domain. A record that is not a definition (a join key, an input of a
    metric that people never query) is left out.
  - The title, description, value type and domain are only what the tool says: null when it says
    nothing, never a default; a domain that is not a domain id warns `invalid_domain`.
  - The mark is the meaning: the calculation with the meanings it is built from, the type, the
    title and the description; never the domain, the other names or the environment.
  - A record built on one the file does not hold is left out, with a warning, and the read is in
    part, so what Heed already knew of it stays as it was.
*/

/**
 * The invented tool's metrics file, as far as this connector reads it: its format, the
 * environment it was built for (never kept), and its groups of metrics and dimensions. Unknown
 * keys are ignored, so a newer file still reads.
 */
const memberSchema = z.object({
  name: z.string().check(z.regex(/^[a-z][a-z0-9_]{0,99}$/)),
  label: z.optional(z.nullable(z.string())),
  description: z.optional(z.nullable(z.string())),
  type: z.optional(z.nullable(z.string())),
  /** A calculation: kept out of every definition, and part of the mark. */
  expr: z.optional(z.nullable(z.string())),
  /** The metrics of the same group a metric is built from. */
  inputs: z.optional(z.array(z.string())),
  domain: z.optional(z.nullable(z.string())),
  synonyms: z.optional(z.unknown()),
})
export const metricsFileSchema = z.object({
  format: z.literal('example-metrics/1'),
  /** Where the file was built: a database and schema, never part of a definition or a mark. */
  environment: z.optional(z.unknown()),
  groups: z.array(
    z.object({
      name: z.string().check(z.regex(/^[a-z][a-z0-9_]{0,99}$/)),
      domain: z.optional(z.nullable(z.string())),
      metrics: z.optional(z.array(memberSchema)),
      dimensions: z.optional(z.array(memberSchema)),
    }),
  ),
})
export type MetricsFile = z.infer<typeof metricsFileSchema>
type Member = z.infer<typeof memberSchema>

/** The value types the tool's dimensions have; any other is said as unknown (null). */
const dimensionTypes = new Set(['categorical', 'time'])
/** The value types the tool's metrics have; any other is said as unknown (null). */
const metricTypes = new Set(['count', 'count_distinct', 'sum', 'average', 'ratio'])

type Warning = Extract<RuntimeMessage, { type: 'warning' }>

/** The file's text as the tool's metrics file, or null when it is not one. */
export function parseMetricsFile(text: string): MetricsFile | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = metricsFileSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

/**
 * Every definition the file holds, with the warnings to send before them and whether the read is
 * whole. Groups and members come in the file's order; the refs are sorted, so the order of the
 * file never matters.
 */
export async function mapDefinitions(
  file: MetricsFile,
  domainNames: Readonly<Record<string, string>> = {},
): Promise<{ definitions: RuntimeDefinition[]; warnings: Warning[]; complete: boolean }> {
  const definitions: RuntimeDefinition[] = []
  const warnings: Warning[] = []
  let complete = true
  const warn = (code: string, target: string) => warnings.push({ type: 'warning', code, target })

  for (const group of file.groups) {
    const groupDomain = domainHint(group.domain, domainNames)
    if (groupDomain.invalid) warn('invalid_domain', group.name)
    else if (groupDomain.areaHint === null) warn('missing_domain', group.name)
    const metrics = new Map((group.metrics ?? []).map((metric) => [metric.name, metric]))

    /** A metric's meaning, with the meanings of the metrics it is built from; null when one is missing. */
    const metricMeaning = (metric: Member, seen: Set<string>): unknown => {
      if (seen.has(metric.name)) return null
      const inputs: unknown[] = []
      for (const name of metric.inputs ?? []) {
        const input = metrics.get(name)
        const meaning = input && metricMeaning(input, new Set([...seen, metric.name]))
        if (!meaning) return null
        inputs.push(meaning)
      }
      // The input's own label and description stay out: a change to them moves no metric on top.
      return { type: metric.type, expr: metric.expr, inputs }
    }

    const member = async (kind: 'metric' | 'dimension', entry: Member, meaning: unknown) => {
      const name = `${group.name}.${entry.name}`
      // A name the group has twice is one definition: the first.
      if (definitions.some((definition) => definition.name === name)) return
      const own = domainHint(entry.domain, domainNames)
      if (own.invalid) warn('invalid_domain', name)
      // A member's own valid domain wins over its group's.
      const domain = own.areaHint === null ? groupDomain : own
      const description = descriptionCopy(entry.description)
      if (description.cut) warn(`${manifest.id}.description_cut`, name)
      const types = kind === 'metric' ? metricTypes : dimensionTypes
      definitions.push({
        ref: `${manifest.refPrefix}:${name}`,
        kind,
        name,
        title: entry.label?.trim() || null,
        descriptionCopy: description.copy,
        valueType: entry.type && types.has(entry.type) ? entry.type : null,
        visibleGroups: null,
        areaHint: domain.areaHint,
        domainSource: domain.domainSource,
        modelFile: null,
        synonyms: synonymsOf(entry.synonyms),
        changeMark: await meaningMark({
          kind,
          meaning,
          title: entry.label,
          description: entry.description,
        }),
      })
    }

    for (const metric of group.metrics ?? []) {
      const meaning = metricMeaning(metric, new Set())
      if (meaning === null) {
        warn(`${manifest.id}.unresolved_metric`, `${group.name}.${metric.name}`)
        complete = false
        continue
      }
      await member('metric', metric, meaning)
    }
    for (const dimension of group.dimensions ?? [])
      await member('dimension', dimension, { type: dimension.type, expr: dimension.expr })
  }
  definitions.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
  return { definitions, warnings, complete }
}
