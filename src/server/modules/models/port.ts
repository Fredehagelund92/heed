import type { LanguageModelV4, LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'
import { modelAdapters } from './adapters/index.ts'
import { ModelConfigError, ModelVendorError } from './errors.ts'
import { scriptedAnswerModel, scriptedJudgeModel } from './mock.ts'
import { defaultModel, modelProviders, vendorNames } from './providers.ts'
import type {
  Effort,
  ListedModel,
  ModelChoice,
  ModelRef,
  ModelRole,
  Prices,
  ProviderAdapter,
  ProviderEntry,
} from './types.ts'

/**
 * The model port (plan section 3.1): one explicit model object per role. `get_facts` never
 * calls a model; only the evaluation runner, its judges and Ask's words do. A plain string
 * model would route through an AI gateway the service did not choose, so every model here is an
 * object made by the adapter of a provider in the registry (`providers.ts`), for a model that
 * provider lists. `MODELS=mock` puts the scripted mock behind every role instead.
 */

export type ModelMode = 'mock' | 'live'

export interface ModelPort {
  readonly mode: ModelMode
  /** The model for a role. `ref` comes from the role's setting (`models.<role>`); the mock ignores it. */
  choose(role: ModelRole, ref?: ModelRef): ModelChoice
  /**
   * A model of another line than `answer`, from the same provider and vendor: the first its
   * provider lists, else its own line. A fallback never moves to another vendor; that takes a
   * setting that names one.
   */
  otherLine(role: ModelRole, answer: ModelChoice): ModelChoice
  /** Refuses an assignment this service cannot serve, with a message that names the setting. */
  check(setting: string, ref: ModelRef): void
  /**
   * What the provider's own counter says its key has used so far, in micros (`creditsPath`):
   * null when it keeps none, or for the mock. Throws when the counter cannot be read.
   */
  creditsUsed(provider: string): Promise<number | null>
}

/**
 * A call's tokens. `inputTokens` is every input token, those read from and written to a prompt
 * cache included; output tokens include any reasoning.
 */
export type Usage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens?: number
}

const free: Prices = { input: 0, output: 0, cacheRead: 0 }

/** Cost in micros (1e-6 US dollars): tokens times dollars per million tokens. */
export function costMicros(prices: Prices, usage: Usage): number {
  const written = usage.cacheWriteTokens ?? 0
  const fresh = Math.max(0, usage.inputTokens - usage.cacheReadTokens - written)
  return Math.ceil(
    fresh * prices.input +
      usage.cacheReadTokens * (prices.cacheRead ?? prices.input) +
      written * (prices.cacheWrite ?? prices.input) +
      usage.outputTokens * prices.output,
  )
}

export type ModelPortOptions = {
  mode: ModelMode
  /** The environment: each provider's key and base URL are read from it by name. */
  env?: Readonly<Record<string, string | undefined>>
  /** The registry; tests add a provider here. */
  providers?: readonly ProviderEntry[]
  adapters?: Readonly<Record<string, ProviderAdapter>>
  effort?: Partial<Record<ModelRole, Effort>>
  /** Mock prices, so tests can exercise spend caps. The scripted mock is free by default. */
  mockPrices?: Prices
}

const defaultEffort: Record<ModelRole, Effort> = {
  eval_answer: 'medium',
  judge: 'low',
  // Ask's words only phrase what the engine found, in a few sentences, and stream to the person as
  // they are written: any reasoning delays the first sentence, and at low effort the model still
  // spent the words' whole output limit on reasoning for some questions and wrote nothing.
  assistant: 'none',
  test_authoring: 'medium',
}

export function createModelPort(options: ModelPortOptions): ModelPort {
  const effort = (role: ModelRole) => options.effort?.[role] ?? defaultEffort[role]
  const adapters = options.adapters ?? modelAdapters
  const providers = registry(options.providers ?? modelProviders, adapters)
  const resolve = (setting: string, ref: ModelRef) => {
    const entry = providers.get(ref.provider)
    if (!entry)
      throw new ModelConfigError(
        `${setting} names provider ${ref.provider}, which is not in the provider registry (${[...providers.keys()].join(', ')})`,
      )
    const listed = Object.hasOwn(entry.models, ref.model) ? entry.models[ref.model] : undefined
    if (!listed)
      throw new ModelConfigError(
        `${setting} names model ${ref.model}, which provider ${entry.name} does not list; add it with its prices to the provider registry first`,
      )
    return { entry, listed }
  }
  if (options.mode === 'mock') return mockPort(options.mockPrices ?? free, effort, resolve)

  const env = options.env ?? {}
  const connections = new Map<string, ReturnType<ProviderAdapter['connect']>>()
  /** The provider's key and base URL, from the environment. */
  const connectionOf = (setting: string, entry: ProviderEntry) => {
    const apiKey = env[entry.apiKeyEnv]
    if (!apiKey)
      throw new ModelConfigError(
        `${setting} uses provider ${entry.name}, which needs ${entry.apiKeyEnv}. Put it in .env.local (never commit it), or use MODELS=mock.`,
      )
    const baseUrl = env[entry.baseUrlEnv] || entry.baseUrl
    if (!URL.canParse(baseUrl) || !/^https?:$/.test(new URL(baseUrl).protocol))
      throw new ModelConfigError(`${entry.baseUrlEnv} must be an http or https URL`)
    return { apiKey, baseUrl }
  }
  const connect = (setting: string, entry: ProviderEntry) => {
    const made = connections.get(entry.name)
    if (made) return made
    const connection = adapters[entry.adapter]!.connect(entry, connectionOf(setting, entry))
    connections.set(entry.name, connection)
    return connection
  }
  const cache = new Map<string, ModelChoice>()
  const choose = (role: ModelRole, ref: ModelRef = defaultModel): ModelChoice => {
    const key = `${role}:${ref.provider}:${ref.model}`
    const cached = cache.get(key)
    if (cached) return cached
    const setting = `models.${role}`
    const { entry, listed } = resolve(setting, ref)
    const adapted = connect(setting, entry)(ref.model, listed, effort(role))
    const choice: ModelChoice = {
      ...adapted,
      model: holdVendor(adapted.model, ref.model, listed.vendor),
      id: `${entry.name}/${ref.model}`,
      provider: entry.name,
      name: ref.model,
      vendor: listed.vendor,
      family: `${listed.vendor}/${listed.line}`,
      effort: effort(role),
      prices: listed.prices,
      recipients: recipients(entry, listed),
    }
    cache.set(key, choice)
    return choice
  }
  return {
    mode: 'live',
    choose,
    otherLine(role, answer) {
      const entry = providers.get(answer.provider)!
      const vendor = Object.entries(entry.models).filter(([, m]) => m.vendor === answer.vendor)
      const [name] = vendor.find(([, m]) => `${m.vendor}/${m.line}` !== answer.family) ?? vendor[0]!
      return choose(role, { provider: entry.name, model: name })
    },
    check(setting, ref) {
      connect(setting, resolve(setting, ref).entry)
    },
    async creditsUsed(provider) {
      const entry = providers.get(provider)
      const apiKey = entry ? env[entry.apiKeyEnv] : undefined
      if (!entry?.creditsPath || !apiKey) return null
      const base = (env[entry.baseUrlEnv] || entry.baseUrl).replace(/\/+$/, '')
      // The key goes in the header only, never in a message.
      const response = await fetch(base + entry.creditsPath, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok)
        throw new Error(`${entry.name} answered the credit count with HTTP ${response.status}`)
      const used = Number(((await response.json()) as { total_used?: unknown }).total_used)
      if (!Number.isFinite(used)) throw new Error(`${entry.name} gave no total used`)
      return Math.round(used * 1_000_000)
    },
  }
}

/** The entries by name, refused at start-up when two share a name or one names no adapter. */
function registry(
  entries: readonly ProviderEntry[],
  adapters: Readonly<Record<string, ProviderAdapter>>,
): Map<string, ProviderEntry> {
  const byName = new Map<string, ProviderEntry>()
  for (const entry of entries) {
    if (byName.has(entry.name) || entry.name === 'mock')
      throw new ModelConfigError(`The provider registry has a second provider named ${entry.name}`)
    if (!Object.hasOwn(adapters, entry.adapter))
      throw new ModelConfigError(
        `Provider ${entry.name} names adapter ${entry.adapter}, which does not exist`,
      )
    byName.set(entry.name, entry)
  }
  return byName
}

/** The scripted mock behind every role. A setting is still checked against the registry. */
function mockPort(
  prices: Prices,
  effort: (role: ModelRole) => Effort,
  resolve: (setting: string, ref: ModelRef) => unknown,
): ModelPort {
  const models: Record<ModelRole, LanguageModelV4> = {
    eval_answer: scriptedAnswerModel(),
    judge: scriptedJudgeModel(),
    assistant: scriptedAnswerModel(),
    // No feature drafts test questions with a model yet; the role can be assigned before it does.
    test_authoring: scriptedAnswerModel(),
  }
  const choose = (role: ModelRole): ModelChoice => ({
    model: models[role],
    id: `mock/${models[role].modelId}`,
    provider: 'mock',
    name: models[role].modelId,
    vendor: 'mock',
    family: `mock/${models[role].modelId}`,
    effort: effort(role),
    options: {},
    cacheBreakpoint: {},
    prices,
    recipients: 'no one (the scripted mock)',
  })
  return {
    mode: 'mock',
    choose,
    otherLine: choose,
    check(setting, ref) {
      resolve(setting, ref)
    },
    creditsUsed: () => Promise.resolve(null),
  }
}

function recipients(entry: ProviderEntry, listed: ListedModel): string {
  const vendor = vendorNames[listed.vendor] ?? listed.vendor
  return vendor === entry.operator ? vendor : `${entry.operator} and ${vendor}`
}

/**
 * Refuses a response that names a model of another vendor, as a gateway's fallback would. A
 * response model id of the form `vendor/model` is checked; a bare id names no vendor.
 */
function holdVendor(model: LanguageModelV4, name: string, vendor: string): LanguageModelV4 {
  const check = (served: string | undefined) => {
    const prefix = served?.includes('/') ? served.slice(0, served.indexOf('/')) : undefined
    if (prefix !== undefined && prefix !== vendor)
      throw new ModelVendorError(
        `${name} was answered by ${served}, a model of another vendor than ${vendor}; a fallback may not change the vendor`,
      )
  }
  return wrapLanguageModel({
    model,
    middleware: {
      wrapGenerate: async ({ doGenerate }) => {
        const result = await doGenerate()
        check(result.response?.modelId)
        return result
      },
      wrapStream: async ({ doStream }) => {
        const result = await doStream()
        const stream = result.stream.pipeThrough(
          new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
            transform(part, controller) {
              if (part.type === 'response-metadata') check(part.modelId)
              controller.enqueue(part)
            },
          }),
        )
        return { ...result, stream }
      },
    },
  })
}
