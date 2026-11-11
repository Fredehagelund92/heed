import type { SourceSettings } from '@contract/sources'
import { fieldVisible } from '@domain/connector-config'
import type { ConnectorManifest } from '@domain/connector-manifest'
import { domainHint } from '@domain/definition-helpers'
import { builtInManifests } from '../../../connectors/manifests'
import {
  parseStaticEntries,
  staticCheckReport,
} from '../../../connectors/static-definitions/entries'
import { SERVICE_ACCOUNT, SLUG } from '@/lib/brand'
import { connectorById, connectors } from '@/model/catalogue'
import { servedToAgents, type Fact, type Metric } from '@/model/items'
import {
  type ConnectChoice,
  type ConnectForm,
  type ConnectScope,
  type ConnectTest,
  type ConnectValues,
  type IntegrationsView,
  type LeftOutView,
  type Source,
  type SourcePage,
} from '@/model/integrations'
import { ApiError } from '../errors'
import { connectFormOf, connectionOf, formTakes, minutesOf } from '../http-integrations'
import { demoPageOf, demoSemanticModels, demoTools, integrationState } from './data/integrations'
import type { Address } from './scenario'

/** How long a read the mock runs takes: Read again shows Reading for this long. */
export const MOCK_READ_MS = 1_200

/** How long Test connection takes on the mock: its checks, one after another. */
export const MOCK_TEST_MS = 1_500

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The manifest a tool's connect form is drawn from: its connector's, when it has one. */
const manifestOf = (id: string): ConnectorManifest | undefined =>
  builtInManifests.find((m) => m.id === id)

/**
 * What the flow set for a tool this visit: its settings, its choices, whether a definitions tool
 * reads every view or only those chosen, and its revision.
 */
export type Kept = {
  config: Record<string, string>
  chosen: ConnectChoice[]
  readsAll: boolean
  revision: number
}

/**
 * A model of hundreds of views, for the connect flow at that size (`?views=many`): each region of
 * an invented chain by each subject and each channel, after the demo's own views.
 */
export function manyViews(): ConnectScope[] {
  const regions = ['north', 'south', 'east', 'west', 'central', 'coast', 'alpine', 'lakes']
  const subjects = ['orders', 'revenue', 'returns', 'stock', 'traffic', 'basket', 'region', 'store']
  const channels = ['store', 'web', 'app', 'marketplace', 'wholesale', 'outlet', 'kiosk']
  return regions.flatMap((region, r) =>
    subjects.flatMap((subject, s) =>
      channels.map((channel, c) => {
        const metrics = (r + s + c) % 6
        const dimensions = 1 + ((r * 3 + c) % 4)
        return {
          id: `${region}_${subject}_${channel}`,
          title: `${region}_${subject}_${channel}`,
          detail: [metrics && plural(metrics, 'metric'), plural(dimensions, 'dimension')]
            .filter(Boolean)
            .join(', '),
          metrics,
          dimensions,
        }
      }),
    ),
  )
}

/** The demo model's view of a metric, by its group: Payments are in `orders`. */
const viewOfGroup = (group: string) => (group === 'Payments' ? 'orders' : group.toLowerCase())

/**
 * What reading only these views would stop reading, on the mock: each view read now and left
 * out, and the live items that apply to one of its metrics, by name.
 */
export function leftOutOf(
  reading: readonly ConnectScope[],
  input: { readsAll: boolean; views: readonly string[] },
  world: { metrics: readonly Metric[]; facts: readonly Fact[] },
): LeftOutView {
  if (input.readsAll) return { views: [], items: { count: 0, named: [] } }
  const kept = new Set(input.views)
  const left = reading.filter((scope) => !kept.has(scope.id))
  const gone = new Set(left.map((scope) => scope.id))
  const names = new Set(
    world.metrics.filter((m) => gone.has(viewOfGroup(m.group))).map((m) => m.name),
  )
  const items = world.facts.filter(
    (f) => servedToAgents(f) && f.where.some((name) => names.has(name)),
  )
  return {
    views: left.map((scope) => ({
      view: scope.id,
      metrics: scope.metrics ?? 0,
      dimensions: scope.dimensions ?? 0,
    })),
    items: {
      count: items.length,
      named: items.slice(0, 50).map((f) => ({ id: f.id, title: f.title, domain: f.domain })),
    },
  }
}

/** The domain names a source's settings map, as the form keeps them: none, on the mock. */
const NO_NAMES: Readonly<Record<string, string>> = {}

/**
 * What a test finds in a static list: its groups (a name up to its last dot), each with what it
 * holds and the domain most of it names, as the service's check finds a definitions tool's views.
 */
function staticScopes(text: string): ConnectScope[] {
  const parsed = parseStaticEntries(text)
  if ('problem' in parsed) return []
  const groups = new Map<string, { metrics: number; dimensions: number; domains: string[] }>()
  for (const entry of parsed.entries) {
    const id = entry.name.includes('.')
      ? entry.name.slice(0, entry.name.lastIndexOf('.'))
      : entry.name
    const group = groups.get(id) ?? { metrics: 0, dimensions: 0, domains: [] }
    if (entry.kind === 'metric') group.metrics += 1
    else group.dimensions += 1
    const hint = domainHint(entry.domain, NO_NAMES).areaHint
    if (hint) group.domains.push(hint)
    groups.set(id, group)
  }
  return [...groups].map(([id, g]) => {
    const most = [...new Set(g.domains)].sort(
      (a, b) => g.domains.filter((d) => d === b).length - g.domains.filter((d) => d === a).length,
    )[0]
    return {
      id,
      title: id,
      detail: [
        g.metrics && plural(g.metrics, 'metric'),
        g.dimensions && plural(g.dimensions, 'dimension'),
      ]
        .filter(Boolean)
        .join(', '),
      metrics: g.metrics,
      dimensions: g.dimensions,
      ...(most ? { domain: most } : {}),
    }
  })
}

/** A static list, checked with the connector's own rules, as its runtime checks it. */
function checkStaticList(manifest: ConnectorManifest, values: ConnectValues): ConnectTest {
  const list = manifest.config.fields.find((field) => field.kind === 'json')
  const text = list ? (values.config[list.key] ?? '') : ''
  const parsed = parseStaticEntries(text)
  // As on the service: settings its rules refuse fail the test, in their words.
  if ('problem' in parsed) return { ok: false, steps: [], scopes: [], failure: parsed.problem }
  return {
    ok: true,
    steps: staticCheckReport(parsed.entries, NO_NAMES).steps.map(({ id: _, ...step }) => step),
    scopes: staticScopes(text),
  }
}

/**
 * The checks the mock runs with a connector's own pure rules, by its connector's id: a tool the
 * demo world has no test of, whose check needs nothing outside the app.
 */
const pureChecks: Record<
  string,
  (manifest: ConnectorManifest, values: ConnectValues) => ConnectTest
> = {
  'static-definitions': checkStaticList,
  // Its file is in a repository the mock cannot reach: what the invented shop's file holds.
  'dbt-metricflow': () => ({
    ok: true,
    steps: [
      { title: 'Reach the file', status: 'ok' },
      { title: 'Read the semantic manifest', status: 'ok', detail: '12 metrics and 7 dimensions.' },
    ],
    scopes: demoSemanticModels,
    read: {
      metrics: 12,
      dimensions: 7,
      warnings: [
        {
          title: 'No domain named',
          detail: 'Map it to a domain in the next steps, or name its domain in the tool.',
          count: 1,
        },
      ],
    },
  }),
}

/** A tool's check on the mock, for a tool the demo world has no test of. */
const checkOf = (manifest: ConnectorManifest, values: ConnectValues): ConnectTest =>
  pureChecks[manifest.id]?.(manifest, values) ?? {
    ok: true,
    steps: [{ title: 'Checked the settings', status: 'ok' }],
    scopes: [],
  }

/**
 * A tool's connect form on the mock: drawn from its connector's manifest, as on the service, with
 * what the flow set for it this visit, or the demo world's.
 */
export function connectFormFor(
  id: string,
  connected: readonly string[],
  kept?: Kept,
): ConnectForm | null {
  const tool = connectorById(id)
  const manifest = tool && !tool.soon ? manifestOf(tool.id) : undefined
  if (!tool || !manifest) return null
  const demo = demoTools[tool.id]
  const live = connected.includes(tool.id)
  const config = (live && kept?.config) || (demo?.config ?? {})
  // A connected tool's settings as the service keeps them; a new one starts from the demo's.
  const settings: SourceSettings = {
    id: tool.id,
    type: manifest.id,
    name: tool.name,
    revision: kept?.revision ?? 1,
    config,
    secrets: manifest.secrets.map((secret) => ({ key: secret.key, set: live })),
    scopes: live ? (kept?.chosen ?? demo?.chosen ?? []) : [],
    allGroups: live ? (kept?.readsAll ?? true) : true,
    schedule: null,
    nextReadAt: new Date().toISOString(),
    changedAt: null,
    changedBy: null,
  }
  // A tool the demo world says nothing of starts from its manifest's defaults, as on the service.
  const form = connectFormOf(manifest, live || demo ? settings : null)
  if (!form) return null
  return {
    ...form,
    source: live ? form.source : null,
    // The demo's key file is already uploaded.
    secrets: form.secrets.map((secret) =>
      secret.key === tool.keyFile && demo
        ? { ...secret, set: true, file: { name: `${SLUG}-reader.json`, account: SERVICE_ACCOUNT } }
        : secret,
    ),
  }
}

/**
 * Test connection on the mock: the demo world's checks, then what the tool may read; with `many`,
 * a definitions tool's model of hundreds of views.
 */
export function testFor(connector: string, values: ConnectValues, many = false): ConnectTest {
  const tool = connectorById(connector)
  const manifest = manifestOf(connector)
  if (!tool || !manifest) throw new ApiError('not-found', "This tool can't be connected here.")
  const missing = manifest.config.fields.find(
    (field) =>
      field.required &&
      fieldVisible(field, values.config, manifest.config.fields) &&
      !values.config[field.key]?.trim(),
  )
  if (missing)
    return {
      ok: false,
      steps: [
        {
          title: tool.git ? 'Reach the repository' : 'Check the settings',
          status: 'failed',
          detail: `${missing.label} is empty.`,
          fix: `Give the ${missing.label.toLowerCase()}.`,
        },
      ],
      scopes: [],
    }
  const demo = demoTools[connector]
  if (!demo) return checkOf(manifest, values)
  return {
    ok: true,
    steps: demo.steps.map((title) => ({ title, status: 'ok' as const })),
    scopes: many && tool.kind === 'definitions' ? [...demo.scopes, ...manyViews()] : demo.scopes,
  }
}

/** What connecting, or changing, takes on the mock: a reason, and a domain for every folder. */
export function checkConnect(
  connector: string,
  input: { chosen: readonly ConnectChoice[]; reason: string },
) {
  if (!input.reason.trim()) throw new ApiError('invalid', 'Say why you are adding it.')
  if (connectorById(connector)?.kind !== 'definitions' && !input.chosen.length)
    throw new ApiError('invalid', 'Choose at least one folder to read.')
  if (connectorById(connector)?.kind !== 'definitions' && input.chosen.some((c) => !c.domain))
    throw new ApiError('invalid', 'Choose a domain for each folder.')
}

/**
 * A demo tool's page once the flow chose the views it reads this visit: only those views, and
 * what they hold.
 */
function readingOnly(page: SourcePage, kept: Kept | undefined): SourcePage {
  if (!kept || kept.readsAll || !page.source.definitions) return page
  const chosen = new Map(kept.chosen.map((c) => [c.id, c.domain]))
  // A view of the model of hundreds is read as the demo's own are.
  const many = manyViews().map((v) => ({
    view: v.id,
    metrics: v.metrics ?? 0,
    dimensions: v.dimensions ?? 0,
  }))
  const views = [...page.views, ...many].flatMap((v) => {
    if (!chosen.has(v.view)) return []
    const domain = chosen.get(v.view) ?? null
    return [
      { view: v.view, metrics: v.metrics, dimensions: v.dimensions, ...(domain ? { domain } : {}) },
    ]
  })
  return {
    ...page,
    views,
    source: {
      ...page.source,
      definitions: {
        ...page.source.definitions,
        metrics: views.reduce((n, v) => n + v.metrics, 0),
        dimensions: views.reduce((n, v) => n + v.dimensions, 0),
        views: views.length,
        noDomain: views.filter((v) => !v.domain).length,
      },
    },
  }
}

/** A read a schedule's length after a time of today ("09:41"): the next one it plans. */
const readAfter = (time: string, schedule: string) => {
  const [hours = 0, minutes = 0] = time.split(':').map(Number)
  const at = hours * 60 + minutes + minutesOf(schedule)
  const clock = `${String(Math.floor(at / 60) % 24).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`
  return { day: at < 1_440 ? 'Today' : at < 2_880 ? 'Tomorrow' : 'Later', time: clock }
}

/**
 * A tool connected this visit that the demo world has no page for, its settings as its manifest
 * words them. A definitions tool was read when it was connected, as on the service, and holds what
 * its test found, each view with the domain it was mapped to; a content tool reads first at 07:00.
 */
function keptPage(id: string, kept: Kept | undefined, connectedAt: string): SourcePage | null {
  const tool = connectorById(id)
  const manifest = manifestOf(id)
  if (!tool || !manifest) return null
  const definitions = tool.kind === 'definitions'
  const chosen = kept?.chosen ?? []
  const readsAll = kept?.readsAll ?? true
  // Every view, or only those chosen; each with its domain chosen, or the one the tool names.
  const views = (
    definitions ? checkOf(manifest, { config: kept?.config ?? {}, secrets: {} }).scopes : []
  ).flatMap((scope) => {
    const choice = chosen.find((c) => c.id === scope.id)
    if (!readsAll && !choice) return []
    const domain = choice ? choice.domain : scope.domain
    return [
      {
        view: scope.title,
        metrics: scope.metrics ?? 0,
        dimensions: scope.dimensions ?? 0,
        ...(domain ? { domain } : {}),
      },
    ]
  })
  const metrics = views.reduce((n, v) => n + v.metrics, 0)
  const dimensions = views.reduce((n, v) => n + v.dimensions, 0)
  const form = connectFormOf(manifest, null)
  const source: Source = {
    id,
    connector: id,
    health: 'healthy',
    // A tool read as it is connected has its next read to wait for; one not read yet is queued.
    read: definitions ? 'scheduled' : 'queued',
    every: form?.every ?? 'every day',
    staleAfter: form?.staleAfter ?? '1 day',
    last: definitions
      ? {
          at: { day: 'Today', time: connectedAt },
          complete: true,
          seconds: 1,
          seen: metrics + dimensions,
        }
      : null,
    next: definitions
      ? readAfter(connectedAt, manifest.schedule.default)
      : { day: 'Today', time: '07:00' },
    failures: 0,
    failure: null,
    lastGood: null,
    created: null,
    definitions: definitions
      ? {
          metrics,
          dimensions,
          views: views.length,
          noDomain: views.filter((v) => !v.domain).length,
          flagged: 0,
        }
      : null,
    documents: definitions
      ? null
      : {
          held: 0,
          waiting: 0,
          domains: 0,
          madeToday: 0,
          perDay: manifest.limits.draftsPerDay ?? 0,
        },
    inbox: null,
    added: { by: 'Jon Abara', when: 'Today' },
  }
  const settings: SourceSettings = {
    id,
    type: id,
    name: tool.name,
    revision: kept?.revision ?? 1,
    config: kept?.config ?? {},
    secrets: manifest.secrets.map((secret) => ({ key: secret.key, set: true })),
    scopes: [],
    allGroups: true,
    schedule: null,
    nextReadAt: new Date().toISOString(),
    changedAt: null,
    changedBy: null,
  }
  return {
    source,
    views,
    changedOn: null,
    folders: chosen.flatMap((c) =>
      !definitions && c.domain
        ? [{ folder: c.title, path: '', domain: c.domain, documents: 0 }]
        : [],
    ),
    documents: [],
    activity: [
      definitions
        ? {
            when: `Today, ${connectedAt}`,
            tone: 'ok',
            what: 'First read',
            detail: `${plural(metrics + dimensions, 'definition')} added`,
          }
        : {
            when: 'Today',
            tone: 'ok',
            what: 'Connected',
            detail: 'First read at 07:00. Nothing is published by a read.',
          },
    ],
    connection: connectionOf(settings, manifest),
  }
}

// The mock's integrations: the tools connected (Settings' own list, which the connect flow adds
// to), each as the demo world has it, in the state the address names (?state=) on the
// integrations' pages. Read again reads for a moment and finds nothing new; Pause reading holds
// until the page reloads, as every other switch of the mock.

export function createIntegrations(
  connected: () => string[],
  kept: (id: string) => Kept | undefined,
) {
  const paused = new Set<string>()
  /** The tools read again this visit, and until when they read. */
  const reading = new Map<string, number>()
  /** The reads Read again ran this visit, newest first, by tool. */
  const reads = new Map<string, SourcePage['activity']>()
  /** When each tool the flow connected this visit was connected: "09:41". */
  const connectedAt = new Map<string, string>()
  const timeOf = (now: Date) =>
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const keptAt = (id: string) => {
    if (!connectedAt.has(id)) connectedAt.set(id, timeOf(new Date()))
    return keptPage(id, kept(id), connectedAt.get(id)!)
  }

  const stateAt = (address: Address) =>
    address.path.startsWith('/settings/integrations')
      ? integrationState(address.query.state ?? null)
      : 'normal'

  /** A tool connected, as the demo world has it, or as the flow connected it this visit. */
  const shownPage = (id: string, address: Address): SourcePage | null => {
    if (!connected().includes(id)) {
      connectedAt.delete(id)
      return null
    }
    const demo = demoTools[id]
    return demo ? readingOnly(demoPageOf(stateAt(address), demo), kept(id)) : keptAt(id)
  }

  /** A tool as it is now: paused, reading, or as the address's state has it. */
  const pageOf = (id: string, address: Address): SourcePage | null => {
    const page = shownPage(id, address)
    if (!page) return null
    const until = reading.get(id)
    if (until !== undefined && until <= Date.now()) reading.delete(id)
    const stopped = paused.has(id)
    return {
      ...page,
      source: {
        ...page.source,
        health: stopped ? 'paused' : page.source.health,
        read: stopped ? null : reading.has(id) ? 'reading' : page.source.read,
        next: stopped ? null : page.source.next,
      },
      activity: [...(reads.get(id) ?? []), ...page.activity],
    }
  }

  return {
    page(address: Address): IntegrationsView {
      const nothing = stateAt(address) === 'nothing'
      return {
        sources: nothing
          ? []
          : connectors.flatMap((c) => {
              const page = pageOf(c.id, address)
              return page ? [page.source] : []
            }),
        connectable: connectors.flatMap((c) => {
          const manifest = c.soon ? undefined : manifestOf(c.id)
          return manifest && formTakes(manifest) ? [c.id] : []
        }),
      }
    },

    sourcePage(id: string, address: Address): SourcePage | null {
      return connectorById(id) ? pageOf(id, address) : null
    },

    /** Read again: reading for a moment, then a read that found nothing new. */
    readAgain(id: string, now: Date) {
      const source = connected().includes(id)
        ? (demoTools[id]?.source ?? keptAt(id)?.source)
        : undefined
      if (!source) throw new ApiError('not-found', "We couldn't find this source.")
      if (paused.has(id))
        throw new ApiError('conflict', 'This source is switched off. Switch it on to read it.')
      reading.set(id, Date.now() + MOCK_READ_MS)
      const time = timeOf(now)
      const detail = source.definitions
        ? `${source.definitions.metrics + source.definitions.dimensions} definitions, no changes`
        : `${source.documents?.held ?? 0} documents, no changes. No new suggestions`
      reads.set(id, [
        { when: `Today, ${time}`, tone: 'ok', what: 'Read complete', detail },
        ...(reads.get(id) ?? []),
      ])
    },

    pause(id: string, on: boolean) {
      if (on) paused.add(id)
      else paused.delete(id)
    },
  }
}
