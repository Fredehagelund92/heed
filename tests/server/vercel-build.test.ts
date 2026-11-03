import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bundleService, cspProblem } from '../../scripts/vercel-build.ts'
import { heedVersion } from '../../src/server/version.ts'

/** Heed on Vercel (vercel.json, scripts/vercel-build.ts, docs/vercel.md), without deploying it. */

const read = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
const sha = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`

interface VercelJson {
  rewrites: { source: string; destination: string }[]
  headers: { source: string; headers: { key: string; value: string }[] }[]
}

describe('vercel.json', () => {
  it('sends the API and health to the function, and every other page to the web app', async () => {
    const config = JSON.parse(await read('vercel.json')) as VercelJson
    expect(config.rewrites).toEqual([
      { source: '/api/v1/(.*)', destination: '/api/heed' },
      { source: '/health', destination: '/api/heed' },
      { source: '/health/(.*)', destination: '/api/heed' },
      { source: '/((?!api/).*)', destination: '/index.html' },
    ])
  })

  it("sets the web image's security headers on the web app's files", async () => {
    const config = JSON.parse(await read('vercel.json')) as VercelJson
    const web = new Map(config.headers[0]!.headers.map(({ key, value }) => [key, value]))
    // docker/security-headers.conf, which nginx sets, with the script hashes left out of both.
    const image = new Map(
      [...(await read('docker/security-headers.conf')).matchAll(/^add_header (\S+) "([^"]*)"/gm)]
        .filter(([, name]) => name !== 'Strict-Transport-Security')
        .map(([, name, value]) => [name!, value!]),
    )
    const withoutHashes = (csp = '') => csp.replace(/ (?:'sha256-[^']+'|INLINE_SCRIPT_HASHES)/g, '')
    expect(withoutHashes(web.get('Content-Security-Policy'))).toBe(
      withoutHashes(image.get('Content-Security-Policy')),
    )
    web.delete('Content-Security-Policy')
    image.delete('Content-Security-Policy')
    expect(web).toEqual(image)
    // The service sets its own headers on what it answers (src/server/app.ts).
    expect(config.headers[0]!.source).toBe('/((?!api/|health).*)')
  })

  it("refuses a build whose page needs another script hash than vercel.json's", () => {
    const policy = (scriptSrc: string) =>
      JSON.stringify({
        headers: [
          {
            source: '/(.*)',
            headers: [
              { key: 'Content-Security-Policy', value: `default-src 'self'; ${scriptSrc}` },
            ],
          },
        ],
      })
    const page = '<html><head><script>theme()</script><script src="/assets/a.js"></script>'
    expect(cspProblem(policy(`script-src 'self' ${sha('theme()')}`), page)).toBeUndefined()
    expect(cspProblem(policy(`script-src 'self' ${sha('other()')}`), page)).toContain(
      `the built page needs "script-src 'self' ${sha('theme()')}"`,
    )
    expect(cspProblem('{}', page)).toContain('sets no Content-Security-Policy')
  })
})

describe('the bundled service', () => {
  it('starts in a folder of its own, without node_modules, package.json or the people file', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'heed-vercel-'))
    try {
      const bytes = await bundleService(join(folder, 'heed.mjs'))
      // A function may hold 250 MB; the bundle holds the service alone.
      expect(bytes).toBeLessThan(20 * 1024 * 1024)
      await writeFile(
        join(folder, 'serve.mjs'),
        [
          "import { createServer } from 'node:http'",
          "const { default: handler } = await import('./heed.mjs')",
          'const server = createServer((request, response) => void handler(request, response))',
          "server.listen(0, '127.0.0.1', () => console.log(`at ${server.address().port}`))",
        ].join('\n'),
      )
      const child = spawn(process.execPath, ['serve.mjs'], {
        cwd: folder,
        env: {
          PATH: process.env.PATH ?? '',
          DATABASE_URL: 'postgres://127.0.0.1:1/context_layer_none',
          LOG_LEVEL: 'silent',
        },
      })
      try {
        const port = await new Promise<string>((resolve, reject) => {
          let output = ''
          child.stdout.on('data', (chunk: Buffer) => {
            output += chunk.toString()
            const match = /at (\d+)/.exec(output)
            if (match) resolve(match[1]!)
          })
          child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
          child.on('exit', () => reject(new Error(`exited:\n${output}`)))
        })
        const response = await fetch(`http://127.0.0.1:${port}/health`)
        // 503 would say the service could not start: a file it read beside its code was missing.
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
          status: 'ok',
          service: 'heed',
          version: heedVersion,
        })
      } finally {
        child.kill()
      }
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  }, 60_000)
})
