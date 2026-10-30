import type { SourceSettings } from '@contract/sources'
import type { ConnectorManifest } from '@domain/connector-manifest'
import { builtInManifests } from '../../../connectors/manifests'
import { SERVICE_ACCOUNT, SLUG } from '@/lib/brand'
import {
  connectorById,
  connectors,
  DEFINITIONS_TOOL,
  type ConnectChoice,
  type ConnectForm,
  type ConnectorId,
  type ConnectScope,
  type ConnectTest,
  type ConnectValues,
  type IntegrationsView,
  type SourcePage,
} from '@/model/integrations'
import { ApiError } from '../errors'
import { connectFormOf, connectorOfCatalog } from '../http-integrations'
import {
  cubeViews,
  driveFolders,
  handbookFolders,
  integrationState,
  sourcePageOf,
  sources,
} from './data/integrations'
import type { Address } from './scenario'

/** How long a read the mock runs takes: Read again shows Reading for this long. */
export const MOCK_READ_MS = 1_200

/** How long Test connection takes on the mock: its checks, one after another. */
export const MOCK_TEST_MS = 1_500

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The manifest a tool's connect form is drawn from: its connector's. */
const manifestOf = (id: ConnectorId): ConnectorManifest | undefined =>
  builtInManifests.find((m) => m.id === connectorOfCatalog(id))

/** What the demo world's tools are connected with: addresses only, never a secret. */
const demoConfig: Partial<Record<ConnectorId, Record<string, string>>> = {
  cube: {
    repository: 'https://git.example/larchwood/cube-definitions',
    ref: 'main',
    folder: 'cube/',
  },
  'markdown-git': {
    repository: 'https://git.example/larchwood/handbook',
    ref: 'main',
    folder: 'docs/',
  },
}

/** What each tool's test finds on the mock: the views and folders it may read. */
const demoScopes = (id: ConnectorId): ConnectScope[] =>
  id === 'cube'
    ? cubeViews.map((v) => ({
        id: v.view,
        title: v.view,
        detail: [
          v.metrics && plural(v.metrics, 'metric'),
          v.dimensions && plural(v.dimensions, 'dimension'),
        ]
          .filter(Boolean)
          .join(', '),
        metrics: v.metrics,
        dimensions: v.dimensions,
        ...(v.domain ? { domain: v.domain } : {}),
      }))
    : id === 'google-drive'
      ? driveFolders.map((f) => ({
          id: `${f.folder} / ${f.path}`,
          title: `${f.folder} / ${f.path}`,
          detail: plural(f.documents, 'document'),
          documents: f.documents,
          domain: f.domain,
        }))
      : [
          {
            id: 'docs/sales',
            title: 'docs/sales',
            detail: '5 files',
            documents: 5,
            domain: 'sales',
          },
          { id: 'docs/marketing', title: 'docs/marketing', detail: '3 files', documents: 3 },
          {
            id: 'docs/people',
            title: 'docs/people',
            detail: '1 file',
            documents: 1,
            leftOut: 'its file names people, and those are skipped',
          },
        ]

/** The checks each tool's test runs on the mock, in the mockup's words. */
const demoSteps = (id: ConnectorId) =>
  (id === 'cube'
    ? ['Reached the repository', 'Signed in with the token', `Found 7 ${DEFINITIONS_TOOL} views`]
    : id === 'google-drive'
      ? [
          'Google accepted the service account',
          'Found 3 shared folders',
          'Read 14 Google Docs: titles only',
        ]
      : [
          'Reached the repository',
          'Signed in with the token',
          'Found 9 Markdown files in 3 folders',
        ]
  ).map((title) => ({ title, status: 'ok' as const }))

/** What a connected tool of the demo world reads, with each one's domain. */
const demoChosen = (id: ConnectorId): ConnectChoice[] =>
  id === 'cube'
    ? cubeViews.map((v) => ({ id: v.view, title: v.view, domain: v.domain ?? null }))
    : id === 'google-drive'
      ? driveFolders.map((f) => {
          const name = `${f.folder} / ${f.path}`
          return { id: name, title: name, domain: f.domain }
        })
      : handbookFolders.map((f) => ({ id: f.folder, title: f.folder, domain: f.domain }))

/** What the connect flow set for a tool this visit: its settings, its choices, its revision. */
export type Kept = { config: Record<string, string>; chosen: ConnectChoice[]; revision: number }

/**
 * A tool's connect form on the mock: drawn from its connector's manifest, as on the service, with
 * what the flow set for it this visit, or the demo world's.
 */
export function connectFormFor(
  id: string,
  connected: readonly ConnectorId[],
  kept?: Kept,
): ConnectForm | null {
  const tool = connectorById(id)
  const manifest = tool && !tool.soon ? manifestOf(tool.id) : undefined
  if (!tool || !manifest) return null
  const live = connected.includes(tool.id)
  const config = (live && kept?.config) || (demoConfig[tool.id] ?? {})
  // A connected tool's settings as the service keeps them; a new one starts from the demo's.
  const settings: SourceSettings = {
    id: tool.id,
    type: manifest.id,
    name: tool.name,
    revision: kept?.revision ?? 1,
    config,
    secrets: manifest.secrets.map((secret) => ({ key: secret.key, set: live })),
    scopes: live ? (kept?.chosen ?? demoChosen(tool.id)) : [],
    schedule: null,
    nextReadAt: null,
    changedAt: null,
    changedBy: null,
  }
  const form = connectFormOf(manifest, settings)!
  return {
    ...form,
    connector: tool.id,
    source: live ? form.source : null,
    // The demo's key file is already uploaded, as the mockup draws it.
    secrets: form.secrets.map((secret) =>
      secret.key === tool.keyFile
        ? { ...secret, set: true, file: { name: `${SLUG}-reader.json`, account: SERVICE_ACCOUNT } }
        : secret,
    ),
  }
}

/** Test connection on the mock: the mockup's checks, then what the tool may read. */
export function testFor(connector: ConnectorId, values: ConnectValues): ConnectTest {
  const tool = connectorById(connector)
  const manifest = manifestOf(connector)
  if (!tool || !manifest) throw new ApiError('not-found', "This tool can't be connected here.")
  const missing = manifest.config.fields.find(
    (field) => field.required && !values.config[field.key]?.trim(),
  )
  if (missing)
    return {
      ok: false,
      steps: [
        {
          title: 'Reach the repository',
          status: 'failed',
          detail: `${missing.label} is empty.`,
          fix: `Give the ${missing.label.toLowerCase()}.`,
        },
      ],
      scopes: [],
    }
  return { ok: true, steps: demoSteps(connector), scopes: demoScopes(connector) }
}

/** What connecting, or changing, takes on the mock: a reason, and a domain for every folder. */
export function checkConnect(
  connector: ConnectorId,
  input: { chosen: readonly ConnectChoice[]; reason: string },
) {
  if (!input.reason.trim()) throw new ApiError('invalid', 'Say why you are adding it.')
  if (connectorById(connector)?.kind !== 'definitions' && !input.chosen.length)
    throw new ApiError('invalid', 'Choose at least one folder to read.')
  if (connectorById(connector)?.kind !== 'definitions' && input.chosen.some((c) => !c.domain))
    throw new ApiError('invalid', 'Choose a domain for each folder.')
}

// The mock's integrations: the tools connected (Settings' own list, which the connect flow adds
// to), each as the demo world has it, in the state the address names (?state=) on the
// integrations' pages. Read again reads for a moment and finds nothing new; Pause reading holds
// until the page reloads, as every other switch of the mock.

export function createIntegrations(connected: () => ConnectorId[]) {
  const paused = new Set<string>()
  /** The tools read again this visit, and until when they read. */
  const reading = new Map<string, number>()
  /** The reads Read again ran this visit, newest first, by tool. */
  const reads = new Map<string, SourcePage['activity']>()

  const stateAt = (address: Address) =>
    address.path.startsWith('/settings/integrations')
      ? integrationState(address.query.state ?? null)
      : 'normal'

  /** A tool as it is now: paused, reading, or as the address's state has it. */
  const pageOf = (id: ConnectorId, address: Address): SourcePage | null => {
    const source = sources[id]
    if (!source || !connected().includes(id)) return null
    const page = sourcePageOf(stateAt(address), source)
    const until = reading.get(id)
    if (until !== undefined && until <= Date.now()) reading.delete(id)
    const health = paused.has(id) ? 'paused' : reading.has(id) ? 'reading' : page.source.health
    return {
      ...page,
      source: { ...page.source, health, next: paused.has(id) ? null : page.source.next },
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
        connectable: connectors.filter((c) => !c.soon).map((c) => c.id),
      }
    },

    sourcePage(id: string, address: Address): SourcePage | null {
      const known = connectors.find((c) => c.id === id)
      return known ? pageOf(known.id, address) : null
    },

    /** Read again: reading for a moment, then a read that found nothing new. */
    readAgain(id: string, now: Date) {
      const source = sources[id as ConnectorId]
      if (!source || !connected().includes(source.connector))
        throw new ApiError('not-found', "We couldn't find this source.")
      if (paused.has(id))
        throw new ApiError('conflict', 'This source is switched off. Switch it on to read it.')
      reading.set(id, Date.now() + MOCK_READ_MS)
      const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
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
