import * as z from 'zod/mini'
import { itemSchema, creationChannels } from './item.ts'
import { dateWindowSchema, calendarDateSchema } from './validity.ts'
import { mentionSchema, mentionsInFields, parseMentions } from './mentions.ts'
import { contentDigest } from './canonical.ts'
import { limits } from './proposal-rules.ts'

const text = (max: number) =>
  z.string().check(z.refine((value) => value.trim().length > 0 && [...value].length <= max))
const metricKey = z.string().check(z.regex(/^(metric|group):[a-z0-9_]+$/))
const dimensionKey = z.string().check(z.regex(/^dim:[a-z0-9_]+$/))
const valueScope = z
  .object({
    dimension: dimensionKey,
    value: z.string().check(z.regex(/^val:[a-z0-9_]+\/[a-z0-9_]+$/)),
  })
  .check(
    z.refine(
      (row) => row.value.split('/')[0] === `val:${row.dimension.slice(4)}`,
      'Value must belong to its dimension',
    ),
  )

/** One source: a link, a sentence copied from it and the day it was read. */
export const evidenceEntrySchema = z.object({
  url: z.string().check(z.url(), z.regex(/^https?:\/\//), z.maxLength(limits.url)),
  quote: text(limits.quote),
  date: calendarDateSchema,
})

/** Governed version content, separate from the library projection and mutable source flags. */
export const itemVersionSchema = z
  .strictObject({
    kind: itemSchema.shape.kind,
    areaId: text(limits.areaId),
    title: text(limits.title),
    summary: z.string().check(z.refine((value) => [...value].length <= limits.summary)),
    body: z.optional(z.string().check(z.refine((value) => [...value].length <= limits.body))),
    summaryMarkup: z.optional(z.string()),
    bodyMarkup: z.optional(z.string()),
    mentions: z.array(mentionSchema).check(z.maxLength(limits.mentions)),
    /**
     * `dimensions` names a dimension with any value ("market: any value", FR-126): the item applies
     * whenever a question names that dimension or one of its values, and never when it names neither.
     */
    scope: z.object({
      metrics: z.array(metricKey),
      dimensions: z._default(z.array(dimensionKey), []),
      dimensionValues: z.array(valueScope),
    }),
    validity: dateWindowSchema,
    reviewDate: z.nullable(calendarDateSchema),
    evidence: z.array(evidenceEntrySchema).check(z.minLength(1)),
    references: z.array(text(limits.reference)),
    changeMarks: z.record(z.string(), text(limits.reference)),
    claimLevel: itemSchema.shape.claimLevel,
    claimAuthority: z.optional(text(limits.claimAuthority)),
    claimQuote: z.optional(text(limits.claimQuote)),
    riskLevel: itemSchema.shape.riskLevel,
    audience: z.object({ kind: z.literal('everyone') }),
    ownerId: text(limits.ownerId),
    /** Who proposed it; null for a version a content source's read made (CON-603). */
    proposerId: z.nullable(text(limits.ownerId)),
    createdVia: z.enum(creationChannels),
    notToConclude: text(limits.notToConclude),
    replaces: z.array(z.string().check(z.regex(/^itm_[a-z0-9]{8,16}$/))),
    conflicts: z.array(z.string().check(z.regex(/^itm_[a-z0-9]{8,16}$/))),
  })
  .check(
    z.refine(
      (value) =>
        value.scope.metrics.length +
          value.scope.dimensions.length +
          value.scope.dimensionValues.length >
        0,
      'An item needs scope; mentions do not count',
    ),
    z.refine(
      (value) =>
        !value.scope.dimensionValues.some((row) => value.scope.dimensions.includes(row.dimension)),
      'A dimension with any value cannot also list its values',
    ),
    z.refine(
      (value) => (value.createdVia === 'source') === (value.proposerId === null),
      'A version has a proposer unless a content source made it',
    ),
    z.refine(
      (value) => value.validity.end !== null || value.reviewDate !== null,
      'An open-ended item needs a review date',
    ),
    z.refine(
      (value) =>
        value.claimLevel === 'effect_stated'
          ? value.claimAuthority !== undefined && value.claimQuote !== undefined
          : value.claimAuthority === undefined && value.claimQuote === undefined,
      'An effect claim needs an authority and quote',
    ),
    z.refine(
      (value) =>
        [
          value.scope.metrics,
          value.scope.dimensions,
          value.scope.dimensionValues.map((row) => row.value),
          value.references,
          value.replaces,
          value.conflicts,
        ].every((keys) => new Set(keys).size === keys.length),
      'Duplicate references are not allowed',
    ),
    z.refine(
      (value) =>
        Object.keys(value.changeMarks).every((key) => value.references.includes(key)) &&
        value.references.every((key) => Object.hasOwn(value.changeMarks, key)),
      'Each reference needs its reviewed change mark',
    ),
    z.refine(
      (value) =>
        (['summary', 'body'] as const).every((field) => {
          const markup = field === 'summary' ? value.summaryMarkup : value.bodyMarkup
          if (markup === undefined) return true
          const parsed = parseMentions(markup)
          return parsed.errors.length === 0 && parsed.text === value[field]
        }),
      'Mention markup must be valid and equal its plain text',
    ),
    z.refine((value) => {
      const parsed = mentionsInFields(value)
      return (
        parsed.length === value.mentions.length &&
        parsed.every((mention, index) => {
          const row = value.mentions[index]!
          return (
            mention.field === row.field &&
            mention.position === row.position &&
            mention.target === row.target &&
            mention.label === row.label
          )
        })
      )
    }, 'Mention rows must match the markup in field order'),
    z.refine(
      (value) =>
        [
          value.title,
          value.notToConclude,
          value.claimAuthority ?? '',
          value.claimQuote ?? '',
          ...value.evidence.map((row) => row.quote),
        ].every((field) => parseMentions(field).mentions.length === 0),
      'Mentions are only allowed in summary and body',
    ),
  )
export type ItemVersion = z.infer<typeof itemVersionSchema>

/**
 * What a version's two digests are taken over: `content` is all of it, with its lists in a
 * stable order; `core` leaves out the review date and change marks, which a recheck (CON-211)
 * moves. Two versions have the same digest exactly when these are the same canonical JSON. The
 * owner goes in under the field's first name, `stewardId`, so every digest stored before the
 * rename (0086) still matches its content.
 */
export function itemVersionDigestInput(input: ItemVersion): { content: unknown; core: unknown } {
  const { ownerId, ...parsed } = itemVersionSchema.parse(input)
  const value = {
    ...parsed,
    stewardId: ownerId,
    references: [...parsed.references].sort(),
    scope: {
      metrics: [...parsed.scope.metrics].sort(),
      // Left out when empty, so a version saved before dimensions with any value keeps its digest.
      ...(parsed.scope.dimensions.length
        ? { dimensions: [...parsed.scope.dimensions].sort() }
        : {}),
      dimensionValues: [...parsed.scope.dimensionValues].sort((a, b) =>
        a.value < b.value ? -1 : a.value > b.value ? 1 : 0,
      ),
    },
    replaces: [...parsed.replaces].sort(),
    conflicts: [...parsed.conflicts].sort(),
  }
  const { reviewDate: _review, changeMarks: _marks, ...core } = value
  const defined = (fields: object) =>
    Object.fromEntries(Object.entries(fields).filter(([, field]) => field !== undefined))
  return { content: defined(value), core: defined(core) }
}

export function itemVersionDigests(input: ItemVersion): Promise<{ content: string; core: string }> {
  const { content, core } = itemVersionDigestInput(input)
  return Promise.all([contentDigest(content), contentDigest(core)]).then(([content, core]) => ({
    content,
    core,
  }))
}

/** The schema of an item file as written: a field with a default, such as `scope.dimensions`, may be left out. */
export function itemJsonSchema() {
  return z.toJSONSchema(itemVersionSchema, { io: 'input' })
}
