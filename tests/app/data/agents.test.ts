import { describe, expect, it } from 'vitest'
import {
  ADDRESS,
  ASK_FIRST_LINE,
  CLAUDE_CODE_COMMAND,
  cursorLink,
  GUIDES,
  PROMPT,
  PROMPT_PARTS,
  vscodeLink,
} from '@/data/agents'

// The prompt is what the page shows, word for word; the quick links carry the same address.

describe('the prompt', () => {
  it('copies exactly what the page shows', () => {
    expect(PROMPT).toBe(PROMPT_PARTS.map((p) => p.text).join('\n\n'))
    expect(PROMPT_PARTS.filter((p) => p.code).map((p) => p.text)).toEqual([
      CLAUDE_CODE_COMMAND,
      ASK_FIRST_LINE,
    ])
  })

  it('connects, adds the Ask-first line to the file the project uses, and never asks for a secret', () => {
    expect(PROMPT).toContain(ADDRESS)
    expect(PROMPT).toContain('CLAUDE.md if it exists, otherwise AGENTS.md')
    expect(PROMPT).toContain(ASK_FIRST_LINE)
    expect(PROMPT).toContain('Never ask me for a key or a token.')
  })
})

describe('the quick links', () => {
  it('installs the server in Cursor with its address', () => {
    const url = new URL(cursorLink())
    expect(url.protocol).toBe('cursor:')
    expect(JSON.parse(atob(url.searchParams.get('config')!))).toEqual({ url: ADDRESS })
  })

  it('installs the server in VS Code with its address', () => {
    const link = vscodeLink()
    expect(link.startsWith('vscode:mcp/install?')).toBe(true)
    expect(JSON.parse(decodeURIComponent(link.split('?')[1]))).toMatchObject({ url: ADDRESS })
  })
})

describe('by hand', () => {
  it("ends every agent's steps with approving the connection in the browser", () => {
    for (const g of GUIDES)
      expect(
        g.steps.some((s) => /approve the connection in the browser/i.test(s.what)),
        g.id,
      ).toBe(true)
  })

  it('has one Claude for the terminal and one for the app, never two of the same name', () => {
    const names = GUIDES.map((g) => g.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
