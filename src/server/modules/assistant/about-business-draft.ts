import { generateText } from 'ai'
import type { FastifyBaseLogger } from 'fastify'
import type { BusinessDraft } from '../../../contract/admin.ts'
import {
  ABOUT_BUSINESS_FACTS_TAG,
  ABOUT_BUSINESS_MAX,
  ABOUT_BUSINESS_WORDS_HEADING,
  acceptDraft,
  draftAboutBusiness,
  type BusinessFacts,
} from '../../../domain/about-business.ts'
import { productName } from '../../brand.ts'
import type { Database, Queryable } from '../../db/database.ts'
import {
  conversationRetry,
  costMicros,
  createCallMeter,
  readSpendLimits,
  spendLimitReached,
  type ModelPort,
} from '../models/index.ts'
import { readModel, safeError } from './chat.ts'

/**
 * The "Write a first version for me" action of About our business. Heed writes the draft from what
 * it already knows (the domains, the metrics and dimensions the definition source describes), and
 * nothing is saved: the administrator reads it in the box, edits it, and saves it like any text.
 * With a model behind the assistant, that model words the draft from the same facts, under the
 * assistant's spending limits and its meter; what it writes must pass the same checks as Heed's
 * own draft (no number, deal, date or legal conclusion, at most the limit). A model that cannot
 * be reached, a limit that is reached or a text that fails the checks leaves Heed's own draft.
 */

const feature = 'assistant'
const MAX_OUTPUT_TOKENS = 700
const tokens = (text: string) => Math.ceil(text.length / 4)

const system = [
  `You write the first version of "About our business" for ${productName}. It is a short background text: an administrator reads it, edits it and saves it before the assistant or any AI app is given it.`,
  `You are given what ${productName} already knows in <${ABOUT_BUSINESS_FACTS_TAG}>: the domains the company keeps its facts in, and its metrics and dimensions with the names people also use and the definition source's own words. Use only that.`,
  'Write plain Markdown in two parts, with nothing before or after them.',
  'Part one: one or two sentences on what the company does, only as far as the facts show it. If they do not show it, say which domains the company keeps its facts in.',
  `Part two: a line that reads exactly "${ABOUT_BUSINESS_WORDS_HEADING}", then one line per word an outsider would misread, as "- term: meaning", with the meaning in the definition source's words. At most twelve words, the ones most easily misread.`,
  'Never write a digit, a number, an amount, a date, a deal, or what happened in a market. Never state or hint at a legal or regulatory conclusion. Never write a name of a person, an address, a link or a secret. Never say anything the facts do not.',
  `Keep it under ${ABOUT_BUSINESS_MAX - 200} characters. Write plain words and no dashes other than the hyphen of a list.`,
].join('\n')

export type BusinessDraftDeps = {
  database: Database
  models: ModelPort
  logger: FastifyBaseLogger
}

/**
 * The draft for the facts, read in the request's transaction `tx` for the person `personId`. Empty
 * text when Heed knows too little to write one.
 */
export async function writeBusinessDraft(
  { database, models, logger }: BusinessDraftDeps,
  tx: Queryable,
  personId: string,
  facts: BusinessFacts,
  signal?: AbortSignal,
): Promise<BusinessDraft> {
  const own = draftAboutBusiness(facts)
  const written = (text: string): BusinessDraft => ({ text, writtenBy: 'facts' })
  if (!own) return written('')
  const choice = await readModel(tx, models)
  const prompt = `<${ABOUT_BUSINESS_FACTS_TAG}>\n${JSON.stringify(facts)}\n</${ABOUT_BUSINESS_FACTS_TAG}>`
  const estimate = costMicros(choice.prices, {
    inputTokens: tokens(system) + tokens(prompt),
    outputTokens: MAX_OUTPUT_TOKENS,
    cacheReadTokens: 0,
  })
  if (await spendLimitReached(tx, feature, await readSpendLimits(tx, feature), estimate, personId))
    return written(own)
  const meter = createCallMeter({
    database,
    feature,
    person: personId,
    limits: null,
    retry: conversationRetry,
    onRecordError: (error) => {
      logger.error({ err: safeError(error) }, 'about our business draft spend not recorded')
    },
  })
  try {
    const result = await generateText({
      model: meter.wrap(choice, { role: 'assistant' }).model,
      maxRetries: 0,
      system,
      prompt,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      providerOptions: choice.options,
      timeout: { totalMs: 60_000 },
      ...(signal ? { abortSignal: signal } : {}),
    })
    const text = acceptDraft(result.text)
    if (!text) logger.warn({ model: choice.name }, 'about our business draft refused')
    return text ? { text, writtenBy: 'model' } : written(own)
  } catch (error) {
    logger.warn({ err: safeError(error) }, 'about our business draft model call failed')
    return written(own)
  } finally {
    await meter.close()
  }
}
