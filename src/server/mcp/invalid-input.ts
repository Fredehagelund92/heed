import * as z from 'zod'
import { notLookedUp } from '../../domain/say.ts'
import { listedTool, toolInputSchema, type ListedName } from './tools.ts'

/*
  A tool call whose arguments do not fit the tool's input schema (FR-345).
  The SDK would answer with its own validation text, which names a field but not what to send, and
  the request log would count the call as Heed's error. Instead the tool's schema lets the call
  through marked, and the tool answers with an error a model can correct from: what was wrong with
  each field, the fields the tool takes, and one valid call. The request log counts it as
  `invalid_input`, apart from `error`. Nothing here repeats what the model sent: a field is named,
  never its value, so no question text travels back into a record.
*/

const question = 'How did orders do in Norway in August 2026?'
const searchCall = { query: 'orders Norway' }
const draftCall = {
  text: 'Orders in Norway fell on 3 Aug 2026 while the payment provider was down.',
  scope: {
    metrics: ['orders'],
    dimension_filters: [{ dimension: 'market', values: ['Norway'] }],
  },
}
const scopedCall = {
  question,
  metrics: ['orders'],
  dimension_filters: [{ dimension: 'market', values: ['Norway'] }],
  window: { from: '2026-08-01', to: '2026-08-31' },
}

/** One valid call of each tool and each deprecated id, as the error shows it. Each is checked against its schema. */
export const exampleCalls: Record<ListedName, Record<string, unknown>> = {
  get_context: scopedCall,
  find_context: { query: 'GMV Spain' },
  read_context: { id: 'itm_0a1b2c3d' },
  report: { kind: 'wrong', reply_id: '0f8fad5b-d9cb-469f-a165-70867728950e' },
  suggest_context: draftCall,
  get_related: { id: 'itm_0a1b2c3d' },
  get_facts: scopedCall,
  find_facts: { query: 'GMV Spain' },
  search_facts: searchCall,
  search_context: searchCall,
  read_item: { id: 'itm_0a1b2c3d' },
  report_gap: {
    question,
    metrics: ['orders'],
    window: { from: '2026-08-01', to: '2026-08-31' },
  },
  give_feedback: { delivery_id: '0f8fad5b-d9cb-469f-a165-70867728950e', verdict: 'missing' },
  draft_context: draftCall,
}

/** A Standard Schema issue, with what Zod adds to it when it is there. */
type Issue = {
  message: string
  path?: readonly (PropertyKey | { key: PropertyKey })[] | undefined
  code?: string
  keys?: readonly string[]
  expected?: string
}
const marked = Symbol('invalid input')
type Marked = { [marked]: readonly Issue[] }

/**
 * A tool's input schema for the MCP server that never refuses: arguments that do not fit come
 * through marked with their issues, so the tool answers them itself (`invalidInputOf`). The JSON
 * Schema a client reads is the tool's own.
 */
export function lenientInputSchema(name: ListedName) {
  const schema = toolInputSchema(name)
  const standard = schema['~standard']
  return {
    '~standard': {
      ...standard,
      async validate(value: unknown) {
        const result = await standard.validate(value)
        return result.issues?.length
          ? { value: { [marked]: result.issues as readonly Issue[] } satisfies Marked }
          : result
      },
    },
  }
}

/** The issues of arguments that did not fit, or undefined for arguments that did. */
export function invalidInputOf(args: unknown): readonly Issue[] | undefined {
  return typeof args === 'object' && args !== null && marked in args
    ? (args as Marked)[marked]
    : undefined
}

const fieldOf = (issue: Issue) =>
  (issue.path ?? [])
    .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
    .join('.')
const quoted = (names: readonly string[]) => names.map((name) => `"${name}"`).join(', ')

/** One issue as a model reads it: the field, and what it needs; never the value sent. */
export function problemOf(issue: Issue): { field: string; problem: string } {
  const field = fieldOf(issue)
  if (issue.code === 'unrecognized_keys' && issue.keys?.length)
    return {
      field,
      problem: `unknown ${issue.keys.length === 1 ? 'field' : 'fields'} ${quoted(issue.keys)}${field ? ` in ${field}` : ''}`,
    }
  const message = issue.message.replace(/^Invalid input: /, '')
  if (issue.code === 'invalid_type' && /received undefined$/.test(message))
    return {
      field,
      problem: `${field} is missing${issue.expected ? ` (a ${issue.expected})` : ''}`,
    }
  return { field, problem: `${field || 'the arguments'}: ${message}` }
}

/** The fields a tool takes, the required ones first and marked so. */
export function fieldsOf(name: ListedName): string[] {
  const json = z.toJSONSchema(listedTool(name).inputSchema, { io: 'input' }) as {
    properties?: Record<string, unknown>
    required?: string[]
  }
  const required = json.required ?? []
  const names = Object.keys(json.properties ?? {})
  return [
    ...required.map((field) => `${field} (required)`),
    ...names.filter((field) => !required.includes(field)),
  ]
}

/** At most this many problems are listed; a model fixes those and calls again. */
const MAX_PROBLEMS = 5

/**
 * The issues worth saying: after a field of the wrong type, Zod still checks its length as if it
 * were the right one ("Too big: expected string to have <=10 characters" for a list sent as a
 * string), which only misleads, so a field's other issues are dropped after its type issue.
 */
function distinct(issues: readonly Issue[]): Issue[] {
  const mistyped = new Set(issues.filter((i) => i.code === 'invalid_type').map(fieldOf))
  return issues.filter((i) => i.code === 'invalid_type' || !mistyped.has(fieldOf(i)))
}

/** The error a tool answers arguments that do not fit with (isError, status `invalid_input`). */
export function invalidInputResult(name: ListedName, all: readonly Issue[]) {
  const issues = distinct(all)
  const problems = issues.slice(0, MAX_PROBLEMS).map(problemOf)
  const more = issues.length - problems.length
  const takes = fieldsOf(name)
  const example = exampleCalls[name]
  // The person hears that nothing was looked up; the agent reads what to fix and one valid call.
  const say = `${notLookedUp} The request was missing something or had a value that doesn't fit.`
  const next = [
    `${name} could not read its arguments: ${problems.map((p) => p.problem).join('; ')}${more > 0 ? `; and ${more} more` : ''}.`,
    'Nothing was checked or saved, so this says nothing about what is written down.',
    `It takes ${takes.join(', ')}.`,
    `Call it again with arguments like ${JSON.stringify(example)}`,
  ].join(' ')
  return {
    content: [{ type: 'text' as const, text: `${say} ${next}` }],
    structuredContent: { say, next, status: 'invalid_input', problems, takes, example },
    isError: true as const,
  }
}
