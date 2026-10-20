import { describe, expect, it } from 'vitest'
import { contract } from '../../../src/contract/index.ts'
import type { Session } from '../../../src/server/modules/auth/index.ts'
import { policies } from '../../../src/server/modules/auth/index.ts'
import {
  allowed,
  assistantOperations,
  assistantToolNames,
  assistantTools,
  modelInputSchema,
  proposeOnly,
} from '../../../src/server/modules/assistant/tools.ts'
import { tools as mcpTools } from '../../../src/server/mcp/tools.ts'

/*
  FR-706: the assistant may create only drafts and proposals for the person who uses it. It must
  not accept, publish, edit accepted items, change roles or call administrator functions. These
  tests enumerate everything the assistant can reach.
*/

const administrator: Session = {
  csrfToken: 'x',
  person: {
    id: '00000000-0000-4000-8000-000000000004',
    name: 'Admin',
    initials: 'AD',
    permissions: {
      roles: ['administrator', 'auditor'],
      assignments: [
        { areaId: 'finance', role: 'owner' },
        { areaId: 'finance', role: 'approver' },
      ],
    },
  },
}

// Every operation that decides, publishes, retires, rolls back, stops, administers, or changes
// a submitted proposal or someone else's work. None may be reachable from the assistant.
const forbidden = [
  'review.decide',
  'review.retire',
  'review.recheck',
  'review.proposeRetirement',
  'review.runChecks',
  'editions.rollback',
  'serving.setStop',
  'areas.setState',
  'roles.grant',
  'roles.revoke',
  'assignments.grant',
  'assignments.revoke',
  'settings.set',
  'tools.set',
  'clients.save',
  'proposals.submit',
  'proposals.claim',
  'proposals.handOver',
  'proposals.withdraw',
  'proposals.discard',
  'proposals.saveDraft',
  'proposals.comment',
  'vocabulary.propose',
  'gaps.setStatus',
  'gaps.addNote',
  'gaps.startDraft',
  'evals.runs.approve',
  'evals.runs.start',
  'evals.questions.save',
  'imports.items',
  'operations.run',
]

describe('what the assistant can reach (FR-706)', () => {
  it('offers exactly these tools, each naming one operation', () => {
    expect(assistantToolNames.sort()).toEqual([
      'check_draft',
      'create_draft',
      'domain_overview',
      'estimate_impact',
      'explain_item',
      'find_context',
      'find_overlaps',
      'get_context',
      'improve_question',
      'read_gap',
      'read_item',
      'read_source',
      'search_help',
      'search_web',
      'what_changed',
    ])
    for (const name of assistantToolNames)
      expect(assistantTools[name].operation).toMatch(/^[a-z]+(\.[a-zA-Z_]+)+$/)
  })

  it('reaches only reading MCP tools and read or propose operations, never a forbidden one', () => {
    const contractOperations = Object.entries(contract).flatMap(([group, ops]) =>
      Object.keys(ops).map((op) => `${group}.${op}`),
    )
    for (const operation of forbidden)
      expect(assistantOperations.has(operation), operation).toBe(false)
    for (const name of assistantToolNames) {
      const operation = assistantTools[name].operation
      expect(assistantOperations.has(operation), operation).toBe(true)
      expect(forbidden).not.toContain(operation)
      if (operation.startsWith('mcp.')) {
        const tool = operation.slice(4) as keyof typeof mcpTools
        expect(mcpTools[tool].scope, operation).toBe('read')
      } else if (operation.startsWith('web.')) {
        // The public web: it reads pages and searches, and writes nothing in Heed.
        expect(['web.read_source', 'web.search_web'], operation).toContain(operation)
        expect('web' in assistantTools[name], operation).toBe(true)
      } else {
        expect(contractOperations, operation).toContain(operation)
        expect(['read', 'propose'], operation).toContain(
          policies[operation as keyof typeof policies],
        )
      }
    }
  })

  it('writes through one tool only, which creates a draft and needs the person to confirm it', () => {
    const writing = assistantToolNames.filter(
      (name) => assistantTools[name].operation === 'proposals.create',
    )
    expect(writing).toEqual(['create_draft'])
    expect(
      assistantToolNames.filter(
        (name) => 'confirm' in assistantTools[name] && assistantTools[name].confirm,
      ),
    ).toEqual(['create_draft'])
  })

  it('acts as a propose-only principal, whatever roles the person holds', () => {
    expect(proposeOnly(administrator).permissions).toEqual({ roles: [], assignments: [] })
    for (const operation of [...forbidden, 'settings.list', 'audit.export', 'roles.list'])
      expect(allowed(operation, administrator), operation).toBe(false)
    expect(allowed('proposals.create', administrator)).toBe(true)
    expect(allowed('mcp.get_context', administrator)).toBe(true)
    expect(allowed('web.read_source', administrator)).toBe(true)
    // A web operation the assistant does not have fails closed like any other.
    expect(allowed('web.post_form', administrator)).toBe(false)
    // MCP tools that write anonymous feedback are not the assistant's, and unknown ones fail closed.
    expect(allowed('mcp.report_gap', administrator)).toBe(false)
    expect(allowed('mcp.give_feedback', administrator)).toBe(false)
    expect(allowed('mcp.get_related', administrator)).toBe(false)
    expect(allowed('review.approveEverything', administrator)).toBe(false)
  })
})

describe('the tool definitions the model receives', () => {
  it('describe each input as a JSON object, as the model provider requires', async () => {
    for (const name of assistantToolNames) {
      const schema = (await modelInputSchema(name).jsonSchema) as {
        type?: string
      }
      expect(schema.type, name).toBe('object')
    }
  })
})
