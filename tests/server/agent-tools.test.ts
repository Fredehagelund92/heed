import { describe, expect, it } from 'vitest'
import { agentToolNames, toolScopes, toolsFor, toolsWith } from '../../src/domain/agents.ts'
import { toolNames, tools } from '../../src/server/mcp/tools.ts'

/*
  The switches Settings shows per agent are the MCP server's own tools (FR-420): the same names,
  each needing the scope the server checks, so a switch never stands for a tool that is not there
  and the consent a switch needs is the consent the server asks for.
*/

describe('the tools an agent may call', () => {
  it('are the tools the MCP server offers, each with the scope it checks', () => {
    expect([...agentToolNames]).toEqual(toolNames)
    for (const name of toolNames) expect(toolScopes[name]).toBe(tools[name].scope)
  })

  it('never give an access key suggest_context, which needs a person', () => {
    expect(toolsFor('key')).not.toContain('suggest_context')
    expect(toolsFor('app')).toEqual([...agentToolNames])
  })

  it('are those switched on that the scopes allow: a switch never widens consent', () => {
    expect(toolsWith(['get_context', 'suggest_context', 'report'], ['read', 'feedback'])).toEqual([
      'get_context',
      'report',
    ])
    expect(toolsWith([], ['read', 'feedback', 'propose'])).toEqual([])
  })
})
