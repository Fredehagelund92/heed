import * as z from 'zod/mini'

/*
  What a mention in an item's text can point at: a metric or a dimension (`metric:`, `dim:`), a
  dimension's value (`val:`), another item (`item:`), a domain (`area:`), or a term written in
  Definitions by its id (`term:<id>`, FR-138).
*/

export const mentionTargetSchema = z
  .string()
  .check(
    z.regex(
      /^(?:(?:metric|dim):[a-z0-9_]+|val:[a-z0-9_]+\/[a-z0-9_]+|item:itm_[a-z0-9]{8,16}|area:[a-z][a-z0-9_-]*|term:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/,
    ),
  )
export const mentionLabelSchema = z.string().check(
  z.minLength(1),
  z.refine((value) => [...value].length <= 120),
  z.regex(/^[^\]\r\n]+$/),
)
export const mentionSchema = z.object({
  field: z.enum(['summary', 'body']),
  position: z.number().check(z.int(), z.minimum(0)),
  target: mentionTargetSchema,
  label: mentionLabelSchema,
})
export type Mention = z.infer<typeof mentionSchema>
export type MentionPart =
  { kind: 'text'; text: string } | { kind: 'mention'; target: string; label: string }
export type MentionParse = {
  text: string
  parts: MentionPart[]
  mentions: Omit<Mention, 'field'>[]
  errors: number[]
}

/** Backslash escapes only backslash and @. Offsets are UTF-16; positions count tokens, per field. */
export function parseMentions(markup: string): MentionParse {
  const parts: MentionPart[] = []
  const mentions: MentionParse['mentions'] = []
  const errors: number[] = []
  let literal = ''
  const flush = () => {
    if (literal) {
      parts.push({ kind: 'text', text: literal })
      literal = ''
    }
  }
  for (let i = 0; i < markup.length;) {
    if (markup[i] === '\\' && (markup[i + 1] === '\\' || markup[i + 1] === '@')) {
      literal += markup[i + 1]
      i += 2
      continue
    }
    if (!markup.startsWith('@[', i)) {
      literal += markup[i]
      i++
      continue
    }
    const close = markup.indexOf(']', i + 2)
    const end = close < 0 ? -1 : markup.indexOf(')', close + 2)
    const label = close < 0 ? '' : markup.slice(i + 2, close)
    const target = end < 0 ? '' : markup.slice(close + 2, end)
    if (
      markup[close + 1] !== '(' ||
      !mentionLabelSchema.safeParse(label).success ||
      !mentionTargetSchema.safeParse(target).success
    ) {
      errors.push(i)
      // Preserve the malformed candidate as text; do not recover nested tokens inside it.
      const stop = end < 0 ? markup.length : end + 1
      literal += markup.slice(i, stop)
      i = stop
      continue
    }
    flush()
    parts.push({ kind: 'mention', label, target })
    mentions.push({ position: mentions.length, label, target })
    i = end + 1
  }
  flush()
  return {
    text: parts.map((p) => (p.kind === 'text' ? p.text : p.label)).join(''),
    parts,
    mentions,
    errors,
  }
}

export function serializeMentions(parts: readonly MentionPart[]): string {
  return parts
    .map((part) => {
      if (part.kind === 'text') return part.text.replace(/\\/g, '\\\\').replace(/@/g, '\\@')
      mentionLabelSchema.parse(part.label)
      mentionTargetSchema.parse(part.target)
      return `@[${part.label}](${part.target})`
    })
    .join('')
}

export function mentionsInFields(fields: {
  summaryMarkup?: string
  bodyMarkup?: string
}): Mention[] {
  return (['summary', 'body'] as const).flatMap((field) => {
    const markup = field === 'summary' ? fields.summaryMarkup : fields.bodyMarkup
    return markup === undefined
      ? []
      : parseMentions(markup).mentions.map((mention) => ({ ...mention, field }))
  })
}

export type MentionTarget = { target: string; state: 'current' | 'retired' | 'source_missing' }
export function validateMentionTargets(
  mentions: readonly Mention[],
  itemId: string,
  targets: readonly MentionTarget[],
  limit = 50,
): string[] {
  const known = new Map(targets.map((target) => [target.target, target.state]))
  const errors: string[] = []
  if (mentions.length > limit) errors.push(`At most ${limit} mentions are allowed`)
  for (const mention of mentions) {
    if (mention.target === `item:${itemId}`) errors.push('An item cannot mention itself')
    else if (known.get(mention.target) !== 'current')
      errors.push(`Mention target is not available: ${mention.target}`)
  }
  return [...new Set(errors)]
}

/** What can name another item: mention markup, its mention rows, and the replaces and conflicts lists. */
export type NamesItems = {
  summaryMarkup?: string
  bodyMarkup?: string
  mentions?: readonly Mention[]
  replaces?: readonly string[]
  conflicts?: readonly string[]
}

/** The ids of the items a version, a draft or a document names, each once. */
export function namedItems(value: NamesItems): string[] {
  const mentioned = [value.summaryMarkup, value.bodyMarkup].flatMap((markup) =>
    markup === undefined
      ? []
      : parseMentions(markup).mentions.flatMap(({ target }) =>
          target.startsWith('item:') ? [target.slice(5)] : [],
        ),
  )
  return [...new Set([...mentioned, ...(value.replaces ?? []), ...(value.conflicts ?? [])])]
}

/**
 * A version, a draft or a document as a reader sees it when the audience rule hides some of the
 * items it names (`hidden`, by id): a mention of one reads as its words only, as the plain text
 * does, and the replaces and conflicts lists leave it out. Neither its id nor a link to it reaches
 * the reader (FR-128, NFR-029). Mention rows are read again from the markup, so they still match.
 */
export function withoutItems<T extends NamesItems>(value: T, hidden: ReadonlySet<string>): T {
  if (!namedItems(value).some((id) => hidden.has(id))) return value
  const markup = (text: string | undefined) =>
    text === undefined
      ? undefined
      : serializeMentions(
          parseMentions(text).parts.map((part) =>
            part.kind === 'mention' &&
            part.target.startsWith('item:') &&
            hidden.has(part.target.slice(5))
              ? { kind: 'text', text: part.label }
              : part,
          ),
        )
  const summaryMarkup = markup(value.summaryMarkup)
  const bodyMarkup = markup(value.bodyMarkup)
  const kept = (ids: readonly string[] | undefined) => ids?.filter((id) => !hidden.has(id))
  return {
    ...value,
    ...(summaryMarkup === undefined ? {} : { summaryMarkup }),
    ...(bodyMarkup === undefined ? {} : { bodyMarkup }),
    ...(value.mentions ? { mentions: mentionsInFields({ summaryMarkup, bodyMarkup }) } : {}),
    ...(value.replaces ? { replaces: kept(value.replaces) } : {}),
    ...(value.conflicts ? { conflicts: kept(value.conflicts) } : {}),
  }
}
