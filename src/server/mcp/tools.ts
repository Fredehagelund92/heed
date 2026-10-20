import { createHash } from 'node:crypto'
import * as z from 'zod'
import { canonicalJson } from '../../domain/canonical.ts'
import { draftingGuide } from '../../domain/drafting-guide.ts'
import {
  INSTRUCTIONS_READ_BY_ALL,
  instructionRules as rulesFor,
  instructionsFor,
  toolWords,
} from '../../domain/mcp-text.ts'
import { agentTreatmentSentence } from '../../domain/proposal-attributes.ts'
import {
  contextInput,
  readInput,
  relatedInput,
  searchInput,
  improveInput,
  helpInput,
  helpOutput,
  gapInput,
  feedbackInput,
  draftInput,
  draftOutput,
  readOutput,
  deliveryOutput,
  readItemOutput,
  findInput,
  overviewInput,
  changesInput,
} from './schemas.ts'
import { productName } from '../brand.ts'

const read = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
}
const feedback = {
  readOnlyHint: false,
  idempotentHint: false,
  destructiveHint: false,
  openWorldHint: false,
}
const write = {
  readOnlyHint: false,
  idempotentHint: false,
  destructiveHint: false,
  openWorldHint: false,
}
const prefix = 'Call get_context before answering a question about company data. '
/** The rules every client reads first (FR-343), with the product's name the setting gives. */
export const instructionRules = rulesFor(productName)
export { INSTRUCTIONS_READ_BY_ALL }
/** FR-343: what the server tells a client when it connects (src/domain/mcp-text.ts). */
export const serverInstructions = (dataTools: readonly string[], about = ''): string =>
  instructionsFor(productName, dataTools, about)
/** A tool's description for the model: the line people read first, then what the model needs. */
const describe = (tool: keyof typeof toolWords, text: string, first = prefix) =>
  `${toolWords[tool].line} ${first}${text}`
export const tools = {
  get_context: {
    scope: 'read',
    title: toolWords.get_context.title,
    description: describe(
      'get_context',
      `Pass structured metrics, dimension_filters and inclusive UTC dates when known. Without window, the dates in the question are read (such as 2026, last quarter or 1 Jan to 30 Sep) and dates_read says how; without any dates, the question is read at today and assumed_date says so. The member names you just queried in the data tool work as names, and a name that isn't known comes back with the closest that is. A dimension filter with no values names the dimension for every value, as in a breakdown by market. Returns the checked facts (items) that apply, with their sources, coverage and links, and the domain of each asked metric; with response_format concise, a short reply without bodies, evidence and links. A link neither widens where a fact applies nor proves a cause. Read a linked fact with read_item only when it helps answer the question.`,
    ),
    inputSchema: contextInput,
    outputSchema: deliveryOutput,
    annotations: read,
  },
  search_context: {
    scope: 'read',
    title: toolWords.search_context.title,
    description: describe(
      'search_context',
      'Find facts (items) by a few words, not a whole question, such as "net revenue Spain". Matches the names of domains, metrics and dimension values (such as a market) against what a fact is about, and other words against its title, summary and text. Facts that match every word come first; query_used says how the words were read. Filter by kind, by domain (area: a domain id or name, such as Sales) or by mentions to find the facts that refer to one. Returns titles and summaries, without bodies. Follow next_cursor for another page.',
    ),
    inputSchema: searchInput,
    outputSchema: deliveryOutput,
    annotations: read,
  },
  read_item: {
    scope: 'read',
    title: toolWords.read_item.title,
    description: describe(
      'read_item',
      'Read one fact (item) you may see, with its sources and outgoing links, plus a page of the facts that link to it. An edition needs a service token with edition scope. A link proves neither that a fact applies nor a cause.',
    ),
    inputSchema: readInput,
    outputSchema: readItemOutput,
    annotations: read,
  },
  get_related: {
    scope: 'read',
    title: toolWords.get_related.title,
    description: describe(
      'get_related',
      "Follow links from a fact's item id, a vocabulary key such as metric:orders, or a domain. Returns neighbours one or two steps away with their kind of link, never bodies. A link shows what a text refers to: it neither widens where a fact applies nor proves a cause. Call it only when a link helps answer the question; read a neighbour with read_item. Follow next_cursor for another page.",
    ),
    inputSchema: relatedInput,
    outputSchema: readOutput,
    annotations: read,
  },
  find_context: {
    scope: 'read',
    title: toolWords.find_context.title,
    description: describe(
      'find_context',
      `Find what is written down about a few words or a question, by the names people use: metrics and their other names (such as GMV), markets, domains, member names from the data tool (such as payments.orders), and words in a fact. Use it for "what do we know about", "what is" or "how is it defined", and when you don't know the exact names. Returns the matching facts (items) with titles and summaries, and for each metric or dimension the words name: the definition its source gives, where that definition comes from, and what these facts add. When no words match, it returns the facts that apply to what the words name, on the dates the window or the words give (dates_read says how it read the words) or else today, as assumed_date says; when nothing is found, why says what to try. Read a fact in full with read_item.`,
    ),
    inputSchema: findInput,
    outputSchema: deliveryOutput,
    annotations: read,
  },
  domain_overview: {
    scope: 'read',
    title: toolWords.domain_overview.title,
    /** Reads owners, gaps and editions beside the served edition: offered only with them. */
    reads: true,
    description: describe(
      'domain_overview',
      'Describe a domain in one call: what it is and what kind of data it holds, as its owners wrote it, its owners, what it covers, the facts that need checking, its open gaps and its recent changes. Without a domain, lists every domain with its summary line and those counts, and the metric and dimension names known here. Name the domain as people do, such as Sales.',
    ),
    inputSchema: overviewInput,
    outputSchema: readOutput,
    annotations: read,
  },
  what_changed: {
    scope: 'read',
    title: toolWords.what_changed.title,
    reads: true,
    description: describe(
      'what_changed',
      'Say what changed for AI apps between two editions: by default the live edition and the one before. Filter by domain. Use it for "what changed", "what is new" or "what was archived" (retired). Facts AI apps don\'t get are counted, not named.',
    ),
    inputSchema: changesInput,
    outputSchema: readOutput,
    annotations: read,
  },
  search_help: {
    scope: 'read',
    title: toolWords.search_help.title,
    description: describe(
      'search_help',
      `Answer a question about how ${productName} itself works, such as what an MCP or an edition is, from its help pages: the same pages as its Docs. Pass the question's words. Returns the best matching sections, each with its page and link: answer from them and link the page. For company data, use get_context.`,
      '',
    ),
    inputSchema: helpInput,
    outputSchema: helpOutput,
    annotations: read,
  },
  improve_question: {
    scope: 'read',
    title: toolWords.improve_question.title,
    description: describe(
      'improve_question',
      'Check the dates, definitions and markets of a question, the same way every time. Suggests comparisons, overlapping events and guides that apply.',
    ),
    inputSchema: improveInput,
    outputSchema: readOutput,
    annotations: read,
  },
  report_gap: {
    scope: 'feedback',
    title: toolWords.report_gap.title,
    description: describe(
      'report_gap',
      'Report that nothing is written down for a question about metrics, markets and dates that are in the vocabulary (a gap). The question is used only in memory. Never put question text, personal data or secrets in the optional short note.',
      '',
    ),
    inputSchema: gapInput,
    annotations: feedback,
  },
  give_feedback: {
    scope: 'feedback',
    title: toolWords.give_feedback.title,
    description: describe(
      'give_feedback',
      'Say whether the facts in one reply helped, by its delivery_id. Never put question text, personal data or secrets in the optional short note.',
      '',
    ),
    inputSchema: feedbackInput,
    annotations: feedback,
  },
  draft_context: {
    scope: 'propose',
    title: toolWords.draft_context.title,
    /** Only a person a login server signed in may call it: the draft is theirs (FR-121). */
    person: true,
    // The attributes it names come from the attribute table, so they cannot fall behind it.
    description: describe(
      'draft_context',
      `Save a draft of a fact (a context item) for the signed-in person, when they ask to record something from this work. Only what can be worked out is filled in, and every field is marked; it never sends the draft for review. ` +
        agentTreatmentSentence() +
        ` Pass the words and names: they're matched to the vocabulary, so never invent a metric key or a link, and give a date the person is unsure of only with window.uncertain. Don't include names of customers or staff, personal data, secrets, question text or a transcript. If your app can show forms, the person may be asked its open questions there before it saves; their answers are marked as confirmed. If it lists possible duplicates, ask the person, then call again with item_id or new_item. For a law or a regulation, draft an event: the window from the day it takes effect as its text says, evidence from the official text, and not_to_conclude saying that it is not legal advice and whether the measure is provisional. Show the person the questions and the link, and let them check the draft and send it for review in ${productName}. ${draftingGuide}`,
      '',
    ),
    inputSchema: draftInput,
    outputSchema: draftOutput,
    annotations: write,
  },
} as const
export type ToolName = keyof typeof tools
/** The tools that read the served edition or record anonymous demand, without a person. */
export type ServedToolName = Exclude<ToolName, 'draft_context'>
export const toolNames = Object.keys(tools) as ToolName[]
const outputOf = (name: ToolName) =>
  'outputSchema' in tools[name] ? (tools[name] as { outputSchema: z.ZodType }).outputSchema : null
export const toolDefinitions = toolNames.map((name) => {
  const output = outputOf(name)
  return {
    name,
    title: tools[name].title,
    description: tools[name].description,
    inputSchema: z.toJSONSchema(tools[name].inputSchema, { io: 'input' }),
    ...(output ? { outputSchema: z.toJSONSchema(output) } : {}),
    annotations: tools[name].annotations,
  }
})
export const toolSchemaDigest = createHash('sha256')
  .update(canonicalJson({ tools: toolDefinitions }))
  .digest('hex')
/** A tool that reads owners, gaps or editions beside the served edition (FR-339, FR-340). */
export function needsReads(name: ToolName): boolean {
  return Object.hasOwn(tools[name], 'reads')
}
/** A tool only a person a login server signed in may call: it writes as that person (FR-121). */
export function personOnly(name: ToolName): boolean {
  return Object.hasOwn(tools[name], 'person')
}
export function isToolName(value: unknown): value is ToolName {
  return typeof value === 'string' && Object.hasOwn(tools, value)
}

/** A tool's output schema for the MCP server, when it declares one. */
export function toolOutputSchema(name: ToolName) {
  const schema = outputOf(name)
  return schema
    ? {
        '~standard': {
          ...schema['~standard'],
          jsonSchema: {
            input: () => z.toJSONSchema(schema, { io: 'input' }),
            output: () => z.toJSONSchema(schema),
          },
        },
      }
    : undefined
}

// Zod Mini exposes Standard Schema validation but needs an explicit JSON Schema adapter.
export function toolInputSchema(name: ToolName) {
  const schema = tools[name].inputSchema
  return {
    '~standard': {
      ...schema['~standard'],
      jsonSchema: {
        input: () => z.toJSONSchema(schema, { io: 'input' }),
        output: () => z.toJSONSchema(schema),
      },
    },
  }
}
