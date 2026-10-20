import { generateKeyPairSync } from 'node:crypto'
import {
  Client,
  ProtocolError,
  SdkHttpError,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { dynamicTool, jsonSchema, type JSONSchema7, type ToolSet } from 'ai'
import Fastify from 'fastify'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { createDevVerifier, mintDevToken } from '../../mcp/auth.ts'
import { registerMcpRoutes } from '../../mcp/gateway.ts'
import { loadServingPolicy, type ServingBundle } from '../editions/index.ts'

/**
 * One side of a paired run (FR-508, FR-509): the real MCP server code on a loopback port,
 * serving one edition held in memory (the live edition, or the live edition plus the proposed
 * version), with the production tool descriptions and the `eval` client's own policy, and the
 * tools the run fixed for this side (a links run offers get_related on one side only). The model
 * reaches it through an MCP client, exactly as an AI client would. Nothing it serves counts as
 * demand: the eval runner records its own cells, never deliveries (FR-603).
 *
 * Two clocks: answers are as of noon of the run's day, so a run is dated like the questions it
 * asks, while the request limits count real minutes. On the as-of clock a minute never ended, and
 * every call after the eval client's limit was refused for the rest of the run (round 5).
 */

export const evalClient = 'eval'
export type Arm = { tools: ToolSet; close(): Promise<void> }

/**
 * A tool call the tool server did not answer: refused at the door (a request limit, say) or never
 * reached. The failure is the run's, never the model's: the answer is not made, and the run ends
 * incomplete to make it again (R6).
 */
export class ToolCallRefused extends Error {
  override readonly name = 'ToolCallRefused'
  constructor(tool: string, status: number | null) {
    super(
      status === null
        ? `A call to ${tool} did not reach the tool server`
        : `The tool server refused a call to ${tool} (HTTP ${status})`,
    )
  }
}

const discard = () => Promise.resolve()
const noDemand = { write: discard, reportGap: () => Promise.resolve(''), feedback: discard }

export async function openArm(
  bundle: ServingBundle,
  database: Queryable,
  clock: Clock,
  /** The tools this side offers, fixed when the run was planned; the live switch otherwise. */
  tools?: readonly string[],
): Promise<Arm> {
  const { privateKey } = generateKeyPairSync('ed25519')
  const resource = 'http://localhost/mcp'
  const app = Fastify({ logger: false })
  registerMcpRoutes(app, {
    source: {
      bundle: () => Promise.resolve(bundle),
      policy: async (label) => {
        const policy = await loadServingPolicy(database, label)
        return tools ? { ...policy, tools: [...tools] } : policy
      },
    },
    store: noDemand,
    verifier: createDevVerifier(privateKey, resource, 'test'),
    resource,
    now: () => new Date(`${clock.today()}T12:00:00Z`),
    wallClock: () => clock.now(),
  })
  const base = await app.listen({ host: '127.0.0.1', port: 0 })
  const client = new Client({ name: 'heed-eval-runner', version: '1.0.0' })
  try {
    const token = await mintDevToken(privateKey, resource, {
      client: evalClient,
      scopes: ['read'],
      expiresIn: '2h',
    })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    )
    const listed = await client.listTools()
    const tools: ToolSet = {}
    for (const tool of listed.tools)
      tools[tool.name] = dynamicTool({
        description: tool.description ?? '',
        inputSchema: jsonSchema(tool.inputSchema as JSONSchema7),
        async execute(input) {
          try {
            const result = await client.callTool({
              name: tool.name,
              arguments: input as Record<string, unknown>,
            })
            return result.structuredContent ?? result.content
          } catch (error) {
            // An error the server answered goes back to the model, as it would to any AI client.
            if (error instanceof ProtocolError) throw error
            throw new ToolCallRefused(
              tool.name,
              error instanceof SdkHttpError ? error.status : null,
            )
          }
        },
      })
    return {
      tools,
      async close() {
        await client.close().catch(() => undefined)
        await app.close()
      },
    }
  } catch (error) {
    await client.close().catch(() => undefined)
    await app.close()
    throw error
  }
}
