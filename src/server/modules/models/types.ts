import type { JSONValue, LanguageModelV4, SharedV4ProviderOptions } from '@ai-sdk/provider'

/**
 * The model port's vocabulary: roles, prices, the provider registry's entries and the adapter
 * contract. A provider is one configured way to reach models (an API, or a gateway in front of
 * several vendors); an adapter is the code that speaks one wire protocol, shared by every provider
 * that uses it.
 */

/** Every role that calls a model, each assigned a provider and a model in `models.<role>`. */
export const modelRoles = ['eval_answer', 'judge', 'assistant', 'test_authoring'] as const
export type ModelRole = (typeof modelRoles)[number]
export type Effort = 'low' | 'medium' | 'high'

/**
 * US dollars per million tokens. A model without a cache read price bills tokens read from a
 * prompt cache at the input price, and one without a cache write price the tokens it writes to it.
 */
export type Prices = { input: number; output: number; cacheRead?: number; cacheWrite?: number }

/** A role's assignment: a provider from the registry and a model it lists. */
export type ModelRef = { provider: string; model: string }

/** A model a provider may serve. A model a provider does not list is refused. */
export type ListedModel = {
  /** The company whose model it is, such as `anthropic`, whichever provider serves it. */
  vendor: string
  /** The model line without its version, such as `claude-sonnet`; the family is `vendor/line`. */
  line: string
  /** List prices as this provider bills them. */
  prices: Prices
}

/** One provider: a configuration entry, not code. */
export type ProviderEntry = {
  /** Lowercase, as settings name it (`models.<role>.provider`). */
  name: string
  /** The adapter that speaks this provider's protocol. */
  adapter: string
  /** The company the requests go to, in plain words: it receives every question and answer. */
  operator: string
  /** The environment variable that holds the key. The key itself is never in a setting. */
  apiKeyEnv: string
  /** The environment variable that may override `baseUrl`. */
  baseUrlEnv: string
  baseUrl: string
  /** Settings the adapter reads, documented by the adapter. */
  adapterOptions?: Record<string, JSONValue>
  /**
   * Where the provider keeps its own count of what the key has used: a read-only `GET` under
   * `baseUrl` that answers `{ total_used }` in dollars. The spend ledger is checked against it.
   */
  creditsPath?: string
  /** The only models this provider may serve, best first: a `different_family` judge is the first of another line. */
  models: Record<string, ListedModel>
}

export type Connection = { apiKey: string; baseUrl: string }

/** What an adapter makes for one listed model. */
export type AdaptedModel = {
  model: LanguageModelV4
  /** Passed to generateText and streamText as `providerOptions`. */
  options: SharedV4ProviderOptions
  /** `providerOptions` on the system instructions: a prompt cache breakpoint, where there is one. */
  cacheBreakpoint: SharedV4ProviderOptions
}

/** The code for one wire protocol. It never decides which models are allowed; the entry does. */
export interface ProviderAdapter {
  /** Called once per provider, with its key and base URL; the result makes explicit model objects. */
  connect(
    entry: ProviderEntry,
    connection: Connection,
  ): (name: string, listed: ListedModel, effort: Effort) => AdaptedModel
}

export type ModelChoice = AdaptedModel & {
  /** `provider/model`, recorded on every run and in the cell cache key (FR-510). */
  id: string
  /** The registry entry that serves the model (`anthropic`, `vercel-gateway`, `mock`). */
  provider: string
  /** The model as its provider names it. */
  name: string
  /** The company whose model it is; a different line can share a vendor. */
  vendor: string
  /** `vendor/line`: the model without its version, so a judge can be another model line. */
  family: string
  effort: Effort
  prices: Prices
  /** Who receives what is sent to this model, in plain words, for the notice before a real run. */
  recipients: string
}
