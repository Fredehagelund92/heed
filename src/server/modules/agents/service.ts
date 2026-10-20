import { ORPCError } from '@orpc/client'
import type {
  ConnectInfo,
  TryIt,
  TryItInput,
  TryItReading,
  TryItReadInput,
} from '../../../contract/connect.ts'
import { questionReading } from '../../../domain/question-reading.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { byteSize } from '../../mcp/service.ts'
import { personOnly, toolNames } from '../../mcp/tools.ts'
import { enabledTools, loadLiveBundle } from '../editions/index.ts'
import { previewDelivery } from '../proposals/index.ts'

/** The gateway's own size limit: no client is ever answered more (FR-408). */
const REPLY_LIMIT = 100_000

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
  // The evaluation runner's label is the gateway's own (mcp/auth.ts), not a person's client, and
  // `signed-in` is every app a person signs in with, which needs no token.
  const clients = await tx.query<{ label: string; name: string }>(
    `select client_label as label,display_name as name from client_policies
      where enabled and client_label not in ('eval','signed-in') order by display_name,client_label`,
  )
  // Signing in needs the login server and the client label its apps share switched on.
  const [shared] = await tx.query<{ enabled: boolean }>(
    "select enabled from client_policies where client_label='signed-in'",
  )
  return { address, tools, clients, signIn: signIn && address !== null && Boolean(shared?.enabled) }
}

/**
 * What an agent would get (Try it): get_context on the live edition for a typed scope, with the
 * code that serves agents, no model and nothing recorded: no delivery, no gap, no question
 * (FR-602, FR-603). The bundle is read in the person's transaction and resolved with no
 * audience groups, which is every person's audience while groups are parked, so the reply is
 * the caller's own and never another audience's.
 */
export async function tryIt(
  tx: Queryable,
  clock: Clock,
  input: TryItInput,
  /** The web app's address, so the items' pages are the ones an agent gets (FR-347). */
  web: string | null = null,
): Promise<TryIt> {
  const bundle = await loadLiveBundle(tx)
  if (!bundle)
    throw new ORPCError('PRECONDITION_FAILED', {
      message:
        'Nothing is shared with AI apps yet. They get facts once an owner accepts the first one.',
    })
  const reply = await previewDelivery(bundle, clock, { ...input, question: '' }, web)
  // Nothing was delivered, so there is no delivery for an agent to give feedback on.
  const { delivery_id: _delivery, ...result } = reply.structuredContent
  // The digest names the tools' version for the person; an agent's client gets it in _meta.
  const digest = reply._meta?.tool_schema_digest
  return {
    result: { ...result, ...(digest ? { tool_schema_digest: digest } : {}) } as TryIt['result'],
    bytes: byteSize(reply),
    limit: REPLY_LIMIT,
  }
}

/**
 * A question read as a scope with the live edition's vocabulary (Home's "Try it" and the Ask
 * composer's "Heed reads" line): the same words get_context reads, answered with the scope's keys,
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
        'Nothing is shared with AI apps yet. They get facts once an owner accepts the first one.',
    })
  return questionReading(question, bundle.terms, clock.today())
}
