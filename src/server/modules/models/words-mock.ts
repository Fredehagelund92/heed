import type {
  LanguageModelV4CallOptions,
  LanguageModelV4FinishReason,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from '@ai-sdk/provider'
import { MockLanguageModelV4 } from 'ai/test'
import type { ModelChoice } from './types.ts'

/**
 * The scripted mock of Ask's words (FR-710): a careful writer, so the words cases run in every
 * build without a key. It reads the prompt Ask sends (src/domain/answer-words.ts) and writes each
 * item's first sentence with its number, then what the state asks for: both sides kept for a
 * conflict, and for a partial or possibly outdated answer the engine's own sentence about it. It
 * follows no instruction found in a question or an item. It never claims what a real model would
 * write. Streamed, it sends its words a word at a time, `pace` milliseconds apart.
 */
export function scriptedWordsModel(options: { pace?: number } = {}): ModelChoice {
  return wordsChoice('words', (prompt) => ({ text: scriptedWords(prompt) }), options.pace ?? 0)
}

/**
 * A words model that writes `text` whatever it is asked, stopping with `finishReason` after
 * reasoning `reasoning` tokens: for tests of what Ask does with words that fail the check or are
 * cut off. Streamed like the scripted one.
 */
export function fixedWordsModel(
  text: string,
  options: {
    pace?: number
    finishReason?: LanguageModelV4FinishReason['unified']
    reasoning?: number
  } = {},
): ModelChoice {
  return wordsChoice(
    'fixed',
    () => ({ text, finishReason: options.finishReason, reasoning: options.reasoning }),
    options.pace ?? 0,
  )
}

/** The words the scripted writer writes for Ask's prompt. */
function scriptedWords(prompt: string): string {
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
  return sentences.join(' ')
}

const promptOf = (options: LanguageModelV4CallOptions) =>
  options.prompt
    .flatMap((m) =>
      m.role === 'user' ? m.content.flatMap((p) => (p.type === 'text' ? [p.text] : [])) : [],
    )
    .join('\n')

const tokens = (t: string) => Math.max(1, Math.ceil(t.length / 4))

const usageOf = (prompt: string, text: string, reasoning = 0): LanguageModelV4Usage => ({
  inputTokens: { total: tokens(prompt), noCache: tokens(prompt), cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: tokens(text) + reasoning, text: tokens(text), reasoning },
})

/** A pause that an abort cuts short, as a provider's stream ends when its request is aborted. */
const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((done, fail) => {
    const aborted = () =>
      fail(signal?.reason instanceof Error ? signal.reason : new Error('The call was aborted.'))
    if (signal?.aborted) return aborted()
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', () => (clearTimeout(timer), aborted()), { once: true })
  })

function wordsChoice(
  name: string,
  write: (prompt: string) => {
    text: string
    finishReason?: LanguageModelV4FinishReason['unified'] | undefined
    reasoning?: number | undefined
  },
  pace: number,
): ModelChoice {
  const model = new MockLanguageModelV4({
    doGenerate: (options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> => {
      const prompt = promptOf(options)
      const { text, finishReason = 'stop', reasoning } = write(prompt)
      return Promise.resolve({
        content: text ? [{ type: 'text', text }] : [],
        finishReason: { unified: finishReason, raw: finishReason },
        usage: usageOf(prompt, text, reasoning),
        warnings: [],
      })
    },
    doStream: (options: LanguageModelV4CallOptions) => {
      const prompt = promptOf(options)
      const { text, finishReason = 'stop', reasoning } = write(prompt)
      // A word at a time with the space before it, as providers send their deltas.
      const parts: LanguageModelV4StreamPart[] = [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't' },
        ...(text.match(/\s*\S+/g) ?? []).map((delta): LanguageModelV4StreamPart => ({
          type: 'text-delta',
          id: 't',
          delta,
        })),
        { type: 'text-end', id: 't' },
        {
          type: 'finish',
          finishReason: { unified: finishReason, raw: finishReason },
          usage: usageOf(prompt, text, reasoning),
        },
      ]
      let at = 0
      const stream = new ReadableStream<LanguageModelV4StreamPart>({
        async pull(controller) {
          const part = parts[at++]
          if (!part) return controller.close()
          if (part.type === 'text-delta' && pace) await pause(pace, options.abortSignal)
          controller.enqueue(part)
        },
      })
      return Promise.resolve({ stream })
    },
  })
  return {
    model,
    options: {},
    cacheBreakpoint: {},
    id: `mock/${name}`,
    provider: 'mock',
    name,
    vendor: 'mock',
    family: `mock/${name}`,
    effort: 'low',
    prices: { input: 0, output: 0, cacheRead: 0 },
    recipients: 'nobody: the scripted mock runs on this machine',
  }
}
