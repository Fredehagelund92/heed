import assert from 'node:assert/strict'

/*
  Checks the web image (Dockerfile, `web`) as a browser meets it: gzip, the security headers, HSTS
  only behind TLS, a real 404 for a missing file while the app's own addresses still open, and
  robots.txt and llms.txt as text. CI runs it against the image on its own, with no service:

    node scripts/check-web-image.ts http://127.0.0.1:8080
*/

const base = process.argv[2]
if (!base) throw new Error('Usage: node scripts/check-web-image.ts <web image address>')

const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(new URL(path, base), { headers: { 'accept-encoding': 'gzip', ...headers } })

const checks: [string, () => Promise<void>][] = []
const check = (name: string, run: () => Promise<void>) => checks.push([name, run])

function hasSecurityHeaders(response: Response) {
  const csp = response.headers.get('content-security-policy') ?? ''
  assert.match(csp, /script-src 'self' 'sha256-[A-Za-z0-9+/]+=*'/, 'CSP script-src with a hash')
  assert.match(csp, /frame-ancestors 'none'/)
  assert.doesNotMatch(csp, /'unsafe-eval'|INLINE_SCRIPT_HASHES/)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.equal(response.headers.get('referrer-policy'), 'same-origin')
}

let page = ''
check('the app page: html, gzip, security headers, no HSTS over http', async () => {
  const response = await get('/')
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /^text\/html/)
  hasSecurityHeaders(response)
  assert.equal(response.headers.get('strict-transport-security'), null)
  page = await response.text()
})

check('HSTS behind a proxy that ended TLS', async () => {
  const response = await get('/', { 'x-forwarded-proto': 'https' })
  assert.match(response.headers.get('strict-transport-security') ?? '', /^max-age=\d+/)
})

check("the app's scripts and styles: gzipped, cached for good", async () => {
  const assets = [...page.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map(
    ([, path]) => path!,
  )
  assert.ok(assets.length > 0, 'index.html loads assets')
  for (const path of assets) {
    const response = await get(path)
    assert.equal(response.status, 200, path)
    assert.equal(response.headers.get('content-encoding'), 'gzip', path)
    assert.match(response.headers.get('vary') ?? '', /accept-encoding/i, path)
    assert.match(response.headers.get('cache-control') ?? '', /immutable/, path)
    hasSecurityHeaders(response)
    await response.arrayBuffer()
  }
})

check("the app's own addresses open the app", async () => {
  for (const path of ['/inbox', '/context', '/settings/general', '/docs/get-started', '/x/y']) {
    const response = await get(path)
    assert.equal(response.status, 200, path)
    assert.equal(await response.text(), page, path)
  }
})

check('a missing file is a 404, not the app', async () => {
  for (const path of ['/assets/missing.js', '/assets/a/b.css', '/sitemap.xml', '/wp-login.php']) {
    const response = await get(path)
    assert.equal(response.status, 404, path)
    hasSecurityHeaders(response)
    assert.doesNotMatch(await response.text(), /<div id="root">/, path)
  }
})

check('robots.txt and llms.txt are text', async () => {
  const robots = await get('/robots.txt')
  assert.equal(robots.status, 200)
  assert.match(robots.headers.get('content-type') ?? '', /^text\/plain/)
  assert.match(await robots.text(), /^User-agent: \*\nDisallow: \/\n$/)
  for (const path of ['/llms.txt', '/docs/llms.txt', '/docs/llms-full.txt']) {
    const response = await get(path)
    assert.equal(response.status, 200, path)
    assert.match(response.headers.get('content-type') ?? '', /^text\/plain/, path)
    assert.match(await response.text(), /^# /, path)
  }
})

let failed = 0
for (const [name, run] of checks) {
  try {
    await run()
    console.log(`ok      ${name}`)
  } catch (error) {
    failed++
    console.log(
      `FAILED  ${name}\n        ${(error as Error).message.replaceAll('\n', '\n        ')}`,
    )
  }
}
if (failed) {
  console.log(`\n${failed} of ${checks.length} checks failed against ${base}.`)
  process.exitCode = 1
} else console.log(`\nAll ${checks.length} checks passed against ${base}.`)
