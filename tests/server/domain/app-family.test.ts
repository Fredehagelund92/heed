import { expect, it } from 'vitest'
import { appFamilies, appFamilyNames, appFamilyOf } from '../../../src/domain/app-family.ts'

it('maps the names AI apps send to a family from the fixed list (FR-410)', () => {
  const cases: [unknown, string][] = [
    ['claude-code', 'claude_code'],
    ['Claude Code', 'claude_code'],
    ['claude-ai', 'claude_ai'],
    ['Anthropic/ClaudeAI', 'claude_ai'],
    ['openai-mcp', 'chatgpt'],
    ['ChatGPT', 'chatgpt'],
    ['codex-mcp-client', 'codex'],
    ['cursor-vscode', 'cursor'],
    ['Visual Studio Code', 'vscode_copilot'],
    ['Visual Studio Code - Insiders', 'vscode_copilot'],
    ['windsurf-client', 'windsurf'],
    ['gemini-cli-mcp-client', 'gemini_cli'],
    ['goose', 'goose'],
    ['heed-eval-runner', 'heed'],
    ['  CLAUDE-CODE  ', 'claude_code'],
  ]
  for (const [name, family] of cases) expect(appFamilyOf(name), String(name)).toBe(family)
})

it('makes any other name another app, and a missing one unknown, so free text never passes', () => {
  for (const name of ['Alice Smith private agent', 'claude-codex-clone', 'my claude', 'heed', 'x'])
    expect(appFamilyOf(name), name).toBe('other')
  for (const name of [undefined, null, '', '   ', 42, { name: 'claude-code' }])
    expect(appFamilyOf(name)).toBe('unknown')
  // Whatever arrives, the answer is on the list the database allows (mcp_requests).
  for (const name of ['a'.repeat(10_000), 'claude-code' + 'x'.repeat(200), '\u0000'])
    expect(appFamilies).toContain(appFamilyOf(name))
})

it('names every family in words', () => {
  expect(Object.keys(appFamilyNames).sort()).toEqual([...appFamilies].sort())
})
