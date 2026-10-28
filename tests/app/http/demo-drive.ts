import pg from 'pg'
import { reviews } from '@/api/mock/data/review'
import { builtInConnectors } from '../../../src/connectors/index.ts'
import { defineManifest } from '../../../src/domain/define-manifest.ts'
import { defineConnector, defineRuntime } from '../../../src/domain/connector-runtime.ts'
import { systemClock } from '../../../src/server/clock.ts'
import { calendarDateTypes, databaseFromPool } from '../../../src/server/db/database.ts'
import { localRoles } from '../../../src/server/db/roles.ts'
import {
  ConnectorRegistry,
  connectorSyncJob,
} from '../../../src/server/modules/connectors/index.ts'
import { createLogger } from '../../../src/server/observability/logger.ts'

/*
  This morning's read of a shared Google Drive folder, as the mock has it (data/review.ts): two
  documents of the data team's definitions, each one suggestion for the owners of Sales, never
  published by the read. It runs through the service's own sources job and content pipeline, so
  the suggestions are made exactly as a read makes them: by nobody, under the read, every field
  marked. Only the tool is a stand-in: Google Drive's connector is a later part of the plan, so
  a connector of this seed's own returns the two documents a read of that folder would.
*/

/** The mock's two suggestions from the read, in the order its review queue shows them. */
export const driveCards = ['drive-marketplace', 'drive-bundles'] as const
export type DriveCard = (typeof driveCards)[number]

/**
 * When the read ran: 06:00 this morning, on the clock of the machine the journeys run on, as the
 * Inbox heads it "From Google Drive, today, 06:00" (the mock's "Today, 06:00").
 */
function readAt() {
  const at = new Date()
  at.setHours(6, 0, 0, 0)
  return at.toISOString()
}

/**
 * When each suggestion was sent, on the demo week's day, as the mock dates them: before anyone
 * sent one by hand, so they come last in the review's queue, the first card last.
 */
const sentAt = (today: string, card: DriveCard) =>
  `${today}T06:0${driveCards.length - 1 - driveCards.indexOf(card)}:00Z`

/** The folder the read covers, and the domain an admin mapped it to. */
const folder = { id: 'definitions', title: 'Data team / Definitions', domain: 'area_sales' }

const manifest = defineManifest({
  id: 'demo-drive',
  version: '0.1.0',
  heed: '^3.0',
  kind: 'content',
  tool: 'Google Drive',
  title: 'Google Drive',
  summary: 'Documents in shared folders become suggestions for owners.',
  icon: 'file',
  maintainer: { name: 'Core team' },
  support: 'core',
  maturity: 'experimental',
  config: { fields: [] },
  secrets: [],
  access: ['Read access to the folders shared with it. Nothing is ever written to them.'],
  egress: { hosts: [{ host: 'docs.example.com' }] },
  capabilities: {
    discover: 'folders',
    incremental: false,
    deletions: 'full-listing',
    domain: 'per-scope',
  },
  schedule: { default: 'P1D', minimum: 'PT15M' },
  staleAfter: 'P2D',
  limits: { timeoutSeconds: 30, maxRecords: 100, draftsPerDay: 20 },
  warnings: {},
  markVersion: 1,
})

/** A document as the read finds it: the mock's title, and the text an owner reviews. */
function documentOf(card: DriveCard, today: string) {
  const review = reviews.find((r) => r.id === card)!
  // What the owner reviews: the change's own words, as the mock shows them.
  const text = review.source.after
  return {
    id: card,
    scope: folder.id,
    title: review.title,
    link: `https://docs.example.com/document/${card}`,
    modifiedAt: `${today}T05:30:00.000Z`,
    version: '1',
    text: `# ${review.title}\n\n${text}\n`,
    mediaType: 'text/markdown' as const,
  }
}

/**
 * Adds the Google Drive source with its folder, runs the service's sources job once, and dates
 * the read and its suggestions this morning. Returns each suggestion by its mock card.
 */
export async function seedDriveRead(
  superuserUrl: string,
  today: string,
): Promise<Record<DriveCard, string>> {
  const connector = defineConnector(
    manifest,
    defineRuntime({
      check: () => Promise.resolve({ steps: [{ id: 'reach', title: 'Reach', status: 'ok' }] }),
      async *read() {
        for (const card of driveCards)
          yield await Promise.resolve({
            type: 'document' as const,
            document: documentOf(card, today),
          })
        yield { type: 'end' as const, version: today, complete: true }
      },
    }),
  )
  const admin = new pg.Client({ connectionString: superuserUrl })
  await admin.connect()
  const pool = new pg.Pool({
    connectionString: superuserUrl,
    max: 2,
    options: `-c role=${localRoles.api}`,
    types: calendarDateTypes,
  })
  try {
    await admin.query(
      `insert into connectors (id, kind, type, name, config, interface_version, origin, scopes)
       values ('google-drive', 'context_source', $1, 'Google Drive', '{}', 3, 'workspace', $2)`,
      [manifest.id, JSON.stringify([folder])],
    )
    const registry = new ConnectorRegistry([], {
      connectors: [...builtInConnectors, connector],
    })
    const result = (await connectorSyncJob(registry, { clock: systemClock(today) }).run({
      database: databaseFromPool(pool),
      logger: createLogger({ level: 'silent' }),
      signal: new AbortController().signal,
    })) as { connectors: Record<string, { status?: string; suggested?: number }> }
    const read = result.connectors['google-drive']
    if (read?.status !== 'ok' || read.suggested !== driveCards.length)
      throw new Error(`The Google Drive read made no suggestions: ${JSON.stringify(read)}`)
    const made = await admin.query<{ id: string; document: DriveCard }>(
      `select id::text, source_document_id as document from proposals where source_id = 'google-drive'`,
    )
    await admin.query(
      `update connector_snapshots set fetched_at = $1 where connector_id = 'google-drive'`,
      [readAt()],
    )
    for (const row of made.rows)
      await admin.query('update proposals set created_at = $2, submitted_at = $2 where id = $1', [
        row.id,
        sentAt(today, row.document),
      ])
    return Object.fromEntries(made.rows.map((row) => [row.document, row.id])) as Record<
      DriveCard,
      string
    >
  } finally {
    await pool.end()
    await admin.end()
  }
}
