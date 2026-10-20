import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider'
import { generateText, stepCountIs } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { expect, it } from 'vitest'
import { assistantRelatedTool, relatedCitations } from '../../../src/server/mcp/related-tool.ts'
import { createToolService } from '../../../src/server/mcp/service.ts'
import type { EditionSource } from '../../../src/server/modules/editions/index.ts'
import { bundle, memoryStore } from './fixtures.ts'

function setup(enabled: boolean) {
  const data = bundle(),
    item = data.items[0]!
  data.items.push({ ...item, id: 'itm_neighbour1', title: 'Tax change' })
  data.links.push(
    { from_item: 'itm_neighbour1', rel: 'mentions', to_kind: 'item', to_id: item.id, label: 'x' },
    { from_item: item.id, rel: 'mentions', to_kind: 'item', to_id: 'itm_oldrule001', label: 'y' },
  )
  data.retired.push({
    id: 'itm_oldrule001',
    areaId: 'finance',
    audience: null,
    validity: { start: '2026-01-01', end: '2026-03-01' },
    replacedBy: null,
  })
  const policy = {
    client: null,
    tools: enabled ? ['get_related'] : [],
    limits: {},
    rates: { person: 30, client: 120 },
    about: '',
  }
  const source: EditionSource = {
    bundle: () => Promise.resolve(data),
    policy: () => Promise.resolve(policy),
  }
  return { source, policy, item }
}
const now = () => new Date('2026-10-07T12:00:00Z')
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

it('is not offered while get_related is switched off', async () => {
  expect(await assistantRelatedTool(setup(false).source, { now })).toBeNull()
})

it('runs the MCP tool in process and lets the assistant cite only items in service', async () => {
  const { source, policy, item } = setup(true)
  const related = await assistantRelatedTool(source, { now })
  expect(related).not.toBeNull()
  let step = 0
  const model = new MockLanguageModelV4({
    doGenerate: (): Promise<LanguageModelV4GenerateResult> =>
      Promise.resolve(
        step++ === 0
          ? {
              content: [
                {
                  type: 'tool-call',
                  toolCallId: 'c1',
                  toolName: 'get_related',
                  input: JSON.stringify({ id: item.id }),
                },
              ],
              finishReason: { unified: 'tool-calls', raw: 'tool_use' },
              usage,
              warnings: [],
            }
          : {
              content: [{ type: 'text', text: 'See [itm_neighbour1] and [itm_oldrule001].' }],
              finishReason: { unified: 'stop', raw: 'end_turn' },
              usage,
              warnings: [],
            },
      ),
  })
  const result = await generateText({
    model,
    prompt: 'What relates to the closure?',
    tools: { get_related: related! },
    stopWhen: stepCountIs(3),
  })
  const output: unknown = result.steps[0]!.toolResults[0]!.output
  // The same reply as the MCP tool gives an agent for the same input and edition.
  const mcp = await createToolService(source, memoryStore().store, now)(
    'get_related',
    { id: item.id },
    { client: 'assistant', scopes: ['read'], caller: 'agent', canSelectEdition: false },
    100000,
    () => {},
  )
  expect(output).toEqual(mcp.structuredContent)
  const citable = relatedCitations(output)
  expect(citable.sort()).toEqual(['itm_neighbour1', item.id])
  // The citation check of the turn: the retired rule's marker is not a source.
  const cited = [...result.text.matchAll(/\[(itm_[a-z0-9]+)\]/g)].map((m) => m[1]!)
  expect(cited.filter((id) => !citable.includes(id))).toEqual(['itm_oldrule001'])
  // Switched off mid-conversation: the next call says so instead of answering.
  policy.tools = []
  const off = (await related!.execute!(
    { id: item.id },
    { toolCallId: 'c2', messages: [], context: {} },
  )) as {
    status: string
  }
  expect(off.status).toBe('check_failed')
  expect(relatedCitations(off)).toEqual([])
})
