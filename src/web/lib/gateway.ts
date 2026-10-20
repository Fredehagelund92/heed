/**
 * The MCP and gateway screen's words and rules (FR-407, FR-408): what each tool does in plain
 * words, how an AI app's tools and limits read, and the AI app form. The service decides; these
 * only say what it will do, and check a form before it is sent. Code says client; people read
 * AI app (src/domain/words.ts).
 */
import * as z from 'zod/mini'
import type { ClientPolicy, SaveClientInput, ToolSwitch } from '@/api'
import { toolWords, type McpToolName } from '@domain/mcp-text'

/** The gateway's own limits when a client has none (src/server/mcp/gateway.ts). */
export const DEFAULT_RATE_PER_MINUTE = 120
export const DEFAULT_MAX_RESPONSE_BYTES = 100_000
/** What the service accepts (src/contract/admin.ts). */
export const RATE_RANGE = { min: 1, max: 10_000 } as const
export const RESPONSE_BYTES_RANGE = { min: 1_000, max: 100_000 } as const
export const CLIENT_NAME_MAX = 100
/** An administrator's reason is at most 500 characters, as a decision's is (FR-203). */
export const GATEWAY_REASON_MAX = 500

export type ToolAccess = 'read' | 'feedback' | 'propose'

/** What each tool may do, which the screen groups them by. */
const toolAccess: Record<McpToolName, ToolAccess> = {
  get_context: 'read',
  find_context: 'read',
  search_context: 'read',
  read_item: 'read',
  get_related: 'read',
  domain_overview: 'read',
  what_changed: 'read',
  improve_question: 'read',
  search_help: 'read',
  report_gap: 'feedback',
  give_feedback: 'feedback',
  draft_context: 'propose',
}

/**
 * Every tool the gateway serves, in the order the screen lists them: the ones that read facts
 * first, then the ones that take feedback, then the one that drafts for a person. The title and
 * the line are the ones an AI app shows (src/domain/mcp-text.ts). A tool the service adds later
 * is listed after these under its own name.
 */
export const toolInfo: Record<string, { name: string; about: string; access: ToolAccess }> =
  Object.fromEntries(
    (Object.keys(toolAccess) as McpToolName[]).map((tool) => [
      tool,
      { name: toolWords[tool].title, about: toolWords[tool].line, access: toolAccess[tool] },
    ]),
  )

const toolOrder = Object.keys(toolInfo)

/** A tool's name in words: "Get facts for a question". A tool the screen does not know keeps its own name. */
export const toolName = (tool: string) => toolInfo[tool]?.name ?? tool

export const accessWords: Record<ToolAccess, string> = {
  read: 'Reads facts',
  feedback: 'Sends feedback',
  propose: 'Drafts for a person',
}

/** The tools in the screen's order: known tools first, as `toolInfo` lists them, then the rest. */
export function orderTools<T extends { tool: string }>(tools: readonly T[]): T[] {
  const rank = (tool: string) => {
    const index = toolOrder.indexOf(tool)
    return index < 0 ? toolOrder.length : index
  }
  return [...tools].sort((a, b) => rank(a.tool) - rank(b.tool) || a.tool.localeCompare(b.tool))
}

/** "6 of 7 tools are on." */
export function toolsOnWords(tools: readonly ToolSwitch[]): string {
  const on = tools.filter((tool) => tool.enabled).length
  if (tools.length === 0) return 'There are no tools yet.'
  if (on === tools.length)
    return tools.length === 1 ? 'The tool is on.' : `All ${tools.length} tools are on.`
  return `${on} of ${tools.length} ${tools.length === 1 ? 'tool is' : 'tools are'} on.`
}

/** Whether an AI app may call a tool by its own policy, before the tool's switch is applied. */
export const clientAllows = (client: ClientPolicy, tool: string) =>
  client.toolsAllowed === null || client.toolsAllowed.includes(tool)

/** The switched-on AI apps a tool reaches, or would reach once on, by name. */
export function clientsReached(clients: readonly ClientPolicy[], tool: string): string[] {
  return clients
    .filter((client) => client.enabled && clientAllows(client, tool))
    .map((client) => client.displayName)
}

/** "Claude Code", "Claude Code and Cursor", "Claude Code, Cursor and Evaluation runner". */
export function listWords(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/**
 * The confirmation's one sentence: what switching a tool does, and to which AI apps. Without
 * the AI apps (they did not load) it says what happens to every one.
 */
export function toolSwitchEffect(
  tool: string,
  enabled: boolean,
  clients: readonly ClientPolicy[] | undefined,
): string {
  if (!clients)
    return enabled
      ? 'Every AI app that allows it can use it from its next call.'
      : 'Every AI app stops using it from its next call.'
  const reached = clientsReached(clients, tool)
  if (!enabled)
    return reached.length
      ? `${listWords(reached)} ${reached.length === 1 ? 'stops' : 'stop'} using it from the next call. It stays off for every AI app until you switch it on again.`
      : 'None of the AI apps that are on use it now. It stays off for every AI app until you switch it on again.'
  return reached.length
    ? `${listWords(reached)} can use it from the next call.`
    : 'None of the AI apps that are on allow it yet. Allow it for one on the AI apps tab.'
}

/** What an AI app may call: "Every tool that is on", or the chosen tools by name. */
export function clientToolsWords(client: ClientPolicy): string {
  if (client.toolsAllowed === null) return 'Every tool that is on'
  if (client.toolsAllowed.length === 0) return 'No tools'
  return orderTools(client.toolsAllowed.map((tool) => ({ tool })))
    .map(({ tool }) => toolName(tool))
    .join(', ')
}

const count = (value: number) => value.toLocaleString('en')

/** "120", or "Default (120)" when the AI app has no limit of its own. */
export function rateWords(client: Pick<ClientPolicy, 'ratePerMinute'>): string {
  return client.ratePerMinute === null
    ? `Default (${count(DEFAULT_RATE_PER_MINUTE)})`
    : count(client.ratePerMinute)
}

/** Bytes as kilobytes of 1,000, as the limit is set: "100 KB", "2.5 KB". */
export const kilobytes = (bytes: number) => `${(bytes / 1000).toLocaleString('en')} KB`

/** "100 KB", or "Default (100 KB)" when the AI app has no limit of its own. */
export function answerSizeWords(client: Pick<ClientPolicy, 'maxResponseBytes'>): string {
  return client.maxResponseBytes === null
    ? `Default (${kilobytes(DEFAULT_MAX_RESPONSE_BYTES)})`
    : kilobytes(client.maxResponseBytes)
}

/** An AI app's limits in a sentence, for a row with no columns: "120 a minute, answers up to 100 KB". */
export function limitsWords(client: Pick<ClientPolicy, 'ratePerMinute' | 'maxResponseBytes'>) {
  const rate =
    client.ratePerMinute === null
      ? `${count(DEFAULT_RATE_PER_MINUTE)} a minute (default)`
      : `${count(client.ratePerMinute)} a minute`
  const size =
    client.maxResponseBytes === null
      ? `answers up to ${kilobytes(DEFAULT_MAX_RESPONSE_BYTES)} (default)`
      : `answers up to ${kilobytes(client.maxResponseBytes)}`
  return `${rate}, ${size}`
}

/** The client form, as typed: numbers stay text until they are checked. */
export type ClientFormValues = {
  label: string
  displayName: string
  enabled: boolean
  tools: 'all' | 'chosen'
  chosen: string[]
  ratePerMinute: string
  maxResponseBytes: string
  reason: string
}

export const newClientValues: ClientFormValues = {
  label: '',
  displayName: '',
  enabled: true,
  tools: 'all',
  chosen: [],
  ratePerMinute: '',
  maxResponseBytes: '',
  reason: '',
}

/** A client's policy as the form shows it, with an empty reason. */
export function clientValues(client: ClientPolicy): ClientFormValues {
  return {
    label: client.label,
    displayName: client.displayName,
    enabled: client.enabled,
    tools: client.toolsAllowed === null ? 'all' : 'chosen',
    chosen: client.toolsAllowed ?? [],
    ratePerMinute: client.ratePerMinute === null ? '' : String(client.ratePerMinute),
    maxResponseBytes: client.maxResponseBytes === null ? '' : String(client.maxResponseBytes),
    reason: '',
  }
}

/**
 * A whole number as typed, with any thousands commas or spaces: null when the field is empty,
 * NaN when it is not a whole number.
 */
export function parseWhole(text: string): number | null {
  const plain = text.replace(/[\s,]/g, '')
  if (plain === '') return null
  return /^\d+$/.test(plain) ? Number(plain) : Number.NaN
}

export const LABEL_PATTERN = /^[a-z0-9_.-]{1,40}$/

function wholeInRange(
  value: string,
  { min, max }: { min: number; max: number },
  words: { notWhole: string; range: string },
): string | null {
  const parsed = parseWhole(value)
  if (parsed === null) return null
  if (Number.isNaN(parsed)) return words.notWhole
  return parsed < min || parsed > max ? words.range : null
}

/**
 * The client form's checks (contract 9.9), in its words. A new client needs a label nobody has;
 * a client's label never changes, so the check is skipped for one that exists.
 */
export function clientFormSchema({
  isNew,
  takenLabels,
}: {
  isNew: boolean
  takenLabels: readonly string[] | null
}) {
  const problem = (message: string) => ({ message })
  return z
    .object({
      label: z.string().check(
        z.refine((value) => !isNew || value.trim() !== '', problem('Give the AI app a label.')),
        z.refine(
          (value) => !isNew || value.trim() === '' || LABEL_PATTERN.test(value.trim()),
          problem('Use 1 to 40 lowercase letters, digits, dots, dashes or underscores.'),
        ),
        z.refine(
          () => !isNew || takenLabels !== null,
          problem("We couldn't load the AI apps, so we can't check the label is free. Try again."),
        ),
        z.refine(
          (value) => !isNew || !takenLabels?.includes(value.trim()),
          problem('Another AI app has this label. Edit that one in the list instead.'),
        ),
      ),
      displayName: z.string().check(
        z.refine((value) => value.trim() !== '', problem('Give the AI app a name.')),
        z.refine(
          (value) => [...value.trim()].length <= CLIENT_NAME_MAX,
          problem(`Shorten the name to ${CLIENT_NAME_MAX} characters.`),
        ),
      ),
      enabled: z.boolean(),
      tools: z.enum(['all', 'chosen']),
      chosen: z.array(z.string()),
      ratePerMinute: z.string().check(
        z.superRefine((value, context) => {
          const message = wholeInRange(value, RATE_RANGE, {
            notWhole: 'Enter a whole number of requests, or leave it empty.',
            range: `Use ${count(RATE_RANGE.min)} to ${count(RATE_RANGE.max)} requests a minute.`,
          })
          if (message) context.issues.push({ code: 'custom', message, input: value })
        }),
      ),
      maxResponseBytes: z.string().check(
        z.superRefine((value, context) => {
          const message = wholeInRange(value, RESPONSE_BYTES_RANGE, {
            notWhole: 'Enter a whole number of bytes, or leave it empty.',
            range: `Use ${count(RESPONSE_BYTES_RANGE.min)} to ${count(RESPONSE_BYTES_RANGE.max)} bytes.`,
          })
          if (message) context.issues.push({ code: 'custom', message, input: value })
        }),
      ),
      reason: z.string().check(
        z.superRefine((value, context) => {
          const length = [...value.trim()].length
          const over = length - GATEWAY_REASON_MAX
          const message =
            length === 0
              ? 'Give a reason.'
              : over > 0
                ? `Shorten it by ${count(over)} ${over === 1 ? 'character' : 'characters'}.`
                : null
          if (message) context.issues.push({ code: 'custom', message, input: value })
        }),
      ),
    })
    .check(
      z.refine((values) => values.tools === 'all' || values.chosen.length > 0, {
        message: 'Choose at least one tool, or allow every tool that is on.',
        path: ['chosen'],
        // Checked with the other fields, not only once they are all in order.
        when: ({ value }) =>
          typeof value === 'object' &&
          value !== null &&
          'chosen' in value &&
          Array.isArray(value.chosen),
      }),
    )
}

/** The form, once checked, as the service takes it. */
export function toSaveClientInput(values: ClientFormValues): SaveClientInput {
  return {
    label: values.label.trim(),
    displayName: values.displayName.trim(),
    enabled: values.enabled,
    toolsAllowed: values.tools === 'all' ? null : [...values.chosen].sort(),
    ratePerMinute: parseWhole(values.ratePerMinute),
    maxResponseBytes: parseWhole(values.maxResponseBytes),
    reason: values.reason.trim(),
  }
}
