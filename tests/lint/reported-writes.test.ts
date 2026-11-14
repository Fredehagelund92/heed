import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint, Linter } from 'eslint'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'
import reportedWrites, { writesStillToReport } from '../../eslint.reported-writes.js'

/**
 * writes/reported (eslint.reported-writes.js): a write a screen lets go of (`void write(...)`)
 * says what happens when it fails, so a refused write is never reported as done, or not at all.
 */

const root = fileURLToPath(new URL('../../', import.meta.url))
const linter = new Linter({ cwd: root })

/** What the rule says of `code`, wherever it is written. */
const said = (code: string) =>
  linter
    .verify(
      code,
      [
        {
          files: ['**/*.{ts,tsx}'],
          languageOptions: { parser: tseslint.parser },
          plugins: { writes: reportedWrites },
          rules: { 'writes/reported': 'error' },
        },
      ],
      { filename: join(root, 'src/web/pages/example.tsx') },
    )
    .map((message) => message.messageId)

describe('writes/reported', () => {
  it('reports a write let go of with no failed branch', () => {
    expect(said(`void write('invite', { emails })`)).toEqual(['noFailedBranch'])
    expect(said(`void write('invite', { emails }).then(toastInvited)`)).toEqual(['noFailedBranch'])
    expect(said(`void write('setTool', i).then(a).finally(b)`)).toEqual(['noFailedBranch'])
  })

  it('accepts a write whose chain says what happens when it fails', () => {
    expect(said(`void write('setTool', i).catch(say)`)).toEqual([])
    expect(said(`void write('setTool', i).then(ok).catch(say)`)).toEqual([])
    expect(said(`void write('setTool', i).catch(say).then(next)`)).toEqual([])
    expect(said(`void write('setTool', i).then(ok, say)`)).toEqual([])
  })

  it('leaves a write that is awaited or handed on, and other calls let go of', () => {
    expect(said(`async function a() { await write('setTool', i) }`)).toEqual([])
    expect(said(`reported.act(() => write('invite', { emails }))`)).toEqual([])
    expect(said(`void navigator.clipboard.writeText(key)`)).toEqual([])
  })

  it('runs on the web app, through the repository config', async () => {
    const eslint = new ESLint({
      cwd: root,
      overrideConfig: { languageOptions: { parserOptions: { projectService: false } } },
      ruleFilter: ({ ruleId }) => ruleId === 'writes/reported',
    })
    const [result] = await eslint.lintText(`void write('invite', { emails })`, {
      filePath: join(root, 'src/web/pages/settings-agents.tsx'),
    })
    expect(result?.messages.map((message) => message.ruleId)).toEqual(['writes/reported'])
  })

  it('lists only screens that still let a write go unreported', () => {
    const clean = writesStillToReport.filter(
      (file) => said(readFileSync(join(root, file), 'utf8')).length === 0,
    )
    expect(clean, 'take these off writesStillToReport').toEqual([])
  })
})
