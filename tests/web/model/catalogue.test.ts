import { describe, expect, it } from 'vitest'
import { manifest } from '../../../src/connectors/dbt-metricflow/manifest'
import { connectFormFor, testFor } from '../../../src/web/api/mock/integrations'
import { connectorById, connectors, connectorByTool } from '../../../src/web/model/catalogue'
import { logos } from '../../../src/web/model/integrations'

/* The dbt cell of the catalogue, drawn from its connector's manifest and no longer Soon. */

describe('the dbt cell', () => {
  it('comes from the manifest, with its logo, and can be connected', () => {
    expect(connectorById('dbt-metricflow')).toMatchObject({
      name: manifest.tool,
      kind: 'definitions',
      blurb: manifest.summary,
      logo: logos['dbt-metricflow'],
      access: manifest.access,
      git: true,
      domainField: 'meta.domain',
    })
    expect(connectorById('dbt-metricflow')?.soon).toBeUndefined()
    expect(connectorByTool('dbt')?.id).toBe('dbt-metricflow')
  })

  it('is the only dbt in the catalogue, and Notion stays Soon', () => {
    expect(connectors.filter((connector) => connector.name === 'dbt')).toHaveLength(1)
    expect(connectorById('dbt')).toBeUndefined()
    expect(connectorById('notion')?.soon).toBe(true)
  })

  it('never promises a link to a file its definitions do not name', () => {
    expect(connectorById('dbt-metricflow')?.noFileLinks).toBe(true)
    expect(connectorById('cube')?.noFileLinks).toBeUndefined()
  })
})

describe('dbt on the mock', () => {
  it('starts its form from the manifest’s defaults', () => {
    const form = connectFormFor('dbt-metricflow', [])!
    const value = (key: string) => form.fields.find((field) => field.key === key)?.value
    expect(form.source).toBeNull()
    expect([value('repository'), value('ref'), value('file')]).toEqual([
      '',
      'main',
      'semantic_manifest.json',
    ])
  })

  it('finds its semantic models to choose from, once it has a repository', () => {
    const config = { repository: 'https://git.example.com/a.git', ref: 'main', file: 'a.json' }
    const test = testFor('dbt-metricflow', { config, secrets: {} })
    expect(test.ok).toBe(true)
    expect(test.scopes.map((scope) => [scope.id, scope.metrics, scope.dimensions])).toEqual([
      ['orders', 9, 3],
      ['customers', 1, 4],
      ['_shared', 2, 0],
    ])
    expect(testFor('dbt-metricflow', { config: {}, secrets: {} }).ok).toBe(false)
  })
})
