import { deriveAgentDraft, type DerivationContext } from './agent-draft.ts'
import { contentDigest } from './canonical.ts'
import type { SourceDocument } from './connector-runtime.ts'
import { markdownBlocks } from './doc-diff.ts'
import type { Draft } from './draft.ts'
import { textFindings } from './draft.ts'
import { limits, type FieldMark, type MarkedField } from './proposal-rules.ts'

/*
  A content source's document as a suggestion (docs/connectors.md, "The two pipelines", content;
  CON-603 to CON-608). Pure: the same document gives the same mark and the same draft.

  The text is data, never instructions (I-7): it fills the fields of a draft that an owner
  reviews, and nothing in it is acted on. Its title and summary are prefilled from the document,
  its evidence is the document's link and a quote of at most 500 characters, its domain is the
  one the administrator gave the document's scope, and where it applies comes from the names of
  the vocabulary it uses. Audience, risk, owner and links are never inferred (CON-603): they keep
  their defaults and say so.
*/

/** The most text of one document the pipeline reads; a longer one is left out with a warning. */
export const DOCUMENT_TEXT_MAX = 200_000

/** The most text one content read holds in memory; past it the read is in part. */
export const READ_TEXT_MAX = 64_000_000

/**
 * The warnings that name a document a read saw and could not hand over (too long, or not
 * readable): it is not gone, only not read this time, so its suggestion stays.
 */
export const unreadDocumentCodes: readonly string[] = ['document_too_large', 'unreadable_file']

/** Why a document is not offered as a suggestion. */
export type SkipReason =
  /** It holds an email address or a phone number: it appears to name people (CON-608). */
  | 'names_people'
  /** It holds what looks like a password, a token or a key. */
  | 'holds_secret'
  /** It names no metric, market or other term of the vocabulary, so it applies nowhere. */
  | 'no_scope'
  /** It holds no words. */
  | 'empty'

/** The text as the pipeline compares it: line ends, trailing spaces and blank runs do not count. */
export function normalisedText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/^\uFEFF/, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * The change mark of a document (CON-605): its title and its normalised text. A document whose
 * mark the pipeline has seen holds nothing new; where it sits in the tool does not count.
 */
export function documentMark(document: Pick<SourceDocument, 'title' | 'text'>): Promise<string> {
  return contentDigest({ title: document.title.trim(), text: normalisedText(document.text) })
}

const words = (markdown: string) =>
  markdownBlocks(markdown).flatMap((block) =>
    block.shape.type === 'rule' || !block.text.trim() ? [] : [block],
  )

/** The document's first sentence, at most 500 characters: the evidence quote, and all that is kept. */
export function documentQuote(text: string): string {
  const first =
    words(normalisedText(text)).find((block) => block.shape.type !== 'heading')?.text ??
    words(normalisedText(text))[0]?.text ??
    ''
  const sentence = first.match(/^[\s\S]*?[.!?](?=\s|$)/)?.[0] ?? first
  return [...sentence.trim()].slice(0, limits.quote).join('')
}

/** Why a document is skipped, before anything is drafted from it; null when it may be. */
export function skipReason(text: string): SkipReason | null {
  const plain = normalisedText(text)
  if (!plain) return 'empty'
  const codes = new Set(textFindings(plain).map((finding) => finding.code))
  if (codes.has('email_address') || codes.has('phone_number')) return 'names_people'
  if (codes.size) return 'holds_secret'
  return null
}

/**
 * The summary: the whole sentences of the first paragraph that fit a summary, or its first words
 * when not even one sentence fits.
 */
function leadOf(paragraph: string): string {
  let lead = ''
  for (const match of paragraph.matchAll(/\S[\s\S]*?(?:(?<=[.!?])(?=\s)|$)/g)) {
    const next = lead ? `${lead} ${match[0]}` : match[0]
    if ([...next].length > limits.summary) break
    lead = next
  }
  if (lead) return lead
  const words = [...paragraph].slice(0, limits.summary - 3).join('')
  return `${words.slice(0, Math.max(words.lastIndexOf(' '), 1)).trimEnd()}...`
}

/** The Markdown with a first heading that only repeats the title taken off. */
function withoutTitle(markdown: string, title: string): string {
  const lines = markdown.split('\n')
  const first = lines.findIndex((line) => line.trim())
  const heading = first >= 0 ? lines[first]!.match(/^#{1,6}\s+(.*?)\s*#*\s*$/) : null
  if (heading && heading[1]!.trim().toLowerCase() === title.trim().toLowerCase())
    return lines
      .slice(first + 1)
      .join('\n')
      .trim()
  return markdown
}

/** The Markdown with its first paragraph taken off, when the summary is all of it. */
function withoutParagraph(markdown: string, paragraph: string): string {
  const parts = markdown.split(/\n\s*\n/)
  const index = parts.findIndex((part) => {
    const block = words(part)[0]
    return block !== undefined && block.shape.type !== 'heading'
  })
  if (index < 0) return markdown
  const [block] = words(parts[index]!)
  if (block?.text.trim() !== paragraph.trim()) return markdown
  return parts
    .filter((_, at) => at !== index)
    .join('\n\n')
    .trim()
}

/** At most the body's limit, cut at the last paragraph that fits. */
function capped(markdown: string): string {
  if ([...markdown].length <= limits.body) return markdown
  const kept: string[] = []
  let length = 0
  for (const part of markdown.split(/\n\s*\n/)) {
    const next = length + [...part].length + (kept.length ? 2 : 0)
    if (next > limits.body) break
    kept.push(part)
    length = next
  }
  return kept.length ? kept.join('\n\n') : [...markdown].slice(0, limits.body).join('')
}

export type DocumentDraft =
  | {
      draft: Draft
      /** Where each field came from, for the owner (FR-121). */
      marks: Partial<Record<MarkedField, FieldMark>>
    }
  | { skip: SkipReason }

/**
 * The draft a document becomes, for the domain of its scope (CON-602, CON-603), or why it is
 * skipped. The service then fills the defaults any proposal gets (owner, review date) and checks
 * it the same way.
 */
export function documentDraft(
  document: SourceDocument,
  domain: string,
  context: DerivationContext,
): DocumentDraft {
  const skip = skipReason(document.text)
  if (skip) return { skip }
  const title = [...document.title.trim()].slice(0, limits.title).join('')
  const markdown = withoutTitle(normalisedText(document.text), title)
  const paragraphs = words(markdown).filter((block) => block.shape.type !== 'heading')
  if (!paragraphs.length) return { skip: 'empty' }
  const summary = leadOf(paragraphs[0]!.text)
  const derived = deriveAgentDraft(
    { text: paragraphs.map((block) => block.text).join('\n\n'), summary, title },
    context,
  )
  const scope = derived.draft.scope
  if (!scope || scope.metrics.length + scope.dimensions.length + scope.dimensionValues.length === 0)
    return { skip: 'no_scope' }
  const body = capped(withoutParagraph(markdown, summary))
  const read = document.modifiedAt.slice(0, 10)
  const quote = documentQuote(document.text)
  const draft: Draft = {
    kind: derived.draft.kind ?? 'note',
    areaId: domain,
    title,
    summary,
    ...(body ? { body } : {}),
    scope,
    validity: derived.draft.validity ?? { start: read, end: null },
    evidence: [{ url: document.link, quote: quote || title, date: read }],
  }
  return {
    draft,
    marks: {
      kind: 'prefilled',
      areaId: 'derived',
      ownerId: 'not_inferred',
      title: 'prefilled',
      summary: 'prefilled',
      ...(body ? { body: 'prefilled' as const } : {}),
      scope: 'prefilled',
      validity: derived.draft.validity ? 'prefilled' : 'default',
      reviewDate: 'default',
      evidence: 'derived',
      riskLevel: 'not_inferred',
      audience: 'not_inferred',
      replaces: 'not_inferred',
      conflicts: 'not_inferred',
    },
  }
}
