import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createCubeSource } from '../../../src/server/modules/connectors/index.ts'
import {
  DEMO_SOURCE_VERSION,
  changedDefinitions,
  definitionRefOf,
  definitionRefsOf,
  demoDefinitions,
  demoWarnings,
  goneRefOf,
} from '../../../src/web/mocks/cube-model.ts'
import { generateItems } from '../../../src/web/mocks/items.ts'
import { vocabulary } from '../../../src/web/mocks/reference-data.ts'

const modelDir = fileURLToPath(new URL('../../../db/seed/cube/', import.meta.url))

/*
  The demo Cube model (db/seed/cube) and what the bulk seed and the mock binding say the
  connector reads from it (src/web/mocks/cube-model.ts). When the model changes, this test names
  the difference: copy the new read into cube-model.ts.
*/
describe('the demo Cube model', () => {
  it('reads as cube-model.ts says, with no calculation in the read', async () => {
    const snapshot = await createCubeSource({ modelDir }).read()
    expect(snapshot.complete).toBe(true)
    expect(snapshot.sourceVersion).toBe(DEMO_SOURCE_VERSION)
    expect(snapshot.warnings).toEqual(demoWarnings)
    expect(snapshot.renames).toEqual([])
    expect(snapshot.definitions).toEqual(
      // The demo model gives no member other names and joins none with a prefix.
      demoDefinitions.map((definition) => ({
        ...definition,
        visibleGroups: null,
        synonyms: [],
        baseName: null,
      })),
    )
    // Heed keeps no calculation and no table (CON-207).
    expect(JSON.stringify(snapshot)).not.toMatch(/SUM\(|NULLIF|demo\.|_eur\b/)
  }, 30_000)

  it('gives every vocabulary metric and dimension its own definitions, and nothing else', () => {
    const named = [
      ...vocabulary.metrics.flatMap((metric) =>
        definitionRefsOf({ key: `metric:${metric.id}`, group: metric.group }),
      ),
      ...vocabulary.dimensions.flatMap((dimension) =>
        definitionRefsOf({ key: `dim:${dimension.id}` }),
      ),
    ]
    // A view's date is what a figure is read by (FR-716): no vocabulary term names a date.
    const dates = demoDefinitions.filter((definition) => definition.valueType === 'time')
    expect(dates.map((definition) => definition.ref)).toEqual([
      'cube:marketing.marketing_day',
      'cube:orders.order_day',
    ])
    expect([...named].sort()).toEqual(
      demoDefinitions
        .filter((definition) => definition.valueType !== 'time')
        .map((definition) => definition.ref)
        .sort(),
    )
    // Market is in three views, so its term names each: one dimension, many Cube names.
    expect(definitionRefsOf({ key: 'dim:market' })).toEqual([
      'cube:marketing.market',
      'cube:orders.market',
      'cube:segments.market',
    ])
    for (const metric of vocabulary.metrics) {
      const ref = definitionRefOf({ key: `metric:${metric.id}`, group: metric.group })
      const definition = demoDefinitions.find((d) => d.ref === ref)
      expect(definition?.kind, ref).toBe('metric')
      expect(definition?.title, ref).toContain(metric.name)
    }
    for (const [ref, { previousMark }] of Object.entries(changedDefinitions))
      expect(demoDefinitions.find((d) => d.ref === ref)?.changeMark).not.toBe(previousMark)
  })

  it('gives fixture items the marks a read of the model keeps their flags with', () => {
    const marks = new Map(demoDefinitions.map((d) => [d.ref, d.changeMark]))
    const items = generateItems()
    for (const item of items) {
      const refs = Object.entries(item.changeMarks)
      expect(Object.keys(item.changeMarks), item.id).toEqual(item.references)
      if (item.checkFlag === null)
        expect(
          refs.every(([ref, mark]) => marks.get(ref) === mark),
          item.id,
        ).toBe(true)
      if (item.checkFlag === 'needs_check')
        expect(
          refs.every(([ref, mark]) => marks.has(ref) && marks.get(ref) !== mark),
          item.id,
        ).toBe(true)
      if (item.checkFlag === 'source_missing')
        expect(item.references, item.id).toEqual(item.scope.metrics.map(goneRefOf))
    }
    expect(new Set(items.map((item) => item.checkFlag))).toEqual(
      new Set([null, 'needs_check', 'source_missing']),
    )
  })
})
