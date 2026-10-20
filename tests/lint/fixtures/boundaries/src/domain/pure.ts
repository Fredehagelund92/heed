// Allowed: pure code that takes today as an argument.
import * as z from 'zod/mini'

export const isoDate = z.string()

export function addDays(today: string): string {
  return isoDate.parse(new Date(`${today}T00:00:00Z`).toISOString().slice(0, 10))
}
