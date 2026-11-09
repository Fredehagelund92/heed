import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from '@ai-sdk/provider'
import { MockLanguageModelV4 } from 'ai/test'
import type { ModelChoice } from '../models/index.ts'

/*
  Scripted models for Ask's loop (loop.ts), with no provider and nothing metered: the scripted
  reader the service runs on the mock (MODELS=mock), so the loop answers in every build and in the
  demo without a key, and the step builder its tests script a slow, failing or endless model with.
*/

/** One step of a scripted model: the reads it asks for, or its words, after a pause. */
export type ScriptedStep = {
  calls?: readonly { toolName: string; input: Record<string, unknown> }[]
  text?: string
  /** Milliseconds before it answers; an abort cuts it short, as a provider's request ends. */
  delay?: number
  /** The provider fails this call. */
  fail?: boolean
}

/** What a step of the chat so far gave: the person's last message and the reads made since. */
export type ScriptedPrompt = {
  question: string
  /** The reads made since the person's last message, by tool, with what each returned. */
  results: { toolName: string; value: unknown }[]
  /** How many steps this turn has taken before this one. */
  step: number
  /** Whether this step may read: the last one may not. */
  canRead: boolean
  prompt: LanguageModelV4Prompt
}

const tokens = (t: string) => Math.max(1, Math.ceil(t.length / 4))
const usageOf = (prompt: string, text: string): LanguageModelV4Usage => ({
  inputTokens: { total: tokens(prompt), noCache: tokens(prompt), cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: tokens(text), text: tokens(text), reasoning: 0 },
})

/** The chat as the scripted model reads it: what it was last asked, and what it read since. */
export function scriptedPrompt(
  prompt: LanguageModelV4Prompt,
  toolChoice?: LanguageModelV4CallOptions['toolChoice'],
): ScriptedPrompt {
  const last = prompt.findLastIndex((m) => m.role === 'user')
  const asked = prompt[last]
  const question =
    asked?.role === 'user'
      ? asked.content.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n')
      : ''
  const since = prompt.slice(last + 1)
  const results = since.flatMap((m) =>
    m.role === 'tool'
      ? m.content.flatMap((p) =>
          p.type === 'tool-result'
            ? [{ toolName: p.toolName, value: 'value' in p.output ? p.output.value : null }]
            : [],
        )
      : [],
  )
  return {
    question,
    results,
    step: since.filter((m) => m.role === 'assistant').length,
    canRead: toolChoice?.type !== 'none',
    prompt,
  }
}

/** A pause that an abort cuts short. */
const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((done, fail) => {
    const aborted = () =>
      fail(signal?.reason instanceof Error ? signal.reason : new Error('The call was aborted.'))
    if (signal?.aborted) return aborted()
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', () => (clearTimeout(timer), aborted()), { once: true })
  })

/** A model for the loop that takes each step as `decide` says, for the service's mock or a test. */
export function scriptedLoopChoice(
  name: string,
  decide: (prompt: ScriptedPrompt) => ScriptedStep,
): ModelChoice {
  let calls = 0
  const model = new MockLanguageModelV4({
    doStream: async (options: LanguageModelV4CallOptions) => {
      const seen = scriptedPrompt(options.prompt, options.toolChoice)
      const step = decide(seen)
      if (step.delay) await pause(step.delay, options.abortSignal)
      if (step.fail) throw new Error('The scripted provider failed.')
      const n = ++calls
      const text = step.text ?? ''
      const toolCalls = step.calls ?? []
      const parts: LanguageModelV4StreamPart[] = [
        { type: 'stream-start', warnings: [] },
        ...(text
          ? ([
              { type: 'text-start', id: 't' },
              { type: 'text-delta', id: 't', delta: text },
              { type: 'text-end', id: 't' },
            ] satisfies LanguageModelV4StreamPart[])
          : []),
        ...toolCalls.map((c, i): LanguageModelV4StreamPart => ({
          type: 'tool-call',
          toolCallId: `${name}_${n}_${i}`,
          toolName: c.toolName,
          input: JSON.stringify(c.input),
        })),
        {
          type: 'finish',
          finishReason: toolCalls.length
            ? { unified: 'tool-calls', raw: 'tool_use' }
            : { unified: 'stop', raw: 'end_turn' },
          usage: usageOf(JSON.stringify(options.prompt), text + JSON.stringify(toolCalls)),
        },
      ]
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            for (const part of parts) controller.enqueue(part)
            controller.close()
          },
        }),
      }
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
    effort: 'none',
    prices: { input: 0, output: 0, cacheRead: 0 },
    recipients: 'nobody: the scripted mock runs on this machine',
  }
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : [])
const firstSentence = (text: string) => text.split(/(?<=[.!?])\s/)[0]!.replace(/[.!?]$/, '')
const list = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/**
 * The scripted reader (MODELS=mock): it looks the person's message up once, with get_context and
 * find_context, then writes what applies, each item's title and first sentence with its id, or
 * with nothing found, what the reads say was searched and who owns the subject. It follows no
 * instruction in a message or an item, never asks back, and claims nothing a real model would
 * write.
 */
export function scriptedLoopModel(): ModelChoice {
  return scriptedLoopChoice('loop', ({ question, results, canRead }) => {
    const words = question.trim().slice(0, 500) || 'context'
    if (!results.length && canRead)
      return {
        calls: [
          { toolName: 'get_context', input: { about: words } },
          { toolName: 'find_context', input: { words } },
        ],
      }
    const got = results.find((r) => r.toolName === 'get_context')?.value
    const found = results.find((r) => r.toolName === 'find_context')?.value
    const get = isObj(got) ? got : {}
    const find = isObj(found) ? found : {}
    const items = objs(get.items).length
      ? objs(get.items)
      : objs(find.items).filter((i) => i.match === 'all')
    if (items.length) {
      // The subject's names as typed mentions of what the read named, as the page draws them.
      const about = isObj(get.read) && Array.isArray(get.read.about) ? get.read.about : []
      const names = about.map((id) => `[@${String(id)}]`)
      return {
        text: [
          names.length ? `What is written for ${list(names)}.` : 'What is written.',
          ...items
            .slice(0, 4)
            .map(
              (i) => `${String(i.title)}: ${firstSentence(String(i.summary))} [${String(i.id)}].`,
            ),
        ].join('\n\n'),
      }
    }
    const owners = objs(get.owners).flatMap((o) =>
      Array.isArray(o.owners) && o.owners.length
        ? [`${String(o.domain)} is owned by ${list(o.owners as string[])}.`]
        : [],
    )
    const nothing = [get.nothing, find.nothing].find((n) => typeof n === 'string')
    return {
      text: [nothing ?? 'Nothing is written about this.', ...owners].join(' '),
    }
  })
}
