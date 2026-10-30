import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PRODUCT_NAME,
  PRODUCT_NAME_MAX,
  productNameFrom,
  withProductName,
} from '../../src/domain/brand.ts'
import { ConfigError, loadConfig } from '../../src/server/config/env.ts'

/*
  The product's name setting (docs/rename-checklist.md): one setting, CL_PRODUCT_NAME, read once
  at start by the service and the web build. A value that cannot be a name stops the start; a
  help page's token becomes the name.
*/

const other = 'Acme Ledger'
const databaseUrl = 'postgres://localhost:5432/context_layer_dev'
const old = new RegExp(`\\b${DEFAULT_PRODUCT_NAME}\\b`)

/** The service's modules as a start with CL_PRODUCT_NAME set loads them. */
async function startedAs(name: string | undefined) {
  if (name === undefined) vi.stubEnv('CL_PRODUCT_NAME', undefined)
  else vi.stubEnv('CL_PRODUCT_NAME', name)
  vi.resetModules()
  const [brand, tools, service] = await Promise.all([
    import('../../src/server/brand.ts'),
    import('../../src/server/mcp/tools.ts'),
    import('../../src/server/mcp/service.ts'),
  ])
  return {
    productName: brand.productName,
    instructions: tools.serverInstructions(['Cube'], ''),
    toolDescriptions: Object.values(tools.tools).map((tool) => tool.description),
    // What a failed read tells the person: the agent says where it looked, so never the name.
    failed: service.failure().structuredContent.say as string,
  }
}

describe('the product name setting', () => {
  it('is the default when unset, empty or unusable, and trimmed otherwise', () => {
    expect(productNameFrom(undefined)).toBe(DEFAULT_PRODUCT_NAME)
    expect(productNameFrom('')).toBe(DEFAULT_PRODUCT_NAME)
    expect(productNameFrom('   ')).toBe(DEFAULT_PRODUCT_NAME)
    expect(productNameFrom('Two\nlines')).toBe(DEFAULT_PRODUCT_NAME)
    expect(productNameFrom('x'.repeat(PRODUCT_NAME_MAX + 1))).toBe(DEFAULT_PRODUCT_NAME)
    expect(productNameFrom(`  ${other} `)).toBe(other)
  })

  it('stops the start with a reason when the name cannot be used, and takes an empty one as unset', () => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, CL_PRODUCT_NAME: other })).not.toThrow()
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, CL_PRODUCT_NAME: '' })).not.toThrow()
    for (const bad of [
      'Two\nlines',
      '<b>Acme</b>',
      '{{product}}',
      'x'.repeat(PRODUCT_NAME_MAX + 1),
    ])
      expect(() => loadConfig({ DATABASE_URL: databaseUrl, CL_PRODUCT_NAME: bad })).toThrow(
        ConfigError,
      )
  })

  it('puts the name in place of each token of a help page', () => {
    expect(withProductName('What is {{product}}? {{product}} holds items.', other)).toBe(
      `What is ${other}? ${other} holds items.`,
    )
  })

  it('takes a name with replacement patterns literally', () => {
    expect(withProductName('What is {{product}}?', 'Acme $& $$ $1')).toBe('What is Acme $& $$ $1?')
  })
})

describe('the service with another name', () => {
  // The first start transforms the service's modules, which takes seconds on a busy machine; later
  // starts reuse the transform. Warm it once here, so each test times the start, not the transform.
  beforeAll(async () => {
    await startedAs(undefined)
    vi.unstubAllEnvs()
  }, 60_000)
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('reads the name once at start', async () => {
    expect((await startedAs(undefined)).productName).toBe(DEFAULT_PRODUCT_NAME)
    expect((await startedAs(other)).productName).toBe(other)
  })

  it('says it in the MCP instructions, and never the old name', async () => {
    const started = await startedAs(other)
    expect(started.instructions).toMatch(new RegExp(`^${other} holds checked context`))
    expect(started.failed).not.toContain(other)
    for (const text of [started.instructions, started.failed, ...started.toolDescriptions])
      expect(text).not.toMatch(old)
  })
})
