import { createHash } from 'node:crypto'
import * as z from 'zod'
import { canonicalJson } from '../../domain/canonical.ts'
import { draftingGuide } from '../../domain/drafting-guide.ts'
import {
  INSTRUCTIONS_READ_BY_ALL,
  agentToolNames,
  deprecatedTools,
  instructionRules as rulesFor,
  instructionsFor,
  toolWords,
  type AgentToolName,
  type DeprecatedToolName,
} from '../../domain/mcp-text.ts'
import { agentTreatmentSentence } from '../../domain/proposal-attributes.ts'
import {
  contextInput,
  contextOutput,
  deliveryOutput,
  draftInput,
  draftOutput,
  feedbackInput,
  findContextInput,
  findContextOutput,
  findInput,
  gapInput,
  getContextInput,
  readContextOutput,
  readInput,
  readItemOutput,
  readOutput,
  relatedInput,
  reportInput,
  reportOutput,
  searchInput,
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
const describe = (tool: AgentToolName, text: string, first = prefix) =>
  `${toolWords[tool].line} ${first}${text}`

/**
 * The six tools of the agent contract (docs/product.md, section 10), in the order agents read
 * them. Each id, title and first line comes from src/domain/mcp-text.ts.
 */
export const tools = {
  get_context: {
    scope: 'read',
    title: toolWords.get_context.title,
    description: describe(
      'get_context',
      `Pass structured metrics, dimension_filters and inclusive UTC dates when known. Without window, the dates in the question are read (such as 2026, last quarter or 1 Jan to 30 Sep) and say says how; without any dates, the question is read at today and say says so. The member names you just queried in the data tool work as names, and a name that isn't known comes back with the closest that is. A dimension filter with no values names the dimension for every value, as in a breakdown by market. Returns status, the answer state; say, the sentence to relay, which starts with the answer line; asked, what was looked up; and context, each item that applies with its kind, when and where it applies, who checked it and when, its source, its not_to_conclude line, whether it may be out of date and which item it disagrees with; then reply_id, for report, and the edition. A synonym written in Definitions reads as the metric or dimension it names; terms gives each word of the question a person defined there, with its meaning as written, who wrote it as a role and when: read the question by it, never as a checked source. With response_format full, each item also has its body, every source and its links. A link neither widens where an item applies nor proves a cause. Read a linked item with read_context only when it helps answer the question.`,
    ),
    inputSchema: getContextInput,
    outputSchema: contextOutput,
    annotations: read,
  },
  find_context: {
    scope: 'read',
    title: toolWords.find_context.title,
    description: describe(
      'find_context',
      `Find what is written down about a few words, by the names people use: metrics and their other names (such as GMV), markets, domains, member names from the data tool (such as payments.orders), and words in an item's title, summary or text. Use it for "what do we know about", "what is" or "how is it defined", and when you don't know the exact names. Filter by domain (a name such as Sales) or kind (event, warning, rule or guide). Returns the matching items, titles and summaries only, and for each metric or dimension the words name: the definition its source gives and what this context adds; and terms, each word a person defined in Definitions, with its meaning as written. When no words match, it returns the items that apply to what the words name, on the dates the window or the words give, or else today, as say says; when nothing is found, why says what to try. Read an item in full with read_context.`,
    ),
    inputSchema: findContextInput,
    outputSchema: findContextOutput,
    annotations: read,
  },
  read_context: {
    scope: 'read',
    title: toolWords.read_context.title,
    description: describe(
      'read_context',
      'Read one item you may see, by its id: its text, its sources with the sentence each one gives, who checked it and when, its not_to_conclude line and its outgoing links, plus a page of the items that link to it, and terms, each word of it a person defined in Definitions, with its meaning as written. An edition needs a service token with edition scope. A link proves neither that an item applies nor a cause.',
    ),
    inputSchema: readInput,
    outputSchema: readContextOutput,
    annotations: read,
  },
  report: {
    scope: 'feedback',
    title: toolWords.report.title,
    description: describe(
      'report',
      "Ask the person first. kind says what: missing, wrong, unclear, or helped. Pass the reply_id of the get_context reply it is about, and context_id when it is about one item; for something missing with no reply, pass the question's metrics, markets and dates instead. It records what was reported and where, so the owner of the domain sees it, and never who asked. The question is read in memory only. Never put question text, personal data or secrets in the optional short note.",
      '',
    ),
    inputSchema: reportInput,
    outputSchema: reportOutput,
    annotations: feedback,
  },
  suggest_context: {
    scope: 'propose',
    title: toolWords.suggest_context.title,
    /** Only a person a login server signed in may call it: the suggestion is theirs (FR-121). */
    person: true,
    // The attributes it names come from the attribute table, so they cannot fall behind it.
    description: describe(
      'suggest_context',
      `Call it only after the person says yes to sending it. It sends a suggestion, a new item or a change to one, as the signed-in person, to the owner of its domain, who checks it and publishes it: nothing changes until they do, and it never publishes. Only what can be worked out is filled in, and every field is marked for the owner. If the review checks find a problem, it is kept as the person's draft and the reply says why. ` +
        agentTreatmentSentence() +
        ` Pass the words and names: they're matched to the vocabulary, so never invent a metric key or a link, and give a date the person is unsure of only with window.uncertain. Don't include names of customers or staff, personal data, secrets, question text or a transcript. If your agent can show forms, the person may be asked its open questions there before it is sent; their answers are marked as confirmed. If it lists possible duplicates, ask the person, then call again with item_id or new_item. For a law or a regulation, suggest an event: the window from the day it takes effect as its text says, evidence from the official text, and not_to_conclude saying that it is not legal advice and whether the measure is provisional. Tell the person it waits for the owner, and give them the link. ${draftingGuide}`,
      '',
    ),
    inputSchema: draftInput,
    outputSchema: draftOutput,
    annotations: write,
  },
  get_related: {
    scope: 'read',
    title: toolWords.get_related.title,
    description: describe(
      'get_related',
      "Follow links from an item's id, a vocabulary key such as metric:orders, a term written in Definitions (term:<id>), or a domain. Returns neighbours one or two steps away with their kind of link, never bodies; a term comes with what it means, as a person wrote it, which is background for reading words and never a checked source. A link shows what a text refers to: it neither widens where an item applies nor proves a cause, and it never changes what get_context includes. Call it only when a link helps answer the question; read a neighbour with read_context. Follow next_cursor for another page.",
    ),
    inputSchema: relatedInput,
    outputSchema: readOutput,
    annotations: read,
  },
} as const satisfies Record<AgentToolName, unknown>
export type ToolName = AgentToolName
export const toolNames: ToolName[] = [...agentToolNames]

/**
 * The deprecated ids (src/domain/mcp-text.ts), each with the arguments and the reply it had, so a
 * client that learned it from an earlier connection, a skill file or a saved instruction keeps
 * working for one release. The server lists each beside the tool that replaced it, with a
 * description that names that tool, and its reply carries a note that does too. A call by an old
 * id is checked, limited and logged as the tool that replaced it.
 */
export const deprecatedSchemas = {
  get_facts: { inputSchema: contextInput, outputSchema: deliveryOutput },
  find_facts: { inputSchema: findInput, outputSchema: deliveryOutput },
  search_facts: { inputSchema: searchInput, outputSchema: deliveryOutput },
  search_context: { inputSchema: searchInput, outputSchema: deliveryOutput },
  read_item: { inputSchema: readInput, outputSchema: readItemOutput },
  report_gap: { inputSchema: gapInput },
  give_feedback: { inputSchema: feedbackInput },
  draft_context: { inputSchema: draftInput, outputSchema: draftOutput },
} as const satisfies Record<DeprecatedToolName, unknown>
export type DeprecatedToolAlias = DeprecatedToolName
export const deprecatedToolAliases = deprecatedTools

/** What the old ids did, in a line, after the tool that replaced them. */
const oldLines: Record<DeprecatedToolName, string> = {
  get_facts:
    'It takes the arguments it took before and gives the reply it gave, with items and delivery_id.',
  find_facts: 'It takes the arguments it took before and gives the reply it gave, with items.',
  search_facts:
    'It takes the arguments it took before (query, kind, area, mentions, cursor) and gives the reply it gave.',
  search_context:
    'It takes the arguments search_facts took (query, kind, area, mentions, cursor) and gives the reply it gave.',
  read_item: 'It takes the arguments it took before and gives the reply it gave, with item.',
  report_gap: "It takes a question's scope and records a gap, as before.",
  give_feedback: 'It takes a delivery_id and a verdict, as before.',
  draft_context: 'It saves a draft for the person and never sends it, as before.',
}

/** A tool, or a deprecated id, as the server lists it. */
export type ListedName = ToolName | DeprecatedToolName
export const isDeprecated = (name: string): name is DeprecatedToolName =>
  Object.hasOwn(deprecatedTools, name)
/** What the server lists for a name: its title, description, schemas and annotations. */
export function listedTool(name: ListedName) {
  if (!isDeprecated(name)) return tools[name]
  const { scope, title, annotations } = tools[deprecatedTools[name]]
  // Its own schemas only: an old id that had no output schema declares none.
  return {
    scope,
    title,
    annotations,
    ...deprecatedSchemas[name],
    description: `Deprecated: use ${deprecatedTools[name]}. ${oldLines[name]}`,
  }
}

const outputOf = (name: ListedName) => {
  const listed = listedTool(name)
  return 'outputSchema' in listed ? (listed.outputSchema as z.ZodType) : null
}
const definitionOf = (name: ListedName) => {
  const listed = listedTool(name)
  const output = outputOf(name)
  return {
    name,
    title: listed.title,
    description: listed.description,
    inputSchema: z.toJSONSchema(listed.inputSchema, { io: 'input' }),
    ...(output ? { outputSchema: z.toJSONSchema(output) } : {}),
    annotations: listed.annotations,
  }
}
export const toolDefinitions = toolNames.map(definitionOf)
export const deprecatedDefinitions = (Object.keys(deprecatedTools) as DeprecatedToolName[]).map(
  definitionOf,
)
/** One digest of everything the server lists: the six tools and the deprecated ids. */
export const toolSchemaDigest = createHash('sha256')
  .update(canonicalJson({ tools: toolDefinitions, deprecated: deprecatedDefinitions }))
  .digest('hex')
/** A tool only a person a login server signed in may call: it writes as that person (FR-121). */
export function personOnly(name: ToolName): boolean {
  return Object.hasOwn(tools[name], 'person')
}
export function isToolName(value: unknown): value is ToolName {
  return typeof value === 'string' && Object.hasOwn(tools, value)
}

/** The tool a name calls: the tool itself, or the tool an old id stands for. Null for no tool. */
export function toolCalledBy(value: unknown): ToolName | null {
  if (isToolName(value)) return value
  return typeof value === 'string' && isDeprecated(value) ? deprecatedTools[value] : null
}

/** The old ids of a tool, listed beside it as deprecated. */
export const aliasesOf = (name: ToolName): DeprecatedToolName[] =>
  (Object.keys(deprecatedTools) as DeprecatedToolName[]).filter(
    (alias) => deprecatedTools[alias] === name,
  )

/**
 * What the tool service runs, by name: the six tools but suggest_context (the draft tool writes
 * it), and the deprecated ids by the code they had (search_context runs search_facts).
 */
export type ServedToolName =
  | Exclude<ToolName, 'suggest_context'>
  | Exclude<DeprecatedToolName, 'search_context' | 'draft_context'>
/** The service name a deprecated id runs. */
export const servedNameOf = (old: Exclude<DeprecatedToolName, 'draft_context'>): ServedToolName =>
  old === 'search_context' ? 'search_facts' : old

/** A tool's output schema for the MCP server, when it declares one. */
export function toolOutputSchema(name: ListedName) {
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
export function toolInputSchema(name: ListedName) {
  const schema = listedTool(name).inputSchema
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
