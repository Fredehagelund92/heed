import pg from 'pg'
import { reviews } from '@/api/mock/data/review'
import { systemClock } from '../../../src/server/clock.ts'
import { calendarDateTypes, databaseFromPool } from '../../../src/server/db/database.ts'
import { localRoles } from '../../../src/server/db/roles.ts'
import {
  ConnectorRegistry,
  connectorSyncJob,
  type SecretStore,
} from '../../../src/server/modules/connectors/index.ts'
import { createLogger } from '../../../src/server/observability/logger.ts'
import { driveHost } from '../../server/connectors/drive-server.ts'

/*
  This morning's read of a shared Google Drive folder, as the mock has it (data/review.ts): two
  documents of the data team's definitions, each one suggestion for the owners of Sales, never
  published by the read. It runs the Google Drive connector through the service's own sources job
  and content pipeline, so the suggestions are made exactly as a read makes them: by nobody, under
  the read, every field marked. Only Google is a stand-in: a fake Drive on this machine
  (tests/server/connectors/drive-server.ts), with a service account and key invented for the
  seed, holds the two documents.
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

/** The domain an admin mapped the folder the read covers to. */
const DOMAIN = 'area_sales'

/** Where the seed's key is, in a secret store of its own that holds that one key. */
const SECRET_REF = 'local:00000000-0000-4000-8000-00000000d71e'

/**
 * Adds the Google Drive source with its folder, runs the service's sources job once against the
 * fake Drive, and dates the read and its suggestions this morning. Returns each suggestion by its
 * mock card.
 */
export async function seedDriveRead(
  superuserUrl: string,
  today: string,
): Promise<Record<DriveCard, string>> {
  // The data team's folder, shared with the service account, and the folder of definitions in
  // it, with the mock's two documents: each its title, and the words an owner reviews.
  const drive = await driveHost({ startAt: `${today}T05:30:00Z` })
  const team = drive.folder('Data team')
  const definitions = drive.folder('Definitions', team)
  const cardOf = new Map<string, DriveCard>()
  for (const card of driveCards) {
    const review = reviews.find((r) => r.id === card)!
    const id = drive.document(
      review.title,
      definitions,
      `# ${review.title}\n\n${review.source.after}\n`,
    )
    cardOf.set(id, card)
  }
  const key = drive.key()
  const secrets: SecretStore = {
    available: true,
    read: (ref) => Promise.resolve(ref === SECRET_REF ? { serviceAccountKey: key } : null),
    write: () => Promise.reject(new Error('The seed keeps one key only')),
    remove: () => Promise.resolve(),
  }
  const folder = { id: definitions, title: 'Data team / Definitions', domain: DOMAIN }
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
      `insert into connectors
         (id, kind, type, name, config, interface_version, origin, scopes, secret_ref)
       values ('google-drive', 'context_source', 'google-drive', 'Google Drive', $1, 3, 'workspace',
               $2, $3)`,
      [
        JSON.stringify({ apiAddress: drive.address, signInAddress: drive.signInAddress }),
        JSON.stringify([folder]),
        SECRET_REF,
      ],
    )
    const registry = new ConnectorRegistry([], { secrets })
    const result = (await connectorSyncJob(registry, { clock: systemClock(today) }).run({
      database: databaseFromPool(pool),
      logger: createLogger({ level: 'silent' }),
      signal: new AbortController().signal,
    })) as { connectors: Record<string, { status?: string; suggested?: number }> }
    const read = result.connectors['google-drive']
    if (read?.status !== 'ok' || read.suggested !== driveCards.length)
      throw new Error(`The Google Drive read made no suggestions: ${JSON.stringify(read)}`)
    const made = (
      await admin.query<{ id: string; document: string }>(
        `select id::text, source_document_id as document from proposals where source_id = 'google-drive'`,
      )
    ).rows.map((row) => ({ id: row.id, document: cardOf.get(row.document)! }))
    await admin.query(
      `update connector_snapshots set fetched_at = $1 where connector_id = 'google-drive'`,
      [readAt()],
    )
    for (const row of made)
      await admin.query('update proposals set created_at = $2, submitted_at = $2 where id = $1', [
        row.id,
        sentAt(today, row.document),
      ])
    return Object.fromEntries(made.map((row) => [row.document, row.id])) as Record<
      DriveCard,
      string
    >
  } finally {
    await pool.end()
    await admin.end()
    await drive.close()
  }
}
