import type { Synced } from '../../../contract/review-path.ts'
import type { Queryable } from '../../db/database.ts'
import { connectorType } from './registry.ts'

interface Row {
  id: string
  sourceId: string
  sourceName: string
  type: string
  scope: string
  scopes: { id: string; title?: string }[]
  title: string
  link: string
  quote: string
  readId: string
  readAt: string
}

/**
 * Where each suggestion a content source's read made comes from (CON-611): its source and the
 * tool it reads, the scope and document, the read that made it and the document's quote. A
 * suggestion a person sent is not in the map. The words that name the tool are the connector's.
 */
export async function syncedOf(
  tx: Queryable,
  proposalIds: readonly string[],
): Promise<Map<string, Synced>> {
  if (!proposalIds.length) return new Map()
  const rows = await tx.query<Row>(
    `select p.id::text, c.id as "sourceId", c.name as "sourceName", c.type, d.scope, c.scopes,
            d.title, d.link, d.quote, s.id::text as "readId",
            to_char(s.fetched_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "readAt"
       from proposals p
       join connectors c on c.id = p.source_id
       join connector_snapshots s on s.id = p.source_read_id
       join connector_documents d on d.source_id = p.source_id and d.document_id = p.source_document_id
      where p.id = any($1::uuid[])`,
    [proposalIds],
  )
  return new Map(
    rows.map((row) => [
      row.id,
      {
        source: {
          id: row.sourceId,
          name: row.sourceName,
          tool: connectorType(row.type, row.sourceName).tool,
        },
        scope: row.scopes.find((scope) => scope.id === row.scope)?.title ?? row.scope,
        document: { title: row.title, link: row.link },
        read: { id: row.readId, at: row.readAt },
        quote: row.quote,
      },
    ]),
  )
}
