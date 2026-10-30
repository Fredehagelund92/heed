import { createAnthropic } from '@ai-sdk/anthropic'
import { ModelConfigError } from '../errors.ts'
import type { ProviderAdapter, ProviderEntry } from '../types.ts'

const servedByAnthropic = (entry: ProviderEntry, name: string, provider: string) => {
  // A model object from another provider (or a gateway) must never stand in for this API.
  if (!provider.startsWith('anthropic'))
    throw new ModelConfigError(`Model ${name} of ${entry.name} is served by ${provider}`)
}

/**
 * The Anthropic Messages API, with Claude's effort setting and a prompt cache breakpoint:
 * Anthropic itself, or a gateway that serves the Messages API at its base URL.
 */
export const anthropicAdapter: ProviderAdapter = {
  connect(entry, { apiKey, baseUrl }) {
    const anthropic = createAnthropic({ apiKey, baseURL: baseUrl })
    return (name, _listed, effort) => {
      const model = anthropic(name)
      servedByAnthropic(entry, name, model.provider)
      return {
        model,
        options: { anthropic: { effort } },
        cacheBreakpoint: { anthropic: { cacheControl: { type: 'ephemeral' } } },
      }
    }
  },
}
