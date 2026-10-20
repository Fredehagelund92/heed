import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { goldenSetSchema, type GoldenSet } from '../../src/domain/golden-set.ts'

/** The golden set (golden-set.yml), checked against its format. Demo data only. */
export function loadGoldenSet(): GoldenSet {
  return goldenSetSchema.parse(
    parse(readFileSync(new URL('./golden-set.yml', import.meta.url), 'utf8')),
  )
}
