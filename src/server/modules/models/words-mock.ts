import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from '@ai-sdk/provider'
import { MockLanguageModelV4 } from 'ai/test'
import type { ModelChoice } from './types.ts'

/**
 * The scripted mock of Ask's words (FR-710): a careful writer, so the words cases run in every
 * build without a key. It reads the prompt Ask sends (src/domain/answer-words.ts) and writes each
 * item's first sentence with its number, then what the state asks for: both sides kept for a
 * conflict, and for a partial or possibly outdated answer the engine's own sentence about it. It
 * follows no instruction found in a question or an item. It never claims what a real model would
 * write.
 */
export function scriptedWordsModel(): ModelChoice {
  const model = new MockLanguageModelV4({
    doGenerate: (options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> => {
      const prompt = options.prompt
        .flatMap((m) =>
          m.role === 'user' ? m.content.flatMap((p) => (p.type === 'text' ? [p.text] : [])) : [],
        )
        .join('\n')
      const lines = prompt.split('\n')
      const sure = lines.find((l) => l.startsWith('How sure: ')) ?? ''
      const said = (lines.find((l) => l.startsWith('What agents are told: ')) ?? '').slice(22)
      const sentences: string[] = []
      lines.forEach((line, i) => {
        const n = /^\[(\d+)\] /.exec(line)?.[1]
        const summary = lines[i + 1]?.trim()
        if (!n || !summary) return
        const first = summary.split(/(?<=[.!?])\s/)[0]!.replace(/[.!?]$/, '')
        sentences.push(`${first} [${n}].`)
      })
      if (/disagree/.test(sure)) sentences.push('Both are kept until an owner chooses.')
      if (/only part|out of date/.test(sure)) sentences.push(...said.split(/(?<=[.!?])\s/).slice(1))
      const text = sentences.join(' ')
      const tokens = (t: string) => Math.max(1, Math.ceil(t.length / 4))
      return Promise.resolve({
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: tokens(prompt),
            noCache: tokens(prompt),
            cacheRead: 0,
            cacheWrite: 0,
          },
          outputTokens: { total: tokens(text), text: tokens(text), reasoning: 0 },
        },
        warnings: [],
      })
    },
  })
  return {
    model,
    options: {},
    cacheBreakpoint: {},
    id: 'mock/words',
    provider: 'mock',
    name: 'words',
    vendor: 'mock',
    family: 'mock/words',
    effort: 'low',
    prices: { input: 0, output: 0, cacheRead: 0 },
    recipients: 'nobody: the scripted mock runs on this machine',
  }
}
