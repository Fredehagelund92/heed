import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createCubeSource,
  createDemoSource,
  ConnectorRegistry,
  domainCoverage,
  workerReadablePaths,
} from '../../../src/server/modules/connectors/index.ts'
import { SourceReadError } from '../../../src/server/modules/connectors/types.ts'

const fixture = fileURLToPath(new URL('../../fixtures/cube/model.yml', import.meta.url))
const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function model(transform: (text: string) => string = (text) => text) {
  const dir = await mkdtemp(join(tmpdir(), 'heed-cube-'))
  temporary.push(dir)
  await writeFile(join(dir, 'model.yml'), transform(await readFile(fixture, 'utf8')))
  return dir
}

const read = (modelDir: string) => createCubeSource({ modelDir }).read()

describe('offline Cube source', () => {
  it('reads public views, resolves aliases, and prefers member domains to view domains', async () => {
    const snapshot = await read(await model())
    expect(snapshot.complete).toBe(true)
    expect(snapshot.definitions).toHaveLength(7)
    expect(snapshot.definitions.every((entry) => entry.visibleGroups === null)).toBe(true)
    expect(snapshot.definitions.find((entry) => entry.ref === 'cube:sales.count')?.areaHint).toBe(
      'commerce',
    )
    expect(snapshot.definitions.find((entry) => entry.ref === 'cube:sales.revenue')?.areaHint).toBe(
      'finance',
    )
    expect(
      snapshot.definitions.find((entry) => entry.ref === 'cube:marketing.orders_income'),
    ).toBeDefined()
    expect(snapshot.definitions.some((entry) => entry.ref.startsWith('cube:orders.'))).toBe(false)
    expect(domainCoverage(snapshot.definitions)).toEqual({ cube: 3, override: 0, none: 2 })
    expect(JSON.stringify(snapshot)).not.toContain('SELECT')
    expect(JSON.stringify(snapshot)).not.toContain('example_orders')
  }, 15_000)

  it("reads a member's meta.synonyms as its other names, each once", async () => {
    const withSynonyms = (synonyms: string) =>
      model((text) =>
        text.replace(
          '      - name: country\n        type: string\n',
          `      - name: country\n        type: string\n        meta:\n          synonyms: ${synonyms}\n`,
        ),
      )
    const plain = await read(await model())
    const read1 = await read(await withSynonyms('[geo, " Market ", GEO, 7, "", nation]'))
    const country = read1.definitions.find((entry) => entry.ref === 'cube:sales.country')
    expect(country?.synonyms).toEqual(['geo', 'Market', 'nation'])
    // A joined view's member has the same other names.
    expect(
      read1.definitions.find((entry) => entry.ref === 'cube:marketing.orders_country')?.synonyms,
    ).toEqual(['geo', 'Market', 'nation'])
    expect(plain.definitions.find((entry) => entry.ref === 'cube:sales.country')?.synonyms).toEqual(
      [],
    )
  }, 60_000)

  it('names a member a view joins with a prefix by its own name', async () => {
    const snapshot = await read(await model())
    const baseName = (ref: string) =>
      snapshot.definitions.find((entry) => entry.ref === ref)?.baseName
    // marketing joins orders with `prefix: true`: orders_country is the member country.
    expect(baseName('cube:marketing.orders_country')).toBe('country')
    // An alias keeps its own name; only the join's prefix goes.
    expect(baseName('cube:marketing.orders_income')).toBe('income')
    // A member a view includes as it is is named by its name after the view.
    expect(baseName('cube:sales.country')).toBeNull()
    expect(baseName('cube:sales.revenue')).toBeNull()
  }, 30_000)

  it('names the model file of each member, relative to the model folder, outside the mark', async () => {
    const flat = await read(await model())
    expect(new Set(flat.definitions.map((entry) => entry.modelFile))).toEqual(
      new Set(['model.yml']),
    )
    // The same model one folder down: every member names the new path, and no mark changes.
    const dir = await mkdtemp(join(tmpdir(), 'heed-cube-'))
    temporary.push(dir)
    await mkdir(join(dir, 'views'))
    await writeFile(join(dir, 'views', 'model.yml'), await readFile(fixture, 'utf8'))
    const nested = await read(dir)
    expect(
      nested.definitions.map(({ ref, modelFile, changeMark }) => ({ ref, modelFile, changeMark })),
    ).toEqual(
      flat.definitions.map(({ ref, changeMark }) => ({
        ref,
        modelFile: 'views/model.yml',
        changeMark,
      })),
    )
    expect((await createDemoSource().read()).definitions.every((d) => d.modelFile === null)).toBe(
      true,
    )
  }, 30_000)

  it('supports no domains, partial coverage, invalid domains and gap-only local overrides', async () => {
    const dir = await model((text) =>
      text
        .replace('domain: commerce', 'domain: INVALID')
        .replace('    meta:\n      domain: finance\n', ''),
    )
    const overrides = join(dir, 'overrides.json')
    // Keep configuration outside the model: every unsupported model file must warn.
    const configDir = await mkdtemp(join(tmpdir(), 'heed-domains-'))
    temporary.push(configDir)
    const configFile = join(configDir, 'domains.json')
    await writeFile(
      configFile,
      JSON.stringify({ sales: 'local_sales', marketing: 'paid_media', operations: 17 }),
    )
    const partial = await createCubeSource({
      modelDir: dir,
      domainOverridesFile: configFile,
    }).read()
    expect(partial.definitions.find((entry) => entry.ref === 'cube:sales.revenue')).toMatchObject({
      areaHint: 'local_sales',
      domainSource: 'override',
    })
    expect(partial.definitions.find((entry) => entry.ref === 'cube:sales.count')).toMatchObject({
      areaHint: 'local_sales',
      domainSource: 'override',
    })
    expect(
      partial.definitions.find((entry) => entry.ref === 'cube:marketing.orders_income'),
    ).toMatchObject({ areaHint: 'paid_media', domainSource: 'override' })
    expect(
      partial.definitions.find((entry) => entry.ref === 'cube:operations.revenue')?.areaHint,
    ).toBeNull()
    expect(partial.warnings).toContainEqual({ code: 'invalid_domain', target: 'sales.count' })
    expect(partial.warnings).toContainEqual({
      code: 'invalid_domain',
      target: 'override:operations',
    })
    // A view the server's domain names map has a domain: information, not a missing domain.
    const missing = partial.warnings.filter((warning) => warning.code === 'missing_domain')
    expect(missing.map((warning) => warning.target)).toContain('operations')
    expect(missing.map((warning) => warning.target)).not.toContain('sales')
    expect(missing.map((warning) => warning.target)).not.toContain('marketing')
    expect(partial.warnings).toContainEqual({
      code: 'domain_override',
      target: 'cube:marketing.orders_income',
    })
    expect(existsSync(overrides)).toBe(false)
    const noDomains = await read(
      await model((text) => text.replace(/\s+meta:\n\s+domain: \w+/g, '')),
    )
    expect(domainCoverage(noDomains.definitions)).toEqual({ cube: 0, override: 0, none: 5 })
    expect(noDomains.definitions.every((entry) => entry.areaHint === null)).toBe(true)
  }, 20_000)

  it('reads an empty line of the domain names as one still to fill', async () => {
    const dir = await model((text) => text.replace('    meta:\n      domain: finance\n', ''))
    const configDir = await mkdtemp(join(tmpdir(), 'heed-domains-'))
    temporary.push(configDir)
    const configFile = join(configDir, 'domains.json')
    await writeFile(configFile, JSON.stringify({ sales: '' }))
    const snapshot = await createCubeSource({
      modelDir: dir,
      domainOverridesFile: configFile,
    }).read()
    expect(snapshot.warnings).toContainEqual({ code: 'missing_domain', target: 'sales' })
    expect(snapshot.warnings).not.toContainEqual({
      code: 'invalid_domain',
      target: 'override:sales',
    })
  }, 20_000)

  it('falls back to a valid view domain when a member domain is invalid and still warns', async () => {
    const snapshot = await read(
      await model((text) => text.replace('domain: commerce', 'domain: Sales Area')),
    )
    expect(snapshot.definitions.find((entry) => entry.ref === 'cube:sales.count')).toMatchObject({
      areaHint: 'finance',
      domainSource: 'cube',
    })
    expect(snapshot.warnings).toContainEqual({ code: 'invalid_domain', target: 'sales.count' })
    expect(snapshot.warnings).not.toContainEqual({ code: 'invalid_domain', target: 'sales' })
  }, 15_000)

  it('keeps a valid member domain over a valid view domain without warning', async () => {
    const snapshot = await read(await model())
    expect(snapshot.definitions.find((entry) => entry.ref === 'cube:sales.count')).toMatchObject({
      areaHint: 'commerce',
      domainSource: 'cube',
    })
    expect(snapshot.warnings.some((entry) => entry.code === 'invalid_domain')).toBe(false)
  }, 15_000)

  it('lists public cubes, omits hidden members, and reports an invalid view domain', async () => {
    const snapshot = await read(
      await model((text) =>
        text
          .replace('public: false', 'public: true')
          .replace(
            'name: revenue\n        type:',
            'name: revenue\n        public: false\n        type:',
          )
          .replace('domain: finance', 'domain: Not an area'),
      ),
    )
    expect(snapshot.definitions.some((entry) => entry.ref === 'cube:orders.country')).toBe(true)
    expect(snapshot.definitions.some((entry) => entry.ref === 'cube:orders.revenue')).toBe(false)
    expect(snapshot.warnings).toContainEqual({ code: 'invalid_domain', target: 'sales' })
    expect(
      snapshot.definitions.find((entry) => entry.ref === 'cube:sales.country')?.areaHint,
    ).toBeNull()
  }, 15_000)

  it('changes marks for source calculation, type and description but ignores YAML formatting', async () => {
    const before = await read(await model())
    const formatted = await read(await model((text) => `# same meaning\n${text}`))
    expect(formatted.definitions).toEqual(before.definitions)
    for (const [from, to] of [
      ['sql: amount', 'sql: amount * 2'],
      ['type: sum', 'type: avg'],
      ['Total order revenue.', 'Revenue after refunds.'],
    ]) {
      const changed = await read(await model((text) => text.replace(from!, to!)))
      const revenue = (entries: typeof before.definitions) =>
        entries.find((entry) => entry.ref === 'cube:sales.revenue')!.changeMark
      expect(revenue(changed.definitions)).not.toBe(revenue(before.definitions))
    }
    // Five full compiles of the model: on a busy machine each takes several seconds.
  }, 60_000)

  it('keeps the domain out of change marks and names each view without a domain', async () => {
    const before = await read(await model())
    expect(before.warnings).toEqual(
      expect.arrayContaining([
        { code: 'missing_domain', target: 'marketing' },
        { code: 'missing_domain', target: 'operations' },
      ]),
    )
    expect(before.warnings.filter((w) => w.code === 'missing_domain')).toHaveLength(2)
    // A changed domain informs the owner; it must not flag items through the change mark.
    const moved = await read(
      await model((text) => text.replace('domain: finance', 'domain: treasury')),
    )
    const revenue = (snapshot: typeof before) =>
      snapshot.definitions.find((entry) => entry.ref === 'cube:sales.revenue')!
    expect(revenue(moved).areaHint).toBe('treasury')
    expect(revenue(moved).changeMark).toBe(revenue(before).changeMark)
  }, 30_000)

  it('reads renamed members from configuration and warns about renames it cannot use', async () => {
    const dir = await model((text) => text.replace('- name: growth', '- name: expansion'))
    const configDir = await mkdtemp(join(tmpdir(), 'heed-renames-'))
    temporary.push(configDir)
    const renamesFile = join(configDir, 'renames.json')
    await writeFile(
      renamesFile,
      JSON.stringify({
        'cube:growth.revenue': 'cube:expansion.revenue',
        'cube:sales.revenue': 'cube:sales.count',
        'cube:gone.member': 'cube:nowhere.member',
        'not a ref': 'cube:expansion.revenue',
      }),
    )
    const snapshot = await createCubeSource({ modelDir: dir, renamesFile }).read()
    expect(snapshot.renames).toEqual([
      { from: 'cube:growth.revenue', to: 'cube:expansion.revenue' },
    ])
    for (const target of ['cube:sales.revenue', 'cube:gone.member', 'not a ref'])
      expect(snapshot.warnings).toContainEqual({ code: 'invalid_rename', target })
    expect(snapshot.complete).toBe(true)
  }, 15_000)

  it('warns without executing JS, Python, Jinja, symlinks or malformed YAML', async () => {
    const dir = await model()
    const sentinel = join(dir, 'should-not-exist')
    await symlink(fixture, join(dir, 'linked.yml'))
    await writeFile(
      join(dir, 'script.js'),
      `require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'bad')`,
    )
    await writeFile(join(dir, 'script.py'), 'raise Exception("must not execute")')
    await writeFile(join(dir, 'template.yml'), '{% for i in [1,2] %}\n{% endfor %}')
    await writeFile(join(dir, 'invalid.yml'), 'cubes: [')
    const snapshot = await read(dir)
    expect(snapshot.complete).toBe(false)
    expect(snapshot.definitions).toHaveLength(7)
    expect(snapshot.warnings).toEqual(
      expect.arrayContaining([
        { code: 'unsupported_file', target: 'script.js' },
        // A link is never followed: it is left out as a file that could not be read.
        { code: 'unreadable_file', target: 'linked.yml' },
        { code: 'unsupported_file', target: 'script.py' },
        { code: 'unsupported_file', target: 'template.yml' },
        { code: 'unreadable_file', target: 'invalid.yml' },
      ]),
    )
    expect(existsSync(sentinel)).toBe(false)
  }, 15_000)

  it('fails safely for compiler errors, missing folders, bad configuration and timeouts', async () => {
    // Each failure says why in a fixed code that holds no compiler message (Sources shows it).
    const failure = (reading: Promise<unknown>) =>
      reading.then(
        () => expect.unreachable('the read must fail'),
        (error: unknown) => {
          expect(error).toBeInstanceOf(SourceReadError)
          return (error as SourceReadError).warnings
        },
      )
    expect(
      await failure(read(await model((text) => text.replace('type: sum', 'type: not_a_type')))),
    ).toEqual([{ code: 'compile_error', target: 'model' }])
    expect(await failure(read('/does/not/exist'))).toEqual([
      { code: 'no_model_files', target: 'model' },
    ])
    const empty = await mkdtemp(join(tmpdir(), 'heed-cube-'))
    temporary.push(empty)
    await writeFile(join(empty, 'notes.txt'), 'no model here')
    expect(await failure(read(empty))).toEqual([
      { code: 'no_model_files', target: 'model' },
      { code: 'unsupported_file', target: 'notes.txt' },
    ])
    const dir = await model()
    await expect(
      createCubeSource({ modelDir: dir, domainOverridesFile: '/does/not/exist' }).read(),
    ).rejects.toThrow()
    expect(await failure(createCubeSource({ modelDir: dir, timeoutMs: 1 }).read())).toEqual([
      { code: 'compile_timeout', target: 'model' },
    ])
    expect(() => createCubeSource({ modelDir: dir, timeoutMs: 0 })).toThrow(
      'Invalid worker timeout',
    )
    // Five compiler processes one after the other: on a busy machine they took over 20 seconds.
  }, 60_000)

  it('compiles with network denied by the Node permission system', async () => {
    const dir = await model()
    const moduleUrl = new URL('../../../src/server/modules/connectors/index.ts', import.meta.url)
      .href
    const program = `import { createCubeSource } from ${JSON.stringify(moduleUrl)}; const result = await createCubeSource({modelDir:${JSON.stringify(dir)}}).read(); console.log(result.definitions.length)`
    const { stdout } = await promisify(execFile)(process.execPath, [
      '--permission',
      '--allow-fs-read=*',
      '--allow-addons',
      '--allow-child-process',
      '--input-type=module',
      '-e',
      program,
    ])
    expect(stdout.trim()).toBe('7')
    // A process that loads the service, then the compiler's own: on a busy machine, many seconds.
  }, 60_000)
})

// A model before its data team names domains: the demo model's own files (db/seed/cube) with every
// meta.domain taken out, read in place as a whole folder.
it('reads a whole model folder in place and names each view that has no domain yet', async () => {
  const demoFolder = fileURLToPath(new URL('../../../db/seed/cube', import.meta.url))
  const dir = await mkdtemp(join(tmpdir(), 'heed-cube-folder-'))
  temporary.push(dir)
  const files = (await readdir(demoFolder)).filter((name) => name.endsWith('.yml')).sort()
  for (const name of files) {
    const text = await readFile(join(demoFolder, name), 'utf8')
    await writeFile(join(dir, name), text.replace(/\s+meta:\n\s+domain: \w+/g, ''))
  }
  const before = await Promise.all(files.map((name) => readFile(join(dir, name), 'utf8')))

  const named = await read(demoFolder)
  const snapshot = await read(dir)
  const views = [
    ...new Set(snapshot.definitions.map((definition) => definition.name.split('.')[0])),
  ].sort()
  const metrics = snapshot.definitions.filter((entry) => entry.kind === 'metric')
  expect(snapshot.complete).toBe(true)
  // Every view in every file, with the same members as the model with domains.
  expect(views.length).toBeGreaterThan(1)
  expect(snapshot.definitions.map(({ ref, kind }) => `${kind}:${ref}`)).toEqual(
    named.definitions.map(({ ref, kind }) => `${kind}:${ref}`),
  )
  expect(domainCoverage(snapshot.definitions)).toEqual({
    cube: 0,
    override: 0,
    none: metrics.length,
  })
  // CON-516: every view without meta.domain is reported until its data team adds it.
  expect(
    snapshot.warnings
      .filter((warning) => warning.code === 'missing_domain')
      .map((warning) => warning.target)
      .sort(),
  ).toEqual(views)
  // No data query and no calculation leaves the read, and the folder is never written.
  expect(JSON.stringify(snapshot)).not.toMatch(/SUM\(|NULLIF/)
  expect((await readdir(dir)).sort()).toEqual(files)
  expect(await Promise.all(files.map((name) => readFile(join(dir, name), 'utf8')))).toEqual(before)
}, 60_000)

it('registers both definition sources through the same port and rejects ambiguous ids', async () => {
  const demo = createDemoSource()
  const registry = new ConnectorRegistry([demo, createCubeSource({ modelDir: 'unused' })])
  expect(registry.list().map((source) => source.id)).toEqual(['demo', 'cube'])
  expect((await registry.get('demo').read()).definitions).toHaveLength(2)
  expect(() => registry.get('missing')).toThrow('Unknown connector')
  expect(() => new ConnectorRegistry([demo, demo])).toThrow('Duplicate connector')
})

describe('what the compiler may read', () => {
  it('reads the service and its dependencies, never the model, the repository or home', () => {
    const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
    // The runtime hands the worker the model's files: the worker reads no folder of the tool.
    const paths = workerReadablePaths()
    expect(paths).toHaveLength(3)
    expect(paths).toContain(join(root, 'src'))
    expect(paths).toContain(join(root, 'node_modules'))
    expect(paths).toContain(join(root, 'package.json'))
    // Not the repository itself, where local keys and .env.local live, nor anything above it.
    for (const path of paths) {
      expect(path).not.toBe(root)
      expect(root.startsWith(`${path}/`)).toBe(false)
      expect(path).not.toBe('*')
    }
    expect(paths).not.toContain(process.env.HOME)
  })
})
