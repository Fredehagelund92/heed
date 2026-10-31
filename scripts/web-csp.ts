import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

/*
  The web image's security headers (Dockerfile, `web-build`): docker/security-headers.conf with
  the hash of each script the built index.html carries inline, so the Content-Security-Policy
  lets exactly those run and no other inline script.

    node scripts/web-csp.ts <index.html> <security-headers.conf> <out>
*/

const PLACEHOLDER = 'INLINE_SCRIPT_HASHES'

/** The CSP source of each inline script in a page: 'sha256-<base64>' of its exact text. */
export function inlineScriptHashes(html: string): string[] {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attributes]) => !/\bsrc\s*=/i.test(attributes!))
    .map(([, , body]) => `'sha256-${createHash('sha256').update(body!).digest('base64')}'`)
}

/** The headers file with the page's inline script hashes in place. */
export function securityHeaders(template: string, html: string): string {
  if (!template.includes(PLACEHOLDER))
    throw new Error(`The headers file has no ${PLACEHOLDER} to fill in`)
  return template.replaceAll(PLACEHOLDER, inlineScriptHashes(html).join(' '))
}

if (import.meta.main) {
  const [page, template, out] = process.argv.slice(2)
  if (!page || !template || !out)
    throw new Error('Usage: node scripts/web-csp.ts <index.html> <security-headers.conf> <out>')
  writeFileSync(out, securityHeaders(readFileSync(template, 'utf8'), readFileSync(page, 'utf8')))
}
