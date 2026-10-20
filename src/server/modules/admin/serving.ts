import { ORPCError } from '@orpc/client'
import type * as z from 'zod/mini'
import {
  type ClientPolicy,
  type saveClientSchema,
  type setToolSchema,
  unknownToolsMessage,
} from '../../../contract/admin.ts'
import type { Queryable } from '../../db/database.ts'
import { plainReason, recordAudit } from './audit.ts'

/*
  The MCP gateway reads `tool_config` and `client_policies` on every request, so a change here
  reaches the next request without a restart.
*/

type ToolRow = { tool: string; enabled: boolean; updatedAt: string }
const toolColumns = 'tool,enabled,updated_at::text as "updatedAt"'

export function listTools(tx: Queryable): Promise<ToolRow[]> {
  return tx.query<ToolRow>(`select ${toolColumns} from tool_config order by tool`)
}

export async function knownTools(tx: Queryable): Promise<string[]> {
  return (await tx.query<{ tool: string }>('select tool from tool_config order by tool')).map(
    (row) => row.tool,
  )
}

/** FR-407: one list decides which tools are on, for every client. */
export async function setTool(tx: Queryable, input: z.infer<typeof setToolSchema>) {
  plainReason(input.reason)
  const [before] = await tx.query<ToolRow>(
    `select ${toolColumns} from tool_config where tool=$1 for update`,
    [input.tool],
  )
  if (!before) throw new ORPCError('NOT_FOUND', { message: "We couldn't find this tool." })
  if (before.enabled === input.enabled) return before
  const [after] = await tx.query<ToolRow>(
    `update tool_config set enabled=$2,updated_at=now() where tool=$1 returning ${toolColumns}`,
    [input.tool, input.enabled],
  )
  await recordAudit(tx, {
    action: input.enabled ? 'tool.switched_on' : 'tool.switched_off',
    subjectType: 'tool',
    subjectId: input.tool,
    details: { reason: input.reason },
  })
  return after!
}

const clientColumns = `client_label as label,display_name as "displayName",tools_allowed as "toolsAllowed",
  rate_per_minute as "ratePerMinute",max_response_bytes as "maxResponseBytes",enabled`

export function listClients(tx: Queryable): Promise<ClientPolicy[]> {
  return tx.query<ClientPolicy>(
    `select ${clientColumns} from client_policies order by client_label`,
  )
}

/**
 * Adds a client label to the closed list, or changes its tools, limits or switch (FR-408). A
 * label is never removed: switching it off keeps its past request records meaningful.
 */
export async function saveClient(tx: Queryable, input: z.infer<typeof saveClientSchema>) {
  plainReason(input.reason)
  if (input.toolsAllowed) {
    const tools = await knownTools(tx)
    const unknown = input.toolsAllowed.filter((tool) => !tools.includes(tool))
    if (unknown.length)
      throw new ORPCError('UNPROCESSABLE_CONTENT', {
        message: unknownToolsMessage(unknown),
      })
  }
  const toolsAllowed = input.toolsAllowed && [...new Set(input.toolsAllowed)].sort()
  const [before] = await tx.query<ClientPolicy>(
    `select ${clientColumns} from client_policies where client_label=$1 for update`,
    [input.label],
  )
  const [after] = await tx.query<ClientPolicy>(
    `insert into client_policies(client_label,display_name,tools_allowed,rate_per_minute,max_response_bytes,enabled)
     values($1,$2,$3,$4,$5,$6)
     on conflict (client_label) do update set display_name=excluded.display_name,tools_allowed=excluded.tools_allowed,
       rate_per_minute=excluded.rate_per_minute,max_response_bytes=excluded.max_response_bytes,enabled=excluded.enabled
     returning ${clientColumns}`,
    [
      input.label,
      input.displayName,
      toolsAllowed,
      input.ratePerMinute,
      input.maxResponseBytes,
      input.enabled,
    ],
  )
  const { label: _label, ...settings } = after!
  await recordAudit(tx, {
    action: before ? 'client_policy.changed' : 'client_policy.added',
    subjectType: 'client',
    subjectId: input.label,
    details: { ...settings, reason: input.reason },
  })
  return after!
}
