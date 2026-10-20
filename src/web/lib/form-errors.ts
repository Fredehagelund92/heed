import type { FieldErrors, FieldValues } from 'react-hook-form'
import type { FormatFinding } from '@domain/draft'

/**
 * Validation messages in the one shape the forms use: a field path ("evidence.0.url") and the
 * words to show. Every source is turned into this list (the form's own schema, the service's
 * format findings, a parse of zod issues), in the order the fields appear on the page, so the
 * error summary links to them top to bottom.
 */
export type FormError = { field: string; message: string }

/** The first message for each field of a react-hook-form error tree, in `order` first. */
export function formErrorsFromFieldErrors<T extends FieldValues>(
  errors: FieldErrors<T>,
  order: readonly string[] = [],
): FormError[] {
  const found: FormError[] = []
  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== 'object') return
    const message = (node as { message?: unknown }).message
    if (typeof message === 'string' && message !== '') {
      found.push({ field: path, message })
      return
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'ref' || key === 'type' || key === 'types') continue
      walk(child, path ? `${path}.${key}` : key)
    }
  }
  walk(errors, '')
  return sortByOrder(found, order)
}

/** The service's format findings (FR-110 level 1) as field errors. Warnings are left out. */
export function formErrorsFromFindings(
  findings: readonly FormatFinding[],
  order: readonly string[] = [],
): FormError[] {
  const seen = new Set<string>()
  const errors: FormError[] = []
  for (const finding of findings) {
    if (finding.severity !== 'error' || seen.has(finding.field)) continue
    seen.add(finding.field)
    errors.push({ field: finding.field, message: finding.message })
  }
  return sortByOrder(errors, order)
}

/** zod issues (from `safeParse`) as field errors, one per field. */
export function formErrorsFromIssues(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
  order: readonly string[] = [],
): FormError[] {
  const seen = new Set<string>()
  const errors: FormError[] = []
  for (const issue of issues) {
    const field = issue.path.map(String).join('.')
    if (seen.has(field)) continue
    seen.add(field)
    errors.push({ field, message: issue.message })
  }
  return sortByOrder(errors, order)
}

/**
 * Sorts errors into the page's field order. A field is placed by the longest entry of `order`
 * it starts with, so `evidence.0.url` sorts with `evidence`; fields not in `order` go last, in
 * the order they came.
 */
export function sortByOrder(errors: FormError[], order: readonly string[]): FormError[] {
  if (order.length === 0) return errors
  const rank = (field: string) => {
    let best = -1
    let bestLength = -1
    order.forEach((name, index) => {
      if ((field === name || field.startsWith(`${name}.`)) && name.length > bestLength) {
        best = index
        bestLength = name.length
      }
    })
    return best === -1 ? order.length : best
  }
  return errors
    .map((error, index) => ({ error, index, rank: rank(error.field) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ error }) => error)
}

/** More than two errors add a summary at the top of the form (contract 9.9). */
export const ERROR_SUMMARY_THRESHOLD = 3

/** The id a field's control carries, so the summary can link to it: `field-evidence-0-url`. */
export function fieldControlId(field: string): string {
  return `field-${field.replace(/[^a-zA-Z0-9_-]+/g, '-')}`
}
