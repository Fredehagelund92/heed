import type { OperationsOverviewView } from '../../contract/operations.ts'
import { sourceViews } from '../../domain/source-views.ts'
import { DEMO_SOURCE_VERSION, GONE_DEFINITION_REF, demoDefinitions } from './cube-model.ts'

type Source = OperationsOverviewView['connectors'][number]

/** The views of the demo model that name no domain on purpose (db/seed/cube, CON-516). */
const missingDomain = ['operations', 'segments']

/**
 * The definition sources as the operations overview reports them, over the demo Cube model
 * (db/seed/cube) and the rules the service uses (domain/source-views.ts): read every hour, the
 * newest read 25 minutes ago with the model's two views without a domain, one failed read
 * three hours ago, and the demo source switched off. `source-down` makes the newest read the
 * failed one; `definition-gone` leaves one definition out of the newest read.
 */
export function mockSources({
  ago,
  scenario,
}: {
  /** The moment `seconds` before the mock's now (ISO 8601). */
  ago: (seconds: number) => string
  scenario: string | null
}): Source[] {
  const down = scenario === 'source-down'
  const gone = scenario === 'definition-gone' ? [GONE_DEFINITION_REF] : []
  const current = demoDefinitions.filter((definition) => !gone.includes(definition.ref))
  const metrics = current.filter((definition) => definition.kind === 'metric')
  const newest = 1_520
  const hour = 3_600
  // Hourly reads, newest first: the fourth failed (or the first, while the source is down).
  const reads = [0, 1, 2, 3, 4, 5].map((index) => {
    const failed = down ? index === 0 : index === 3
    return {
      at: ago(newest + index * hour),
      status: failed ? ('failed' as const) : ('ok' as const),
      durationMs: failed ? 30_000 : 1_740 + index * 35,
      definitionsSeen: failed ? 0 : current.length,
      warnings: failed ? 0 : missingDomain.length,
      sourceVersion: failed ? null : DEMO_SOURCE_VERSION,
    }
  })
  const lastGood = reads.find((read) => read.status !== 'failed')!
  const lastFailed = reads.find((read) => read.status === 'failed')!
  const ageSeconds = Math.round((Date.parse(ago(0)) - Date.parse(lastGood.at)) / 1000)
  return [
    {
      id: 'cube',
      name: 'Cube local model',
      type: 'cube',
      kind: 'definition_source',
      origin: 'server',
      tool: 'Cube',
      settingKeys: ['sources.cube_model_url'],
      server: {
        settings: [
          { key: 'model_folder', variable: 'CUBE_MODEL_DIR', value: 'db/seed/cube' },
          { key: 'domain_overrides', variable: 'CL_DOMAIN_OVERRIDES', value: null },
          { key: 'renames', variable: 'CUBE_RENAMES_FILE', value: null },
        ],
      },
      status: 'ok',
      staleAfterSeconds: 6 * hour,
      lastSuccessAt: lastGood.at,
      ageSeconds,
      sourceVersion: DEMO_SOURCE_VERSION,
      lastErrorAt: lastFailed.at,
      lastError: 'Definition source could not be read',
      lastRead: {
        status: reads[0]!.status,
        at: reads[0]!.at,
        warnings: down ? [] : missingDomain.map((target) => ({ code: 'missing_domain', target })),
      },
      definitions: { current: current.length, missing: gone.length },
      domainCoverage: {
        cube: metrics.filter((definition) => definition.domainSource === 'cube').length,
        override: metrics.filter((definition) => definition.domainSource === 'override').length,
        none: metrics.filter((definition) => definition.domainSource === 'none').length,
      },
      flaggedItems: gone.length ? 3 : 0,
      staleLinks: gone.length ? 5 : 0,
      views: sourceViews(
        current.map((definition) => ({
          name: definition.name,
          kind: definition.kind,
          areaHint: definition.areaHint,
          modelFile: definition.modelFile,
          fromServer: definition.domainSource === 'override',
        })),
      ),
      renames: [],
      recentReads: reads,
    },
    {
      id: 'demo',
      name: 'Demo definitions',
      type: 'demo',
      kind: 'definition_source',
      origin: 'server',
      tool: 'Demo',
      settingKeys: [],
      server: null,
      status: 'disabled',
      staleAfterSeconds: 6 * hour,
      lastSuccessAt: ago(40 * 86_400),
      ageSeconds: 40 * 86_400,
      sourceVersion: 'demo-v1',
      lastErrorAt: null,
      lastError: null,
      lastRead: { status: 'ok', at: ago(40 * 86_400), warnings: [] },
      definitions: { current: 2, missing: 0 },
      domainCoverage: { cube: 0, override: 0, none: 0 },
      flaggedItems: 0,
      staleLinks: 0,
      views: [],
      renames: [],
      recentReads: [
        {
          at: ago(40 * 86_400),
          status: 'ok',
          durationMs: 12,
          definitionsSeen: 2,
          warnings: 0,
          sourceVersion: 'demo-v1',
        },
      ],
    },
  ]
}
