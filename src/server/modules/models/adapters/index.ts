import type { ProviderAdapter } from '../types.ts'
import { anthropicAdapter } from './anthropic.ts'
import { openAiCompatibleAdapter } from './openai-compatible.ts'

/** Every adapter, by the name a provider entry gives as its `adapter`. */
export const modelAdapters: Readonly<Record<string, ProviderAdapter>> = {
  anthropic: anthropicAdapter,
  'openai-compatible': openAiCompatibleAdapter,
}
