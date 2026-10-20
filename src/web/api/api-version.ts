/**
 * Whether the web app and the Heed service come from the same code. Every answer of the service
 * names the contract it speaks in the `x-heed-api` header (src/server/http/api.ts), and the app is
 * built with the digest of the same contract (api-version.json, `npm run api:generate`). They
 * differ after an update when one side was not started again: a page left open from before the
 * update (`page`), or a service started before it (`service`), such as one whose clone was
 * updated while it ran. The web server serves the digest of the build it serves at
 * `/heed-version.json` (vite.config.ts), which tells the two apart.
 */
import built from './api-version.json' with { type: 'json' }

export const API_VERSION_HEADER = 'x-heed-api'
export const VERSION_FILE = '/heed-version.json'

/** Which side is older than the other; `checking` while the web server's build is read. */
export type Outdated = 'page' | 'service' | 'checking'

let outdated: Outdated | null = null
/** The contract the service named last, so a second answer naming it starts no second check. */
let seen: string | null = null
const listeners = new Set<() => void>()

function set(next: Outdated | null) {
  if (next === outdated) return
  outdated = next
  for (const listener of listeners) listener()
}

/** Reads the contract the web server's build speaks; null when it cannot be read. */
async function servedBuild(): Promise<string | null> {
  try {
    const response = await fetch(VERSION_FILE, { cache: 'no-store' })
    if (!response.ok) return null
    const body = (await response.json()) as { api?: unknown }
    return typeof body.api === 'string' ? body.api : null
  } catch {
    return null
  }
}

/**
 * Notes the contract an answer of the service named. One that differs from the app's own starts
 * the check of which side is older: when the web server serves a build that speaks the service's
 * contract, this page is the old one. An answer naming the app's own contract again (the service
 * was started again) clears it. An answer that names none, as from a service of before this
 * header, says nothing.
 */
export function noteServiceVersion(
  served: string | null,
  ownVersion: string = built.api,
  readBuild: () => Promise<string | null> = servedBuild,
): void {
  if (!served || served === seen) return
  seen = served
  if (served === ownVersion) {
    set(null)
    return
  }
  set('checking')
  void readBuild().then((build) => {
    if (seen === served) set(build === served ? 'page' : 'service')
  })
}

export function outdatedSide(): Outdated | null {
  return outdated
}

export function subscribeOutdated(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Forgets what the service named; for tests. */
export function resetOutdated(): void {
  seen = null
  set(null)
}

/** What to do about it, in a sentence or two (NFR-016). */
export function updateAdvice(side: Outdated): string {
  if (side === 'page') return 'The app was updated. Reload the page to use the new version.'
  if (side === 'checking') return 'The app was updated.'
  return 'The app was updated and is still starting. Try again in a few minutes.'
}
