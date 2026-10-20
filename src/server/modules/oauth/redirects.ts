/**
 * Where a client may send a person back with a sign-in code (docs/ai-sign-in.md, "Redirect
 * rules"): https anywhere, or http on this computer for a desktop client (RFC 8252). Never a
 * wildcard, a fragment, credentials or another scheme. A requested address must equal a
 * registered one; only a loopback address may differ in its port, because a desktop client
 * listens on a port it picks when it starts (RFC 8252, section 7.3).
 */
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
export const maxRedirectLength = 512

/** Why an address cannot be a redirect address, or null when it can. */
export function redirectProblem(value: string): string | null {
  if (value.length > maxRedirectLength) return 'is too long'
  if (!URL.canParse(value)) return 'is not an absolute address'
  if (value.includes('*')) return 'holds a wildcard'
  if (value.includes('#')) return 'holds a fragment'
  const url = new URL(value)
  if (url.username || url.password) return 'holds credentials'
  if (url.protocol === 'https:') return null
  if (url.protocol === 'http:' && loopbackHosts.has(url.hostname)) return null
  return 'must use https, or http on this computer (localhost, 127.0.0.1 or [::1])'
}

/** Whether a requested redirect address is one of the client's registered ones. */
export function redirectMatches(registered: readonly string[], requested: string): boolean {
  if (redirectProblem(requested) !== null) return false
  if (registered.includes(requested)) return true
  const asked = new URL(requested)
  if (asked.protocol !== 'http:' || !loopbackHosts.has(asked.hostname)) return false
  return registered.some((address) => {
    if (redirectProblem(address) !== null) return false
    const known = new URL(address)
    return (
      known.protocol === 'http:' &&
      known.hostname === asked.hostname &&
      known.pathname === asked.pathname &&
      known.search === asked.search
    )
  })
}

/** The redirect address with the answer's parameters added to any query it already has. */
export function redirectWith(address: string, parameters: Record<string, string | undefined>) {
  const url = new URL(address)
  for (const [key, value] of Object.entries(parameters))
    if (value !== undefined) url.searchParams.set(key, value)
  return url.href
}
