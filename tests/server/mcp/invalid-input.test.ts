import { expect, it } from 'vitest'
import {
  exampleCalls,
  fieldsOf,
  invalidInputOf,
  invalidInputResult,
  lenientInputSchema,
  problemOf,
} from '../../../src/server/mcp/invalid-input.ts'
import {
  deprecatedToolAliases,
  listedTool,
  toolNames,
  type ListedName,
} from '../../../src/server/mcp/tools.ts'

it('shows each tool and each old id a call that its own schema accepts', () => {
  const listed = [...toolNames, ...Object.keys(deprecatedToolAliases)] as ListedName[]
  expect(Object.keys(exampleCalls).sort()).toEqual([...listed].sort())
  for (const name of listed)
    expect(listedTool(name).inputSchema.safeParse(exampleCalls[name]).success, name).toBe(true)
})

it('lets arguments that fit through as they are, and marks the rest with their issues', async () => {
  const schema = lenientInputSchema('get_facts')['~standard']
  const fits = await schema.validate({ question: 'Orders' })
  expect(fits).toMatchObject({ value: { question: 'Orders' } })
  expect(invalidInputOf((fits as { value: unknown }).value)).toBeUndefined()
  const wrong = await schema.validate({ metric: 'orders' })
  expect('issues' in wrong && wrong.issues).toBeFalsy()
  expect(invalidInputOf((wrong as { value: unknown }).value)?.length).toBeGreaterThan(0)
})

it('names the field and what it needs, never the value sent', async () => {
  const schema = lenientInputSchema('get_facts')['~standard']
  const secret = 'Alice asked about orders'
  const marked = (await schema.validate({ question: 42, metrics: secret, note: secret })) as {
    value: unknown
  }
  const issues = invalidInputOf(marked.value)!
  const result = invalidInputResult('get_facts', issues)
  // One problem per field: a list sent as a string is not also "too long".
  expect(result.structuredContent.problems.map((p) => p.problem)).toEqual([
    'question: expected string, received number',
    'metrics: expected array, received string',
    'unknown field "note"',
  ])
  expect(problemOf(issues[0]!)).toEqual({
    field: 'question',
    problem: 'question: expected string, received number',
  })
  expect(JSON.stringify(result)).not.toContain('Alice')
  expect(result).toMatchObject({
    isError: true,
    structuredContent: { status: 'invalid_input', example: exampleCalls.get_facts },
  })
  // The person hears that nothing was looked up; the model reads what to fix, in the same text.
  expect(result.structuredContent.say).toBe(
    "Nothing was looked up yet. The request was missing something or had a value that doesn't fit.",
  )
  expect(result.content[0]!.text).toBe(
    `${result.structuredContent.say} ${result.structuredContent.next}`,
  )
  expect(result.structuredContent.next).toMatch(/^get_facts could not read its arguments: /)
})

it('lists the required fields first', () => {
  expect(fieldsOf('give_feedback')).toEqual([
    'delivery_id (required)',
    'verdict (required)',
    'note',
  ])
})
