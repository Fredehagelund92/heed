import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/errors'
import { createMockApi } from '@/api/mock-api'
import { createMockWorkflow, MOCK_MCP_ADDRESS } from '@/api/mock-workflow'
import { getFixtureItems, versionDays } from '@/mocks/fixtures'
import { areas, FIXTURE_TODAY, people, roleGrants, vocabulary } from '@/mocks/reference-data'

const workflow = createMockWorkflow({
  today: FIXTURE_TODAY,
  areas,
  people,
  vocabulary,
  items: getFixtureItems,
  approvers: roleGrants.approvers,
  administrators: roleGrants.administrators,
  versionDays,
})
const as = (personId: string) =>
  createMockApi({ personId: () => personId, workflow: () => Promise.resolve(workflow) })
const maria = as('per_maria')
const known = new Set(areas.map((area) => area.id))

// An item an agent gets: accepted, for everyone, in any domain, and not high risk unchecked.
const served = getFixtureItems().find(
  (item) =>
    item.status === 'accepted' &&
    item.audience.kind === 'everyone' &&
    known.has(item.areaId) &&
    item.riskLevel !== 'high' &&
    item.scope.metrics.length > 0,
)!
const market = served.scope.dimensionValues.find((value) => value.dimension === 'market')!
const scope = {
  metrics: [`metric:${served.scope.metrics[0]}`],
  dimension_filters: [{ dimension: 'dim:market', values: [`val:market/${market.value}`] }],
  window: { from: served.validity.start, to: served.validity.start },
}

describe('What an agent would get, in the mock', () => {
  it("answers get_context's reply for a scope, with the live edition, the size and no delivery", async () => {
    const tried = await maria.tryIt(scope)
    expect(['matched', 'conflict']).toContain(tried.result.status)
    expect(tried.result.items?.map((item) => item.id)).toContain(served.id)
    expect(tried.result).not.toHaveProperty('delivery_id')
    expect(tried.result.edition).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/)
    expect(tried.result.tool_schema_digest).toMatch(/^[0-9a-f]{64}$/)
    expect(tried.result.instructions).toMatch(/^State the documented fact/)
    // What the AI app may tell the person, in the service's own sentences (FR-344).
    expect(tried.result.say).toMatch(/^\d+ facts? appl(y|ies) to .+\. Only that was checked\./)
    expect(Object.keys(tried.result)[0]).toBe('say')
    expect(tried.result.check_report.statements).toEqual([
      'No match does not prove that no caveat exists.',
    ])
    expect(tried.bytes).toBeGreaterThan(JSON.stringify(tried.result).length)
    expect(tried.limit).toBe(100_000)
  })

  it('resolves the scope as get_context does: without dates at today, which it says', async () => {
    const open = await maria.tryIt({ metrics: scope.metrics })
    expect(open.result).toMatchObject({
      scope_used: { window: { start: '2026-10-07', end: '2026-10-08' } },
      assumed_date: { date: '2026-10-07', time_zone: 'UTC', reason: 'no date given' },
      options: [],
    })
    expect(open.result.instructions).toContain('I assumed today, 7 October 2026')
    // The person hears the same sentence, once, in what the AI app may say.
    expect(open.result.say).toMatch(
      /I assumed today, 7 October 2026\. Tell me if you meant a different period\.$/,
    )
    const unknown = await maria.tryIt({ ...scope, metrics: ['metric:no_such_metric'] })
    expect(unknown.result.status).toBe('need_more_detail')
    expect(unknown.result.options?.[0]).toMatchObject({
      field: 'metrics',
      input: 'metric:no_such_metric',
    })
    const before = await maria.tryIt({ ...scope, window: { from: '1999-01-01', to: '1999-01-31' } })
    expect(before.result).toMatchObject({ status: 'no_match', items: [] })
    expect(before.result.say).toMatch(
      /^Nothing is written down for .+ in January 1999\. Only that was checked\.$/,
    )
    expect(before.result.next).toMatch(/^That does not prove there is no caveat/)
  })

  it('withholds what agents do not get: an item stopped by an administrator', async () => {
    const admin = as(roleGrants.administrators[0])
    await admin.setStop({ scope: 'item', itemId: served.id, on: true, reason: 'Checking it' })
    const stopped = await maria.tryIt(scope)
    expect(stopped.result.items?.map((item) => item.id)).not.toContain(served.id)
    expect(stopped.result.check_report.withheld).toBeGreaterThan(0)
    await admin.setStop({ scope: 'item', itemId: served.id, on: false, reason: 'Checked' })
    expect((await maria.tryIt(scope)).result.items?.map((item) => item.id)).toContain(served.id)
  })

  it('says how each fact was reviewed by role, and names who only behind sign-in (FR-326)', async () => {
    const tried = await maria.tryIt(scope)
    const item = tried.result.items!.find((entry) => entry.id === served.id)!
    const area = areas.find((candidate) => candidate.id === served.areaId)!
    expect(item.owner.role).toBe(`the owner of ${area.name}`)
    expect(item.reviewed).toEqual({
      accepted_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
      accepted_by: `the owner of ${area.name}`,
      in_edition: expect.stringMatching(/^\d{4}-\d{2}-\d{2}\.\d+$/) as string,
    })
    // No person's name reaches what an agent gets.
    for (const person of people) expect(JSON.stringify(tried.result)).not.toContain(person.name)
    // Inside Heed the same review names who accepted it, with the checks it passed.
    const [review] = await maria.getServedReviews([served.id, 'itm_zzzzzzzz'])
    expect(review).toMatchObject({
      id: served.id,
      version: served.version,
      acceptedOn: item.reviewed!.accepted_on,
      acceptedAs: 'owner',
      areaId: served.areaId,
      personId: served.ownerId,
      edition: item.reviewed!.in_edition,
    })
    expect(review!.checks.slice(0, 3)).toEqual(['format', 'matching', 'delivery'])
  })

  it('takes no question and no audience, as the service refuses them', async () => {
    for (const extra of [{ question: 'Why did orders drop?' }, { groups: ['board'] }]) {
      const refused = await maria.tryIt({ ...scope, ...extra }).catch((error: unknown) => error)
      expect(refused).toBeInstanceOf(ApiError)
      expect((refused as ApiError).kind).toBe('bad-request')
    }
  })
})

describe('Connect an AI app, in the mock', () => {
  it('gives every person the address, every tool with its switch and the clients switched on', async () => {
    const off = ['draft_context', 'get_related']
    expect(await maria.getConnectInfo()).toEqual({
      address: MOCK_MCP_ADDRESS,
      tools: [
        'domain_overview',
        'draft_context',
        'find_context',
        'get_context',
        'get_related',
        'give_feedback',
        'improve_question',
        'read_item',
        'report_gap',
        'search_context',
        'search_help',
        'what_changed',
      ].map((tool) => ({
        tool,
        enabled: !off.includes(tool),
        personOnly: tool === 'draft_context',
      })),
      clients: [{ label: 'claude-code', name: 'Claude Code with a token' }],
      signIn: true,
    })
  })

  it('follows the gateway: a client switched on is offered, a tool switched off is marked off', async () => {
    const admin = as(roleGrants.administrators[0])
    await admin.saveClient({
      label: 'cursor',
      displayName: 'Cursor',
      toolsAllowed: null,
      ratePerMinute: 60,
      maxResponseBytes: null,
      enabled: true,
      reason: 'The team uses Cursor',
    })
    await admin.setTool({ tool: 'report_gap', enabled: false, reason: 'Not now' })
    const info = await maria.getConnectInfo()
    expect(info.clients).toEqual([
      { label: 'claude-code', name: 'Claude Code with a token' },
      { label: 'cursor', name: 'Cursor' },
    ])
    expect(info.tools).toContainEqual({ tool: 'report_gap', enabled: false, personOnly: false })
  })
})
