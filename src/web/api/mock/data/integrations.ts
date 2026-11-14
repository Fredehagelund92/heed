import { SERVICE_ACCOUNT } from '@/lib/brand'
import { builtInManifests } from '../../../../connectors/manifests'
import {
  type Activity,
  type ConnectChoice,
  type ConnectScope,
  type DefinitionsView,
  type DriveDocument,
  type DriveFolder,
  type FigureConnection,
  type IntegrationState,
  type Source,
  type SourcePage,
} from '@/model/integrations'

// The demo world's integrations: the tools it connects, by their connector's id, and for each what
// it reads, its activity, how it is connected and what its test finds; and how the figure-capable
// ones are reached. The demo world names its tools here, and only here: every word on a screen
// that names one comes from its connector's manifest.

/** The demo world's definitions tool and its context tool, by their connector's id. */
export const DEMO_DEFINITIONS = 'cube'
export const DEMO_CONTEXT = 'google-drive'
/** The tool the demo's handbook is in, connected only once someone goes through the flow. */
const DEMO_HANDBOOK = 'git-markdown'

/** The tools the demo world starts with connected. */
export const demoConnected = [DEMO_DEFINITIONS, DEMO_CONTEXT]

/** A tool of the demo world, as people say it: its manifest's name for it. */
export const demoTool = (id: string) => builtInManifests.find((m) => m.id === id)?.tool ?? id

/** Where the demo's definitions tool is, for a figure read there while figures are off. */
export const demoToolHome: Record<string, string> = {
  [DEMO_DEFINITIONS]: 'https://cube.larchwood.example/',
}

/** What the definitions tool reads: each view, what it holds and the domain it maps to. */
const cubeViews: DefinitionsView[] = [
  { view: 'orders', metrics: 2, dimensions: 1, domain: 'sales' },
  { view: 'revenue', metrics: 3, dimensions: 0, domain: 'sales' },
  { view: 'basket', metrics: 4, dimensions: 0, domain: 'sales' },
  { view: 'customers', metrics: 6, dimensions: 0, domain: 'customer_value' },
  { view: 'marketing', metrics: 5, dimensions: 0, domain: 'marketing' },
  { view: 'operations', metrics: 2, dimensions: 0 },
  { view: 'segments', metrics: 0, dimensions: 5 },
]

/** What a test of the invented shop's dbt project finds: its semantic models, and `_shared`. */
export const demoSemanticModels: ConnectScope[] = [
  {
    id: 'orders',
    title: 'orders',
    detail: '9 metrics, 3 dimensions',
    metrics: 9,
    dimensions: 3,
    domain: 'sales',
  },
  {
    id: 'customers',
    title: 'customers',
    detail: '1 metric, 4 dimensions',
    metrics: 1,
    dimensions: 4,
  },
  { id: '_shared', title: '_shared', detail: '2 metrics', metrics: 2, dimensions: 0 },
]

/** The folders shared with Heed's service account, each mapped to exactly one domain. */
const driveFolders: DriveFolder[] = [
  { folder: 'Data team', path: 'Definitions', domain: 'sales', documents: 6 },
  { folder: 'Marketing', path: 'Campaigns', domain: 'marketing', documents: 5 },
  { folder: 'Customers', path: 'Retention', domain: 'customer_value', documents: 3 },
]

const driveDocuments: DriveDocument[] = [
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

const cubeActivity: Activity[] = [
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

const driveActivity: Activity[] = [
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
  [DEMO_DEFINITIONS]: {
    endpoint: 'https://cube.larchwood.example/cubejs-api/v1/load',
    host: 'cube.larchwood.example',
    secretSet: true,
    contact: 'Ravi Kapoor',
    asOf: 'today at 06:00',
  },
}

/** The folders of the handbook in Git, once it is connected: its first read is still to come. */
const handbookFolders: DriveFolder[] = [
  { folder: 'docs/sales', path: '', domain: 'sales', documents: 5 },
  { folder: 'docs/marketing', path: '', domain: 'marketing', documents: 3 },
]

const quiet = { failures: 0, failure: null, lastGood: null, created: null }
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * A tool of the demo world: its row and page, and its connect flow (the settings a new connection
 * starts from, what its test checks and finds, and what it reads once connected). `states` is how
 * it shows a state a reviewer opens by address (?state=); a state it has none for leaves it as is.
 */
export type DemoTool = {
  source: Source
  page: Omit<SourcePage, 'source'>
  config: Record<string, string>
  steps: string[]
  scopes: ConnectScope[]
  chosen: ConnectChoice[]
  states?: Partial<Record<IntegrationState, (page: SourcePage) => SourcePage>>
}

/** Each tool of the demo world, by its connector's id. */
export const demoTools: Record<string, DemoTool> = {
  [DEMO_DEFINITIONS]: {
    source: {
      id: DEMO_DEFINITIONS,
      connector: DEMO_DEFINITIONS,
      health: 'healthy',
      read: 'scheduled',
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
    page: {
      views: cubeViews,
      changedOn: '7 Oct',
      folders: [],
      documents: [],
      activity: cubeActivity,
      connection: [
        {
          label: 'Repository',
          value: 'https://git.example/larchwood/cube-definitions',
          code: true,
        },
        { label: 'Branch or tag', value: 'main', code: true },
        { label: 'Folder', value: 'cube/', code: true },
        { label: 'Read-only token', value: 'Set, only used for reading' },
      ],
    },
    config: {
      repository: 'https://git.example/larchwood/cube-definitions',
      ref: 'main',
      folder: 'cube/',
    },
    steps: [
      'Reached the repository',
      'Signed in with the token',
      `Found 7 ${demoTool(DEMO_DEFINITIONS)} views`,
    ],
    scopes: cubeViews.map((v) => ({
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
    })),
    chosen: cubeViews.map((v) => ({ id: v.view, title: v.view, domain: v.domain ?? null })),
    states: {
      syncing: (page) => ({
        ...page,
        source: { ...page.source, read: 'reading', progress: { done: 19, total: 27 } },
      }),
      failed: (page) => ({
        ...page,
        source: {
          ...page.source,
          health: 'failed',
          failures: 3,
          failure: 'the repository refused the token (401)',
          lastGood: { day: '21 Oct', time: '06:00', ago: '24 hours ago' },
          next: { day: 'Today', time: '07:00' },
          definitions: { ...page.source.definitions!, flagged: 0 },
        },
      }),
    },
  },
  [DEMO_CONTEXT]: {
    source: {
      id: DEMO_CONTEXT,
      connector: DEMO_CONTEXT,
      health: 'healthy',
      read: 'scheduled',
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
    page: {
      views: [],
      changedOn: null,
      folders: driveFolders,
      documents: driveDocuments,
      activity: driveActivity,
      connection: [
        { label: 'Reads as', value: SERVICE_ACCOUNT, code: true },
        { label: 'Access', value: 'Viewer on the folders above. Nothing else in Drive' },
        { label: 'Service account key', value: 'Set, only used for reading' },
      ],
    },
    config: {},
    steps: [
      'Google accepted the service account',
      'Found 3 shared folders',
      'Read 14 Google Docs: titles only',
    ],
    scopes: driveFolders.map((f) => ({
      id: `${f.folder} / ${f.path}`,
      title: `${f.folder} / ${f.path}`,
      detail: plural(f.documents, 'document'),
      documents: f.documents,
      domain: f.domain,
    })),
    chosen: driveFolders.map((f) => {
      const name = `${f.folder} / ${f.path}`
      return { id: name, title: name, domain: f.domain }
    }),
    states: {
      reauth: (page) => ({
        ...page,
        source: {
          ...page.source,
          health: 'reauth',
          // Not paused: each day's read tries the key again.
          failures: 2,
          failure: 'Google refused the service account key',
          last: { at: { day: 'Today', time: '06:00' }, complete: false, seconds: null, seen: 0 },
          lastGood: { day: '20 Oct', time: '06:00' },
        },
        activity: [
          {
            when: 'Today, 06:00',
            tone: 'failed',
            what: 'Read refused',
            detail: 'Google refused the service account key again.',
          },
          {
            when: 'Yesterday, 06:00',
            tone: 'failed',
            what: 'Read refused',
            detail: 'Google refused the service account key.',
          },
          ...driveActivity.slice(2),
        ],
        connection: page.connection.map((row) =>
          row.label === 'Service account key'
            ? { ...row, value: 'Refused by Google on 21 Oct' }
            : row,
        ),
      }),
      suggestions: (page) => ({
        ...page,
        source: {
          ...page.source,
          created: { suggested: 3, replaced: 1, skipped: ['it names people'] },
        },
      }),
    },
  },
  [DEMO_HANDBOOK]: {
    source: {
      id: DEMO_HANDBOOK,
      connector: DEMO_HANDBOOK,
      health: 'healthy',
      // Connected this visit and not read yet: queued for the job's first read.
      read: 'queued',
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
    page: {
      views: [],
      changedOn: null,
      folders: handbookFolders,
      documents: [],
      activity: [
        {
          when: 'Today',
          tone: 'ok',
          what: 'Connected',
          detail: 'First read at 07:00. Nothing is published by a read.',
        },
      ],
      connection: [
        { label: 'Repository', value: 'https://git.example/larchwood/handbook', code: true },
        { label: 'Branch or tag', value: 'main', code: true },
        { label: 'Read-only token', value: 'Set, only used for reading' },
      ],
    },
    config: {
      repository: 'https://git.example/larchwood/handbook',
      ref: 'main',
      folder: 'docs/',
    },
    steps: [
      'Reached the repository',
      'Signed in with the token',
      'Found 9 Markdown files in 3 folders',
    ],
    scopes: [
      { id: 'docs/sales', title: 'docs/sales', detail: '5 files', documents: 5, domain: 'sales' },
      { id: 'docs/marketing', title: 'docs/marketing', detail: '3 files', documents: 3 },
      {
        id: 'docs/people',
        title: 'docs/people',
        detail: '1 file',
        documents: 1,
        leftOut: 'its file names people, and those are skipped',
      },
    ],
    chosen: handbookFolders.map((f) => ({ id: f.folder, title: f.folder, domain: f.domain })),
  },
}

/** A tool's page in the demo world, in one of the states a reviewer opens by address. */
export function demoPageOf(state: IntegrationState, tool: DemoTool): SourcePage {
  const page = { ...tool.page, source: tool.source }
  return tool.states?.[state]?.(page) ?? page
}
