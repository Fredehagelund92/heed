import * as z from 'zod/mini'
import { evidenceEntrySchema, itemVersionSchema, type ItemVersion } from './item-version.ts'
import { mentionsInFields, parseMentions } from './mentions.ts'
import { draftStorageLimits, limits } from './proposal-rules.ts'

const {
  proposerId: _proposer,
  createdVia: _channel,
  mentions: _mentions,
  summary: _summary,
  body: _body,
  ...editable
} = itemVersionSchema.shape
/** Incomplete forms can be saved. Identity and derived mention rows are never client inputs. */
export const draftSchema = z.partial(
  z.strictObject({
    ...editable,
    title: z.string().check(z.maxLength(limits.title)),
    validity: z.object({
      start: z.string().check(z.maxLength(draftStorageLimits.date)),
      end: z.nullable(z.string().check(z.maxLength(draftStorageLimits.date))),
    }),
    reviewDate: z.nullable(z.string().check(z.maxLength(draftStorageLimits.date))),
    evidence: z.array(
      z.object({
        url: z.string().check(z.maxLength(limits.url)),
        quote: z.string().check(z.maxLength(limits.quote)),
        date: z.string().check(z.maxLength(draftStorageLimits.date)),
      }),
    ),
    ownerId: z.string().check(z.uuid()),
    summary: z.string().check(z.maxLength(draftStorageLimits.summary)),
    body: z.string().check(z.maxLength(draftStorageLimits.body)),
  }),
)
export type Draft = z.infer<typeof draftSchema>
export type FormatFinding = {
  code: string
  field: string
  message: string
  severity: 'error' | 'warning'
}

/**
 * Level 1's outcome: it fails on an error only. A warning (a broad scope, a domain the source
 * gives elsewhere, a changed definition) is shown to the reviewer and never blocks (FR-505, FR-209).
 */
export const formatOutcome = (
  findings: readonly Pick<FormatFinding, 'severity'>[],
): 'passed' | 'failed' =>
  findings.some((finding) => finding.severity === 'error') ? 'failed' : 'passed'

const patterns: [string, RegExp][] = [
  ['email_address', /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i],
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['access_key', /\b(?:AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,})\b/],
  [
    'password_or_token',
    /\b(?:password|passwd|secret|api[_ -]?key|access[_ -]?token)\s*[:=]\s*\S+|\bBearer\s+[A-Za-z0-9._~-]{12,}/i,
  ],
  [
    'phone_number',
    /(?:\+\d{1,3}[ ()-]*)?(?:\(\d{3}\)[ -]*\d{3}[ -]*\d{4}|\b\d{3}[ -]\d{3}[ -]\d{4}\b)/,
  ],
]
/**
 * Where in one text each pattern of FR-117 matches, so an editor can mark the words. The same
 * patterns as `textFindings`; offsets are UTF-16.
 */
export function sensitiveMatches(text: string): { code: string; start: number; end: number }[] {
  return patterns.flatMap(([code, pattern]) =>
    [...text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))].map((match) => ({
      code,
      start: match.index,
      end: match.index + match[0].length,
    })),
  )
}
export function textFindings(value: unknown, field = ''): FormatFinding[] {
  if (typeof value === 'string')
    return patterns
      .filter(([, pattern]) => pattern.test(value))
      .map(([code]) => ({ code, field, message: `Text matches ${code}`, severity: 'error' }))
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) =>
    textFindings(child, field ? `${field}.${key}` : key),
  )
}
export function assembleDraft(
  draft: Draft,
  proposerId: string | null,
  createdVia: ItemVersion['createdVia'],
) {
  const { summaryMarkup, bodyMarkup } = draft
  return {
    ...draft,
    ...(summaryMarkup === undefined ? {} : { summary: parseMentions(summaryMarkup).text }),
    ...(bodyMarkup === undefined ? {} : { body: parseMentions(bodyMarkup).text }),
    proposerId,
    createdVia,
    mentions: mentionsInFields(draft),
  }
}
export function formatDraft(
  draft: Draft,
  proposerId: string | null,
  channel: ItemVersion['createdVia'],
) {
  const candidate = assembleDraft(draft, proposerId, channel)
  const parsed = itemVersionSchema.safeParse(candidate)
  const findings: FormatFinding[] = textFindings(draft)
  if (!parsed.success)
    findings.push(
      ...parsed.error.issues.map((issue) => ({
        code: 'format',
        field: issue.path.join('.'),
        message: issue.message,
        severity: 'error' as const,
      })),
    )
  return { findings, version: parsed.success ? parsed.data : null }
}

/** A finding about where the draft comes from: its links, quotes and the days they were read. */
export const isEvidenceFinding = (finding: Pick<FormatFinding, 'code' | 'field'>) =>
  finding.code === 'format' &&
  (finding.field === 'evidence' || finding.field.startsWith('evidence.'))

/**
 * FR-108: the version the live preview shows. Where the draft comes from does not change what an
 * agent is told about matching, so a draft whose only errors are in its evidence previews too,
 * with the evidence entries that are complete. Any other error, or sensitive text anywhere, still
 * stops the preview.
 */
export function previewVersion(
  draft: Draft,
  proposerId: string | null,
  channel: ItemVersion['createdVia'],
): { findings: FormatFinding[]; version: ItemVersion | null } {
  const checked = formatDraft(draft, proposerId, channel)
  if (
    checked.version ||
    checked.findings.some((finding) => finding.severity === 'error' && !isEvidenceFinding(finding))
  )
    return checked
  const complete = (draft.evidence ?? []).filter(
    (entry) => evidenceEntrySchema.safeParse(entry).success,
  )
  const standIn = { url: 'https://example.com', quote: 'Evidence to come', date: '2000-01-01' }
  const whole = formatDraft(
    { ...draft, evidence: complete.length ? complete : [standIn] },
    proposerId,
    channel,
  )
  return {
    findings: checked.findings,
    version: whole.version && { ...whole.version, evidence: complete },
  }
}
