import { createHash } from 'node:crypto'
import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import type { ModelChoice } from '../../../src/server/modules/models/index.ts'

/*
  The steps of Ask's loop as a real run's model took them, kept so every build can take them
  again with no model: a step is keyed by what the model was sent (the chat, the reads and their
  results, and whether it could read), and holds what it said, its words and its reads with their
  call ids. A build that sends the same thing gets the same step; a step no run recorded is the
  scripted reader's. Provider options are left out of the key: the real run and the build send
  the same chat under different providers.
*/

/** A step as recorded: the model's words, and the reads it asked for with their call ids. */
type Step = { text: string; calls: { id: string; toolName: string; input: string }[] }

const withoutOptions = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(withoutOptions)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([k]) => k !== 'providerOptions' && k !== 'providerMetadata')
            .map(([k, v]) => [k, withoutOptions(v)]),
        )
      : value

/** What a step is known by: what the model was sent, and whether it could read. */
export const stepKey = (params: LanguageModelV4CallOptions) =>
  createHash('sha256')
    .update(JSON.stringify([withoutOptions(params.prompt), params.toolChoice ?? null]))
    .digest('hex')
    .slice(0, 32)

/** The real model, every step it takes kept in `written` by its key, the first of each. */
export function recordingModel(choice: ModelChoice, written: Record<string, string>): ModelChoice {
  const model = wrapLanguageModel({
    model: choice.model,
    middleware: {
      wrapStream: async ({ doStream, params }) => {
        const result = await doStream()
        const step: Step = { text: '', calls: [] }
        const key = stepKey(params)
        const stream = result.stream.pipeThrough(
          new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
            transform(part, controller) {
              if (part.type === 'text-delta') step.text += part.delta
              else if (part.type === 'tool-call')
                step.calls.push({ id: part.toolCallId, toolName: part.toolName, input: part.input })
              else if (part.type === 'finish') written[key] ??= JSON.stringify(step)
              controller.enqueue(part)
            },
          }),
        )
        return { ...result, stream }
      },
    },
  })
  return { ...choice, model }
}

/**
 * A model that takes each recorded step again, and the `fallback`'s for one never recorded, which
 * `missed` counts.
 */
export function replayingModel(
  recorded: Readonly<Record<string, string>>,
  fallback: ModelChoice,
  missed: { steps: number } = { steps: 0 },
): ModelChoice {
  const model = new MockLanguageModelV4({
    doStream: async (params: LanguageModelV4CallOptions) => {
      const found = recorded[stepKey(params)]
      if (!found) {
        missed.steps++
        return (fallback.model as MockLanguageModelV4).doStream(params)
      }
      const step = JSON.parse(found) as Step
      const parts: LanguageModelV4StreamPart[] = [
        { type: 'stream-start', warnings: [] },
        ...(step.text
          ? ([
              { type: 'text-start', id: 't' },
              { type: 'text-delta', id: 't', delta: step.text },
              { type: 'text-end', id: 't' },
            ] satisfies LanguageModelV4StreamPart[])
          : []),
        ...step.calls.map((c): LanguageModelV4StreamPart => ({
          type: 'tool-call',
          toolCallId: c.id,
          toolName: c.toolName,
          input: c.input,
        })),
        {
          type: 'finish',
          finishReason: step.calls.length
            ? { unified: 'tool-calls', raw: 'tool_use' }
            : { unified: 'stop', raw: 'end_turn' },
          usage: {
            inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 0, text: 0, reasoning: 0 },
          },
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
  return { ...fallback, model, id: 'mock/recorded-loop', name: 'recorded-loop' }
}
