import { describe, expect, it } from 'vitest'
import * as z from 'zod'
import type { RecordsItem } from '../../src/domain/records.ts'
import { toolSchemaDigest, toolNames } from '../../src/server/mcp/tools.ts'
import {
  askToolDefinitions,
  askToolNames,
  createAskTools,
  type ToolReads,
} from '../../src/server/modules/answer/index.ts'
import {
  queryRecords,
  recordsInput,
  type RecordsTable,
} from '../../src/server/modules/answer/tool-records.ts'

/*
  Ask's tools without a database (FR-718 to FR-720): the registry the loop will offer, what it
  leaves unchanged for agents, the errors an input that does not fit gets, and the records tool's
  counting, ranking and denominators, by code. The tools as each person, on the real service, are
  tests/web/integration/ask-tools.test.ts.
*/

/** Reads that fail if a test reaches them: the registry needs none until a tool runs. */
const unread = (): never => {
  throw new Error('not read here')
}
const noReads: ToolReads = {
  bundle: unread,
  index: unread,
  records: unread,
  areas: unread,
  people: unread,
  catalogue: unread,
  glossary: unread,
  conflicts: unread,
  inbox: unread,
  asked: unread,
  today: '2026-10-23',
  now: '2026-10-23T12:00:00.000Z',
}

describe("Ask's tool registry", () => {
  it('gives every tool a description and schemas the loop can send, in the AI SDK shape', () => {
    expect(Object.keys(askToolDefinitions)).toEqual([...askToolNames])
    for (const name of askToolNames) {
      const { description, input, output } = askToolDefinitions[name]
      expect(description.length, name).toBeGreaterThan(80)
      expect(z.toJSONSchema(input, { io: 'input' }), name).toMatchObject({ type: 'object' })
      expect(z.toJSONSchema(output), name).toMatchObject({ type: 'object' })
    }
    const tools = createAskTools(noReads).ai()
    expect(Object.keys(tools)).toEqual([...askToolNames])
    for (const name of askToolNames) {
      expect(tools[name].description).toBe(askToolDefinitions[name].description)
      expect(tools[name].inputSchema).toBe(askToolDefinitions[name].input)
      expect(typeof tools[name].execute).toBe('function')
    }
  })

  it('leaves every MCP tool as agents have it (FR-718.5)', () => {
    // A deliberate change to an MCP tool changes these; Ask's tools never do. The engine's own
    // digest is held in tests/server/ask-plan-cases.test.ts.
    expect(toolNames).toEqual([
      'get_context',
      'find_context',
      'read_context',
      'report',
      'suggest_context',
      'get_related',
    ])
    expect(toolSchemaDigest).toBe(
      '63fd1e52a96b1a806f6250a734e31ed87c97662f9f88e20b9295b1655fd1d014',
    )
    // No Ask tool writes, reports or suggests: none is an agent tool that is not a read.
    expect(askToolNames.filter((n) => ['report', 'suggest_context'].includes(n))).toEqual([])
  })

  it('refuses an input that does not fit, saying which part, and reads nothing', async () => {
    const tools = createAskTools(noReads)
    const refusal = async (name: 'records' | 'read_context' | 'find_context', input: object) => {
      const result = await tools.run(name, input)
      expect(result.ids).toEqual([])
      return 'error' in result ? result.error : null
    }
    expect(await refusal('records', { show: 'everything' })).toMatch(
      /^The input does not fit records: show /,
    )
    expect(await refusal('read_context', { id: 'not an id' })).toMatch(
      /^The input does not fit read_context: id /,
    )
    expect(
      await refusal('find_context', { words: 'orders', widen: { without: 'market' } }),
    ).toMatch(/widen\.without/)
  })
})

const item = (over: Partial<RecordsItem> & Pick<RecordsItem, 'id' | 'title'>): RecordsItem => ({
  kind: 'event',
  areaId: 'area_sales',
  status: 'live',
  reviewDate: null,
  checkFlag: null,
  publishedAt: '2026-09-01T09:00:00.000Z',
  changedAt: '2026-09-01T09:00:00.000Z',
  checkedAt: '2026-09-01T00:00:00.000Z',
  archivedAt: null,
  owners: [],
  metrics: ['metric:orders'],
  values: [],
  ...over,
})
const table: RecordsTable = {
  items: [
    item({
      id: 'itm_a',
      title: 'Norway stop',
      values: ['val:market/norway'],
      checkedAt: '2026-10-03T00:00:00.000Z',
    }),
    item({ id: 'itm_b', title: 'Card only', kind: 'note', status: 'due', checkedAt: null }),
    item({
      id: 'itm_c',
      title: 'Old campaign',
      areaId: 'area_marketing',
      status: 'archived',
      metrics: ['metric:roas'],
    }),
    item({
      id: 'itm_d',
      title: 'Store credit',
      kind: 'note',
      values: ['val:market/norway', 'val:market/sweden'],
      publishedAt: '2026-10-20T08:00:00.000Z',
      checkedAt: '2026-08-01T00:00:00.000Z',
    }),
  ],
  areas: [
    { id: 'area_sales', name: 'Sales' },
    { id: 'area_marketing', name: 'Marketing' },
  ],
  nameOf: (key) =>
    ({
      'metric:orders': 'Orders',
      'metric:roas': 'Return on ad spend',
      'val:market/norway': 'Norway',
      'val:market/sweden': 'Sweden',
    })[key] ?? key,
  isShown: (key) => key !== 'metric:roas' && key !== 'val:market/sweden',
  keysOf: (names) => {
    const known: Record<string, string> = { orders: 'metric:orders', norway: 'val:market/norway' }
    return {
      keys: names.flatMap((n) => (known[n.toLowerCase()] ? [known[n.toLowerCase()]!] : [])),
      unknown: names.filter((n) => !known[n.toLowerCase()]).map((n) => `"${n}" names nothing.`),
    }
  },
}
const read = (input: object) => queryRecords(recordsInput.parse(input), table)
/** A records answer, which these inputs must get. */
const query = (input: object) => {
  const found = read(input)
  if ('error' in found) throw new Error(found.error)
  return found
}

describe('the records tool (FR-720.3)', () => {
  it('never names a metric or value Definitions hides, counting it as unnamed', () => {
    const named = (by: 'metric' | 'value') => {
      const groups = query({ group_by: by, show: 'count' }).groups
      return JSON.stringify(groups)
    }
    expect(named('metric')).not.toMatch(/roas|Return on ad spend/)
    expect(query({ group_by: 'metric', show: 'count' }).groups?.rows).toContainEqual({
      name: 'no metric named',
      count: 1,
    })
    expect(named('value')).not.toMatch(/sweden|Sweden/)
  })

  it('says what every count is out of, by the domain and the statuses asked', () => {
    expect(query({ show: 'count' })).toMatchObject({
      count: 4,
      counted: '4 of 4 context items you may read',
      byStatus: { live: 2, due: 1, archived: 1 },
    })
    expect(query({ show: 'count', status: ['live', 'due'], about: ['Norway'] })).toMatchObject({
      count: 2,
      counted: '2 of 3 published context items you may read',
    })
    expect(query({ show: 'count', domain: 'sales', status: ['due'] })).toMatchObject({
      counted: '1 of 1 context item due for a check in Sales you may read',
    })
    expect(query({ show: 'count', status: ['live', 'archived'] })).toMatchObject({
      counted: '3 of 3 live or archived context items you may read',
    })
  })

  it('ranks in code, with an item that has no date of the kind last, either way', () => {
    const ranked = (order: string) =>
      query({ sort_by: 'last_checked', order }).items.map((i) => [i.rank, i.id])
    expect(ranked('newest_first')).toEqual([
      [1, 'itm_a'],
      [2, 'itm_c'],
      [3, 'itm_d'],
      [4, 'itm_b'],
    ])
    expect(ranked('oldest_first')).toEqual([
      [1, 'itm_d'],
      [2, 'itm_c'],
      [3, 'itm_a'],
      [4, 'itm_b'],
    ])
    expect(query({ limit: 2 })).toMatchObject({ more: 2, order: 'by title' })
  })

  it('counts by dates, kinds and groups, saying when groups add up to more', () => {
    expect(
      query({ dated: { field: 'published', from: '2026-10-01', to: '2026-10-20' } }),
    ).toMatchObject({ count: 1, filters: { period: 'published 1-20 Oct 2026' } })
    expect(query({ kinds: ['rule'], show: 'count' })).toMatchObject({ count: 2 })
    expect(query({ group_by: 'value', show: 'count' }).groups).toEqual({
      by: 'value',
      note: 'An item that names several counts under each, so the groups add up to more than 4 items.',
      rows: [
        { name: 'Norway', count: 2 },
        { name: 'no market or value named', count: 2 },
      ],
    })
  })

  it('names what it does not know instead of counting nothing', () => {
    expect(read({ domain: 'Sails' })).toEqual({
      error: 'No domain is called "Sails". The domains are Sales, Marketing.',
    })
    expect(read({ about: ['Orders', 'Atlantis'] })).toEqual({ error: '"Atlantis" names nothing.' })
  })
})
