import { dateLabel, whenLabel, type Validity } from '@/model/validity'

// The edit pages' When: six presets over the stored dates, and the one line the field shows.

export type WhenMode = 'always' | 'from' | 'until' | 'between' | 'ongoing' | 'day'

export const WHEN_PRESETS: { value: WhenMode; label: string }[] = [
  { value: 'always', label: 'Always' },
  { value: 'from', label: 'From a date' },
  { value: 'until', label: 'Until a date' },
  { value: 'between', label: 'Between dates' },
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'day', label: 'A single day' },
]

export type WhenValue = { mode: WhenMode; from: string; until: string }

/** The stored dates a When says. Ongoing may start on a date or not. */
export function validOfWhen(w: WhenValue): Validity {
  switch (w.mode) {
    case 'always':
      return {}
    case 'from':
      return { from: w.from || undefined }
    case 'until':
      return { until: w.until || undefined }
    case 'between':
      return { from: w.from || undefined, until: w.until || undefined }
    case 'ongoing':
      return { from: w.from || undefined, ongoing: true }
    case 'day':
      return { from: w.from || undefined, until: w.from || undefined }
  }
}

/** The editor's When from stored dates. */
export function whenOfValid(v: Validity): WhenValue {
  const mode: WhenMode =
    v.from && v.until
      ? v.from === v.until
        ? 'day'
        : 'between'
      : v.until
        ? 'until'
        : v.ongoing
          ? 'ongoing'
          : v.from
            ? 'from'
            : 'always'
  return { mode, from: v.from ?? '', until: v.until ?? '' }
}

/** Which dates a mode still needs, so the field can say so instead of showing half a sentence. */
export function missingDates(w: WhenValue) {
  if (w.mode === 'from' || w.mode === 'day') return !w.from
  if (w.mode === 'until') return !w.until
  if (w.mode === 'between') return !w.from || !w.until
  return false
}

/** The When in one line: "From 4 Aug 2026, still going on", or what is left to pick. */
export function whenSummary(w: WhenValue) {
  if (!missingDates(w)) return whenLabel(validOfWhen(w))
  if (w.mode === 'between')
    return w.from ? `From ${dateLabel(w.from)} - pick the end` : 'Between dates - pick the start'
  return `${WHEN_PRESETS.find((p) => p.value === w.mode)!.label} - pick a date`
}
