import { SERVICE_ACCOUNT } from '@/lib/brand'
import type {
  Activity,
  ConnectorId,
  CubeView,
  DriveDocument,
  DriveFolder,
  FigureConnection,
  IntegrationState,
  Source,
  SourcePage,
} from '@/model/integrations'

// The demo world's integrations: what Cube reads, the Drive folders and documents, each tool's
// activity, and how the figure-capable ones are reached.

/** What Cube reads: each view, what it holds and the domain it maps to. */
export const cubeViews: CubeView[] = [
  { view: 'orders', metrics: 2, dimensions: 1, domain: 'sales' },
  { view: 'revenue', metrics: 3, dimensions: 0, domain: 'sales' },
  { view: 'basket', metrics: 4, dimensions: 0, domain: 'sales' },
  { view: 'customers', metrics: 6, dimensions: 0, domain: 'customer_value' },
  { view: 'marketing', metrics: 5, dimensions: 0, domain: 'marketing' },
  { view: 'operations', metrics: 2, dimensions: 0 },
  { view: 'segments', metrics: 0, dimensions: 5 },
]

/** The folders shared with Heed's service account, each mapped to exactly one domain. */
export const driveFolders: DriveFolder[] = [
  { folder: 'Data team', path: 'Definitions', domain: 'sales', documents: 6 },
  { folder: 'Marketing', path: 'Campaigns', domain: 'marketing', documents: 5 },
  { folder: 'Customers', path: 'Retention', domain: 'customer_value', documents: 3 },
]

export const driveDocuments: DriveDocument[] = [
  {
    title: 'Marketplace orders: what we count',
    folder: 'Data team / Definitions',
    domain: 'sales',
    state: 'waiting',
    read: 'Today',
    href: '/inbox?demo=week&card=drive-marketplace',
  },
  {
    title: 'Units sold: bundles and sets',
    folder: 'Data team / Definitions',
    domain: 'sales',
    state: 'waiting',
    read: 'Today',
    href: '/inbox?demo=week&card=drive-bundles',
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

export const integrationState = (flag: string | null): IntegrationState =>
  flag === 'nothing' ||
  flag === 'syncing' ||
  flag === 'failed' ||
  flag === 'reauth' ||
  flag === 'suggestions'
    ? flag
    : 'normal'

/** How each figure-capable integration is reached. The secret is never shown in full. */
export const figureConnections: Record<string, FigureConnection> = {
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

/** The folders of the handbook in Git, once it is connected: its first read is still to come. */
export const handbookFolders: DriveFolder[] = [
  { folder: 'docs/sales', path: '', domain: 'sales', documents: 5 },
  { folder: 'docs/marketing', path: '', domain: 'marketing', documents: 3 },
]

const quiet = { failures: 0, failure: null, lastGood: null, created: null }

/** Each tool the demo world connects, as its row and the head of its page show it. */
export const sources: Record<ConnectorId, Source | undefined> = {
  cube: {
    id: 'cube',
    connector: 'cube',
    health: 'healthy',
    every: 'every hour',
    staleAfter: '6 hours',
    last: { at: { day: 'Today', time: '06:00' }, complete: true, seconds: 3, seen: 27 },
    next: { day: 'Today', time: '07:00' },
    ...quiet,
    definitions: { metrics: 22, dimensions: 5, views: 7, noDomain: 2, flagged: 2 },
    documents: null,
    inbox: null,
    added: { by: 'Ravi Kapoor', when: '1 Oct' },
  },
  'google-drive': {
    id: 'google-drive',
    connector: 'google-drive',
    health: 'healthy',
    every: 'every day',
    staleAfter: '2 days',
    last: { at: { day: 'Today', time: '06:00' }, complete: true, seconds: 4, seen: 14 },
    next: { day: 'Tomorrow', time: '06:00' },
    ...quiet,
    definitions: null,
    documents: { held: 14, waiting: 3, domains: 2, madeToday: 3, perDay: 5 },
    inbox: '/inbox?demo=week&card=drive-marketplace',
    added: { by: 'Ravi Kapoor', when: '1 Oct' },
  },
  warehouse: {
    id: 'warehouse',
    connector: 'warehouse',
    health: 'healthy',
    every: 'when asked',
    staleAfter: '1 day',
    last: null,
    next: null,
    ...quiet,
    definitions: null,
    documents: null,
    inbox: null,
    added: { by: 'Ravi Kapoor', when: '1 Oct' },
  },
  'markdown-git': {
    id: 'markdown-git',
    connector: 'markdown-git',
    health: 'healthy',
    every: 'every day',
    staleAfter: '2 days',
    last: null,
    next: { day: 'Today', time: '07:00' },
    ...quiet,
    definitions: null,
    documents: { held: 0, waiting: 0, domains: 0, madeToday: 0, perDay: 5 },
    inbox: null,
    added: { by: 'Jon Abara', when: 'Today' },
  },
  dbt: undefined,
  notion: undefined,
}

/** How each tool the demo world connects is connected: never a secret, only whether one is set. */
export const connections: Partial<Record<ConnectorId, SourcePage['connection']>> = {
  cube: [
    { label: 'Repository', value: 'https://git.example/larchwood/cube-definitions', code: true },
    { label: 'Branch or tag', value: 'main', code: true },
    { label: 'Folder', value: 'cube/', code: true },
    { label: 'Read-only token', value: 'Set, only used for reading' },
  ],
  'google-drive': [
    { label: 'Reads as', value: SERVICE_ACCOUNT, code: true },
    { label: 'Access', value: 'Viewer on the folders above. Nothing else in Drive' },
    { label: 'Service account key', value: 'Set, only used for reading' },
  ],
  warehouse: [],
  'markdown-git': [
    { label: 'Repository', value: 'https://git.example/larchwood/handbook', code: true },
    { label: 'Branch or tag', value: 'main', code: true },
    { label: 'Read-only token', value: 'Set, only used for reading' },
  ],
}

/**
 * A tool as one of the states a reviewer opens by address shows it (?state=): Cube reading or
 * failing, Google Drive refusing its key, or its read having created suggestions.
 */
export function sourceIn(state: IntegrationState, source: Source): Source {
  if (source.connector === 'cube' && state === 'syncing')
    return { ...source, health: 'reading', progress: { done: 19, total: 27 } }
  if (source.connector === 'cube' && state === 'failed')
    return {
      ...source,
      health: 'failed',
      failures: 3,
      failure: 'the repository refused the token (401)',
      lastGood: { day: '21 Oct', time: '06:00', ago: '24 hours ago' },
      next: { day: 'Today', time: '07:00' },
      definitions: { ...source.definitions!, flagged: 0 },
    }
  if (source.connector === 'google-drive' && state === 'reauth')
    return {
      ...source,
      health: 'reauth',
      failures: 1,
      failure: 'Google refused the service account key',
      last: { at: { day: '21 Oct', time: '06:00' }, complete: false, seconds: null, seen: 0 },
      lastGood: { day: '20 Oct', time: '06:00' },
    }
  if (source.connector === 'google-drive' && state === 'suggestions')
    return { ...source, created: { suggested: 3, replaced: 1, skipped: ['it names people'] } }
  return source
}

/** A tool's page in the demo world, in one of the states a reviewer opens by address. */
export function sourcePageOf(state: IntegrationState, source: Source): SourcePage {
  const shown = sourceIn(state, source)
  const activity: Record<ConnectorId, Activity[]> = {
    cube: cubeActivity,
    'google-drive':
      state === 'reauth'
        ? [
            {
              when: '21 Oct, 06:00',
              tone: 'failed',
              what: 'Read refused',
              detail: 'Google refused the service account key. Reading paused.',
            },
            ...driveActivity.slice(1),
          ]
        : driveActivity,
    'markdown-git': [
      {
        when: 'Today',
        tone: 'ok',
        what: 'Connected',
        detail: 'First read at 07:00. Nothing is published by a read.',
      },
    ],
    warehouse: [],
    dbt: [],
    notion: [],
  }
  const connection = (connections[source.connector] ?? []).map((row) =>
    row.label === 'Service account key' && state === 'reauth'
      ? { ...row, value: 'Refused by Google on 21 Oct' }
      : row,
  )
  return {
    source: shown,
    views: source.connector === 'cube' ? cubeViews : [],
    changedOn: source.connector === 'cube' ? '7 Oct' : null,
    folders:
      source.connector === 'google-drive'
        ? driveFolders
        : source.connector === 'markdown-git'
          ? handbookFolders
          : [],
    documents: source.connector === 'google-drive' ? driveDocuments : [],
    activity: activity[source.connector],
    connection,
  }
}
