import { describe, expect, it } from 'vitest'
import { sourceServerSettingKeys, sourceWarningCodes } from '../../src/contract/operations.ts'
import { sourceViews, viewOf } from '../../src/domain/source-views.ts'
import { createCubeSource } from '../../src/server/modules/connectors/cube.ts'
import { connectorTypes } from '../../src/server/modules/connectors/registry.ts'
import { warningSchema } from '../../src/server/modules/connectors/types.ts'
import {
  ConnectorRegistry,
  createWorkspaceSources,
  noSecretStore,
} from '../../src/server/modules/connectors/index.ts'
import { builtInManifests } from '../../src/connectors/manifests.ts'
import { mockConnectorListings } from '../../src/web/mocks/source-types.ts'
import {
  checkWords,
  holdsWords,
  issueSummary,
  sourceFormInput,
  sourceFormProblems,
  sourceFormValues,
  sourceProblemCodes,
  listWords,
  membersWords,
  needsALookWords,
  nextHourly,
  readResultWords,
  serverSettingWords,
  scheduleWords,
  sourceIssues,
  sourceWarningWords,
  versionWords,
  type Source,
} from '@/lib/sources'
import { settingMeta } from '@/lib/settings'
import { movedSourceSettings } from '@/lib/settings-sections'
import { mockSources } from '../../src/web/mocks/sources.ts'

/*
  Sources (integrations decision, 12 October 2026): every warning a connector may report and every
  server setting it may name has words on screen, a source's issues come from its newest read, and
  the views of a source group its members by the part of their name before the last dot.
*/

const source = (patch: Partial<Source> = {}): Source => ({
  ...mockSources({
    ago: (seconds) => new Date(Date.UTC(2026, 9, 7, 12) - seconds * 1000).toISOString(),
    scenario: null,
  })[0]!,
  ...patch,
})

describe('the words of the connector contract', () => {
  it('gives every warning code a connector may report its words', () => {
    // The connectors' own schema, not a copy: a new code there fails here until it has words.
    const [core] = warningSchema.shape.code.options
    expect([...core.options].sort()).toEqual([...sourceWarningCodes].sort())
    for (const code of core.options) {
      const words = sourceWarningWords[code]
      expect(words, code).toBeDefined()
      // A failure's reason is one sentence; a warning counts what it names.
      if (!sourceProblemCodes.includes(code)) {
        expect(words.title(1)).toMatch(/^1 /)
        expect(words.title(2)).toMatch(/^2 /)
      } else expect(words.title(1)).toMatch(/^[A-Z]/)
      expect(words.description('payments', 1, 'Cube')).not.toMatch(/undefined|NaN/)
    }
  })

  it('lists the same connectors with the same forms in the mock as the service does', () => {
    const service = createWorkspaceSources({
      secrets: noSecretStore,
      registry: new ConnectorRegistry([]),
    })
    expect(mockConnectorListings).toEqual(service.types())
  })

  it("words every connector's own warnings on screen, from its manifest", () => {
    for (const manifest of builtInManifests)
      for (const code of Object.keys(manifest.warnings)) {
        const issues = sourceIssues(
          source({
            lastRead: {
              status: 'ok',
              at: '2026-10-07T11:00:00.000Z',
              warnings: [{ code: `${manifest.id}.${code}`, target: 'payments.orders' }],
            },
          }),
        )
        expect(issues[0]).toMatchObject({ id: `${manifest.id}.${code}` })
        expect(issues[0]!.title).toBe(manifest.warnings[code]!.title)
        expect(issues[0]!.description).toMatch(/About payments\.orders\.$/)
      }
  })

  it('gives every server setting a connector names its words', () => {
    const named = createCubeSource({ modelDir: '/srv/model' }).serverSettings
    for (const setting of named) expect(serverSettingWords[setting.key]).toBeDefined()
    expect(Object.keys(serverSettingWords).sort()).toEqual([...sourceServerSettingKeys].sort())
  })

  it("names each type's tool and settings, and only settings the screen knows", () => {
    expect(connectorTypes.map((type) => [type.type, type.tool])).toEqual([
      ['cube', 'Cube'],
      ['demo', 'Demo'],
    ])
    for (const type of connectorTypes)
      for (const key of type.settingKeys) expect(settingMeta[key]).toBeDefined()
    // An old link to a moved setting opens the page of a source that has it.
    for (const [key, id] of Object.entries(movedSourceSettings))
      expect(connectorTypes.find((type) => type.type === id)?.settingKeys).toContain(key)
  })
})

describe("a source's issues", () => {
  it('says which views have no domain, in the tool the source reads', () => {
    const issues = sourceIssues(source())
    expect(issues.map((issue) => issue.id)).toEqual(['missing_domain'])
    expect(issues[0]).toMatchObject({ tone: 'warning', title: '2 views have no domain' })
    expect(issues[0]!.description).toMatch(
      /^operations and segments name no domain in Cube, so their metrics have no domain/,
    )
    expect(issueSummary(issues)).toBe('2 views have no domain')
  })

  it('puts a failed read first, then warnings, then definitions gone; information never asks', () => {
    const issues = sourceIssues(
      source({
        lastRead: {
          status: 'failed',
          at: '2026-10-07T11:00:00.000Z',
          warnings: [
            { code: 'domain_override', target: 'cube:sales.revenue' },
            { code: 'unsupported_file', target: 'legacy.js' },
            { code: 'invalid_domain', target: 'override:sales' },
            { code: 'brand_new_code', target: 'x' },
          ],
        },
        definitions: { current: 40, missing: 1 },
      }),
    )
    expect(issues.map((issue) => [issue.id, issue.tone])).toEqual([
      ['failed', 'danger'],
      ['invalid_domain', 'warning'],
      ['unsupported_file', 'warning'],
      ['domain_override', 'info'],
      ['brand_new_code', 'warning'],
      ['gone', 'info'],
    ])
    expect(issues.find((issue) => issue.id === 'invalid_domain')!.description).toMatch(
      /^the server's domain name for sales names/,
    )
    expect(issues.at(-1)!.title).toBe('1 definition is gone from Cube')
    expect(issueSummary(issues)).toBe('The last read failed, 3 more issues')
    expect(issueSummary(issues.filter((issue) => issue.tone === 'info'))).toBe('Nothing')
  })
})

describe('what a source holds and its reads', () => {
  it('groups members by view, the most common domain first', () => {
    expect(viewOf('payments.orders')).toBe('payments')
    expect(viewOf('a.b.c')).toBe('a.b')
    expect(viewOf('Revenue')).toBeNull()
    const member = (
      name: string,
      areaHint: string | null,
      kind: 'metric' | 'dimension' = 'metric',
    ) => ({
      name,
      kind,
      areaHint,
      modelFile: 'sales.yml',
      fromServer: areaHint === 'finance',
    })
    expect(
      sourceViews([
        member('sales.a', 'commercial'),
        member('sales.b', 'finance'),
        member('sales.c', 'finance'),
        member('sales.d', null),
        member('sales.country', null, 'dimension'),
        member('Revenue', null),
      ]),
    ).toEqual([
      {
        name: 'sales',
        metrics: 4,
        dimensions: 1,
        domains: ['finance', 'commercial'],
        withoutDomain: 1,
        fromServer: 2,
        modelFile: 'sales.yml',
      },
    ])
  })

  it('says what a source holds and what needs a look', () => {
    const demo = source()
    expect(holdsWords(demo)).toBe(`7 views, ${demo.definitions.current} definitions`)
    expect(membersWords(demo)).toMatch(/^7 views: \d+ metrics and \d+ dimensions$/)
    expect(membersWords({ ...demo, views: [], definitions: { current: 2, missing: 1 } })).toBe(
      '2 definitions, 1 gone',
    )
    expect(needsALookWords({ flaggedItems: 0, staleLinks: 0 })).toBe('Nothing')
    expect(needsALookWords({ flaggedItems: 1, staleLinks: 5 })).toBe('1 fact, 5 mentions')
  })

  it('says how a read went, and when the hourly read comes next', () => {
    const read = { status: 'ok', durationMs: 1_840, warnings: 2 } as const
    expect(readResultWords(read)).toBe('Complete in 1.8 seconds, 2 warnings')
    expect(readResultWords({ ...read, status: 'partial', warnings: 1 })).toBe(
      'In part in 1.8 seconds, 1 warning',
    )
    expect(readResultWords({ ...read, durationMs: 240, warnings: 0 })).toBe(
      'Complete in 240 milliseconds',
    )
    expect(readResultWords({ ...read, status: 'failed' })).toBe('Failed. Nothing changed.')
    expect(nextHourly('7 * * * *', new Date('2026-10-07T11:35:00Z'))?.toISOString()).toBe(
      '2026-10-07T12:07:00.000Z',
    )
    expect(nextHourly('7 * * * *', new Date('2026-10-07T11:05:00Z'))?.toISOString()).toBe(
      '2026-10-07T11:07:00.000Z',
    )
    expect(nextHourly('*/5 * * * *', new Date())).toBeNull()
    expect(versionWords('30c67cf52ae0859292a64c593dec2a20')).toBe('30c67cf')
    expect(versionWords('v1.4.0')).toBe('v1.4.0')
    expect(listWords(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c and 2 more')
    expect(listWords(['a', 'b'])).toBe('a and b')
  })
})

const cubeInGit = mockConnectorListings.find((listing) => listing.manifest.id === 'cube')!.manifest

it("tells an added source's administrator the remedy they have: the model, not the server", () => {
  const added = sourceIssues(source({ origin: 'workspace' }))[0]!.description
  expect(added).toMatch(
    /Name the domain with meta\.domain in the model, then read the source again/,
  )
  expect(sourceIssues(source())[0]!.description).toMatch(/the server's domain names/)
})

describe('the form to add a source', () => {
  it('starts from what the manifest gives, with every secret empty', () => {
    const values = sourceFormValues(cubeInGit)
    expect(values.fields).toEqual({
      repository: '',
      ref: 'main',
      folder: '',
      username: '',
      modelUrl: '',
    })
    expect(values.secrets).toEqual({ token: '' })
    expect(values.maps).toEqual({ domainNames: [] })
  })

  it('fills a source to change from its settings, never with a secret', () => {
    const values = sourceFormValues(cubeInGit, {
      id: 'analytics',
      type: 'cube',
      name: 'Analytics',
      revision: 2,
      config: {
        repository: 'https://git.example.com/a.git',
        ref: 'v2',
        domainNames: { paid: 'area_paid_media' },
      },
      secrets: [{ key: 'token', set: true }],
      changedAt: null,
      changedBy: null,
    })
    expect(values.name).toBe('Analytics')
    expect(values.fields).toMatchObject({ ref: 'v2', folder: '' })
    expect(values.secrets).toEqual({ token: '' })
    expect(values.maps.domainNames).toEqual([{ from: 'paid', to: 'area_paid_media' }])
  })

  it('sends settings and secrets apart, and leaves empty ones out', () => {
    const values = sourceFormValues(cubeInGit)
    values.fields = { ...values.fields, repository: ' https://git.example.com/a.git ' }
    values.secrets = { token: 'tok' }
    values.maps = {
      domainNames: [
        { from: ' paid ', to: 'area_paid_media' },
        { from: '', to: '' },
      ],
    }
    expect(sourceFormInput(cubeInGit, values)).toEqual({
      config: {
        repository: 'https://git.example.com/a.git',
        ref: 'main',
        domainNames: { paid: 'area_paid_media' },
      },
      secrets: { token: 'tok' },
    })
  })

  it('says what is missing or wrong before it sends anything', () => {
    const values = sourceFormValues(cubeInGit)
    values.fields = { ...values.fields, ref: '', modelUrl: 'https://me:pw@git.example.com/m' }
    values.maps = { domainNames: [{ from: 'paid', to: '' }] }
    expect(sourceFormProblems(cubeInGit, values, { isNew: true })).toEqual({
      name: 'Give the source a name.',
      repository: 'Give the repository address.',
      ref: 'Give the branch, tag or commit.',
      modelUrl:
        'Use an https address, without a user name, password, query or fragment. A secret goes in its own field.',
      domainNames: 'Choose a domain on each line.',
      reason: "Say why you're changing it.",
    })
    values.maps = {
      domainNames: [
        { from: 'paid', to: 'a' },
        { from: 'paid', to: 'b' },
      ],
    }
    expect(sourceFormProblems(cubeInGit, values, { isNew: true }).domainNames).toBe(
      'Give each name once.',
    )
  })

  it('draws the form of an interface 3 connector from its manifest, with its own rules', () => {
    const list = builtInManifests.find((manifest) => manifest.id === 'static-definitions')!
    const values = sourceFormValues(list)
    expect(values.fields).toEqual({ definitions: '' })
    expect(values.maps).toEqual({ domainNames: [] })
    values.name = 'Finance metrics'
    values.reason = 'Try it'
    expect(sourceFormProblems(list, values, { isNew: true })).toEqual({
      definitions: 'Give the definitions.',
    })
    values.fields.definitions = '[{"kind": "metric",'
    expect(sourceFormProblems(list, values, { isNew: true })).toEqual({
      definitions: 'This is not JSON. Check the brackets, commas and quotes.',
    })
    values.fields.definitions = '[{"kind": "metric", "name": "payments.orders"}]'
    expect(sourceFormProblems(list, values, { isNew: true })).toEqual({})
    expect(sourceFormInput(list, values)).toEqual({
      config: { definitions: '[{"kind": "metric", "name": "payments.orders"}]' },
      secrets: {},
    })
  })

  it('says how often a connector reads', () => {
    expect(scheduleWords('PT1H')).toBe('every hour')
    expect(scheduleWords('PT15M')).toBe('every 15 minutes')
    expect(scheduleWords('P1D')).toBe('every day')
    expect(scheduleWords('PT6H')).toBe('every 6 hours')
  })
})

describe('what a test read says', () => {
  it('says what Heed would hold, and the warnings that ask for a look', () => {
    const check = {
      ok: true,
      steps: [],
      version: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      complete: true,
      views: 4,
      metrics: 28,
      dimensions: 51,
      warnings: [
        { code: 'missing_domain', target: 'traffic' },
        { code: 'missing_domain', target: 'ranks' },
      ],
    }
    expect(checkWords(check, 'Cube')).toEqual({
      tone: 'warning',
      title: 'We can read it, with warnings',
      description:
        'Version a1b2c3d, 4 views: 28 metrics and 51 dimensions. 2 views have no domain.',
    })
    expect(checkWords({ ...check, warnings: [] }, 'Cube').tone).toBe('success')
  })

  it('says why it could not read, in the failure’s own words', () => {
    const failed = {
      ok: false,
      steps: [],
      version: null,
      complete: false,
      views: 0,
      metrics: 0,
      dimensions: 0,
      warnings: [{ code: 'unauthorized', target: 'https://git.example.com/a.git' }],
    }
    expect(checkWords(failed, 'Cube')).toMatchObject({
      tone: 'danger',
      title: 'The token was refused',
    })
    expect(checkWords({ ...failed, warnings: [] }, 'Cube').title).toBe(
      "We couldn't read the Cube model",
    )
    // A connector's failed step speaks for itself.
    expect(
      checkWords(
        {
          ...failed,
          warnings: [],
          steps: [
            {
              id: 'reach',
              title: 'Reach the host',
              status: 'failed',
              detail: 'It did not answer.',
              fix: 'Check the address.',
            },
          ],
        },
        'Static list',
      ),
    ).toEqual({
      tone: 'danger',
      title: "Reach the host: it didn't work",
      description: 'It did not answer. Check the address.',
    })
  })

  it("names a failed read's reason on the source's page", () => {
    const failed = source({
      lastRead: {
        status: 'failed',
        at: '2026-10-07T11:00:00.000Z',
        warnings: [{ code: 'ref_not_found', target: 'release' }],
      },
    })
    const [first, ...rest] = sourceIssues(failed)
    expect(first).toMatchObject({
      id: 'failed',
      tone: 'danger',
      title: "The last read failed: the branch, tag or commit isn't there",
    })
    expect(first!.description).toMatch(
      /^The repository has no release\. Check its name\. Nothing changed/,
    )
    expect(rest.map((issue) => issue.id)).not.toContain('ref_not_found')
  })
})
