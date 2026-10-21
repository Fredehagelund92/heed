/**
 * Settings in the mock (FR-801, FR-804, FR-806 to FR-810, FR-410): the settings and their
 * versions, who holds which role, the areas as settings edits them, the history log, the
 * operations view and the MCP traffic, with the rules the service applies
 * (src/server/modules/admin, areas/settings.ts, auth/roles.ts, jobs/operations.ts). The roster it
 * changes is the workflow's own (mock-workflow.ts), so a role granted here is a role the person
 * holds everywhere at once, and an area created here is listed everywhere.
 *
 * Times are counted from the fixture day, so a story or a screenshot that plays the same steps
 * gets the same answers.
 */
import { ABOUT_BUSINESS_STARTER } from '../../domain/about-business.ts'
import { domainHues, type Area, type Person } from '../../domain/item.ts'
import {
  areaRemovalOutcome,
  confirmsDeletion,
  DELETE_DOMAIN_PHRASE,
} from '../../domain/area-removal.ts'
import { canonicalJson } from '../../domain/canonical.ts'
import { textFindings } from '../../domain/draft.ts'
import { shiftDate } from '../../domain/validity.ts'
import {
  type AuditEntry,
  type ClientPolicy,
  type Setting,
  type SettingKey,
  settingSchemas,
  unknownToolsMessage,
} from '../../contract/admin.ts'
import {
  AREA_APPROVERS_MAX,
  AREA_DELETION_LIST_MAX,
  AREA_OWNERS_MAX,
  areaDescriptionSchema,
  areaSummarySchema,
  removeAreaSchema,
  restoreAreaSchema,
  type AreaDetail,
  type AreaRemoval,
  type AreaRemoved,
  type AreaRestored,
  type ArchivedArea,
} from '../../contract/areas.ts'
import type { Edition } from '../../contract/review.ts'
import type {
  HeldRole,
  PeoplePage,
  PeopleSearchInput,
  PersonRow,
  PersonSheet,
  RoleChange,
} from '../../contract/people.ts'
import type { OperationsOverviewView } from '../../contract/operations.ts'
import { GRANT_BATCH_MAX, lastOwnerMessage } from '../../contract/auth.ts'
import { refusals } from '../../contract/refusals.ts'
import type {
  ApplyGrantsInput,
  AssignmentInput,
  AuditChain,
  AuditExport,
  AuditExportParams,
  AuditPage,
  AuditSearchParams,
  CreateAreaInput,
  GrantChange,
  Grants,
  GrantsApplied,
  RoleInput,
  RunJobResult,
  SetSettingInput,
  TrafficParams,
  TrafficSummary,
  UpdateAreaInput,
  DescribeAreaInput,
  RemoveAreaInput,
  RestoreAreaInput,
  AdminDisconnect,
  AdminDisconnectPerson,
  Connection,
  PersonConnection,
} from './client.ts'
import { DEMO_MODEL_URL } from '../mocks/cube-model.ts'
import { mockSources } from '../mocks/sources.ts'
import { mockConnectorListings } from '../mocks/source-types.ts'
import { connectorConfigDomains, parseConnectorConfig } from '../../domain/connector-config.ts'
import { secretsBoundTo } from '../../domain/connector-manifest.ts'
import {
  parseStaticEntries,
  staticCheckReport,
  staticDomainOf,
} from '../../connectors/static-definitions/entries.ts'
import { reservedSourceIds, sourceIdFrom } from '../../domain/source-id.ts'
import type {
  AddSourceInput,
  SourceCheck,
  ConnectorListing,
  SourceConfig,
  SourceSettings,
  TestSourceInput,
  UpdateSourceInput,
} from '../../contract/sources.ts'
import { ApiError, type StatusKind, type Finding } from './errors.ts'
import { mockConnectionSeed, type MockConnection } from './mock-connections.ts'
import { productName } from '../lib/brand.ts'

/** Who holds which role: the workflow reads these arrays for every permission it checks. */
export type MockRoster = {
  areas: Area[]
  approvers: { areaId: string; personId: string }[]
  administrators: string[]
  auditors: string[]
}

export type MockAdminWorld = {
  today: string
  now: () => string
  people: readonly Person[]
  roster: MockRoster
  /** The MCP tools by name, and the clients that may connect. */
  tools: () => readonly string[]
  clients: () => readonly ClientPolicy[]
  /** The mock's scenario (mock-scenario.ts), for the broken chain and a stopped job runner. */
  scenario: () => string | null
  /**
   * A proposal's number and a proposal's or an item's title for the history log's screen, as
   * the person may see them (row security on the service); nothing for any other subject.
   */
  subjectOf?: (
    subject: { type: string; id: string },
    personId: string,
  ) => Pick<AuditEntry, 'subjectNumber' | 'subjectTitle'>
  /** What deleting an area does to what it holds (FR-814); an area holds nothing without it. */
  deletion?: MockAreaDeletion
}

/** What deleting an area would do, every one named, and who it tells (areas/deletion.ts). */
export type MockDeletionPlan = Pick<
  AreaRemoval,
  'holdings' | 'items' | 'terms' | 'openProposals' | 'drafts' | 'team'
> & { recipients: string[] }

/**
 * What the workflow does when an area is deleted (FR-814): it holds the items, terms and
 * proposals, so it moves them, in one edition, and later serves the terms again.
 */
export type MockAreaDeletion = {
  plan: (areaId: string) => MockDeletionPlan
  /** Moves the items to the Bin, retires the terms and withdraws the open proposals. */
  apply: (
    areaId: string,
    name: string,
    personId: string,
    plan: MockDeletionPlan,
    reason: string | undefined,
  ) => {
    edition: Edition | null
    /** Serves the terms again, as `restoreArea` does; null when there were none. */
    restore: (
      personId: string,
      reason: string | undefined,
    ) => {
      edition: Edition | null
      terms: number
    }
    terms: number
  }
  /** The area's items still in the Bin, newest first. */
  binned: (areaId: string) => AreaRestored['binnedItems']
}

const heldNothing: MockDeletionPlan = {
  holdings: {
    items: 0,
    terms: 0,
    openProposals: 0,
    sourceMembers: 0,
    drafts: 0,
    team: 0,
    history: false,
  },
  items: [],
  terms: [],
  openProposals: [],
  drafts: [],
  team: [],
  recipients: [],
}

const statusOf: Record<StatusKind, number> = {
  'signed-out': 401,
  forbidden: 403,
  'not-found': 404,
  conflict: 409,
  invalid: 422,
  precondition: 412,
  'bad-request': 400,
  unavailable: 503,
}

function refuse(kind: StatusKind, message: string, findings?: Finding[]): never {
  throw new ApiError(kind, message, { status: statusOf[kind], ...(findings ? { findings } : {}) })
}

/** The checks the contract makes before an operation runs: the service answers 400 otherwise. */
function valid(ok: boolean, message: string = refusals.badRequest) {
  if (!ok) refuse('bad-request', message)
}

/** An administrator's reason is kept in the history log, so it holds no sensitive text. */
function plainReason(reason: string) {
  valid(reason.length >= 1 && reason.length <= 500)
  const findings = textFindings(reason, 'reason')
  if (findings.length)
    refuse('invalid', 'Remove the email address, phone number or secret from the reason.', findings)
}

/** What a domain is holds no email address, phone number or secret, as the service checks. */
function plainAbout(input: { summary?: string; description?: string }) {
  const findings = textFindings({
    summary: input.summary ?? '',
    description: input.description ?? '',
  })
  if (findings.length)
    refuse(
      'invalid',
      'Remove the email address, phone number or secret from the summary or the description.',
      findings,
    )
}

/** A deterministic 64 character hex digest, standing in for an entry's hash. */
function digestOf(text: string): string {
  let out = ''
  for (let round = 0; out.length < 64; round++) {
    let hash = 0x811c9dc5 ^ round
    for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193)
    out += (hash >>> 0).toString(16).padStart(8, '0')
  }
  return out.slice(0, 64)
}

const modelOf = (model: string) => ({ provider: 'anthropic', model })

/**
 * Every setting with the value and the reason the service's migrations start it with
 * (db/migrations), so the mock's Limits read like a fresh service. A few have a later version, so
 * the history shows more than the default.
 */
const startingSettings: { key: SettingKey; value: unknown; reason: string }[] = [
  { key: 'evals.flip_repeats', value: 7, reason: 'default (FR-515)' },
  {
    key: 'evals.run_budget_micros',
    value: 2_000_000,
    reason: 'default (FR-516): a run estimated above this waits for an administrator',
  },
  { key: 'evals.tries', value: 3, reason: 'default (FR-515)' },
  {
    key: 'gaps.no_item_threshold',
    value: { calls: 5, days: 7 },
    reason: 'default (FR-606 case 1)',
  },
  {
    key: 'limits.api_rate_per_minute',
    value: { ip: 120, person: 600 },
    reason: 'default (FR-408)',
  },
  { key: 'limits.gap_reports_per_minute', value: { person: 5 }, reason: 'default (FR-408)' },
  {
    key: 'limits.assistant_ratings_per_minute',
    value: { person: 20 },
    reason: 'default (FR-408)',
  },
  { key: 'limits.agent_drafts', value: { per_day: 10, open: 20 }, reason: 'default (FR-121)' },
  {
    key: 'limits.web_searches_per_day',
    value: 0,
    reason: 'default: web search off until an administrator turns it on',
  },
  { key: 'limits.llm_daily_micros_per_person', value: 2_000_000, reason: 'default (FR-409)' },
  {
    key: 'limits.llm_feature_monthly_micros',
    value: { assistant: 250_000_000, eval: 250_000_000 },
    reason: 'default (FR-409)',
  },
  { key: 'limits.llm_monthly_cap_micros', value: 500_000_000, reason: 'default (FR-409)' },
  {
    key: 'limits.mcp_rate_per_minute',
    value: { get_facts: 120, give_feedback: 20, report_gap: 20 },
    reason: 'default (FR-408)',
  },
  {
    key: 'limits.mcp_requests_per_minute',
    value: { client: 120, person: 30 },
    reason: 'default (FR-408)',
  },
  { key: 'limits.mentions_per_version', value: 50, reason: 'Default mention limit (FR-134)' },
  {
    key: 'models.assistant',
    value: modelOf('claude-sonnet-5-5'),
    reason: 'default: questions and answers leave the company to the named provider',
  },
  {
    key: 'models.eval_answer',
    value: modelOf('claude-sonnet-5-5'),
    reason: 'default: questions and answers leave the company to the named provider',
  },
  {
    key: 'models.judge',
    value: 'different_family',
    reason: 'default: a judge from another model line than the answering model',
  },
  {
    key: 'models.call_limits',
    value: { concurrency: 4 },
    reason: 'default (output test plan, R4 and R5)',
  },
  {
    key: 'models.test_authoring',
    value: modelOf('claude-sonnet-5-5'),
    reason: 'default: questions and answers leave the company to the named provider',
  },
  { key: 'privacy.min_count', value: 5, reason: 'default (OQ-6)' },
  { key: 'retention.delivery_days', value: 180, reason: 'default (OQ-6)' },
  { key: 'retention.note_days', value: 180, reason: 'default (OQ-6)' },
  { key: 'retention.outbox_days', value: 30, reason: 'default' },
  { key: 'retention.request_log_days', value: 90, reason: 'default' },
  { key: 'review.default_days', value: 90, reason: 'default (FR-127)' },
  { key: 'review.open_issue_days', value: 14, reason: 'default (FR-135)' },
  { key: 'serving.max_overlay_age_seconds', value: 60, reason: 'default (FR-805, NFR-042)' },
  // On, as the bulk seed sets it: the demo model's folder in this repository.
  {
    key: 'sources.cube_model_url',
    value: DEMO_MODEL_URL,
    reason: 'The demo model is in this repository',
  },
  {
    key: 'business.about',
    value: ABOUT_BUSINESS_STARTER,
    reason: 'default: the starter text, an outdoor-gear retailer',
  },
]

/** Later versions a demo service would have: the history of these reads like a real one. */
const laterVersions: { key: SettingKey; value: unknown; reason: string; days: number }[] = [
  {
    key: 'limits.mcp_requests_per_minute',
    value: { client: 120, person: 40 },
    reason: 'Analysts run longer agent sessions during the quarterly close',
    days: -21,
  },
  {
    key: 'review.default_days',
    value: 120,
    reason: 'Owners asked for a longer default review time',
    days: -12,
  },
  {
    key: 'review.default_days',
    value: 90,
    reason: 'Back to 90 days: too many items went stale unnoticed',
    days: -4,
  },
]

/** The areas' settings the fixture areas do not carry: review time, channel and owner team. */
const areaExtras: Record<
  string,
  { reviewDays: number; chatChannel: string | null; ownerTeam: string | null }
> = {
  area_sales: { reviewDays: 5, chatChannel: '#sales-data', ownerTeam: 'Sales BI' },
  area_marketing: { reviewDays: 5, chatChannel: '#marketing-data', ownerTeam: 'Growth analytics' },
  area_customer_value: { reviewDays: 7, chatChannel: null, ownerTeam: 'Customer insights' },
  area_paid_media: { reviewDays: 5, chatChannel: null, ownerTeam: null },
  area_sandbox: { reviewDays: 10, chatChannel: '#heed-sandbox', ownerTeam: null },
}

/** The scheduled jobs the service registers (src/server/modules/jobs), with their cron lines. */
const scheduledJobs: { name: string; cron: string; everySeconds: number }[] = [
  { name: 'connectors.sync', cron: '7 * * * *', everySeconds: 7_200 },
  { name: 'evals.retrieval', cron: '* * * * *', everySeconds: 300 },
  { name: 'evals.weekly', cron: '0 4 * * 1', everySeconds: 8 * 86_400 },
  { name: 'evals.work', cron: '* * * * *', everySeconds: 300 },
  { name: 'gaps.detect', cron: '*/15 * * * *', everySeconds: 1_800 },
  { name: 'jobs.watchdog', cron: '*/5 * * * *', everySeconds: 600 },
  { name: 'outbox.relay', cron: '* * * * *', everySeconds: 300 },
  { name: 'partitions.ensure', cron: '0 3 * * *', everySeconds: 2 * 86_400 },
  { name: 'retention.run', cron: '30 3 * * *', everySeconds: 2 * 86_400 },
]

const AUDIT_PAGE = 50
const AUDIT_EXPORT = 10_000

/** A CSV cell as the service writes it: quoted, with a leading formula character neutralised. */
const csvCell = (value: unknown) => {
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : canonicalJson(value)
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

export function createMockAdmin(world: MockAdminWorld) {
  const { roster } = world
  const at = (days: number, time = '09:00:00') => `${shiftDate(world.today, days)}T${time}.000Z`
  const firstAdmin = roster.administrators[0] ?? null

  // Settings: every version of each key, newest first.
  const settings = new Map<string, Setting[]>()
  for (const { key, value, reason } of startingSettings)
    settings.set(key, [
      {
        key,
        version: 1,
        value,
        changedAt: at(-120, '06:00:00'),
        changedBy: null,
        reason,
        editable: true,
      },
    ])
  for (const { key, value, reason, days } of laterVersions) {
    const versions = settings.get(key)!
    versions.unshift({
      key,
      version: versions[0]!.version + 1,
      value,
      changedAt: at(days, '10:15:00'),
      changedBy: firstAdmin,
      reason,
      editable: true,
    })
  }

  // The areas' settings, by id; an area created here gets its own.
  const areaSettings = new Map(
    roster.areas.map((area) => [
      area.id,
      {
        ...(areaExtras[area.id] ?? { reviewDays: 5, chatChannel: null, ownerTeam: null }),
        demo: area.id === 'area_sandbox',
        createdAt: at(-200, '08:00:00'),
      },
    ]),
  )

  /**
   * The archived areas (FR-814): out of the roster, so no list, picker or role names them, with
   * the roles their archiving ended, which restoring gives back.
   */
  const archived: {
    area: Area
    archivedAt: string
    team: { personId: string; role: 'owner' | 'approver' }[]
    /** Serves the terms deleting it took again; nothing for an area archived without them. */
    restore: ReturnType<MockAreaDeletion['apply']>['restore'] | null
    terms: number
  }[] = []

  /** When each role was granted: the roster carries who, this map since when. */
  const since = new Map<string, string>()
  const roleKey = (personId: string, role: string, areaId?: string) =>
    [personId, role, areaId ?? ''].join(' ')
  const sinceOf = (key: string) => since.get(key) ?? at(-180, '08:00:00')
  /** Who gave a role here; a role the fixtures start with was given when Heed was set up. */
  const givers = new Map<string, string>()

  // The history log, oldest first. Each entry's hash chains to the entry before.
  const audit: AuditEntry[] = []
  const nameOf = (personId: string | null) =>
    world.people.find((person) => person.id === personId)?.name ?? null
  function record(
    entry: Pick<AuditEntry, 'action' | 'areaId' | 'subjectType' | 'subjectId' | 'details'> &
      Partial<Pick<AuditEntry, 'batchId' | 'reason'>> & {
        actorId: string | null
        at?: string
      },
  ) {
    const previous = audit.at(-1)
    const seq = (previous?.seq ?? 0) + 1
    const when = entry.at ?? world.now()
    const content = {
      seq,
      at: when,
      actorId: entry.actorId,
      actorName: nameOf(entry.actorId),
      actorKind: entry.actorId ? ('person' as const) : ('system' as const),
      action: entry.action,
      areaId: entry.areaId,
      subjectType: entry.subjectType,
      subjectId: entry.subjectId,
      requestId: entry.actorId
        ? `0199a6c4-${seq.toString(16).padStart(4, '0')}-7000-8000-${digestOf(`request ${seq}`).slice(0, 12)}`
        : null,
      details: entry.details,
      batchId: entry.batchId ?? null,
      reason: entry.reason ?? null,
      // Every role change is a person naming another in Heed, as the service records it.
      source: /^(role|assignment)\./.test(entry.action) ? ('named' as const) : null,
    }
    audit.push({ ...content, hash: digestOf(`${previous?.hash ?? ''}${JSON.stringify(content)}`) })
  }
  // The id the history entries of one step share, counted so a replay gives the same ids.
  let batches = 0
  const nextBatchId = () => {
    batches++
    return `0199a6c5-${batches.toString(16).padStart(4, '0')}-7000-8000-${digestOf(`batch ${batches}`).slice(0, 12)}`
  }
  seedAudit()

  // People's agents (FR-403): each person's own, which an administrator sees and disconnects.
  let connections: MockConnection[] = mockConnectionSeed(world.today)
  const withoutPerson = ({ personId: _, ...connection }: MockConnection): Connection => connection
  /** Ends a connection as the service's revokeGrant does, with its history entry. */
  function endConnection(
    connection: MockConnection,
    actorId: string,
    step: { reason: string; batchId: string | null } | null,
  ) {
    connections = connections.filter((candidate) => candidate.id !== connection.id)
    record({
      actorId,
      action: 'ai_client.disconnected',
      areaId: null,
      subjectType: 'ai_connection',
      subjectId: connection.id,
      details: {
        reason: step ? 'disconnected_by_admin' : 'disconnected',
        client: connection.clientName,
        person: connection.personId,
      },
      ...(step ? { reason: step.reason, batchId: step.batchId } : {}),
    })
  }

  /** A believable month of the log: settings, roles, areas, tools, stops and imports. */
  function seedAudit() {
    const admin = firstAdmin
    const owner = roster.areas.find((area) => area.ownerIds.length)?.ownerIds[0] ?? null
    const seeds: Parameters<typeof record>[0][] = [
      {
        at: at(-30, '08:12:04'),
        actorId: admin,
        action: 'assignment.granted',
        areaId: 'area_customer_value',
        subjectType: 'person',
        subjectId: 'per_alex',
        // A grant from before the deputy role went keeps the word it was written with.
        details: { role: 'deputy' },
      },
      {
        at: at(-28, '13:40:51'),
        actorId: admin,
        action: 'tool.switched_off',
        areaId: null,
        subjectType: 'tool',
        subjectId: 'get_related',
        details: { reason: 'Off until an evaluation shows it helps (FR-332)' },
      },
      {
        at: at(-25, '09:02:33'),
        actorId: admin,
        action: 'client_policy.changed',
        areaId: null,
        subjectType: 'client',
        subjectId: 'cursor',
        details: { enabled: false, reason: 'Paused while the security review runs' },
      },
      ...laterVersions.map((change, index) => ({
        at: at(change.days, '10:15:00'),
        actorId: admin,
        action: 'setting.changed',
        areaId: null,
        subjectType: 'setting',
        subjectId: change.key,
        details: {
          from: index === 2 ? 2 : 1,
          to: index === 2 ? 3 : 2,
          value: change.value,
          reason: change.reason,
        },
      })),
      {
        at: at(-9, '16:20:10'),
        actorId: null,
        action: 'item.flagged',
        areaId: 'area_sales',
        subjectType: 'item',
        subjectId: 'itm_0000001042',
        details: { flag: 'source_changed', definition: 'cube:revenue.gross_sales' },
      },
      {
        at: at(-7, '11:05:48'),
        actorId: admin,
        action: 'stop.on',
        areaId: 'area_marketing',
        subjectType: 'area',
        subjectId: 'area_marketing',
        details: { reason: 'A campaign figure was wrong in the live edition' },
      },
      {
        at: at(-7, '15:47:02'),
        actorId: admin,
        action: 'stop.off',
        areaId: 'area_marketing',
        subjectType: 'area',
        subjectId: 'area_marketing',
        details: { reason: 'The figure is fixed in the new edition' },
      },
      {
        at: at(-5, '10:31:17'),
        actorId: owner,
        action: 'proposal.claimed',
        areaId: 'area_sales',
        subjectType: 'proposal',
        subjectId: '0199a6c4-7a00-7000-8000-000000000226',
        details: {},
      },
      {
        at: at(-3, '14:09:55'),
        actorId: admin,
        action: 'import.applied',
        areaId: null,
        subjectType: 'import_batch',
        subjectId: '0199a6c4-1b00-7000-8000-0000000000b1',
        details: {
          sourceName: 'paid-media-notes.yaml',
          create: 4,
          change: 0,
          unchanged: 0,
          errors: 0,
          submitted: true,
        },
      },
      {
        at: at(-9, '10:02:13'),
        actorId: 'per_alex',
        action: 'ai_client.connected',
        areaId: null,
        subjectType: 'ai_connection',
        subjectId: '0199a6c4-2f00-7000-8000-00000000c801',
        details: { client: 'Claude Desktop', scopes: ['read', 'feedback'] },
      },
      {
        at: at(-3, '15:21:37'),
        actorId: admin,
        action: 'ai_client.disconnected',
        areaId: null,
        subjectType: 'ai_connection',
        subjectId: '0199a6c4-2f00-7000-8000-00000000c801',
        details: { reason: 'disconnected_by_admin', client: 'Claude Desktop', person: 'per_alex' },
        reason: 'Alex handed in the laptop it ran on',
      },
      {
        at: at(-1, '09:58:40'),
        actorId: null,
        action: 'item.links_stale',
        areaId: 'area_marketing',
        subjectType: 'item',
        subjectId: 'itm_0000000317',
        details: { mentions: 2 },
      },
    ]
    seeds.sort((a, b) => (a.at! < b.at! ? -1 : 1)).forEach(record)
  }

  // Manual runs waiting in the queue, by job name.
  const queued = new Set<string>()

  /**
   * The People page's directory: everyone the fixtures name, with an address and when they last
   * signed in (days before the fixture day; null if never), and two who are gone, one of them
   * erased. The addresses are the bulk seed's, so the mock reads like the service on its data.
   */
  const lastSignIn: Record<string, number | null> = {
    per_maria: 0,
    per_jon: -2,
    per_sofia: -5,
    per_tomas: -12,
    per_noor: -45,
    per_alex: -3,
    per_priya: -1,
    per_lars: -20,
    per_ines: -64,
    per_kofi: null,
    per_ella: -8,
    per_ravi: 0,
  }
  const gone: { person: Person; status: 'left' | 'erased'; lastDays: number }[] = [
    {
      person: { id: 'per_hanna', name: 'Hanna Holm', initials: 'HH' },
      status: 'left',
      lastDays: -70,
    },
    {
      person: { id: 'per_erased1', name: 'Erased person', initials: 'EP' },
      status: 'erased',
      lastDays: -200,
    },
  ]
  const signedInAt = (days: number | null | undefined) =>
    days === null || days === undefined ? null : at(days, '08:30:00')

  /** The roles a person holds now, global ones first, then by area: as the service orders them. */
  function heldRoles(id: string): HeldRole[] {
    const global: HeldRole[] = [
      ...(roster.administrators.includes(id)
        ? [{ role: 'administrator' as const, areaId: null }]
        : []),
      ...(roster.auditors.includes(id) ? [{ role: 'auditor' as const, areaId: null }] : []),
    ]
    const area: HeldRole[] = [
      ...roster.areas.flatMap((candidate) =>
        candidate.ownerIds.includes(id) ? [{ role: 'owner' as const, areaId: candidate.id }] : [],
      ),
      ...roster.approvers
        .filter((grant) => grant.personId === id)
        .map((grant) => ({ role: 'approver' as const, areaId: grant.areaId })),
    ].sort((a, b) =>
      a.areaId < b.areaId ? -1 : a.areaId > b.areaId ? 1 : a.role < b.role ? -1 : 1,
    )
    return [...global, ...area]
  }

  function directory(): PersonRow[] {
    return [
      ...world.people.map((person) => ({
        ...person,
        email: `${person.id}@example.test`,
        status: 'active' as const,
        lastSignedInAt: signedInAt(person.id in lastSignIn ? lastSignIn[person.id] : -1),
        roles: heldRoles(person.id),
      })),
      ...gone.map(({ person, status, lastDays }) => ({
        ...person,
        email: status === 'erased' ? null : `${person.id}@example.test`,
        status,
        lastSignedInAt: signedInAt(lastDays),
        roles: [],
      })),
    ]
  }

  /** people.search's rules (auth/people.ts): status, words with their ranking, roles, sign-in. */
  function searchPeople(input: PeopleSearchInput): PeoplePage {
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    valid(
      Number.isInteger(limit) &&
        limit >= 1 &&
        limit <= 100 &&
        Number.isInteger(offset) &&
        offset >= 0,
    )
    const status = input.status ?? 'active'
    const words = input.q?.trim().toLowerCase().replace(/\s+/g, ' ') ?? ''
    const now = Date.parse(world.now())
    const daysAgo = (moment: string) => (now - Date.parse(moment)) / 86_400_000
    const rank = (row: PersonRow) => {
      const name = row.name.toLowerCase()
      if (name.startsWith(words) || row.email?.startsWith(words)) return 0
      return name.includes(` ${words}`) ? 1 : 2
    }
    const matches = directory().filter((row) => {
      if (status === 'active' && row.status !== 'active') return false
      if (status === 'left' && row.status === 'active') return false
      if (words && !`${row.name.toLowerCase()} ${row.email ?? ''}`.includes(words)) return false
      const inArea = input.areaId
        ? row.roles.filter((held) => held.areaId === input.areaId)
        : row.roles
      if (input.role === 'none') {
        if (inArea.length > 0 || (!input.areaId && row.roles.length > 0)) return false
      } else if (input.role === 'administrator' || input.role === 'auditor') {
        if (!row.roles.some((held) => held.role === input.role)) return false
        if (input.areaId && inArea.length === 0) return false
      } else if (input.role || input.areaId) {
        if (!inArea.some((held) => held.areaId && (!input.role || held.role === input.role)))
          return false
      }
      const last = row.lastSignedInAt
      if (input.signedIn === 'never' && last !== null) return false
      if (input.signedIn === 'week' && (last === null || daysAgo(last) > 7)) return false
      if (input.signedIn === 'month' && (last === null || daysAgo(last) > 30)) return false
      if (input.signedIn === 'older' && (last === null || daysAgo(last) <= 30)) return false
      return true
    })
    matches.sort(
      (a, b) =>
        (words ? rank(a) - rank(b) : 0) ||
        a.name.localeCompare(b.name, 'en') ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    const people = matches.slice(offset, offset + limit)
    return {
      people: structuredClone(people),
      total: matches.length,
      next: offset + people.length < matches.length ? offset + people.length : null,
      readAt: world.now(),
    }
  }

  /** people.sheet: the person, the roles they hold with since and giver, and their role changes. */
  function personSheet(id: string): PersonSheet {
    const row = directory().find((candidate) => candidate.id === id)
    if (!row) refuse('not-found', "We couldn't find this person.")
    const grants = row.roles.map((held) => {
      const key = roleKey(id, held.role, held.areaId ?? undefined)
      return { ...held, since: sinceOf(key), grantedBy: givers.get(key) ?? null }
    })
    const history: RoleChange[] = audit
      .filter(
        (entry) =>
          entry.subjectType === 'person' &&
          entry.subjectId === id &&
          /^(role|assignment)\.(granted|revoked)$/.test(entry.action),
      )
      .reverse()
      .slice(0, 200)
      .map((entry) => ({
        seq: entry.seq,
        at: entry.at,
        change: entry.action.endsWith('.granted') ? 'granted' : 'revoked',
        role: String(entry.details.role),
        areaId: entry.areaId,
        actorId: entry.actorId,
        actorName: entry.actorName,
        reason: entry.reason,
      }))
    return {
      person: structuredClone({ ...row, createdAt: at(-200, '08:00:00') }),
      grants,
      history,
      readAt: world.now(),
    }
  }

  // Sources administrators added, by id. The mock keeps which secrets are set, never a secret.
  const addedSources = new Map<string, SourceSettings>()

  /**
   * The service's checks of a source's settings (workspace.ts): a connector written to
   * interface 3 by its manifest's rules and its runtime's own (the static list's entries), the
   * Cube type by its own rules (connectors/cube.ts), in words by field. Domain names must name
   * domains in Heed.
   */
  function sourceProblems(
    listing: ConnectorListing,
    input: { name: string; config: SourceConfig; secrets: Record<string, string>; reason?: string },
  ): Finding[] {
    const problems: Finding[] = []
    const problem = (field: string, message: string) =>
      problems.push({ code: 'invalid_setting', field, message, severity: 'error' })
    const { manifest } = listing
    for (const key of Object.keys(input.secrets))
      if (!manifest.secrets.some((secret) => secret.key === key))
        problem(key, 'This source has no such secret.')
    const pasted = JSON.stringify([input.name, input.config, input.reason ?? ''])
    for (const [key, value] of Object.entries(input.secrets))
      if (value.length >= 8 && pasted.includes(value))
        problem(key, 'The secret is in another field too. Keep it in its own field only.')
    if (listing.writtenTo === 2) return [...cubeProblems(input.config), ...problems]
    const parsed = parseConnectorConfig(manifest, input.config)
    if ('problems' in parsed)
      for (const found of parsed.problems) problem(found.field, found.message)
    else if (manifest.id === 'static-definitions') {
      const { definitions } = parsed.config
      const entries = parseStaticEntries(typeof definitions === 'string' ? definitions : '')
      if ('problem' in entries) problem('definitions', entries.problem)
    }
    const mapField = manifest.config.fields.find((field) => field.kind === 'domain_map')?.key
    for (const id of connectorConfigDomains(manifest, input.config))
      if (mapField && /^[a-z][a-z0-9_]{1,39}$/.test(id) && !roster.areas.some((a) => a.id === id))
        problem(mapField, unknownDomain(id))
    return problems
  }

  /** The service's words for a domain the settings name that Heed does not have. */
  const unknownDomain = (id: string) => `${id} isn't a domain in ${productName}.`

  /** The Cube type's own checks (connectors/cube.ts), in words by field. */
  function cubeProblems(config: SourceConfig): Finding[] {
    const problems: Finding[] = []
    const problem = (field: string, message: string) =>
      problems.push({ code: 'invalid_setting', field, message, severity: 'error' })
    const text = (key: string) => {
      const value = config[key]
      return typeof value === 'string' ? value.trim() : ''
    }
    const known = mockConnectorListings.find((listing) => listing.manifest.id === 'cube')!.manifest
    for (const key of Object.keys(config))
      if (!known.config.fields.some((field) => field.key === key))
        problem(key, 'This source has no such setting.')
    const fetchable = (address: string, plainHttp: boolean) => {
      const url = URL.parse(address)
      return (
        url !== null &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        (url.protocol === 'https:' ||
          (plainHttp &&
            url.protocol === 'http:' &&
            ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      )
    }
    const repository = text('repository')
    if (!repository) problem('repository', 'Give the repository’s address.')
    else if (!fetchable(repository, true))
      problem(
        'repository',
        'Use an https address on a public host, without a user name, password, query or fragment. The token goes in its own field.',
      )
    const ref = text('ref')
    if (!ref) problem('ref', 'Name a branch, a tag or a commit.')
    else if (!/^[A-Za-z0-9._/-]{1,200}$/.test(ref) || /^[-/]|\/$|\.lock$|\.\.|\/\//.test(ref))
      problem(
        'ref',
        'Use letters, digits, dots, dashes, underscores and slashes, as Git names a branch.',
      )
    const folder = text('folder').replace(/^\/+|\/+$/g, '')
    if (
      folder &&
      !folder
        .split('/')
        .every(
          (part) => /^[A-Za-z0-9._ -]{1,100}$/.test(part) && !['.', '..', '.git'].includes(part),
        )
    )
      problem('folder', 'Name a folder inside the repository, such as model or cube/model.')
    const username = text('username')
    if (username && !/^[A-Za-z0-9._@+-]{1,100}$/.test(username))
      problem('username', 'Use letters, digits and . _ @ + - only.')
    const modelUrl = text('modelUrl')
    if (modelUrl && !fetchable(modelUrl, false))
      problem('modelUrl', 'Use an https address without a user name, password, query or fragment.')
    const names = config.domainNames
    if (typeof names !== 'object' || Array.isArray(names)) {
      if (names !== undefined) problem('domainNames', 'Write a list of names.')
    } else
      for (const [from, to] of Object.entries(names)) {
        if (!from.trim()) problem('domainNames', 'Each line needs the model’s name.')
        else if (!/^[a-z][a-z0-9_]{1,39}$/.test(to))
          problem('domainNames', `Choose the ${productName} domain for ${from.trim()}.`)
        else if (!roster.areas.some((area) => area.id === to))
          problem('domainNames', unknownDomain(to))
      }
    return problems
  }

  /**
   * The settings as the service stores them: by the manifest's rules for a connector written to
   * interface 3; trimmed, with empty ones left out, for the Cube type.
   */
  function storedConfig(listing: ConnectorListing, config: SourceConfig): SourceConfig {
    if (listing.writtenTo === 3) {
      const parsed = parseConnectorConfig(listing.manifest, config)
      return 'config' in parsed ? parsed.config : {}
    }
    const stored: SourceConfig = {}
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string') {
        const trimmed =
          key === 'folder'
            ? value.trim().replace(/^\/+|\/+$/g, '')
            : // The repository is kept in the form git is given (the WHATWG form).
              key === 'repository' && URL.canParse(value.trim())
              ? new URL(value.trim()).href
              : value.trim()
        if (trimmed) stored[key] = trimmed
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        const names = Object.fromEntries(
          Object.entries(value).map(([from, to]) => [from.trim(), to] as const),
        )
        if (Object.keys(names).length) stored[key] = names
      }
    }
    return stored
  }

  const sourceType = (type: string) =>
    mockConnectorListings.find((candidate) => candidate.manifest.id === type) ??
    refuse('invalid', "We can't add a source of this type.", [
      {
        code: 'invalid_setting',
        field: 'type',
        message: "We can't add a source of this type.",
        severity: 'error',
      },
    ])

  /**
   * A test of a static list, as the service runs it: the runtime's check (from the connector's
   * own pure code), then what a read would hold. Its version is a digest of what was read.
   */
  function staticCheck(config: SourceConfig): SourceCheck {
    const parsed = parseStaticEntries(
      typeof config.definitions === 'string' ? config.definitions : '',
    )
    if ('problem' in parsed) throw new Error('A static list is checked before it is tested')
    const names =
      typeof config.domainNames === 'object' && !Array.isArray(config.domainNames)
        ? config.domainNames
        : {}
    const views = new Set(
      parsed.entries.flatMap((entry) => {
        const dot = entry.name.lastIndexOf('.')
        return dot > 0 ? [entry.name.slice(0, dot)] : []
      }),
    )
    return {
      ok: true,
      ...staticCheckReport(parsed.entries, names),
      version: digestOf(JSON.stringify(config)),
      complete: true,
      views: views.size,
      metrics: parsed.entries.filter((entry) => entry.kind === 'metric').length,
      dimensions: parsed.entries.filter((entry) => entry.kind === 'dimension').length,
      // What the read warns about, in the runtime's order: a domain that is not a domain id.
      warnings: parsed.entries.flatMap((entry) => {
        const domain = staticDomainOf(entry, names)
        return domain !== null && !/^[a-z][a-z0-9_]{1,39}$/.test(domain)
          ? [{ code: 'invalid_domain', target: entry.name }]
          : []
      }),
    }
  }

  /** An added source as the operations view lists it: waiting for its first read. */
  function addedOverview(source: SourceSettings): OperationsOverviewView['connectors'][number] {
    return {
      id: source.id,
      name: source.name,
      type: source.type,
      kind: 'definition_source',
      origin: 'workspace',
      tool:
        mockConnectorListings.find((listing) => listing.manifest.id === source.type)?.manifest
          .tool ?? source.type,
      settingKeys: [],
      server: null,
      status: 'waiting',
      staleAfterSeconds: 6 * 3_600,
      lastSuccessAt: null,
      ageSeconds: null,
      sourceVersion: null,
      lastErrorAt: null,
      lastError: null,
      lastRead: null,
      definitions: { current: 0, missing: 0 },
      domainCoverage: { cube: 0, override: 0, none: 0 },
      flaggedItems: 0,
      staleLinks: 0,
      views: [],
      renames: [],
      recentReads: [],
    }
  }

  /** Acting as one person: administrators change settings; auditors read the history log. */
  function as(personId: string) {
    const isAdmin = () => roster.administrators.includes(personId)
    const isAuditor = () => roster.auditors.includes(personId)
    const adminOnly = () => {
      if (!isAdmin()) refuse('forbidden', refusals.forbidden)
    }
    const auditOnly = () => {
      if (!isAdmin() && !isAuditor()) refuse('forbidden', refusals.forbidden)
    }
    const person = (id: string, grant: boolean) => {
      if (grant && !world.people.some((candidate) => candidate.id === id))
        refuse('not-found', "We couldn't find this person, or they're no longer active.")
    }
    const area = (id: string) =>
      roster.areas.find((candidate) => candidate.id === id) ??
      refuse('not-found', "We couldn't find this domain. Someone may have deleted it.")

    function detail(id: string): AreaDetail {
      const found = area(id)
      const extra = areaSettings.get(id)!
      return {
        id: found.id,
        name: found.name,
        label: found.label,
        reviewDays: extra.reviewDays,
        chatChannel: extra.chatChannel,
        ownerTeam: extra.ownerTeam,
        demo: extra.demo,
        summary: found.summary,
        description: found.description,
        ownerIds: [...found.ownerIds],
        approverIds: roster.approvers
          .filter((grant) => grant.areaId === id)
          .map((grant) => grant.personId)
          .sort(),
        createdAt: extra.createdAt,
        revision: found.revision,
      }
    }

    const nameTaken = (name: string, id: string) =>
      [...roster.areas, ...archived.map((entry) => entry.area)].some(
        (candidate) => candidate.id !== id && candidate.name.toLowerCase() === name.toLowerCase(),
      )
    /** An archived area holds its id and name until it is restored: names are unique. */
    const archivedNamed = (id: string, name: string) =>
      archived.some(
        ({ area: held }) => held.id === id || held.name.toLowerCase() === name.toLowerCase(),
      )

    type AreaFields = Pick<
      AreaDetail,
      'name' | 'label' | 'reviewDays' | 'chatChannel' | 'ownerTeam' | 'summary' | 'description'
    >
    /** Stores what differs as one more revision and records it, as the service does. */
    function changeArea(id: string, after: AreaFields, reason: string | null): AreaDetail {
      const found = area(id)
      const extra = areaSettings.get(id)!
      const current = detail(id)
      const before: AreaFields = {
        name: current.name,
        label: current.label,
        reviewDays: current.reviewDays,
        chatChannel: current.chatChannel,
        ownerTeam: current.ownerTeam,
        summary: current.summary,
        description: current.description,
      }
      const changed = (Object.keys(after) as (keyof AreaFields)[]).filter(
        (key) => after[key] !== before[key],
      )
      if (!changed.length) return current
      Object.assign(found, {
        name: after.name,
        label: after.label,
        summary: after.summary,
        description: after.description,
        revision: found.revision + 1,
      })
      Object.assign(extra, {
        reviewDays: after.reviewDays,
        chatChannel: after.chatChannel,
        ownerTeam: after.ownerTeam,
      })
      record({
        actorId: personId,
        action: 'area.changed',
        areaId: id,
        subjectType: 'area',
        subjectId: id,
        details: {
          from: Object.fromEntries(changed.map((key) => [key, before[key]])),
          to: Object.fromEntries(changed.map((key) => [key, after[key]])),
          ...(reason === null ? {} : { reason }),
        },
      })
      return detail(id)
    }

    function checkAreaFields(input: CreateAreaInput | UpdateAreaInput) {
      const line = (text: string | null, max: number) =>
        text === null ||
        (text.length >= 1 &&
          text.length <= max &&
          text.trim() === text &&
          // eslint-disable-next-line no-control-regex
          !/[\u0000-\u001f\u007f]/.test(text))
      valid(
        /^[a-z][a-z0-9_]{1,39}$/.test(input.id) &&
          (domainHues as readonly string[]).includes(input.label) &&
          line(input.name, 60) &&
          line(input.chatChannel, 100) &&
          line(input.ownerTeam, 100) &&
          described(input) &&
          Number.isInteger(input.reviewDays) &&
          input.reviewDays >= 1 &&
          input.reviewDays <= 30,
      )
      // A new area needs no reason: creating it says what happened.
      if (input.reason !== undefined) plainReason(input.reason)
      plainAbout(input)
    }

    /** A summary and a description as the service takes them; left out on create, empty. */
    function described(input: { summary?: string; description?: string }) {
      return (
        areaSummarySchema.safeParse(input.summary ?? '').success &&
        areaDescriptionSchema.safeParse(input.description ?? '').success
      )
    }

    /** One change, in a batch the caller restores when any change of it is refused. */
    function changeOne(
      input: RoleInput | AssignmentInput,
      grant: boolean,
      entry: { batchId: string; reason: string | null },
    ) {
      person(input.personId, grant)
      const assignment = 'areaId' in input
      if (assignment) area(input.areaId)
      const key = roleKey(input.personId, input.role, assignment ? input.areaId : undefined)
      const holds = assignment
        ? input.role === 'approver'
          ? roster.approvers.some((g) => g.areaId === input.areaId && g.personId === input.personId)
          : area(input.areaId).ownerIds.includes(input.personId)
        : (input.role === 'administrator' ? roster.administrators : roster.auditors).includes(
            input.personId,
          )
      if (grant === holds) return false
      if (assignment) {
        const found = area(input.areaId)
        if (input.role === 'approver') {
          if (grant) roster.approvers.push({ areaId: input.areaId, personId: input.personId })
          else
            roster.approvers.splice(
              roster.approvers.findIndex(
                (g) => g.areaId === input.areaId && g.personId === input.personId,
              ),
              1,
            )
        } else if (grant) found.ownerIds = [...found.ownerIds, input.personId]
        else found.ownerIds = found.ownerIds.filter((id) => id !== input.personId)
      } else {
        const list = input.role === 'administrator' ? roster.administrators : roster.auditors
        if (grant) list.push(input.personId)
        else list.splice(list.indexOf(input.personId), 1)
      }
      if (grant) {
        since.set(key, world.now())
        givers.set(key, personId)
      } else {
        since.delete(key)
        givers.delete(key)
      }
      record({
        actorId: personId,
        action: `${assignment ? 'assignment' : 'role'}.${grant ? 'granted' : 'revoked'}`,
        areaId: assignment ? input.areaId : null,
        subjectType: 'person',
        subjectId: input.personId,
        details: { role: input.role },
        batchId: entry.batchId,
        reason: entry.reason,
      })
      return true
    }

    /**
     * The service's grants.apply (auth/roles.ts): all or none, removals first so an owner is
     * replaced at once, the actor's own administrator role last, an administrator kept, and a
     * domain that has owners keeps one (unless the domain itself goes: `keepOwners`).
     */
    function applyGrants(input: ApplyGrantsInput, keepOwners = true): GrantsApplied {
      adminOnly()
      valid(input.changes.length >= 1 && input.changes.length <= GRANT_BATCH_MAX)
      const reason = input.reason ?? null
      if (reason !== null) plainReason(reason)
      const keys = input.changes.map((change) =>
        roleKey(change.personId, change.role, 'areaId' in change ? change.areaId : undefined),
      )
      if (new Set(keys).size !== keys.length)
        refuse('bad-request', 'The same role is in this change twice. Remove one, then try again.')
      const own = (change: GrantChange) =>
        change.op === 'revoke' &&
        !('areaId' in change) &&
        change.role === 'administrator' &&
        change.personId === personId
      const order = [
        ...input.changes.filter((change) => change.op === 'revoke' && !own(change)),
        ...input.changes.filter((change) => change.op === 'grant'),
        ...input.changes.filter(own),
      ]
      // Everything a change may touch, put back as it was when one is refused.
      const saved = {
        owners: roster.areas.map((found) => [...found.ownerIds]),
        approvers: [...roster.approvers],
        administrators: [...roster.administrators],
        auditors: [...roster.auditors],
        since: new Map(since),
        audit: audit.length,
        batches,
      }
      const batchId = nextBatchId()
      const changed = new Map<GrantChange, boolean>()
      try {
        for (const change of order) {
          const { op, ...grant } = change
          changed.set(change, changeOne(grant, op === 'grant', { batchId, reason }))
        }
        if (roster.administrators.length === 0)
          refuse('conflict', 'This would leave no active admin. Make someone else an admin first.')
        const left = roster.areas.find(
          (found) =>
            order.some(
              (change) =>
                change.op === 'revoke' &&
                'areaId' in change &&
                change.role === 'owner' &&
                change.areaId === found.id &&
                changed.get(change),
            ) && found.ownerIds.length === 0,
        )
        if (left && keepOwners) refuse('conflict', lastOwnerMessage(left.name))
      } catch (error) {
        roster.areas.forEach((found, n) => {
          found.ownerIds = saved.owners[n] ?? []
        })
        roster.approvers.splice(0, Infinity, ...saved.approvers)
        roster.administrators.splice(0, Infinity, ...saved.administrators)
        roster.auditors.splice(0, Infinity, ...saved.auditors)
        since.clear()
        for (const [key, value] of saved.since) since.set(key, value)
        audit.length = saved.audit
        batches = saved.batches
        throw error
      }
      return {
        batchId,
        changes: input.changes.map((change) => ({ ...change, changed: changed.get(change)! })),
      }
    }

    function filtered(params: AuditSearchParams | AuditExportParams) {
      valid(
        (params.from === undefined || /^\d{4}-\d{2}-\d{2}$/.test(params.from)) &&
          (params.to === undefined || /^\d{4}-\d{2}-\d{2}$/.test(params.to)) &&
          (params.action === undefined || /^[a-z_]+(\.[a-z_]+)?$/.test(params.action)),
      )
      return audit.filter(
        (entry) =>
          (params.action === undefined ||
            entry.action === params.action ||
            entry.action.startsWith(`${params.action}.`)) &&
          (params.actorId === undefined || entry.actorId === params.actorId) &&
          (params.areaId === undefined || entry.areaId === params.areaId) &&
          (params.subjectType === undefined || entry.subjectType === params.subjectType) &&
          (params.subjectId === undefined || entry.subjectId === params.subjectId) &&
          (params.requestId === undefined || entry.requestId === params.requestId) &&
          (params.batchId === undefined || entry.batchId === params.batchId) &&
          (params.from === undefined || entry.at.slice(0, 10) >= params.from) &&
          (params.to === undefined || entry.at.slice(0, 10) <= params.to),
      )
    }

    function chain(): AuditChain {
      // The `audit-broken` scenario shows what an administrator sees when an entry was altered.
      if (world.scenario() === 'audit-broken')
        return { verified: false, firstBadSeq: audit[Math.floor(audit.length / 2)]?.seq ?? 1 }
      return { verified: true, firstBadSeq: null }
    }

    return {
      listSettings(): Setting[] {
        adminOnly()
        return [...settings.values()].map((versions) => structuredClone(versions[0]!))
      },

      getSettingHistory(key: string): Setting[] {
        adminOnly()
        valid(/^[a-z_]+(\.[a-z_]+)*$/.test(key) && key.length <= 100)
        const versions = settings.get(key) ?? refuse('not-found', "We couldn't find this setting.")
        return structuredClone(versions)
      },

      setSetting(input: SetSettingInput): Setting {
        adminOnly()
        valid(/^[a-z_]+(\.[a-z_]+)*$/.test(input.key) && Number.isInteger(input.version))
        plainReason(input.reason)
        if (!Object.hasOwn(settingSchemas, input.key))
          refuse(
            'invalid',
            "You can't change this setting here. The data team sets it where the app runs.",
          )
        const parsed = settingSchemas[input.key as SettingKey].safeParse(input.value)
        if (!parsed.success)
          refuse(
            'invalid',
            parsed.error.issues
              .map((i) => [i.path.join('.'), i.message].filter(Boolean).join(': '))
              .join('; '),
          )
        if (input.key === 'limits.mcp_rate_per_minute') {
          const unknown = Object.keys(parsed.data as Record<string, number>).filter(
            (tool) => !world.tools().includes(tool),
          )
          if (unknown.length) refuse('invalid', unknownToolsMessage(unknown))
        }
        const versions =
          settings.get(input.key) ?? refuse('not-found', "We couldn't find this setting.")
        const current = versions[0]!
        if (current.version !== input.version)
          refuse(
            'conflict',
            'Someone changed this setting after you opened it. Look at the latest value, then try again.',
          )
        const saved: Setting = {
          key: input.key,
          version: current.version + 1,
          value: structuredClone(parsed.data),
          changedAt: world.now(),
          changedBy: personId,
          reason: input.reason,
          editable: true,
        }
        versions.unshift(saved)
        record({
          actorId: personId,
          action: 'setting.changed',
          areaId: null,
          subjectType: 'setting',
          subjectId: input.key,
          details: {
            from: current.version,
            to: saved.version,
            value: saved.value,
            reason: input.reason,
          },
        })
        return structuredClone(saved)
      },

      searchPeople(input: PeopleSearchInput): PeoplePage {
        auditOnly()
        return searchPeople(input)
      },

      getPersonSheet(id: string): PersonSheet {
        adminOnly()
        return personSheet(id)
      },

      listGrants(): Grants {
        adminOnly()
        const byPerson = (a: { personId: string }, b: { personId: string }) =>
          a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0
        const roles = [
          ...roster.administrators.map((id) => ({ personId: id, role: 'administrator' as const })),
          ...roster.auditors.map((id) => ({ personId: id, role: 'auditor' as const })),
        ]
          .sort((a, b) => byPerson(a, b) || (a.role < b.role ? -1 : 1))
          .map((grant) => ({ ...grant, since: sinceOf(roleKey(grant.personId, grant.role)) }))
        const order = { owner: 0, approver: 1 }
        const assignments = [
          ...roster.areas.flatMap((candidate) =>
            candidate.ownerIds.map((id) => ({
              areaId: candidate.id,
              personId: id,
              role: 'owner' as const,
            })),
          ),
          ...roster.approvers.map((grant) => ({ ...grant, role: 'approver' as const })),
        ]
          .sort(
            (a, b) =>
              (a.areaId < b.areaId ? -1 : a.areaId > b.areaId ? 1 : 0) ||
              byPerson(a, b) ||
              order[a.role] - order[b.role],
          )
          .map((grant) => ({
            ...grant,
            since: sinceOf(roleKey(grant.personId, grant.role, grant.areaId)),
          }))
        return { roles, assignments }
      },

      applyGrants: (input: ApplyGrantsInput) => applyGrants(input),

      getArea(id: string): AreaDetail {
        adminOnly()
        return detail(id)
      },

      createArea(input: CreateAreaInput): AreaDetail {
        adminOnly()
        checkAreaFields(input)
        if (archivedNamed(input.id, input.name))
          refuse(
            'conflict',
            'A deleted domain has this id or name. Restore it from Deleted domains, or choose another.',
          )
        if (roster.areas.some((candidate) => candidate.id === input.id))
          refuse('conflict', 'Another domain already has this id. Choose another.')
        if (nameTaken(input.name, input.id))
          refuse('conflict', 'Another domain already has this name. Choose another.')
        // The team is checked before the area exists, so a refused one creates nothing.
        const { ownerIds = [], approverIds = [] } = input.team ?? {}
        const team: GrantChange[] = [
          ...ownerIds.map((id) => ({
            op: 'grant' as const,
            personId: id,
            role: 'owner' as const,
          })),
          ...approverIds.map((id) => ({
            op: 'grant' as const,
            personId: id,
            role: 'approver' as const,
          })),
        ].map((change) => ({ ...change, areaId: input.id }))
        valid(approverIds.length <= AREA_APPROVERS_MAX && ownerIds.length <= AREA_OWNERS_MAX)
        if (
          new Set(approverIds).size !== approverIds.length ||
          new Set(ownerIds).size !== ownerIds.length
        )
          refuse(
            'bad-request',
            'The same role is in this change twice. Remove one, then try again.',
          )
        for (const change of team) person(change.personId, true)
        roster.areas.push({
          id: input.id,
          name: input.name,
          label: input.label,
          summary: input.summary ?? '',
          description: input.description ?? '',
          ownerIds: [],
          revision: 1,
        })
        areaSettings.set(input.id, {
          reviewDays: input.reviewDays,
          chatChannel: input.chatChannel,
          ownerTeam: input.ownerTeam,
          demo: false,
          createdAt: world.now(),
        })
        const { reason, id: _id, team: _team, ...fields } = input
        record({
          actorId: personId,
          action: 'area.created',
          areaId: input.id,
          subjectType: 'area',
          subjectId: input.id,
          details: { ...fields, ...(reason === undefined ? {} : { reason }) },
        })
        if (team.length) applyGrants({ changes: team, ...(reason === undefined ? {} : { reason }) })
        return detail(input.id)
      },

      /** What deleting an area would do (FR-814), as the service reads it (areas/deletion.ts). */
      getAreaRemoval(id: string): AreaRemoval {
        adminOnly()
        const current = detail(id)
        const plan = world.deletion?.plan(id) ?? heldNothing
        const first = <T>(list: readonly T[]) => list.slice(0, AREA_DELETION_LIST_MAX)
        return {
          id,
          name: current.name,
          revision: current.revision,
          demo: current.demo,
          outcome: areaRemovalOutcome(plan.holdings, current.demo),
          holdings: plan.holdings,
          items: first(plan.items),
          terms: first(plan.terms),
          openProposals: first(plan.openProposals),
          drafts: first(plan.drafts),
          team: first(plan.team),
        }
      },

      /** Deletes an area and everything under it, as the service does (areas/deletion.ts). */
      removeArea(input: RemoveAreaInput): AreaRemoved {
        adminOnly()
        valid(removeAreaSchema.safeParse(input).success)
        if (input.reason !== undefined) plainReason(input.reason)
        const before = detail(input.id)
        if (before.revision !== input.revision)
          refuse(
            'conflict',
            'Someone changed this domain after you opened it. Look at the latest version, then try again.',
          )
        if (!confirmsDeletion(input.confirm))
          refuse('bad-request', `Type ${DELETE_DOMAIN_PHRASE} to confirm.`)
        const plan = world.deletion?.plan(input.id) ?? heldNothing
        const { holdings } = plan
        const outcome = areaRemovalOutcome(holdings, before.demo)
        if (outcome === 'blocked') refuse('conflict', "The demo domain can't be deleted.")
        const reason = input.reason === undefined ? {} : { reason: input.reason }
        const team = { ownerIds: before.ownerIds, approverIds: before.approverIds }
        const held = plan.team.map(({ personId: id, role }) => ({ personId: id, role }))
        if (outcome === 'delete') {
          const at = roster.areas.findIndex((candidate) => candidate.id === input.id)
          roster.areas.splice(at, 1)
          roster.approvers.splice(
            0,
            Infinity,
            ...roster.approvers.filter((grant) => grant.areaId !== input.id),
          )
          areaSettings.delete(input.id)
          record({
            actorId: personId,
            action: 'area.deleted',
            areaId: input.id,
            subjectType: 'area',
            subjectId: input.id,
            details: { name: before.name, kept: false, team, ...reason },
          })
          return {
            outcome: 'deleted',
            area: before,
            edition: null,
            holdings,
          }
        }
        const done = world.deletion?.apply(input.id, before.name, personId, plan, input.reason)
        // The domain goes, so its whole team ends with it.
        if (held.length)
          applyGrants(
            {
              changes: held.map((role) => ({ ...role, op: 'revoke' as const, areaId: input.id })),
              ...reason,
            },
            false,
          )
        const at = roster.areas.findIndex((candidate) => candidate.id === input.id)
        const [gone] = roster.areas.splice(at, 1)
        const archivedAt = world.now()
        archived.unshift({
          area: { ...gone!, revision: gone!.revision + 1 },
          archivedAt,
          team: held,
          restore: done?.restore ?? null,
          terms: done?.terms ?? 0,
        })
        record({
          actorId: personId,
          action: 'area.deleted',
          areaId: input.id,
          subjectType: 'area',
          subjectId: input.id,
          details: {
            name: before.name,
            kept: true,
            edition: done?.edition?.label ?? null,
            holdings,
            team,
            items: plan.items.map(({ id, title }) => ({ id, title })),
            terms: plan.terms.map(({ key, name, fate }) => ({ key, name, fate })),
            openProposals: plan.openProposals.map(({ id, number, title }) => ({
              id,
              number,
              title,
            })),
            drafts: plan.drafts.map(({ id, title }) => ({ id, title })),
            roles: plan.team,
            ...reason,
          },
        })
        return {
          outcome: 'archived',
          area: before,
          edition: done?.edition ?? null,
          holdings,
        }
      },

      listArchivedAreas(): ArchivedArea[] {
        adminOnly()
        return archived.map(({ area: held, archivedAt, team, terms }) => ({
          id: held.id,
          name: held.name,
          label: held.label,
          summary: held.summary,
          archivedAt,
          team: team.length,
          terms,
          binnedItems: world.deletion?.binned(held.id).length ?? 0,
        }))
      },

      /**
       * Restores a deleted area, with the roles its deletion ended, for active
       * people, and the terms it took; its items wait in the Bin.
       */
      restoreArea(input: RestoreAreaInput): AreaRestored {
        adminOnly()
        valid(restoreAreaSchema.safeParse(input).success)
        if (input.reason !== undefined) plainReason(input.reason)
        const at = archived.findIndex((entry) => entry.area.id === input.id)
        if (at < 0)
          refuse(
            'not-found',
            "We couldn't find this deleted domain. Someone may have restored it already.",
          )
        const entry = archived[at]!
        archived.splice(at, 1)
        roster.areas.push({ ...entry.area, revision: entry.area.revision + 1 })
        roster.areas.sort((a, b) => a.name.localeCompare(b.name))
        const team = entry.team.filter((role) =>
          world.people.some((candidate) => candidate.id === role.personId),
        )
        const served = entry.restore?.(personId, input.reason) ?? { edition: null, terms: 0 }
        record({
          actorId: personId,
          action: 'area.restored',
          areaId: input.id,
          subjectType: 'area',
          subjectId: input.id,
          details: {
            team: team.length,
            terms: served.terms,
            edition: served.edition?.label ?? null,
            ...(input.reason === undefined ? {} : { reason: input.reason }),
          },
        })
        if (team.length)
          applyGrants({
            changes: team.map((role) => ({ ...role, op: 'grant' as const, areaId: input.id })),
            ...(input.reason === undefined ? {} : { reason: input.reason }),
          })
        return {
          area: detail(input.id),
          edition: served.edition,
          terms: served.terms,
          team: team.length,
          binnedItems: world.deletion?.binned(input.id) ?? [],
        }
      },

      updateArea(input: UpdateAreaInput): AreaDetail {
        adminOnly()
        checkAreaFields(input)
        if (area(input.id).revision !== input.revision)
          refuse(
            'conflict',
            'Someone changed this domain after you opened it. Look at the latest version, then try again.',
          )
        if (nameTaken(input.name, input.id))
          refuse('conflict', 'Another domain already has this name. Choose another.')
        const { id: _id, revision: _revision, reason, ...after } = input
        return changeArea(input.id, after, reason)
      },

      /** What a domain is (FR-813): its owners or an administrator writes it. */
      describeArea(input: DescribeAreaInput): AreaDetail {
        const found = area(input.id)
        if (!isAdmin() && !found.ownerIds.includes(personId))
          refuse('forbidden', "Only the domain's owners and admins can describe it.")
        valid(described(input))
        plainAbout(input)
        if (found.revision !== input.revision)
          refuse(
            'conflict',
            'Someone changed this domain after you opened it. Look at the latest version, then try again.',
          )
        const current = detail(input.id)
        return changeArea(
          input.id,
          {
            name: current.name,
            label: current.label,
            reviewDays: current.reviewDays,
            chatChannel: current.chatChannel,
            ownerTeam: current.ownerTeam,
            summary: input.summary,
            description: input.description,
          },
          null,
        )
      },

      getOperations(): OperationsOverviewView {
        adminOnly()
        const stopped = world.scenario() === 'runner-stopped'
        const now = world.now()
        const ago = (seconds: number) => new Date(Date.parse(now) - seconds * 1000).toISOString()
        const jobs = scheduledJobs.map((job, index) => {
          // gaps.detect failed on its last run, so the screen shows a job that fails.
          const failing = job.name === 'gaps.detect'
          const last = Math.min(job.everySeconds / 2, 90 + index * 37)
          return {
            name: job.name,
            cron: job.cron,
            status: failing ? ('failing' as const) : ('ok' as const),
            expectedEverySeconds: job.everySeconds,
            registeredAt: at(-30, '06:00:00'),
            lastStartedAt: ago(failing ? 240 : last),
            lastSucceededAt: ago(failing ? 1_140 : last - 2),
            lastErrorAt: failing ? ago(238) : null,
            lastError: failing
              ? 'canceling statement due to statement timeout (gap topic counts)'
              : null,
            runsOk: 40 + index * 13,
            runsFailed: failing ? 2 : 0,
            queue: stopped
              ? null
              : {
                  queued: queued.has(job.name) ? 1 : 0,
                  active: 0,
                  deferred: 0,
                  failed: failing ? 2 : 0,
                },
          }
        })
        return {
          checkedAt: now,
          runner: stopped ? 'stopped' : 'running',
          jobs,
          connectors: [
            ...mockSources({ ago, scenario: world.scenario() }),
            ...[...addedSources.values()].map(addedOverview),
          ],
          spend: {
            month: world.today.slice(0, 7),
            monthCostMicros: 61_420_000,
            monthCapMicros: 500_000_000,
            todayCostMicros: 2_310_000,
            byFeature: [
              { feature: 'assistant', calls: 412, costMicros: 38_910_000 },
              { feature: 'eval', calls: 1_260, costMicros: 22_510_000 },
            ],
          },
        }
      },

      listSourceTypes(): ConnectorListing[] {
        adminOnly()
        return structuredClone(mockConnectorListings)
      },

      getSourceSettings(id: string): SourceSettings {
        adminOnly()
        const found =
          addedSources.get(id) ??
          refuse('not-found', "We couldn't find this source among the ones an admin added.")
        return structuredClone(found)
      },

      addSource(input: AddSourceInput): SourceSettings {
        adminOnly()
        valid(input.name.trim().length >= 1 && input.name.trim().length <= 80)
        const type = sourceType(input.type)
        plainReason(input.reason)
        const problems = sourceProblems(type, input)
        if (problems.length) refuse('invalid', problems[0]!.message, problems)
        const id = sourceIdFrom(input.name, new Set([...reservedSourceIds, ...addedSources.keys()]))
        const config = storedConfig(type, input.config)
        const saved: SourceSettings = {
          id,
          type: type.manifest.id,
          name: input.name.trim(),
          revision: 1,
          config,
          secrets: type.manifest.secrets.map((secret) => ({
            key: secret.key,
            set: Boolean(input.secrets[secret.key]),
          })),
          changedAt: world.now(),
          changedBy: personId,
        }
        addedSources.set(id, saved)
        record({
          actorId: personId,
          action: 'source.added',
          areaId: null,
          subjectType: 'source',
          subjectId: id,
          details: {
            type: type.manifest.id,
            version: type.manifest.version,
            name: saved.name,
            config,
            secrets: Object.fromEntries(Object.keys(input.secrets).map((key) => [key, 'set'])),
            reason: input.reason,
          },
        })
        return structuredClone(saved)
      },

      updateSource(input: UpdateSourceInput): SourceSettings {
        adminOnly()
        valid(input.name.trim().length >= 1 && input.name.trim().length <= 80)
        const found =
          addedSources.get(input.id) ??
          refuse('not-found', "We couldn't find this source among the ones an admin added.")
        const type = sourceType(found.type)
        plainReason(input.reason)
        const problems = sourceProblems(type, input)
        if (problems.length) refuse('invalid', problems[0]!.message, problems)
        if (found.revision !== input.revision)
          refuse(
            'conflict',
            'Someone changed this source after you opened it. Look at the latest version, then try again.',
          )
        const config = storedConfig(type, input.config)
        const rebound = secretsBoundTo(type.manifest).some(
          (key) =>
            JSON.stringify(config[key] ?? null) !== JSON.stringify(found.config[key] ?? null),
        )
        const saved: SourceSettings = {
          ...found,
          name: input.name.trim(),
          revision: found.revision + 1,
          config,
          // A stored secret goes only where it was given for: a new repository forgets it.
          secrets: found.secrets.map((secret) => ({
            key: secret.key,
            set: (secret.set && !rebound) || Boolean(input.secrets[secret.key]),
          })),
          changedAt: world.now(),
          changedBy: personId,
        }
        addedSources.set(input.id, saved)
        record({
          actorId: personId,
          action: 'source.changed',
          areaId: null,
          subjectType: 'source',
          subjectId: input.id,
          details: {
            from: found.revision,
            to: saved.revision,
            name: saved.name,
            config,
            secrets: Object.fromEntries([
              ...Object.keys(input.secrets).map((key) => [key, 'replaced']),
              ...found.secrets
                .filter((secret) => rebound && secret.set && !(secret.key in input.secrets))
                .map((secret) => [secret.key, 'removed']),
            ]),
            reason: input.reason,
          },
        })
        return structuredClone(saved)
      },

      /**
       * A test read, played by the settings: a host named `unreachable`, the token `refused`,
       * the ref `no-such-branch` and the folder `missing` each fail as the service says; any
       * other reads the demo model.
       */
      testSource(input: TestSourceInput): SourceCheck {
        adminOnly()
        const type = sourceType(input.type)
        const problems = sourceProblems(type, {
          name: 'Test',
          config: input.config,
          secrets: input.secrets,
        }).filter((problem) => problem.field !== 'domainNames')
        if (problems.length) refuse('invalid', problems[0]!.message, problems)
        if (input.id !== undefined && addedSources.get(input.id)?.type !== input.type)
          refuse('not-found', "We couldn't find this source among the ones an admin added.")
        const config = storedConfig(type, input.config)
        const failed = (code: string, target: string): SourceCheck => ({
          ok: false,
          steps: [],
          version: null,
          complete: false,
          views: 0,
          metrics: 0,
          dimensions: 0,
          warnings: [{ code, target }],
        })
        if (type.manifest.id === 'static-definitions') return staticCheck(config)
        const repository = typeof config.repository === 'string' ? config.repository : ''
        const ref = typeof config.ref === 'string' ? config.ref : ''
        if (URL.parse(repository)?.hostname.includes('unreachable'))
          return failed('unreachable', repository)
        if (input.secrets.token === 'refused') return failed('unauthorized', repository)
        if (ref === 'no-such-branch') return failed('ref_not_found', ref)
        if (config.folder === 'missing') return failed('folder_missing', 'missing')
        const model = mockSources({ ago: () => world.now(), scenario: null })[0]!
        return {
          ok: true,
          steps: [],
          version: digestOf(`${repository} ${ref}`).slice(0, 40),
          complete: true,
          views: model.views.length,
          metrics: model.views.reduce((sum, view) => sum + view.metrics, 0),
          dimensions: model.views.reduce((sum, view) => sum + view.dimensions, 0),
          warnings: model.lastRead?.warnings ?? [],
        }
      },

      runJob({ job }: { job: string }): RunJobResult {
        adminOnly()
        valid(/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$/.test(job) && job.length <= 80)
        if (!scheduledJobs.some((candidate) => candidate.name === job))
          refuse('not-found', `There's no scheduled job called ${job}.`)
        if (world.scenario() === 'runner-stopped')
          refuse('unavailable', "The job runner isn't running. Ask the data team to start it.")
        if (queued.has(job))
          refuse('conflict', `${job} is already waiting or running. Try again once it's done.`)
        queued.add(job)
        return {
          job,
          status: 'queued',
          id: `0199a6c5-${digestOf(job).slice(0, 4)}-7000-8000-000000000001`,
        }
      },

      searchAudit(params: AuditSearchParams = {}): AuditPage {
        auditOnly()
        const limit = params.limit ?? AUDIT_PAGE
        valid(Number.isInteger(limit) && limit >= 1 && limit <= 200)
        const newest = filtered(params)
          .filter((entry) => params.before === undefined || entry.seq < params.before)
          .reverse()
        const entries = newest.slice(0, limit)
        return {
          entries: structuredClone(entries).map((entry) =>
            entry.subjectType && entry.subjectId
              ? {
                  ...entry,
                  subjectNumber: null,
                  subjectTitle: null,
                  ...world.subjectOf?.({ type: entry.subjectType, id: entry.subjectId }, personId),
                }
              : { ...entry, subjectNumber: null, subjectTitle: null },
          ),
          next: newest.length > limit ? (entries.at(-1)?.seq ?? null) : null,
        }
      },

      exportAudit(params: AuditExportParams = {}): AuditExport {
        auditOnly()
        const format = params.format ?? 'jsonl'
        const limit = params.limit ?? AUDIT_EXPORT
        const after = filtered(params).filter(
          (entry) => params.after === undefined || entry.seq > params.after,
        )
        const entries = after.slice(0, limit)
        const columns = [
          'seq',
          'at',
          'actorId',
          'actorName',
          'actorKind',
          'action',
          'areaId',
          'subjectType',
          'subjectId',
          'requestId',
          'details',
          'hash',
        ] as const
        const content =
          format === 'csv'
            ? [
                columns.join(','),
                ...entries.map((entry) =>
                  columns.map((column) => csvCell(entry[column])).join(','),
                ),
              ].join('\n') + '\n'
            : entries.map((entry) => JSON.stringify(entry)).join('\n') +
              (entries.length ? '\n' : '')
        return {
          format,
          content,
          count: entries.length,
          next: after.length > limit ? (entries.at(-1)?.seq ?? null) : null,
          chain: chain(),
        }
      },

      verifyAudit(): AuditChain {
        auditOnly()
        return chain()
      },

      /** The agents connected as this person, the newest first (FR-403). */
      listConnections(): Connection[] {
        return connections
          .filter((connection) => connection.personId === personId)
          .sort((a, b) => b.connectedAt.localeCompare(a.connectedAt))
          .map(withoutPerson)
      },

      disconnectApp({ id }: { id: string }): { disconnected: boolean } {
        const found =
          connections.find(
            (connection) => connection.id === id && connection.personId === personId,
          ) ??
          refuse('not-found', "We couldn't find this connection. It may be disconnected already.")
        endConnection(found, personId, null)
        return { disconnected: true }
      },

      /** The consent screen allowed an app: it is connected as this person. */
      connectApp(connection: Connection) {
        connections = [
          { ...connection, personId },
          ...connections.filter((candidate) => candidate.id !== connection.id),
        ]
        record({
          actorId: personId,
          action: 'ai_client.connected',
          areaId: null,
          subjectType: 'ai_connection',
          subjectId: connection.id,
          details: { client: connection.clientName, scopes: connection.scopes },
        })
      },

      /** Every person's agents, the last used first (FR-403, FR-807). Administrators only. */
      listAiConnections(): PersonConnection[] {
        adminOnly()
        return [...connections]
          .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt) || (a.id < b.id ? -1 : 1))
          .map((connection) => {
            const person = world.people.find((candidate) => candidate.id === connection.personId)
            return {
              ...withoutPerson(connection),
              person: {
                id: connection.personId,
                name: person?.name ?? connection.personId,
                initials: person?.initials ?? '',
                email: `${connection.personId}@example.test`,
              },
            }
          })
      },

      disconnectAiConnection(input: AdminDisconnect): { disconnected: number } {
        adminOnly()
        const reason = input.reason.trim()
        plainReason(reason)
        const found =
          connections.find((connection) => connection.id === input.id) ??
          refuse('not-found', "We couldn't find this connection. It may be disconnected already.")
        endConnection(found, personId, { reason, batchId: null })
        return { disconnected: 1 }
      },

      disconnectPersonAiConnections(input: AdminDisconnectPerson): { disconnected: number } {
        adminOnly()
        const reason = input.reason.trim()
        plainReason(reason)
        const theirs = connections
          .filter((connection) => connection.personId === input.personId)
          .sort((a, b) => a.connectedAt.localeCompare(b.connectedAt))
        const batchId = theirs.length ? nextBatchId() : null
        for (const connection of theirs) endConnection(connection, personId, { reason, batchId })
        return { disconnected: theirs.length }
      },

      /** An import made proposals: the log keeps who and how many (admin/imports.ts). */
      recordImport: (details: Record<string, unknown>, batchId: string) => {
        record({
          actorId: personId,
          action: 'import.applied',
          areaId: null,
          subjectType: 'import_batch',
          subjectId: batchId,
          details,
        })
      },

      getTraffic({ days = 7 }: TrafficParams = {}): TrafficSummary {
        adminOnly()
        valid(Number.isInteger(days) && days >= 1 && days <= 90)
        const hour = `${world.now().slice(0, 13)}:00:00Z`
        const to = new Date(Date.parse(hour) + 3_600_000).toISOString().replace('.000', '')
        const from = new Date(Date.parse(to) - days * 86_400_000).toISOString().replace('.000', '')
        if (world.scenario() === 'empty')
          return {
            from,
            to,
            retentionDays: retention(),
            total: { ...counts(0, 0, 0, 0, 0, 0), lastHour: null },
            rows: [],
          }
        const named = (label: string) =>
          world.clients().find((client) => client.label === label)?.displayName ?? null
        // Calls scale with the days asked: a week is the unit the figures were made for.
        const scale = (n: number) => Math.round((n * days) / 7)
        const lastHourOf = (hoursAgo: number) =>
          new Date(Date.parse(hour) - hoursAgo * 3_600_000).toISOString().replace('.000', '')
        const rows = [
          row(
            'claude-code',
            'get_facts',
            scale(1_842),
            scale(3),
            scale(11),
            0,
            0,
            412,
            1_890,
            scale(15_400_000),
            0,
            scale(6),
          ),
          row(
            'claude-code',
            'search_facts',
            scale(604),
            scale(1),
            0,
            0,
            0,
            188,
            640,
            scale(2_210_000),
            1,
          ),
          row('claude-code', 'protocol', scale(388), 0, 0, 0, 0, 9, 31, scale(190_000), 0),
          row(
            'eval',
            'get_facts',
            scale(1_260),
            scale(6),
            0,
            0,
            0,
            455,
            2_310,
            scale(10_900_000),
            26,
          ),
          row('claude-code', 'read_item', scale(231), 0, 0, 0, 0, 74, 210, scale(1_480_000), 2),
          row('claude-code', 'give_feedback', scale(57), 0, 0, 0, 0, 41, 96, scale(11_000), 5),
          row('cursor', 'get_facts', scale(43), 0, 0, scale(43), 0, null, null, 0, 52),
          row('claude-code', 'report_gap', scale(19), 0, scale(2), 0, 0, 63, 140, scale(4_100), 3),
          row('unknown', 'protocol', scale(12), 0, 0, 0, scale(12), 3, 8, scale(2_000), 7),
        ].filter((r) => r.calls > 0)
        const sum = (
          field:
            | 'calls'
            | 'ok'
            | 'errors'
            | 'invalidInput'
            | 'rateLimited'
            | 'forbidden'
            | 'unauthorized'
            | 'bytes',
        ) => rows.reduce((total, r) => total + r[field], 0)
        return {
          from,
          to,
          retentionDays: retention(),
          total: {
            calls: sum('calls'),
            ok: sum('ok'),
            errors: sum('errors'),
            invalidInput: sum('invalidInput'),
            rateLimited: sum('rateLimited'),
            forbidden: sum('forbidden'),
            unauthorized: sum('unauthorized'),
            medianMs: 214,
            p95Ms: 1_760,
            bytes: sum('bytes'),
            lastHour: rows.length ? lastHourOf(0) : null,
          },
          rows,
        }

        function counts(
          calls: number,
          errors: number,
          rateLimited: number,
          forbidden: number,
          unauthorized: number,
          bytes: number,
          medianMs: number | null = null,
          p95Ms: number | null = null,
        ) {
          return {
            calls,
            ok: calls - errors - rateLimited - forbidden - unauthorized,
            errors,
            invalidInput: 0,
            rateLimited,
            forbidden,
            unauthorized,
            medianMs: calls ? medianMs : null,
            p95Ms: calls ? p95Ms : null,
            bytes,
          }
        }
        function row(
          client: string,
          tool: string,
          calls: number,
          errors: number,
          rateLimited: number,
          forbidden: number,
          unauthorized: number,
          medianMs: number | null,
          p95Ms: number | null,
          bytes: number,
          hoursAgo: number,
          invalidInput = 0,
        ) {
          return {
            client,
            clientName: client === 'unknown' ? null : named(client),
            tool,
            ...counts(calls, errors, rateLimited, forbidden, unauthorized, bytes, medianMs, p95Ms),
            ok: calls - errors - invalidInput - rateLimited - forbidden - unauthorized,
            invalidInput,
            lastHour: lastHourOf(hoursAgo),
          }
        }
      },
    }
  }

  /** `retention.request_log_days` as it is now. */
  function retention() {
    return settings.get('retention.request_log_days')![0]!.value as number
  }

  return { as, record }
}

export type MockAdmin = ReturnType<typeof createMockAdmin>
