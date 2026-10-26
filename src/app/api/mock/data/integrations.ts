import type {
  Activity,
  CubeView,
  DriveDocument,
  DriveFolder,
  FigureConnection,
  IntegrationState,
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
