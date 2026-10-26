import { expect, it } from 'vitest'
import fc from 'fast-check'
import { resolve, itemTextSize } from '../../../src/domain/resolver.ts'
import { oracle } from './oracle.ts'
import { bundleArb, requestArb } from './resolver-arbitraries.ts'

// CPU-bound and deterministic: the default five seconds is too short beside the full suite.
it(
  'agrees with an independent full-scan oracle on 20,000 boundary-heavy cases',
  { timeout: 60_000 },
  () => {
    fc.assert(
      fc.property(bundleArb, requestArb, (bundle, request) => {
        const output = resolve(bundle, request)
        expect({
          status: output.status,
          items: output.items,
          withheld: output.withheld,
          cut: output.cut,
        }).toEqual(oracle(bundle, request))
        expect(resolve({ ...bundle, items: [...bundle.items].reverse() }, request)).toEqual(output)
        expect(
          output.items.reduce(
            (size, match) =>
              size + itemTextSize(bundle.items.find((item) => item.id === match.id)!),
            0,
          ),
        ).toBeLessThanOrEqual(request.sizeLimit)
      }),
      { seed: 20260804, numRuns: 20_000 },
    )
  },
)
