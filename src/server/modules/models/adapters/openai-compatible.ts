import type { JSONObject, LanguageModelV4Usage, SharedV4ProviderOptions } from '@ai-sdk/provider'
import {
  createOpenAICompatible,
  type OpenAICompatibleProviderSettings,
} from '@ai-sdk/openai-compatible'
import { ModelConfigError } from '../errors.ts'
import type { ProviderAdapter } from '../types.ts'

/**
 * Any API that speaks OpenAI's Chat Completions, such as an AI gateway. One adapter serves every
 * such provider; the entry's `adapterOptions` say where the API differs:
 * - `effort`: `reasoning_effort` (OpenAI's field, the default) or `reasoning` (`{ effort }`, a
 *   gateway's, which turns reasoning off for effort `none` with `{ enabled: false }`). OpenAI's
 *   field has no value every model takes for no reasoning, so `none` is sent there as `low`.
 * - `promptCache`: `cache_control` marks the system instructions as a prompt cache breakpoint;
 *   `none` (the default) sends no breakpoint.
 * - `onlyVendor`: ask the gateway to serve each model from its vendor only
 *   (`providerOptions.gateway.only`), never from another company's copy of the model.
 * - `structuredOutputs`: send a JSON schema as `response_format` (the judge's verdict). Without
 *   it (the default) the schema is not sent, the SDK warns, and the judge falls back to JSON text,
 *   up to three calls a verdict.
 *
 * Prompt cache writes are read from `usage.cache_creation_input_tokens` wherever the API reports
 * them (see `convertUsage`).
 */
const options = {
  effort: ['reasoning_effort', 'reasoning'],
  promptCache: ['none', 'cache_control'],
  onlyVendor: [false, true],
  structuredOutputs: [false, true],
} as const

type ChatUsage = Parameters<NonNullable<OpenAICompatibleProviderSettings['convertUsage']>>[0]

/**
 * A response's usage as the AI SDK reads it, plus the tokens written to the prompt cache, which
 * OpenAI's format has no field for and the SDK leaves out. Vercel's gateway reports Claude's as
 * `cache_creation_input_tokens`, counted in `prompt_tokens` like the cache reads, and bills them
 * at the cache write price (1.25 times input); read as plain input they were billed at the input
 * price, and every call's `cache_write` was 0 (round 5).
 */
function convertUsage(usage: ChatUsage): LanguageModelV4Usage {
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
  if (usage == null)
    return {
      inputTokens: {
        total: undefined,
        noCache: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: undefined, text: undefined, reasoning: undefined },
    }
  const total = count(usage.prompt_tokens)
  const cacheRead = count(usage.prompt_tokens_details?.cached_tokens)
  const cacheWrite = count(usage.cache_creation_input_tokens)
  const output = count(usage.completion_tokens)
  const reasoning = count(usage.completion_tokens_details?.reasoning_tokens)
  return {
    inputTokens: {
      total,
      noCache: Math.max(0, total - cacheRead - cacheWrite),
      cacheRead,
      cacheWrite,
    },
    outputTokens: { total: output, text: Math.max(0, output - reasoning), reasoning },
    raw: usage as JSONObject,
  }
}

export const openAiCompatibleAdapter: ProviderAdapter = {
  connect(entry, { apiKey, baseUrl }) {
    const settings = {
      effort: 'reasoning_effort',
      promptCache: 'none',
      onlyVendor: false,
      structuredOutputs: false,
    }
    for (const [key, value] of Object.entries(entry.adapterOptions ?? {})) {
      const allowed = options[key as keyof typeof options] as readonly unknown[] | undefined
      if (!allowed?.includes(value))
        throw new ModelConfigError(
          `Provider ${entry.name}: adapter option ${key} must be one of ${(allowed ?? []).join(', ') || 'nothing (unknown option)'}`,
        )
      Object.assign(settings, { [key]: value })
    }
    const provider = createOpenAICompatible({
      name: entry.name,
      apiKey,
      baseURL: baseUrl,
      // Streamed answers report their usage only when asked; the spend ledger needs it.
      includeUsage: true,
      supportsStructuredOutputs: settings.structuredOutputs,
      convertUsage,
    })
    // The provider's own options key, in camel case as the AI SDK expects (`vercelGateway`).
    const key = entry.name.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase())
    return (name, listed, effort) => {
      // Fields under the provider's own key that the adapter does not know go into the request body.
      const body: JSONObject =
        settings.effort === 'reasoning'
          ? { reasoning: effort === 'none' ? { enabled: false } : { effort } }
          : { reasoningEffort: effort === 'none' ? 'low' : effort }
      if (settings.onlyVendor) body.providerOptions = { gateway: { only: [listed.vendor] } }
      // Message fields under `openaiCompatible` are sent on the message itself.
      const cacheBreakpoint: SharedV4ProviderOptions =
        settings.promptCache === 'cache_control'
          ? { openaiCompatible: { cache_control: { type: 'ephemeral' } } }
          : {}
      return { model: provider.chatModel(name), options: { [key]: body }, cacheBreakpoint }
    }
  },
}
