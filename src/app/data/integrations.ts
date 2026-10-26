import cube from '@/assets/logos/cube.svg'
import dbt from '@/assets/logos/dbt.svg'
import googledrive from '@/assets/logos/googledrive.svg'
import markdown from '@/assets/logos/markdown.svg'
import notion from '@/assets/logos/notion.svg'
import warehouse from '@/assets/logos/warehouse.svg'
import type { DomainId } from './world'

// The tools Heed reads, from the settings and integrations design (round 3, all picks adopted).
// Definitions (what exists: metrics and dimensions), context (what people know: documents) and,
// opt-in, figures for Ask. Heed stores no numbers: it reads one when an answer asks for it, and only
// from an integration an admin has switched figures on for. A sync never publishes: definitions are
// a read-only copy that flags the context relying on them, documents become suggestions in the
// owners' Inbox, one per document.

export type ConnectorKind = 'definitions' | 'context' | 'data'
export type ConnectorId = 'cube' | 'google-drive' | 'markdown-git' | 'dbt' | 'notion' | 'warehouse'

export type Connector = {
  id: ConnectorId
  name: string
  kind: ConnectorKind
  logo: string
  /** One line on the catalog cell. */
  blurb: string
  /** Built in v1, or shown as Soon. */
  soon?: boolean
  /** It can answer a figure for Ask (opt-in, off until an admin switches it on). */
  figures?: true
}

export const connectors: Connector[] = [
  {
    id: 'cube',
    name: 'Cube',
    kind: 'definitions',
    logo: cube,
    blurb: 'Metrics and dimensions, read from your Cube definition files in Git.',
    figures: true,
  },
  {
    id: 'dbt',
    name: 'dbt',
    kind: 'definitions',
    logo: dbt,
    blurb: 'Metrics from dbt MetricFlow, read from your project in Git.',
    soon: true,
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    kind: 'context',
    logo: googledrive,
    blurb: 'Google Docs in folders you share become suggestions for owners.',
  },
  {
    id: 'markdown-git',
    name: 'Markdown in Git',
    kind: 'context',
    logo: markdown,
    blurb: 'Markdown files in a repository become suggestions for owners.',
  },
  {
    id: 'notion',
    name: 'Notion',
    kind: 'context',
    logo: notion,
    blurb: 'Pages in spaces you choose become suggestions for owners.',
    soon: true,
  },
  {
    id: 'warehouse',
    name: 'Larchwood warehouse',
    kind: 'data',
    logo: warehouse,
    blurb: "Figures for Ask from your warehouse's query API, read only when an answer needs one.",
    figures: true,
  },
]

export const kindName: Record<ConnectorKind, string> = {
  definitions: 'Definitions',
  context: 'Context',
  data: 'Figures',
}
export const connectorById = (id: string | undefined) => connectors.find((c) => c.id === id)

/** The connected definitions tool, by name: generic copy says it through this, never by hand. */
export const DEFINITIONS_TOOL = connectorById('cube')!.name

/** What Cube reads: each view, what it holds and the domain it maps to. */
export const cubeViews: { view: string; metrics: number; dimensions: number; domain?: DomainId }[] =
  [
    { view: 'orders', metrics: 2, dimensions: 1, domain: 'sales' },
    { view: 'revenue', metrics: 3, dimensions: 0, domain: 'sales' },
    { view: 'basket', metrics: 4, dimensions: 0, domain: 'sales' },
    { view: 'customers', metrics: 6, dimensions: 0, domain: 'customer_value' },
    { view: 'marketing', metrics: 5, dimensions: 0, domain: 'marketing' },
    { view: 'operations', metrics: 2, dimensions: 0 },
    { view: 'segments', metrics: 0, dimensions: 5 },
  ]

/** The folders shared with Heed's service account, each mapped to exactly one domain. */
export const driveFolders: { folder: string; path: string; domain: DomainId; documents: number }[] =
  [
    { folder: 'Data team', path: 'Definitions', domain: 'sales', documents: 6 },
    { folder: 'Marketing', path: 'Campaigns', domain: 'marketing', documents: 5 },
    { folder: 'Customers', path: 'Retention', domain: 'customer_value', documents: 3 },
  ]

export type DocState = 'waiting' | 'published' | 'returned' | 'skipped'

export const driveDocuments: {
  title: string
  folder: string
  domain: DomainId
  state: DocState
  note?: string
  read: string
  card?: string
}[] = [
  {
    title: 'Marketplace orders: what we count',
    folder: 'Data team / Definitions',
    domain: 'sales',
    state: 'waiting',
    read: 'Today',
    card: 'drive-marketplace',
  },
  {
    title: 'Units sold: bundles and sets',
    folder: 'Data team / Definitions',
    domain: 'sales',
    state: 'waiting',
    read: 'Today',
    card: 'drive-bundles',
  },
  {
    title: 'Retention definitions 2026',
    folder: 'Customers / Retention',
    domain: 'customer_value',
    state: 'waiting',
    read: 'Today',
  },
  {
    title: 'Norway launch campaign notes',
    folder: 'Marketing / Campaigns',
    domain: 'marketing',
    state: 'published',
    read: '20 Oct',
  },
  {
    title: 'Spring Sale checklist',
    folder: 'Marketing / Campaigns',
    domain: 'marketing',
    state: 'returned',
    note: 'Returned by Tomas',
    read: '14 Oct',
  },
  {
    title: 'Team offsite notes',
    folder: 'Marketing / Campaigns',
    domain: 'marketing',
    state: 'skipped',
    note: 'Skipped: names people',
    read: '12 Oct',
  },
]

export type Activity = {
  when: string
  tone: 'ok' | 'changed' | 'failed'
  what: string
  detail: string
}

export const cubeActivity: Activity[] = [
  { when: 'Today, 06:00', tone: 'ok', what: 'Read complete', detail: '27 definitions, no changes' },
  {
    when: '7 Oct, 06:00',
    tone: 'changed',
    what: 'Read complete',
    detail: '2 definitions changed, 2 context items marked Needs checking',
  },
  {
    when: '1 Oct, 06:00',
    tone: 'ok',
    what: 'First read',
    detail: '27 definitions added, 2 views without a domain',
  },
]

export const driveActivity: Activity[] = [
  {
    when: 'Today, 06:00',
    tone: 'changed',
    what: 'Read complete',
    detail: '3 new suggestions, 1 replaced an open one, 1 skipped: names people',
  },
  {
    when: 'Yesterday, 06:00',
    tone: 'ok',
    what: 'Read complete',
    detail: '14 documents, no changes',
  },
  {
    when: '1 Oct, 09:30',
    tone: 'ok',
    what: 'First read',
    detail: '11 documents in 3 folders, 4 suggestions',
  },
]

/**
 * The five states an admin meets, each reachable by a flag in the address (?state=...), so a
 * reviewer can open any of them: nothing connected, syncing, failed, needs a new key, and a sync
 * that created suggestions.
 */
export type IntegrationState =
  'normal' | 'nothing' | 'syncing' | 'failed' | 'reauth' | 'suggestions'
export const integrationState = (flag: string | null): IntegrationState =>
  flag === 'nothing' ||
  flag === 'syncing' ||
  flag === 'failed' ||
  flag === 'reauth' ||
  flag === 'suggestions'
    ? flag
    : 'normal'

/** How each figure-capable integration is reached. The secret is never shown in full. */
export const figureConnections: Record<
  string,
  { endpoint: string; host: string; secretTail: string; contact: string; asOf: string }
> = {
  cube: {
    endpoint: 'https://cube.larchwood.example/cubejs-api/v1/load',
    host: 'cube.larchwood.example',
    secretTail: '3f9a',
    contact: 'Ravi Kapoor',
    asOf: 'today at 06:00',
  },
  warehouse: {
    endpoint: 'https://warehouse.larchwood.example/api/v2/query',
    host: 'warehouse.larchwood.example',
    secretTail: '81c2',
    contact: 'Ravi Kapoor',
    asOf: 'today at 05:30',
  },
}

/** What the warehouse has tables for. It answers none of them: no metric's definition comes from it. */
export const warehouseHas = ['Orders', 'Net promoter score', 'Support contacts']
