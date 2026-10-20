import { tool, type Tool } from 'ai'
import type { EditionSource } from '../modules/editions/index.ts'
import type { Principal } from './auth.ts'
import { relatedInput } from './schemas.ts'
import { createToolService, failure } from './service.ts'
import { tools } from './tools.ts'

/*
  get_related for the assistant (FR-332, plan section 8.4). The assistant slice (S14) registers
  this tool beside its other read tools: it runs the MCP tool's own code in process, on the live
  edition, with no records written, and it is offered only while the tool switch has get_related
  on (FR-407), checked again on every call. Citations of a turn are validated against
  `relatedCitations` of its get_related results: only items in service may be cited, never a
  retired or replaced item's marker or a vocabulary term.
*/

/** The client label the assistant reads as. It never selects an edition. */
export const assistantClient = 'assistant'
const principal: Principal = {
  client: assistantClient,
  scopes: ['read'],
  caller: 'agent',
  canSelectEdition: false,
}
/** Nothing the assistant reads is a delivery or demand (FR-603). */
const noop = () => Promise.resolve()
const reportGap = () => Promise.reject(new Error('The assistant does not report gaps here'))
const switchedOn = async (source: EditionSource) =>
  (await source.policy(assistantClient)).tools.includes('get_related')

/** The tool, or null while get_related is switched off. */
export async function assistantRelatedTool(
  source: EditionSource,
  options: { maxBytes?: number; now?: () => Date } = {},
): Promise<Tool | null> {
  if (!(await switchedOn(source))) return null
  const execute = createToolService(source, { write: noop, reportGap, feedback: noop }, options.now)
  return tool({
    description: tools.get_related.description,
    inputSchema: relatedInput,
    async execute(input) {
      const result = (await switchedOn(source))
        ? await execute('get_related', input, principal, options.maxBytes ?? 100000, () => {})
        : failure('get_related is switched off.')
      return result.structuredContent
    },
  })
}
/** Ids the assistant may cite from one get_related result: items in service, root included. */
export function relatedCitations(output: unknown): string[] {
  if (!output || typeof output !== 'object') return []
  const reply = output as { root?: unknown; nodes?: unknown }
  const nodes: unknown[] = [
    reply.root,
    ...(Array.isArray(reply.nodes) ? (reply.nodes as unknown[]) : []),
  ]
  return nodes.flatMap((node) => {
    if (!node || typeof node !== 'object') return []
    const n = node as { type?: unknown; status?: unknown; id?: unknown }
    return n.type === 'item' && n.status === 'current' && typeof n.id === 'string' ? [n.id] : []
  })
}
