import type { Finding } from '@/api/errors'

// What the service finds wrong with a draft, put where the editor can show it: at the field it is
// about. The service names a field by its place in the stored version ("evidence.0.url"); the
// editor has a title, the text and a few properties.

export type EditorField = 'title' | 'text' | 'domain' | 'where' | 'when' | 'source' | 'dont'

/** The editor's field for a stored field, or null for one the editor has no place for. */
export function editorFieldOf(field: string): EditorField | null {
  const head = field.split('.')[0]
  switch (head) {
    case 'title':
      return 'title'
    case 'summary':
    case 'summaryMarkup':
    case 'body':
    case 'bodyMarkup':
    case 'mentions':
      return 'text'
    case 'areaId':
      return 'domain'
    case 'scope':
      return 'where'
    case 'validity':
    case 'reviewDate':
      return 'when'
    case 'evidence':
      return 'source'
    case 'notToConclude':
      return 'dont'
    default:
      return null
  }
}

/** Words a validation library gives when it has nothing of its own to say. */
const stock = /^(invalid |too (small|big)|expected |required|text matches )/i

/** Why a field was refused, in a sentence for the person writing: the service's own when it has one. */
function reasonOf({ field, message }: Finding): string {
  if (/^text matches /i.test(message))
    return 'This looks like a private detail, such as an email address, a phone number or a secret. Take it out.'
  if (!stock.test(message)) return message
  if (/^evidence\.\d+\.url$/.test(field))
    return 'That is not a web link. Paste an address that starts with https://.'
  if (/^evidence\.\d+\.quote$/.test(field))
    return 'Add a sentence copied from the source, and keep it short.'
  if (field === 'evidence') return 'Add a source.'
  switch (editorFieldOf(field)) {
    case 'title':
      return 'The title is empty or too long.'
    case 'text':
      return 'The text is too long.'
    case 'where':
      return 'Add where it applies.'
    case 'when':
      return 'These dates do not fit. The last day must come after the first.'
    case 'dont':
      return 'This is empty or too long.'
    default:
      return 'The service does not accept this.'
  }
}

export type Problems = {
  /** One reason per editor field. */
  at: Partial<Record<EditorField, string>>
  /** Reasons for something the editor has no field for. */
  elsewhere: string[]
}

/** The refusal's reasons, each at its field, the first reason for a field when it has several. */
export function problemsOf(findings: readonly Finding[]): Problems {
  const at: Problems['at'] = {}
  const elsewhere: string[] = []
  for (const finding of findings) {
    const field = editorFieldOf(finding.field)
    const reason = reasonOf(finding)
    if (!field) elsewhere.push(reason)
    else at[field] ??= reason
  }
  return { at, elsewhere }
}

/** Whether text is a web link the service takes as a source: http or https, with a host. */
export function isLink(text: string): boolean {
  if (!/^https?:\/\/\S+$/i.test(text)) return false
  try {
    return new URL(text).hostname !== ''
  } catch {
    return false
  }
}

/** Why a source is not a link yet, or an empty string for a link or for nothing at all. */
export const sourceProblem = (source: string) =>
  source.trim() && !isLink(source.trim())
    ? 'That is not a web link. Paste an address that starts with https://.'
    : ''
