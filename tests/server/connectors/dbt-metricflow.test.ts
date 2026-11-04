import { describe, expect, it } from 'vitest'
import { manifest } from '../../../src/connectors/dbt-metricflow/manifest.ts'
import {
  mapDefinitions,
  parseSemanticManifest,
  semanticManifestSchema,
} from '../../../src/connectors/dbt-metricflow/mapping.ts'
import { runtime } from '../../../src/connectors/dbt-metricflow/runtime.ts'
import type {
  FolderTree,
  RuntimeContext,
  RuntimeMessage,
} from '../../../src/domain/connector-runtime.ts'
import { termCandidates, type CandidateMember } from '../../../src/domain/term-candidates.ts'
import {
  deepReorder,
  latestManifest,
  legacyManifest,
  metricOf,
  otherTarget,
  withChangedRevenue,
  withMetric,
  withMissingInput,
} from './dbt-metricflow-fixture.ts'

/*
  The mapping of dbt's semantic manifest, on both YAML specs, with no Git: what becomes a
  definition, what its mark sees, and that what the file does not say stays unknown. The Git
  route, the golden file and the core's checks are the kit's (conformance.test.ts).
*/

const mapped = (file: unknown, domainNames?: Record<string, string>) =>
  mapDefinitions(semanticManifestSchema.parse(file), domainNames)

const marks = async (file: unknown) =>
  Object.fromEntries((await mapped(file)).definitions.map((d) => [d.ref, d.changeMark]))

/** The refs whose marks differ between two reads. */
const moved = async (from: unknown, to: unknown) => {
  const [before, after] = [await marks(from), await marks(to)]
  expect(Object.keys(after)).toEqual(Object.keys(before))
  return Object.keys(before).filter((ref) => before[ref] !== after[ref])
}

const REVENUE_AND_ABOVE = [
  'dbt:_shared.revenue_per_customer',
  'dbt:orders.average_order_value',
  'dbt:orders.net_revenue',
  'dbt:orders.revenue',
  'dbt:orders.revenue_to_date',
]

const CANARIES = [
  'case when',
  '0.6 * amount',
  "'completed'",
  'nullif',
  'revenue - discounts',
  'Dimension(',
  'order_id',
  'example_db',
  'example_schema',
]

describe.each([
  ['legacy', legacyManifest],
  ['latest', latestManifest],
])('the %s spec', (_, file) => {
  it('gives 12 metrics and 7 dimensions, whole', async () => {
    const read = await mapped(file)
    expect(read.complete).toBe(true)
    expect(read.definitions.filter((d) => d.kind === 'metric')).toHaveLength(12)
    expect(read.definitions.filter((d) => d.kind === 'dimension')).toHaveLength(7)
  })

  it('lets no calculation, database or schema cross', async () => {
    const read = JSON.stringify(await mapped(file))
    for (const canary of CANARIES) expect(read).not.toContain(canary)
  })

  it('leaves out measures, entities and the hidden metric', async () => {
    const refs = (await mapped(file)).definitions.map((d) => d.ref)
    expect(refs.filter((ref) => /ordering_customers$/.test(ref))).toEqual([
      'dbt:orders.weekly_ordering_customers',
    ])
    for (const left of ['order_count', 'order_amount', 'orders.order', 'orders.customer'])
      expect(refs.some((ref) => ref.endsWith(left))).toBe(false)
  })

  it('moves no mark for another target', async () => {
    expect(await moved(file, otherTarget(file))).toEqual([])
  })

  it('gives the same read whatever the order of keys and lists', async () => {
    expect(await mapped(deepReorder(file))).toEqual(await mapped(file))
    // Written with other spaces, then read as text, as a read does.
    const spaced = parseSemanticManifest(JSON.stringify(deepReorder(file), null, 7))
    expect(spaced).not.toBeNull()
    expect(await mapDefinitions(spaced!)).toEqual(await mapped(file))
  })

  it('gives the same read twice', async () => {
    expect(await mapped(file)).toEqual(await mapped(file))
  })

  it('moves a changed calculation and exactly what is built on it', async () => {
    expect(await moved(file, withChangedRevenue(file))).toEqual(REVENUE_AND_ABOVE)
  })

  it('moves only its own mark for a label or a description', async () => {
    const relabelled = withMetric(file, 'revenue', (metric) => (metric.label = 'Turnover'))
    expect(await moved(file, relabelled)).toEqual(['dbt:orders.revenue'])
    const redescribed = withMetric(file, 'revenue', (metric) => (metric.description = 'Sales.'))
    expect(await moved(file, redescribed)).toEqual(['dbt:orders.revenue'])
  })

  it('moves no mark for a domain or other names', async () => {
    const changed = withMetric(file, 'orders', (metric) => {
      metric.config.meta = { domain: 'finance', synonyms: ['sales count'] }
    })
    expect(await moved(file, changed)).toEqual([])
    const read = await mapped(changed)
    expect(read.definitions.find((d) => d.ref === 'dbt:orders.orders')).toMatchObject({
      areaHint: 'finance',
      synonyms: ['sales count'],
    })
  })

  it('moves the mark of a filter, a window and a metric built on them', async () => {
    const filtered = withMetric(file, 'completed_orders', (metric) => {
      metric.filter.where_filters[0]!.where_sql_template = "{{ Dimension('order__status') }} = 'x'"
    })
    expect(await moved(file, filtered)).toEqual(['dbt:orders.completed_orders'])
    const widened = withMetric(file, 'weekly_ordering_customers', (metric) => {
      metric.type_params.cumulative_type_params.window.count = 14
    })
    expect(await moved(file, widened)).toEqual(['dbt:orders.weekly_ordering_customers'])
  })

  it('leaves a metric with a missing input out, and the read in part', async () => {
    const read = await mapped(withMissingInput(file))
    expect(read.complete).toBe(false)
    expect(read.definitions.map((d) => d.ref)).not.toContain('dbt:orders.average_order_value')
    expect(read.definitions).toHaveLength(18)
    expect(read.warnings).toContainEqual({
      type: 'warning',
      code: 'dbt-metricflow.unresolved_metric',
      target: 'average_order_value',
    })
  })

  it('says only what the tool says of domains', async () => {
    const read = await mapped(file)
    const of = (ref: string) => read.definitions.find((d) => d.ref === ref)!
    expect(of('dbt:orders.status')).toMatchObject({ areaHint: 'sales', domainSource: 'source' })
    expect(of('dbt:orders.revenue')).toMatchObject({ areaHint: 'sales', domainSource: 'source' })
    expect(of('dbt:customers.region')).toMatchObject({ areaHint: null, domainSource: 'none' })
    expect(of('dbt:customers.tier')).toMatchObject({ areaHint: null, domainSource: 'none' })
    expect(of('dbt:_shared.revenue_per_customer')).toMatchObject({
      areaHint: null,
      domainSource: 'none',
    })
    expect(read.warnings.map((w) => [w.code, w.target])).toEqual([
      ['dbt-metricflow.description_cut', 'orders.gross_margin'],
      ['invalid_domain', 'customers.customers'],
      ['invalid_domain', 'customers.tier'],
      ['missing_domain', '_shared.ordering_rate'],
      ['missing_domain', '_shared.revenue_per_customer'],
      ['missing_domain', 'customers'],
    ])
  })

  it('reads a domain name through the source’s domain names', async () => {
    const read = await mapped(file, { 'Customer Care': 'customer_care' })
    expect(read.definitions.find((d) => d.ref === 'dbt:customers.tier')).toMatchObject({
      areaHint: 'customer_care',
      domainSource: 'source',
    })
    expect(read.warnings.filter((w) => w.code === 'invalid_domain')).toEqual([])
  })

  it('keeps the tool’s words: labels, cut descriptions, other names and types', async () => {
    const { definitions } = await mapped(file)
    const of = (ref: string) => definitions.find((d) => d.ref === ref)!
    expect(of('dbt:orders.channel')).toMatchObject({
      title: null,
      synonyms: ['sales channel', 'route to market'],
      valueType: 'categorical',
    })
    expect([...of('dbt:orders.gross_margin').descriptionCopy!]).toHaveLength(500)
    expect(of('dbt:orders.ordered_at').valueType).toBe('time')
    expect(of('dbt:customers.signed_up_at').valueType).toBe('time')
    expect(of('dbt:orders.revenue').valueType).toBe('sum')
    expect(of('dbt:orders.orders').valueType).toBe('count')
    expect(of('dbt:orders.net_revenue').valueType).toBe('derived')
    expect(of('dbt:orders.average_order_value').valueType).toBe('ratio')
    expect(of('dbt:orders.revenue_to_date').valueType).toBe('cumulative')
    expect(of('dbt:_shared.ordering_rate').valueType).toBe('conversion')
  })

  it('keeps a type it does not know, as unknown', async () => {
    const future = withMetric(file, 'discounts', (metric) => (metric.type = 'forecast'))
    const read = await mapped(future)
    expect(read.complete).toBe(true)
    expect(read.definitions.find((d) => d.ref === 'dbt:orders.discounts')).toMatchObject({
      valueType: null,
    })
    expect(read.warnings).toContainEqual({
      type: 'warning',
      code: 'dbt-metricflow.unknown_type',
      target: 'discounts',
    })

    const dimension = structuredClone(file)
    dimension.semantic_models[0]!.dimensions[1]!.type = 'geography'
    const dimensions = await mapped(dimension)
    expect(dimensions.definitions.find((d) => d.ref === 'dbt:orders.status')?.valueType).toBeNull()
  })

  it('does not resolve a metric built on itself, or what is built on it', async () => {
    const looped = withMetric(file, 'revenue', (metric) => {
      metric.type = 'derived'
      metric.type_params.metrics = [{ name: 'net_revenue' }]
      metric.type_params.measure = null
      metric.type_params.metric_aggregation_params = null
    })
    const read = await mapped(looped)
    expect(read.complete).toBe(false)
    expect(read.warnings.map((w) => w.target)).toEqual(
      expect.arrayContaining(['revenue', 'net_revenue', 'average_order_value']),
    )
  })

  it('keeps the metric when a dimension has its name, and says so', async () => {
    const clash = structuredClone(file)
    clash.semantic_models[0]!.dimensions.push({ name: 'revenue', type: 'categorical' })
    const read = await mapped(clash)
    expect(read.definitions.find((d) => d.ref === 'dbt:orders.revenue')?.kind).toBe('metric')
    expect(read.definitions).toHaveLength(19)
    expect(read.warnings).toContainEqual({
      type: 'warning',
      code: 'dbt-metricflow.same_name',
      target: 'orders.revenue',
    })
  })

  it('leaves out a dimension that a metric not resolved has the name of', async () => {
    const clash = withMissingInput(file)
    clash.semantic_models[0]!.dimensions.push({ name: 'average_order_value', type: 'categorical' })
    const read = await mapped(clash)
    expect(read.complete).toBe(false)
    expect(read.definitions.map((d) => d.ref)).not.toContain('dbt:orders.average_order_value')

    const hidden = withMetric(clash, 'average_order_value', (metric) => {
      ;(metric.type_params as { is_private?: boolean }).is_private = true
    })
    const kept = await mapped(hidden)
    expect(kept.definitions.find((d) => d.ref === 'dbt:orders.average_order_value')?.kind).toBe(
      'dimension',
    )
  })

  it('reads a name once, from its first entry', async () => {
    const twice = structuredClone(file)
    const first = metricOf(twice, 'revenue')
    twice.metrics.push({
      ...structuredClone(first),
      label: 'Another revenue',
      description: 'Another way.',
      type_params: { ...structuredClone(first.type_params), expr: 'amount * 2' },
    })
    expect(await marks(twice)).toEqual(await marks(file))
    expect(
      (await mapped(twice)).definitions.find((d) => d.ref === 'dbt:orders.revenue'),
    ).toMatchObject({ title: 'Revenue' })
  })

  it('moves a metric of a type it does not know with what it is built on and its own params', async () => {
    const future = withMetric(file, 'average_order_value', (metric) => {
      metric.type = 'forecast'
    })
    expect(await moved(future, withChangedRevenue(future))).toContain(
      'dbt:orders.average_order_value',
    )
    const other = withMetric(future, 'average_order_value', (metric) => {
      ;(metric.type_params as Record<string, unknown>).horizon = 7
    })
    expect(await moved(future, other)).toEqual(['dbt:orders.average_order_value'])

    const known = withMetric(file, 'revenue', (metric) => {
      ;(metric.type_params as Record<string, unknown>).horizon = 7
    })
    expect(await moved(file, known)).toEqual([])
  })

  it('gives a shared metric the one domain its semantic models agree on', async () => {
    const agreed = structuredClone(file)
    agreed.semantic_models[1]!.config.meta = { domain: 'sales' }
    const { definitions } = await mapped(agreed)
    expect(definitions.find((d) => d.ref === 'dbt:_shared.ordering_rate')?.areaHint).toBe('sales')
  })

  it('stays fast on a chain, and on metrics that share their inputs many times over', async () => {
    let last = 'revenue'
    const steps = Array.from({ length: 3_000 }, (_, n) => {
      const metric = {
        name: `step_${n}`,
        label: `Step ${n}`,
        type: 'derived',
        type_params: { expr: `${last} + ${last}`, metrics: [{ name: last }, { name: last }] },
      }
      last = metric.name
      return metric
    })
    const read = await mapped({ ...file, metrics: [...file.metrics, ...steps] })
    expect(read.complete).toBe(true)
    expect(read.definitions).toHaveLength(3_019)
  }, 20_000)
})

describe('the two specs', () => {
  it('give the same marks and words for the same meaning', async () => {
    const [legacy, latest] = [await mapped(legacyManifest), await mapped(latestManifest)]
    expect(latest.definitions.map((d) => d.ref)).toEqual(legacy.definitions.map((d) => d.ref))
    // These two carry their SQL in another place in the two projects: a real change.
    const apart = ['dbt:customers.status', 'dbt:orders.channel']
    expect(await moved(legacyManifest, latestManifest)).toEqual(apart)
    const words = (d: (typeof legacy.definitions)[number]) => ({ ...d, changeMark: '' })
    expect(latest.definitions.map(words)).toEqual(legacy.definitions.map(words))
    expect(latest.warnings).toEqual(legacy.warnings)
  })

  it('reads a measure with no expr as its own column, as dbt does', async () => {
    const measure = structuredClone(legacyManifest)
    const amount = measure.semantic_models[0]!.measures[1]!
    delete amount.expr
    amount.name = 'amount'
    metricOf(measure, 'revenue').type_params.measure!.name = 'amount'
    metricOf(measure, 'revenue_to_date').type_params.measure!.name = 'amount'
    expect(await moved(legacyManifest, measure)).toEqual([])
  })
})

describe('a conversion on the legacy spec', () => {
  const carried = (join: boolean) => {
    const legacy = withMetric(legacyManifest, 'ordering_rate', (metric) => {
      const conversion = (
        metric.type_params as unknown as {
          conversion_type_params: { base_measure: Record<string, unknown> }
        }
      ).conversion_type_params
      conversion.base_measure.join_to_timespine = join
    })
    const latest = withMetric(latestManifest, 'customers', (metric) => {
      ;(metric.type_params as Record<string, unknown>).join_to_timespine = join
    })
    return { legacy, latest }
  }

  it('moves with the timespine join of its measure, as the latest spec’s metric does', async () => {
    const { legacy, latest } = carried(true)
    const [before, after, migrated] = [
      await marks(legacyManifest),
      await marks(legacy),
      await marks(latest),
    ]
    expect(after['dbt:_shared.ordering_rate']).not.toBe(before['dbt:_shared.ordering_rate'])
    expect(after['dbt:_shared.ordering_rate']).toBe(migrated['dbt:_shared.ordering_rate'])
  })
})

describe('a file that is not the semantic manifest', () => {
  it('is refused: dbt’s manifest.json, other JSON and no JSON at all', () => {
    const manifestJson = { metadata: {}, nodes: {}, semantic_models: {}, metrics: {} }
    expect(parseSemanticManifest(JSON.stringify(manifestJson))).toBeNull()
    expect(parseSemanticManifest('{ "metrics": [] }')).toBeNull()
    expect(parseSemanticManifest('not json')).toBeNull()
  })
})

describe('the runtime on the server’s folder', () => {
  const tree = (files: Record<string, string>): FolderTree => ({
    folders: () => Promise.resolve([]),
    files: () =>
      Promise.resolve(Object.entries(files).map(([path, text]) => ({ path, size: text.length }))),
    text: (path) => Promise.resolve(files[path] ?? null),
  })
  const context = (folder: FolderTree, file?: string) =>
    ({
      config: file ? { file } : {},
      folder,
      secret: () => null,
      git: () => {
        throw new Error('A folder is read without Git.')
      },
    }) as unknown as RuntimeContext<{ file?: string }>

  const read = async (folder: FolderTree) => {
    const messages: RuntimeMessage[] = []
    for await (const message of runtime.read(context(folder))) messages.push(message)
    return messages
  }

  it('reads it, warnings first, and takes a digest of the file for its version', async () => {
    const messages = await read(tree({ 'semantic_manifest.json': JSON.stringify(legacyManifest) }))
    const types = messages.map((message) => message.type)
    expect(types.lastIndexOf('warning')).toBeLessThan(types.indexOf('definition'))
    expect(types.filter((type) => type === 'definition')).toHaveLength(19)
    expect(messages.at(-1)).toMatchObject({ type: 'end', complete: true })
    expect(messages.at(-1)).not.toHaveProperty('cursor')
  })

  it('says what it found, in dbt’s words', async () => {
    const report = await runtime.check(
      context(tree({ 'semantic_manifest.json': JSON.stringify(latestManifest) })),
    )
    expect(report.steps.map((step) => [step.id, step.status])).toEqual([
      ['reach', 'ok'],
      ['read', 'ok'],
      ['domains', 'warning'],
    ])
    expect(report.steps[1]!.detail).toBe('12 metrics and 7 dimensions in 2 semantic models.')
    expect(report.steps[2]!.detail).toBe('1 semantic model names no domain.')
  })

  it('says a project with no metrics holds nothing, and what to do', async () => {
    const empty = { semantic_models: [], metrics: [] }
    const report = await runtime.check(
      context(tree({ 'semantic_manifest.json': JSON.stringify(empty) })),
    )
    expect(report.steps[1]).toMatchObject({ status: 'warning' })
    expect(report.steps[1]!.fix).toContain('dbt parse')
  })

  it('fails with a code an administrator can act on', async () => {
    const failure = (files: Record<string, string>) =>
      read(tree(files)).then(
        () => null,
        (error: { code: string; errorClass: string }) => [error.code, error.errorClass],
      )
    expect(await failure({})).toEqual(['not_found', 'config'])
    expect(await failure({ 'semantic_manifest.json': '{}' })).toEqual([
      'dbt-metricflow.not_a_semantic_manifest',
      'config',
    ])
    const tooLarge: FolderTree = {
      ...tree({ 'semantic_manifest.json': '' }),
      text: () => Promise.resolve(null),
    }
    await expect(read(tooLarge)).rejects.toMatchObject({
      code: 'unreadable_file',
      errorClass: 'source',
    })
  })

  it('reads a file the listing, cut short on a large tree, does not hold', async () => {
    const cut: FolderTree = {
      ...tree({ 'semantic_manifest.json': JSON.stringify(legacyManifest) }),
      files: () => Promise.resolve([{ path: 'compiled/a.sql', size: 1 }]),
    }
    expect((await read(cut)).at(-1)).toMatchObject({ type: 'end', complete: true })
  })
})

describe('the terms Heed proposes from it', () => {
  it('proposes each dimension on its own, and no time dimension', async () => {
    const { definitions } = await mapped(legacyManifest)
    const members = definitions.map((definition): CandidateMember => ({
      ref: definition.ref,
      source: manifest.id,
      kind: definition.kind,
      name: definition.name,
      title: definition.title,
      description: definition.descriptionCopy,
      valueType: definition.valueType,
      areaHint: definition.areaHint,
      synonyms: definition.synonyms ?? [],
      baseName: definition.baseName ?? null,
      mergeDimensions: manifest.capabilities.mergeDimensions!,
    }))
    const candidates = termCandidates(members, [])
    const of = (key: string) => candidates.find((candidate) => candidate.key === key)
    const linking = (ref: string) => candidates.find((c) => c.definitionRefs.includes(ref))
    expect(candidates.filter((candidate) => candidate.kind === 'metric')).toHaveLength(12)
    expect(candidates.filter((candidate) => candidate.kind === 'dimension')).toHaveLength(7)
    expect(linking('dbt:orders.status')).toMatchObject({
      name: 'Order status',
      definitionRefs: ['dbt:orders.status'],
    })
    expect(linking('dbt:customers.status')).toMatchObject({
      name: 'Customer status',
      definitionRefs: ['dbt:customers.status'],
    })
    expect(of('dim:ordered_at')?.suggested).toBe(false)
    expect(of('dim:signed_up_at')?.suggested).toBe(false)
    expect(linking('dbt:orders.channel')).toMatchObject({
      aliases: ['sales channel', 'route to market'],
    })
    expect(of('metric:orders')).toMatchObject({ aliases: ['purchases', 'order count'] })
  })
})
