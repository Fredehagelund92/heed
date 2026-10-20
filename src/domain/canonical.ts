/** JSON object keys use UTF-16 order. Arrays retain their order; non-JSON data is refused. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>()
  function encode(input: unknown): string {
    if (input === null || typeof input === 'boolean') return JSON.stringify(input)
    if (typeof input === 'string') {
      if (/[\uD800-\uDFFF]/u.test(input)) throw new Error('JSON strings must contain valid Unicode')
      return JSON.stringify(input)
    }
    if (typeof input === 'number' && Number.isFinite(input)) return JSON.stringify(input)
    if (typeof input !== 'object' || input === null) throw new Error('Expected a JSON value')
    if (ancestors.has(input)) throw new Error('Cyclic JSON value')
    ancestors.add(input)
    let result: string
    if (Array.isArray(input)) {
      result = `[${Array.from(input, (entry: unknown) => encode(entry)).join(',')}]`
    } else {
      if (
        Object.getPrototypeOf(input) !== Object.prototype &&
        Object.getPrototypeOf(input) !== null
      )
        throw new Error('Expected a plain JSON object')
      if (Object.getOwnPropertySymbols(input).length)
        throw new Error('JSON objects cannot have symbol keys')
      const record = input as Record<string, unknown>
      result = `{${Object.keys(record)
        .sort()
        .map((key) => `${encode(key)}:${encode(record[key])}`)
        .join(',')}}`
    }
    ancestors.delete(input)
    return result
  }
  return encode(value)
}

export async function sha256(text: string): Promise<string> {
  if (/[\uD800-\uDFFF]/u.test(text)) throw new Error('Digest input must contain valid Unicode')
  const bytes = new TextEncoder().encode(text)
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
export function contentDigest(value: unknown): Promise<string> {
  return sha256(canonicalJson(value))
}

export type EditionContent = {
  items: readonly { id: string; digest: string }[]
  vocabulary: readonly { key: string; digest: string }[]
  areas: readonly { id: string; state: 'not_started' | 'starting' | 'live' | 'paused' }[]
  /** The domains the definition source gave terms (0054); editions sealed before have none. */
  domains?: readonly { key: string; areaId: string }[]
}

/** The same newline-separated preimage as edition_content_digest; labels are not content. */
export function editionDigest(content: EditionContent): Promise<string> {
  for (const rows of [
    content.items.map((row) => row.id),
    content.vocabulary.map((row) => row.key),
    content.areas.map((row) => row.id),
    (content.domains ?? []).map((row) => row.key),
  ]) {
    if (new Set(rows).size !== rows.length || rows.some((key) => !/^[a-z0-9_:/-]+$/.test(key)))
      throw new Error('Invalid or duplicate edition key')
  }
  if ((content.domains ?? []).some((row) => !/^[a-z0-9_]+$/.test(row.areaId)))
    throw new Error('Invalid edition domain')
  for (const row of [...content.items, ...content.vocabulary])
    if (!/^[0-9a-f]{64}$/.test(row.digest)) throw new Error('Expected a SHA-256 digest')
  return sha256(
    [
      ...content.items.map((row) => `item:${row.id}:${row.digest}`),
      ...content.vocabulary.map((row) => `vocab:${row.key}:${row.digest}`),
      ...content.areas.map((row) => `area:${row.id}:${row.state}`),
      ...(content.domains ?? []).map((row) => `domain:${row.key}:${row.areaId}`),
    ]
      .sort()
      .join('\n'),
  )
}
