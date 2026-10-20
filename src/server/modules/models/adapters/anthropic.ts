import { createAnthropic } from '@ai-sdk/anthropic'
import { ModelConfigError } from '../errors.ts'
import type { ProviderAdapter, ProviderEntry } from '../types.ts'

/**
 * A fetch that adds the gateway's routing field to every JSON body: serve the request from the
 * model's vendor only (`providerOptions.gateway.only`), never from another company's copy of it.
 * Vercel's gateway reads the field on its Messages API too (checked 2026-10-15).
 */
function onlyVendorFetch(vendor: string): typeof fetch {
  return (input, init) => {
    if (typeof init?.body !== 'string') return fetch(input, init)
    const body = JSON.parse(init.body) as Record<string, unknown>
    return fetch(input, {
      ...init,
      body: JSON.stringify({ ...body, providerOptions: { gateway: { only: [vendor] } } }),
    })
  }
}

const servedByAnthropic = (entry: ProviderEntry, name: string, provider: string) => {
  // A model object from another provider (or a gateway) must never stand in for this API.
  if (!provider.startsWith('anthropic'))
    throw new ModelConfigError(`Model ${name} of ${entry.name} is served by ${provider}`)
}

/**
 * The Anthropic Messages API, with Claude's effort setting and a prompt cache breakpoint. It also
 * carries Anthropic's own web search tool, for a provider whose entry names it (`webSearch`):
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
  webSearch(entry, { apiKey, baseUrl }) {
    return (name, listed, { maxUses }) => {
      const anthropic = createAnthropic({
        apiKey,
        baseURL: baseUrl,
        ...(entry.webSearch?.onlyVendor ? { fetch: onlyVendorFetch(listed.vendor) } : {}),
      })
      const model = anthropic(name)
      servedByAnthropic(entry, name, model.provider)
      return {
        model,
        tools: { web_search: anthropic.tools.webSearch_20250305({ maxUses }) },
        toolName: 'web_search',
      }
    }
  },
}
