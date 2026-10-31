import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { inlineScriptHashes, securityHeaders } from '../../scripts/web-csp.ts'

const sha = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`
const template = readFileSync(
  new URL('../../docker/security-headers.conf', import.meta.url),
  'utf8',
)

describe('the web image security headers', () => {
  const page = [
    '<html><head><script>;(function () { theme() })()\n</script>',
    '<script type="module" crossorigin src="/assets/index.js"></script>',
    '</head><body><script>\nsecond()</script></body></html>',
  ].join('\n')

  it('hash each inline script exactly, and no script loaded from a file', () => {
    expect(inlineScriptHashes(page)).toEqual([
      sha(';(function () { theme() })()\n'),
      sha('\nsecond()'),
    ])
  })

  it('let only those inline scripts run', () => {
    const headers = securityHeaders(template, page)
    const csp = /Content-Security-Policy "([^"]+)"/.exec(headers)![1]!
    const scriptSrc = csp.split('; ').find((part) => part.startsWith('script-src '))
    expect(scriptSrc).toBe(
      `script-src 'self' ${sha(';(function () { theme() })()\n')} ${sha('\nsecond()')}`,
    )
    expect(csp).not.toContain("'unsafe-eval'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(headers).not.toContain('INLINE_SCRIPT_HASHES')
  })

  it('refuse a headers file with nothing to fill in', () => {
    expect(() => securityHeaders('add_header X-Frame-Options "DENY";', page)).toThrow(
      /no INLINE_SCRIPT_HASHES/,
    )
  })
})
