import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SourceConfig } from '../../../src/contract/sources.ts'
import { checkManifest } from '../../../src/domain/connector-manifest.ts'
import type { ChosenScope, ConnectorModule } from '../../../src/domain/connector-runtime.ts'
import { documentMark } from '../../../src/domain/content-document.ts'
import {
  registerConnectors,
  type RegisteredConnector,
  type StoredSource,
} from '../../../src/server/modules/connectors/index.ts'
import { SourceReadError } from '../../../src/server/modules/connectors/types.ts'

/*
  The connector conformance kit (docs/connectors.md, "Conformance kit"; CON-108): what "compatible
  with interface 3" means, as tests any connector runs against itself. Its tests switch on by
  what the manifest declares, and each takes the connector through the core, as Sources and the
  pipelines do, so a connector passes only if the core accepts what it does.

  A connector in this repository runs it from a test of its own (tests/server/connectors/
  conformance.test.ts), with a fixture: settings that work, and where it has them, a secret the
  tool refuses, settings the form refuses, and a host that cannot be reached.
*/

/** One way to set a source up: its settings, its secrets and, for content, its scopes. */
export interface FixtureSource {
  config: SourceConfig
  secrets: Record<string, string>
  scopes?: ChosenScope[]
}

export interface ConnectorFixture {
  /** The connector's folder, which holds its manifest, its runtime and its README. */
  folder: URL
  /** Settings that work. */
  good: () => FixtureSource
  /** The same with a secret the tool refuses; for a connector with secrets. */
  refused?: () => FixtureSource
  /** Settings for a host that cannot be reached. */
  unreachable?: () => FixtureSource
  /** Settings the form refuses, each on the field it names. */
  invalid?: { config: SourceConfig; field: string }[]
  /** A secret of the fixture that must appear in nothing the connector returns. */
  planted?: string
  /** Definitions: settings whose read meets a file it cannot read, which makes it partial. */
  partial?: () => FixtureSource
  /** Definitions: a calculation in the tool's content that must cross into no definition. */
  calculation?: string
  /** How long a test of it may take, in milliseconds: longer for one with a worker (T1). */
  timeout?: number
}

const stored = (source: FixtureSource): StoredSource => ({
  id: 'kit',
  name: 'Kit',
  config: source.config,
  secrets: source.secrets,
  ...(source.scopes ? { scopes: source.scopes } : {}),
})

/** A failed read or check, as the core says it: its warnings, or the steps that failed. */
async function failure(work: () => Promise<unknown>) {
  try {
    const outcome = await work()
    return { outcome, warnings: [] as { code: string }[] }
  } catch (error) {
    if (!(error instanceof SourceReadError)) throw error
    return { outcome: null, warnings: error.warnings, errorClass: error.errorClass }
  }
}

export function describeConnector(module: ConnectorModule, fixture: ConnectorFixture) {
  const { manifest } = module
  describe(`${manifest.id}: the conformance kit of interface 3`, () => {
    let registered: RegisteredConnector
    const connector = () => (registered ??= registerConnectors([module], [])[0]!)

    describe('its manifest', () => {
      it('is valid and in a range this build speaks, and the registry takes it', () => {
        const checked = checkManifest(manifest)
        expect(checked.ok ? [] : checked.problems).toEqual([])
        expect(connector().manifest.id).toBe(manifest.id)
      })
      it('has a README in its folder that names it', async () => {
        expect(manifest.docs, 'the manifest names its README').toBeDefined()
        const readme = new URL(manifest.docs!, fixture.folder)
        await access(readme)
        expect(await readFile(readme, 'utf8')).toContain(manifest.title)
      })
      it('says the least access it needs, and where its secrets may go', () => {
        expect(manifest.access.length).toBeGreaterThan(0)
        for (const secret of manifest.secrets) expect(secret.boundTo.length).toBeGreaterThan(0)
        if (manifest.secrets.length || manifest.egress.git)
          expect(manifest.egress.hosts.length).toBeGreaterThan(0)
      })
      if (manifest.kind === 'content')
        it('caps the suggestions a source makes in a day (CON-607)', () => {
          expect(manifest.limits.draftsPerDay).toBeGreaterThan(0)
        })
    })

    describe('its form', () => {
      it('takes the settings that work', () => {
        expect(connector().parse(fixture.good().config)).toEqual({
          config: expect.any(Object) as unknown,
        })
      })
      it('starts from defaults that are valid', () => {
        const defaults = Object.fromEntries(
          manifest.config.fields.flatMap((field) =>
            field.default === undefined ? [] : [[field.key, field.default]],
          ),
        )
        const parsed = connector().parse({ ...fixture.good().config, ...defaults })
        expect('problems' in parsed ? parsed.problems : []).toEqual([])
      })
      for (const { config, field } of fixture.invalid ?? [])
        it(`refuses settings on ${field}`, () => {
          const parsed = connector().parse(config)
          expect('problems' in parsed ? parsed.problems.map((p) => p.field) : []).toContain(field)
        })
    })

    describe('its check', () => {
      it(
        'passes with the settings that work, and changes nothing',
        async () => {
          const report = await connector().check(stored(fixture.good()))
          expect(report.steps.filter((step) => step.status === 'failed')).toEqual([])
        },
        fixture.timeout,
      )
      if (fixture.refused)
        it(
          'says a refused secret is for an admin to fix',
          async () => {
            const { outcome, warnings, errorClass } = await failure(() =>
              connector().check(stored(fixture.refused!())),
            )
            const steps = (outcome as { steps?: { status: string }[] } | null)?.steps ?? []
            expect(
              steps.some((step) => step.status === 'failed') ||
                (warnings.length > 0 && errorClass === 'config'),
            ).toBe(true)
          },
          fixture.timeout,
        )
      if (fixture.unreachable)
        it(
          'fails on a host that cannot be reached, and says so',
          async () => {
            const { outcome, warnings } = await failure(() =>
              connector().check(stored(fixture.unreachable!())),
            )
            const steps = (outcome as { steps?: { status: string }[] } | null)?.steps ?? []
            expect(steps.some((step) => step.status === 'failed') || warnings.length > 0).toBe(true)
          },
          fixture.timeout,
        )
    })

    if (manifest.kind === 'definitions')
      describe('its definitions', () => {
        it(
          'are under its prefix, each once, with the same marks for the same input',
          async () => {
            const source = connector().source(stored(fixture.good()))
            const first = await source.read({ cursor: null })
            const refs = first.definitions.map((definition) => definition.ref)
            expect(new Set(refs).size).toBe(refs.length)
            for (const ref of refs) expect(ref.startsWith(`${manifest.refPrefix}:`)).toBe(true)
            const again = await source.read({ cursor: null })
            expect(again.definitions.map((d) => [d.ref, d.changeMark])).toEqual(
              first.definitions.map((d) => [d.ref, d.changeMark]),
            )
          },
          fixture.timeout,
        )
      })

    if (manifest.kind === 'definitions' && fixture.calculation)
      it(
        'keeps every calculation out of what it reads (CON-207)',
        async () => {
          const read = await connector().source(stored(fixture.good())).read({ cursor: null })
          expect(read.definitions.length).toBeGreaterThan(0)
          expect(JSON.stringify(read)).not.toContain(fixture.calculation)
        },
        fixture.timeout,
      )

    if (manifest.kind === 'definitions' && fixture.partial)
      it(
        'reads in part when a file cannot be read, and says which',
        async () => {
          const read = await connector().source(stored(fixture.partial!())).read({ cursor: null })
          expect(read.complete).toBe(false)
          expect(read.definitions.length).toBeGreaterThan(0)
          expect(read.warnings.length).toBeGreaterThan(0)
        },
        fixture.timeout,
      )

    if (manifest.kind === 'content')
      describe('its documents', () => {
        it(
          'lists scopes to choose from, each once and the same each time',
          async () => {
            const scopes = await connector().discover!(stored(fixture.good()))
            expect(scopes.length).toBeGreaterThan(0)
            expect(new Set(scopes.map((scope) => scope.id)).size).toBe(scopes.length)
            expect(await connector().discover!(stored(fixture.good()))).toEqual(scopes)
          },
          fixture.timeout,
        )
        it(
          'are in the chosen scopes, each once, with an https link and a stable mark',
          async () => {
            const good = fixture.good()
            const source = connector().content!(stored(good))
            const first = await source.read({ cursor: null })
            expect(first.documents.length).toBeGreaterThan(0)
            const chosen = new Set((good.scopes ?? []).map((scope) => scope.id))
            const ids = first.documents.map((document) => document.id)
            expect(new Set(ids).size).toBe(ids.length)
            for (const document of first.documents) {
              expect(chosen.has(document.scope)).toBe(true)
              expect(new URL(document.link).protocol).toBe('https:')
            }
            // An unchanged source gives the same documents with the same marks.
            const again = await source.read({ cursor: first.cursor ?? null })
            const marks = async (read: typeof first) =>
              Promise.all(read.documents.map(async (d) => [d.id, await documentMark(d)]))
            expect(await marks(again)).toEqual(await marks(first))
          },
          fixture.timeout,
        )
        it(
          'reads nothing outside the scopes chosen',
          async () => {
            const good = fixture.good()
            const [one] = good.scopes ?? []
            if (!one) return
            const read = await connector().content!(stored({ ...good, scopes: [one] })).read({
              cursor: null,
            })
            for (const document of read.documents) expect(document.scope).toBe(one.id)
          },
          fixture.timeout,
        )
      })

    if (fixture.planted)
      it(
        'keeps its secret out of every check, scope, record and warning',
        async () => {
          const good = stored(fixture.good())
          const seen: unknown[] = [await connector().check(good)]
          if (manifest.kind === 'content') {
            seen.push(await connector().discover!(good))
            const read = await connector().content!(good).read({ cursor: null })
            seen.push({
              ...read,
              documents: read.documents.map(({ text: _text, ...rest }) => rest),
            })
          } else seen.push(await connector().source(good).read({ cursor: null }))
          for (const bad of [fixture.refused, fixture.unreachable])
            if (bad) seen.push((await failure(() => connector().check(stored(bad())))).warnings)
          expect(JSON.stringify(seen)).not.toContain(fixture.planted)
        },
        fixture.timeout,
      )
  })
}

/** The folder of a built-in connector. */
export const builtInFolder = (id: string) =>
  new URL(join('../../../src/connectors', id, '/'), import.meta.url)
