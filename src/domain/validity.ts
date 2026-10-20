import * as z from 'zod/mini'

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export const calendarDateSchema = z
  .string()
  .check(z.refine(isCalendarDate, 'Expected a UTC calendar date'))
export const dateWindowSchema = z
  .object({ start: calendarDateSchema, end: z.nullable(calendarDateSchema) })
  .check(
    z.refine(
      ({ start, end }) => end === null || end > start,
      'End must be after start (exclusive)',
    ),
  )
export type DateWindow = z.infer<typeof dateWindowSchema>

export function overlaps(a: DateWindow, b: DateWindow): boolean {
  return (b.end === null || a.start < b.end) && (a.end === null || b.start < a.end)
}

export function shiftDate(day: string, days: number): string {
  calendarDateSchema.parse(day)
  if (!Number.isSafeInteger(days)) throw new Error('Days must be an integer')
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return calendarDateSchema.parse(date.toISOString().slice(0, 10))
}
