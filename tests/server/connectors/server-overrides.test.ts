import { describe, expect, it } from 'vitest'
import { withOverrides } from '../../../src/server/modules/connectors/server-source.ts'
import type { SourceSnapshot } from '../../../src/server/modules/connectors/types.ts'

describe('the server’s domains for a group', () => {
  it('fill a metric shared across groups, and drop its warning', () => {
    const snapshot = {
      definitions: [{ ref: 'dbt:_shared.rate', name: '_shared.rate', areaHint: null }],
      warnings: [
        { code: 'missing_domain', target: '_shared.rate' },
        { code: 'missing_domain', target: 'customers' },
      ],
    } as unknown as SourceSnapshot
    const read = withOverrides(snapshot, { _shared: 'sales' })
    expect(read.definitions[0]).toMatchObject({ areaHint: 'sales', domainSource: 'override' })
    expect(read.warnings).toEqual([
      { code: 'missing_domain', target: 'customers' },
      { code: 'domain_override', target: 'dbt:_shared.rate' },
    ])
  })
})
