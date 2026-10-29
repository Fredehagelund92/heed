/** A small seeded random generator, so fixtures are identical on every run and every machine. */
export type Random = {
  next: () => number
  int: (min: number, max: number) => number
  pick: <T>(items: readonly T[]) => T
  chance: (probability: number) => boolean
  weighted: <T>(entries: readonly (readonly [T, number])[]) => T
  shuffle: <T>(items: readonly T[]) => T[]
}

export function createRandom(seed: number): Random {
  // mulberry32
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1))
  const pick = <T>(items: readonly T[]): T => {
    const item = items[Math.floor(next() * items.length)]
    if (item === undefined) throw new Error('pick() needs a non-empty list')
    return item
  }
  const chance = (probability: number) => next() < probability
  const weighted = <T>(entries: readonly (readonly [T, number])[]): T => {
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0)
    let roll = next() * total
    for (const [value, weight] of entries) {
      roll -= weight
      if (roll < 0) return value
    }
    const last = entries[entries.length - 1]
    if (!last) throw new Error('weighted() needs a non-empty list')
    return last[0]
  }
  const shuffle = <T>(items: readonly T[]): T[] => {
    const copy = [...items]
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = int(0, i)
      const a = copy[i]
      const b = copy[j]
      if (a === undefined || b === undefined) continue
      copy[i] = b
      copy[j] = a
    }
    return copy
  }
  return { next, int, pick, chance, weighted, shuffle }
}

/** Adds days to an ISO date (UTC), returning an ISO date. */
export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
