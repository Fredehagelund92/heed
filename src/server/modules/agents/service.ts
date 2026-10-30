import { ORPCError } from '@orpc/client'
import type { ConnectInfo, TryItReading, TryItReadInput } from '../../../contract/connect.ts'
import { questionReading } from '../../../domain/question-reading.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { personOnly, toolNames } from '../../mcp/tools.ts'
import { enabledTools, loadLiveBundle } from '../editions/index.ts'

/**
 * Connect your AI, for every signed-in person (FR-404). `address` is the MCP server's public
 * address, null when this service does not serve MCP. Only what a person needs to connect: every
 * tool the gateway has, from its registry, with whether it is on, and the clients switched on, by
 * name; never a client's limits or tools.
 */
export async function connectInfo(
  tx: Queryable,
  address: string | null,
  signIn = false,
): Promise<ConnectInfo> {
  const on = new Set(await enabledTools(tx))
  const tools = toolNames.map((tool) => ({
    tool,
    enabled: on.has(tool),
    personOnly: personOnly(tool),
  }))
  // The evaluation runner's label is the gateway's own (mcp/auth.ts), not a person's client,
  // `signed-in` is every app a person signs in with, which needs no token, and `access-key` every
  // key an administrator made for a bot.
  const clients = await tx.query<{ label: string; name: string }>(
    `select client_label as label,display_name as name from client_policies
      where enabled and client_label not in ('eval','signed-in','access-key')
      order by display_name,client_label`,
  )
  // Signing in needs the login server and the client label its apps share switched on.
  const [shared] = await tx.query<{ enabled: boolean }>(
    "select enabled from client_policies where client_label='signed-in'",
  )
  return { address, tools, clients, signIn: signIn && address !== null && Boolean(shared?.enabled) }
}

/**
 * A question read as a scope with the live edition's vocabulary (Home's "Try it" and the Ask
 * composer's "Heed reads" line): the same words get_facts reads, answered with the scope's keys,
 * names and days, how the dates were read, the words that name more than one term, and the day a
 * question without dates is read at. The question stays in this call: it is not stored or logged,
 * and only the words the reader took go back to the person who asked (FR-602).
 */
export async function readTryItQuestion(
  tx: Queryable,
  clock: Clock,
  { question }: TryItReadInput,
): Promise<TryItReading> {
  const bundle = await loadLiveBundle(tx)
  if (!bundle)
    throw new ORPCError('PRECONDITION_FAILED', {
      message:
        'Nothing is shared with agents yet. They get facts once an owner accepts the first one.',
    })
  return questionReading(question, bundle.terms, clock.today())
}
