import * as z from 'zod'
import * as mini from 'zod/mini'
import { isCalendarDate } from '../../domain/validity.ts'
import { itemKinds } from '../../domain/item.ts'
import { relatedLimits, relations } from '../../domain/links.ts'
import {
  fieldMarks,
  limits,
  markedFields,
  questionIds,
  toolInputLimits,
} from '../../domain/proposal-attributes.ts'
import { provenanceFlagCodes } from '../../domain/provenance.ts'

const date = z.string().refine(isCalendarDate, 'Expected a calendar date')
const edition = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}\.\d+$/)
  .optional()
export const scopeFields = {
  question: z.string().max(2000),
  metrics: z
    .array(z.string().min(1).max(toolInputLimits.name))
    .max(toolInputLimits.names)
    .optional()
    .describe(
      'Metric names as people say them, their other names, or the member names you queried in the data tool (view.member, such as payments.orders).',
    ),
  dimension_filters: z
    .array(
      z.strictObject({
        dimension: z
          .string()
          .min(1)
          .max(toolInputLimits.name)
          .describe('A dimension by its name, or the member name you queried (view.member).'),
        // No values names the dimension without choosing one ("orders by market").
        values: z.array(z.string().min(1).max(toolInputLimits.name)).max(toolInputLimits.values),
      }),
    )
    .max(toolInputLimits.names)
    .optional(),
  window: z
    .strictObject({ from: date, to: date })
    .refine((w) => w.from <= w.to, 'Window ends before it starts')
    .optional(),
}
/**
 * FR-342: how much a reply of get_context or find_context says. `concise` keeps what an answer
 * needs (each item's title, summary, dates, claim level, freshness and what not to conclude) and
 * leaves out bodies, evidence, owners and links, which read_item gives for one item; `full`
 * carries every source detail of FR-326 and FR-331.
 */
export const responseFormat = z
  .enum(['concise', 'full'])
  .describe(
    "concise: a shorter reply, about half the size, each item without its body, evidence, owner and links (read_item gives them). full: every source detail and link. Ask for concise when you only need what applies; full when you will cite an item's evidence or follow its links.",
  )
export type ResponseFormat = z.infer<typeof responseFormat>
export const contextInput = z.strictObject({
  ...scopeFields,
  edition,
  max_items: z.number().int().min(1).max(50).default(20),
  max_bytes: z.number().int().min(1000).max(100000).default(100000),
  response_format: responseFormat.default('full'),
})
export const readInput = z.strictObject({
  id: z.string().regex(/^itm_[a-z0-9]{8,16}$/),
  edition,
  cursor: z.string().max(2000).optional(),
  max_bytes: z.number().int().min(1000).max(100000).default(100000),
})
export const searchInput = z.strictObject({
  query: z.string().max(2000).default(''),
  kind: z.enum(itemKinds).optional(),
  area: z
    .string()
    .max(80)
    .optional()
    .describe('A domain by its id or its name, such as area_sales or Sales.'),
  mentions: z.string().max(160).optional(),
  edition,
  cursor: z.string().max(2000).optional(),
  limit: z.number().int().min(1).max(50).default(20),
  max_bytes: z.number().int().min(1000).max(100000).default(100000),
})
const domainName = z
  .string()
  .min(1)
  .max(80)
  .describe('A domain by its name, such as Sales (its id, such as area_sales, works too).')
/**
 * FR-338: find what Heed holds about a few words or a question, by the names people use. The
 * window only narrows the items that apply when no words match.
 */
export const findInput = z.strictObject({
  query: z
    .string()
    .min(1)
    .max(2000)
    .describe(
      'A few words or the question as asked: a metric, a market, a domain or a topic, such as "GMV Spain" or "what is net revenue".',
    ),
  domain: domainName.optional(),
  kind: z.enum(itemKinds).optional(),
  window: scopeFields.window.describe(
    'Inclusive UTC dates, for the items that apply when no words match. Today when left out.',
  ),
  edition,
  limit: z.number().int().min(1).max(50).default(10),
  max_bytes: z.number().int().min(1000).max(100000).default(100000),
  response_format: responseFormat.default('full'),
})
/** FR-348: a question about how Heed itself works, in words. */
export const helpInput = z.strictObject({
  query: z
    .string()
    .min(2)
    .max(300)
    .describe(
      'The question in the words asked, such as "what is an MCP?" or "how do I review a proposal".',
    ),
})
/** FR-339: one domain, or every domain when it names none. */
export const overviewInput = z.strictObject({
  domain: domainName.optional(),
  max_bytes: z.number().int().min(1000).max(100000).default(100000),
})
const editionNumber = z.string().min(1).max(40)
/** FR-340: what changed between two sealed editions, by default the live one and the one before. */
export const changesInput = z.strictObject({
  edition: editionNumber
    .optional()
    .describe('The edition to report on, such as 2026-10-07.2. The live edition when left out.'),
  since: editionNumber
    .optional()
    .describe('The earlier edition to compare with. The edition just before when left out.'),
  domain: domainName.optional(),
  limit: z.number().int().min(1).max(50).default(20),
  max_bytes: z.number().int().min(1000).max(100000).default(100000),
})
/** FR-332: an item id, a vocabulary key, or a domain (`area:<id>` or the bare area id). */
export const relatedInput = z.strictObject({
  id: z.string().min(1).max(160),
  relations: z.array(z.enum(relations)).min(1).max(relations.length).optional(),
  depth: z.number().int().min(1).max(relatedLimits.maxDepth).default(1),
  max_nodes: z
    .number()
    .int()
    .min(1)
    .max(relatedLimits.maxNodes)
    .default(relatedLimits.defaultNodes),
  window: scopeFields.window,
  edition,
  cursor: z.string().max(2000).optional(),
  max_bytes: z.number().int().min(1000).max(100000).default(100000),
})
export const improveInput = z.strictObject({ ...scopeFields, edition })
export const gapInput = z.strictObject({
  ...scopeFields,
  note: z.string().min(1).max(500).optional(),
})
export const feedbackInput = mini.strictObject({
  delivery_id: mini.string().check(mini.uuid()),
  verdict: mini.enum(['helpful', 'wrong', 'missing', 'unclear']),
  note: mini.optional(mini.string().check(mini.minLength(1), mini.maxLength(500))),
})
/**
 * FR-121: what an agent passes to draft context for the person. Every field is a suggestion the
 * person confirms; Heed resolves names against the vocabulary and never trusts a key or a fact
 * from the agent's memory. Bounded fields only: never a conversation (FR-603).
 */
export const draftInput = z.strictObject({
  text: z
    .string()
    .min(1)
    .max(toolInputLimits.text)
    .describe(
      'What the person wants recorded, in their words or a short summary of them: what happened, where and since when. Not a transcript.',
    ),
  title: z.string().min(1).max(limits.title).optional().describe('A short title, if you have one.'),
  summary: z
    .string()
    .min(1)
    .max(
      limits.summary,
      `at most ${limits.summary} characters: what happened, where and when. Move detail, caveats and what it does not mean into text, which becomes the body`,
    )
    .optional()
    .describe(
      `One or two sentences an AI app reads first, at most ${limits.summary} characters. Do not claim a cause.`,
    ),
  kind: z
    .enum(itemKinds)
    .optional()
    .describe(
      'event: something that happened on a day. issue: a data problem that lasts a while. note: a lasting remark. guide: how to investigate. example: a checked answer to a question.',
    ),
  scope: z
    .strictObject({
      metrics: scopeFields.metrics.describe('Metric names, as you used them with get_context.'),
      dimension_filters: scopeFields.dimension_filters.describe(
        'Dimensions and the values it applies to, such as market Norway. No values means every value.',
      ),
    })
    .optional()
    .describe("Names, as in your last get_context call. They're matched to the vocabulary."),
  window: z
    .strictObject({
      from: date,
      to: date.optional(),
      uncertain: z
        .boolean()
        .optional()
        .describe(
          'True when the person is unsure of the dates: from is your best guess, and the owner sees the dates flagged.',
        ),
    })
    .refine((w) => w.to === undefined || w.from <= w.to, 'Window ends before it starts')
    .optional()
    .describe(
      'Inclusive UTC dates the person named or that the source gives. When they are unsure, give your best start with uncertain: true. Leave out to when it is open.',
    ),
  evidence: z
    .array(
      z.strictObject({
        url: z
          .string()
          .max(limits.url)
          .refine(
            (url) => /^https?:\/\//.test(url) && URL.canParse(url),
            'Expected an http or https link',
          ),
        quote: z.string().min(1).max(limits.quote),
      }),
    )
    .max(toolInputLimits.evidence)
    .optional()
    .describe(
      "Each source the person gave or you read: the address of the exact page, and one sentence copied character for character from that page in the page's own language, never a translation, a summary or a search snippet. Prefer the official text, such as a law on a government site, to a news report of it. Never invent one: if you only saw a summary of a page, leave it out and say so.",
    ),
  not_to_conclude: z
    .string()
    .min(1)
    .max(limits.notToConclude)
    .optional()
    .describe(
      'What not to conclude from this, in the person\'s words, if they said. Otherwise "cause not proven" is used.',
    ),
  area: z
    .string()
    .min(1)
    .max(limits.areaId)
    .optional()
    .describe('The domain, only when the person chose one after a reply asked.'),
  item_id: z
    .string()
    .regex(/^itm_[a-z0-9]{8,16}$/)
    .optional()
    .describe('To suggest a change to an accepted item instead of a new one.'),
  new_item: z
    .boolean()
    .optional()
    .describe('true when the person said it is new after a reply listed possible duplicates.'),
})
export type DraftInput = z.infer<typeof draftInput>

const listed = z.strictObject({ id: z.string(), title: z.string(), kind: z.string() })
const question = z.strictObject({
  field: z.enum(markedFields),
  question: z.string(),
  options: z.array(z.string()).optional(),
})
/**
 * What `draft_context` returns (its MCP output schema), field names and marks from the attribute
 * table (src/domain/proposal-attributes.ts). `status` says which parts are present: a saved draft,
 * a domain to choose, possible duplicates, or a refusal, which saves nothing.
 */
export const draftOutput = z
  .object({
    status: z.enum(['draft_saved', 'needs_area', 'possible_duplicate', 'refused']),
    saved: z.boolean(),
    message: z.string().optional(),
    submitted: z.literal(false).optional(),
    draft_id: z.string().optional(),
    number: z.number().optional(),
    title: z.string().optional(),
    url: z.string().nullable().optional(),
    fields: z
      .partialRecord(
        z.enum(markedFields),
        z.strictObject({
          value: z.unknown(),
          mark: z.enum(fieldMarks),
          reason: z.string().optional(),
        }),
      )
      .optional(),
    questions: z.array(question).optional(),
    /** The questions the person answered in their AI app, when it could ask them. */
    answered: z.array(z.enum(questionIds)).optional(),
    not_in_vocabulary: z
      .array(z.strictObject({ name: z.string(), suggestions: z.array(z.string()) }))
      .optional(),
    areas: z.array(z.strictObject({ id: z.string(), name: z.string() })).optional(),
    possible_duplicates: z.array(listed).optional(),
    overlaps: z
      .strictObject({
        accepted: z.array(listed),
        own_proposals: z.array(z.record(z.string(), z.unknown())),
      })
      .optional(),
    flags: z
      .array(
        z.strictObject({
          code: z.enum(provenanceFlagCodes),
          field: z.enum(markedFields),
          words: z.array(z.string()),
        }),
      )
      .optional(),
    findings: z.array(z.record(z.string(), z.unknown())).optional(),
    instructions: z.string().optional(),
  })
  .loose()
/** A delivered item, with its page in Heed (FR-347). The rest is the tool's own. */
const citedItem = z
  .object({
    id: z.string(),
    url: z.string().describe("The fact's page, for the person: link it where you cite the fact."),
    reviewed: z
      .object({ accepted_on: z.string(), accepted_by: z.string(), in_edition: z.string() })
      .optional()
      .describe(
        'How a person reviewed the fact before AI apps got it: the day it was accepted, the role that accepted it, and the edition that first had it. It names a role, never a person.',
      ),
  })
  .loose()
const said = {
  say: z
    .string()
    .min(1)
    .describe(
      'What you may tell the person about this result, in these words: plain sentences on what was read and what was found.',
    ),
  next: z
    .string()
    .min(1)
    .optional()
    .describe(
      'What to do next with this result: for you, not the person. When nothing was found, it says why that proves nothing and which call to make.',
    ),
  status: z.string(),
}
/**
 * What every read tool returns (its MCP output schema, FR-344): the status and, first, `say`, the
 * sentences for that status a model may repeat to the person, then `next`, the step for the
 * model. The rest is the tool's own; what serves a cache or an audit is in `_meta` (FR-346),
 * which an output schema does not describe.
 */
export const readOutput = z.object(said).loose()
/** A read tool that delivers items: each with its page in Heed (FR-347). */
export const deliveryOutput = z.object({ ...said, items: z.array(citedItem).optional() }).loose()
/** search_help: sections of Heed's help pages, each with its page in Heed (FR-348). */
export const helpOutput = z
  .object({
    ...said,
    results: z
      .array(
        z
          .object({
            page: z.string(),
            text: z.string(),
            url: z
              .string()
              .describe(
                'Where the section opens, for the person: link it where you answer from it.',
              ),
          })
          .loose(),
      )
      .optional(),
  })
  .loose()
/** read_item: the one item, with its page in Heed (FR-347). */
export const readItemOutput = z.object({ ...said, item: citedItem.optional() }).loose()
export type ContextInput = z.infer<typeof contextInput>
