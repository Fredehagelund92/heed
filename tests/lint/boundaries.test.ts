import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

/**
 * The module boundaries are only worth having if they fail loudly. The fixture tree under
 * tests/lint/fixtures/boundaries mirrors src/, so the same rules classify it. If you loosen a
 * boundary in eslint.boundaries.js, a test here fails first.
 */

const root = fileURLToPath(new URL('../../', import.meta.url))
// The fixtures are ignored by `npm run lint`; `ignore: false` lints them on purpose here.
const eslint = new ESLint({ cwd: root, ignore: false })
const fixtures = 'tests/lint/fixtures/boundaries/src'

async function messagesFor(file: string) {
  const [result] = await eslint.lintFiles([`${fixtures}/${file}`])
  return result?.messages.map((message) => `${message.line}: ${message.message}`) ?? []
}

describe('module boundaries', () => {
  it.each(['@modelcontextprotocol/server', '@modelcontextprotocol/client', 'jose'])(
    'keeps %s out of the browser',
    async (dependency) => {
      const [result] = await eslint.lintText(`import '${dependency}'`, {
        filePath: `${fixtures}/app/leaks-server.tsx`,
      })
      expect(result?.messages.map((m) => m.message).join('\n')).toContain('belongs to the service')
    },
  )
  it('keeps the service out of the front end', async () => {
    const messages = await messagesFor('app/leaks-server.tsx')
    expect(messages).toContainEqual(expect.stringMatching(/^2: .*'pg'.*belongs to the service/))
    expect(messages).toContainEqual(
      expect.stringMatching(/^3: Module boundary: the front end never imports the service/),
    )
    expect(messages).toHaveLength(2)
  })

  it('keeps the Cube compiler out of the front end', async () => {
    expect(await messagesFor('app/leaks-cube.tsx')).toContainEqual(
      expect.stringMatching(/belongs to the service/),
    )
  })

  it('lets other code reach a server module only through its index.ts', async () => {
    expect(await messagesFor('server/modules/beta/reaches-in.ts')).toEqual([
      '2: Module boundary: import the alpha module through its index.ts, not its internal files. See "Module boundaries" in CONTRIBUTING.md.',
    ])
    expect(await messagesFor('server/modules/beta/through-index.ts')).toEqual([])
    expect(await messagesFor('server/modules/alpha/index.ts')).toEqual([])
  })

  it('lets the service use the domain and wire modules through their index', async () => {
    expect(await messagesFor('server/app.ts')).toEqual([])
  })

  it('lets the contract import the domain only', async () => {
    expect(await messagesFor('contract/leaks.ts')).toEqual([
      '3: Module boundary: contract may not import server code. See "Module boundaries" in CONTRIBUTING.md.',
    ])
  })

  it("lets the front end read a connector's manifest but not run its runtime", async () => {
    expect(await messagesFor('app/reads-connector.tsx')).toEqual([
      '3: Module boundary: a connector\'s runtime runs in the service only. The front end reads its manifest. See "Module boundaries" in CONTRIBUTING.md.',
    ])
    expect(await messagesFor('connectors/sample/manifest.ts')).toEqual([])
  })

  it('keeps a connector to the domain and what its context hands it', async () => {
    const messages = await messagesFor('connectors/sample/runtime.ts')
    expect(messages).toContainEqual(expect.stringMatching(/^2: .*'pg'.*A connector may import/))
    expect(messages).toContainEqual(
      expect.stringMatching(/^3: Module boundary: connectors may not import server code/),
    )
    expect(messages).toContainEqual(
      expect.stringMatching(/^8: .*A connector reaches the network through ctx.fetch only/),
    )
  })

  it("lets a connector's worker load its packages, and still not the service", async () => {
    expect(await messagesFor('connectors/sample/worker.ts')).toEqual([
      '3: Module boundary: connectors may not import server code. See "Module boundaries" in CONTRIBUTING.md.',
    ])
  })

  it('lets the command line tool import the contract and the domain only', async () => {
    expect(await messagesFor('cli/leaks-server.ts')).toEqual([
      '2: Module boundary: cli may not import server-module code. See "Module boundaries" in CONTRIBUTING.md.',
    ])
  })
})

describe('domain purity', () => {
  it('reports drivers, other layers, the clock and the network', async () => {
    const messages = await messagesFor('domain/impure.ts')
    expect(messages).toContainEqual(expect.stringMatching(/^2: .*'pg'.*src\/domain is pure/))
    expect(messages).toContainEqual(
      expect.stringMatching(/^3: Module boundary: domain may not import server code/),
    )
    expect(messages).toContainEqual('6: src/domain is pure: no clock. Take `today` as an argument.')
    expect(messages).toContainEqual('7: src/domain is pure: no clock. Take `today` as an argument.')
    expect(messages).toContainEqual(expect.stringMatching(/^8: .*src\/domain is pure: no network/))
    expect(messages).toHaveLength(5)
  })

  it('accepts pure code that takes today as an argument', async () => {
    expect(await messagesFor('domain/pure.ts')).toEqual([])
  })
})
