/**
 * Reporting a gap (FR-604, FR-606 cases 2 and 5, FR-611): the topic a resolved scope names, why a
 * scope names none, and what an anonymous note may not hold. The gateway's report_gap, a person's
 * report and the mock binding share them. Apart from gaps.ts, so the shell's first load, which
 * reads the gap statuses and types, does not carry the text check.
 */
import { textFindings, type FormatFinding } from './draft.ts'

/**
 * A topic as the gateway keeps it (FR-604): the area when every metric is in one, the sorted
 * metrics, values and dimensions named without a value, and the calendar month the dates start
 * in. Its key names it in `topics`.
 */
export type GapTopic = {
  key: string
  area: string | null
  metrics: string[]
  values: string[]
  /** Dimensions the question named without a value (FR-604). */
  dimensions: string[]
  month: string
}

/**
 * The one area the metrics belong to, else null: none of them has an area, or they span more than
 * one. A gap's topic and an assistant rating (FR-712) take their area this way.
 */
export function areaOfMetrics(
  metrics: readonly string[],
  metricArea: Record<string, string>,
): string | null {
  const areas = new Set(metrics.flatMap((m) => (metricArea[m] ? [metricArea[m]] : [])))
  return areas.size === 1 ? [...areas][0]! : null
}

/** The topic of a resolved scope. Built from the scope alone, never from question text. */
export function topicFor(
  scope: { metrics: string[]; filters: Record<string, string[]>; window: { start: string } },
  metricArea: Record<string, string>,
): GapTopic {
  const metrics = [...scope.metrics].sort()
  const values = [...new Set(Object.values(scope.filters).flat())].sort()
  // A dimension named without a value is part of the topic (FR-604); one with values is implied.
  const dimensions = Object.keys(scope.filters)
    .filter((dimension) => !scope.filters[dimension]!.length)
    .sort()
  const area = areaOfMetrics(metrics, metricArea)
  const month = scope.window.start.slice(0, 7) + '-01'
  return {
    // The dimensions segment is added only when present, so earlier topics keep their keys.
    key: [
      area ?? '',
      metrics.join(','),
      values.join(','),
      month.slice(0, 7),
      ...(dimensions.length ? [dimensions.join(',')] : []),
    ].join('|'),
    area,
    metrics,
    values,
    dimensions,
    month,
  }
}

/** Words in an anonymous note that FR-117's text check lets through but a note must not hold. */
const noteSecrets =
  /(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:bearer|password|secret|api[_ -]?key)\b|\b(?:sk-|AKIA)[A-Za-z0-9_-]{8,}|\b\+?\d[\d ()-]{7,}\d\b)/i

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/**
 * FR-611: what an anonymous note may not hold. It passes the text check of FR-117 and the
 * stricter words above, and must not carry the question either (FR-602), so a note that repeats
 * it is refused. report_gap, give_feedback and a person's report (case 5) all apply it.
 */
export function noteFindings(note: string, question?: string): FormatFinding[] {
  const findings = textFindings(note, 'note')
  if (!findings.length && noteSecrets.test(note))
    findings.push({
      code: 'personal_data',
      field: 'note',
      message: 'Text matches personal_data',
      severity: 'error',
    })
  if (
    question !== undefined &&
    words(question).length >= 12 &&
    words(note).includes(words(question))
  )
    findings.push({
      code: 'question_text',
      field: 'note',
      message: 'The note repeats the question',
      severity: 'error',
    })
  return findings
}
