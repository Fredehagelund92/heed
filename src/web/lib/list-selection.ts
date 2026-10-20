/** The inclusive range in displayed order; hidden or missing endpoints select nothing. */
export function selectionRange(ids: readonly string[], anchor: string, target: string): string[] {
  const from = ids.indexOf(anchor)
  const to = ids.indexOf(target)
  if (from === -1 || to === -1) return []
  return ids.slice(Math.min(from, to), Math.max(from, to) + 1)
}
