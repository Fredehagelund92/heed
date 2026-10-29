import * as z from 'zod/mini'
import { describe, expect, it } from 'vitest'
import {
  areaSchema,
  itemSchema,
  personSchema,
  SUMMARY_MAX_LENGTH,
  vocabularySchema,
} from '../../src/domain/item.ts'
import { areas, FIXTURE_TODAY, people, vocabulary } from '../../db/seed/fixtures/reference-data.ts'
import {
  DEFAULT_ITEM_COUNT,
  generateItems,
  regression,
  versionDays,
} from '../../db/seed/fixtures/items.ts'
import { addDays } from '../../db/seed/fixtures/random.ts'
import { storyFacts } from '../../db/seed/fixtures/story-facts.ts'

describe('item fixtures', () => {
  const items = generateItems()

  it('generates 1,500 items by default', () => {
    expect(DEFAULT_ITEM_COUNT).toBe(1500)
    expect(items).toHaveLength(1500)
  })

  it('is deterministic for a seed and different for another', () => {
    expect(generateItems(50, 1)).toEqual(generateItems(50, 1))
    expect(generateItems(50, 1)).not.toEqual(generateItems(50, 2))
  })

  it('produces only items that follow the item model', () => {
    for (const item of items) {
      const result = z.safeParse(itemSchema, item)
      expect(result.success, `${item.id}: ${result.success ? '' : result.error.message}`).toBe(true)
    }
  })

  it('has unique ids', () => {
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length)
  })

  it('follows the rules in the requirements', () => {
    for (const item of items) {
      // FR-118: a summary has at most 280 characters.
      expect(item.summary.length).toBeLessThanOrEqual(SUMMARY_MAX_LENGTH)
      // FR-126: an item names at least one metric or one dimension value.
      expect(item.scope.metrics.length + item.scope.dimensionValues.length).toBeGreaterThan(0)
      // FR-127: an item with no end date has a review date.
      if (item.validity.end === null) expect(item.reviewDate).not.toBeNull()
      // An end date is after the start date.
      if (item.validity.end !== null) expect(item.validity.end > item.validity.start).toBe(true)
      // Nothing is dated after the fixture "today".
      expect(item.updatedAt.slice(0, 10) <= FIXTURE_TODAY).toBe(true)
    }
  })

  it('covers all five kinds, every area, long titles and past review dates', () => {
    expect(new Set(items.map((item) => item.kind))).toEqual(
      new Set(['note', 'event', 'guide', 'example', 'issue']),
    )
    expect(new Set(items.map((item) => item.areaId)).size).toBe(areas.length)
    expect(items.some((item) => item.title.length > 100)).toBe(true)
    expect(items.some((item) => item.reviewDate !== null && item.reviewDate < FIXTURE_TODAY)).toBe(
      true,
    )
    expect(items.some((item) => item.status === 'retired')).toBe(true)
  })

  it('holds a handful of issues in every state, each asked the right review question', () => {
    const issues = items.filter((item) => item.kind === 'issue')
    const ended = (end: string | null) => end !== null && end <= FIXTURE_TODAY
    // Still going on with an end date, open with no end date (one of them past its review date),
    // and ended (history now).
    expect(issues.filter((i) => i.validity.end !== null && !ended(i.validity.end))).toHaveLength(2)
    expect(issues.filter((i) => i.validity.end === null)).toHaveLength(2)
    expect(
      issues.filter((i) => i.reviewDate !== null && i.reviewDate < FIXTURE_TODAY),
    ).toHaveLength(1)
    expect(issues.filter((i) => ended(i.validity.end))).toHaveLength(3)
    for (const issue of issues) {
      expect(issue.validity.start <= FIXTURE_TODAY).toBe(true)
      // FR-135: an open issue is re-checked 14 days after it starts and asks whether it goes on.
      expect([issue.reviewDate, issue.reviewQuestion]).toEqual(
        issue.validity.end === null
          ? [addDays(issue.validity.start, 14), 'still_going_on']
          : [null, 'still_correct'],
      )
    }
    for (const item of items.filter((i) => i.kind !== 'issue'))
      expect(item.reviewQuestion).toBe('still_correct')
  })

  it('keeps every item before the issues as it was without them', () => {
    const regular = generateItems(1500).filter((item) => item.kind !== 'issue')
    expect(regular).toHaveLength(1493)
    expect(generateItems(50).map((item) => item.id)).toEqual(
      regular.slice(0, 50).map((item) => item.id),
    )
  })

  it("tells the Norway show's facts in their writers' words, on facts nothing else names", () => {
    const byId = new Map(items.map((item) => [item.id, item]))
    for (const [id, fact] of Object.entries(storyFacts)) {
      const item = byId.get(id)
      expect(item, id).toBeDefined()
      expect(item).toMatchObject({ summary: fact.summary, notToConclude: fact.notToConclude })
      expect(item!.evidence[0]).toMatchObject(fact.source)
      expect(item!.summary.length).toBeLessThanOrEqual(SUMMARY_MAX_LENGTH)
      expect(fact.body !== undefined, id).toBe(item!.kind === 'guide')
      expect(id).not.toBe(regression.item)
    }
    // A shorter library holds the ones it has.
    expect(generateItems(50)).toHaveLength(50)
  })

  it('never repeats a sentence within a summary', () => {
    for (const item of items) {
      const sentences = item.summary.split(/(?<=[.?!])\s/)
      expect(new Set(sentences).size, item.id).toBe(sentences.length)
    }
  })

  it('tells the demo regression: a note ended in its second version, the first had no end', () => {
    const note = items.find((item) => item.id === regression.item)!
    expect(note).toMatchObject({
      kind: 'note',
      areaId: 'area_sales',
      version: 2,
      validity: { end: regression.end },
      reviewDate: null,
      updatedAt: `${regression.accepted}T09:00:00Z`,
    })
    expect(versionDays(note)).toEqual([
      expect.objectContaining({
        version: 1,
        patch: {
          validity: { start: note.validity.start, end: null },
          reviewDate: regression.reviewDateBefore,
        },
      }),
      { version: 2, proposed: '2026-09-29', accepted: regression.accepted },
    ])
    // Another seed has no such note.
    expect(generateItems(50, 1).some((item) => item.id === regression.item)).toBe(false)
  })

  it('references only known areas, people, metrics and dimension values', () => {
    const areaIds = new Set(areas.map((area) => area.id))
    const personIds = new Set(people.map((person) => person.id))
    const metricIds = new Set(vocabulary.metrics.map((metric) => metric.id))
    const dimensionValues = new Set(
      vocabulary.dimensions.flatMap((dimension) =>
        dimension.values.map((value) => `${dimension.id}:${value.id}`),
      ),
    )
    for (const item of items) {
      expect(areaIds.has(item.areaId)).toBe(true)
      expect(personIds.has(item.ownerId)).toBe(true)
      // Every demo item has a person who proposed it: none was made by a read.
      expect(item.proposerId !== null && personIds.has(item.proposerId)).toBe(true)
      for (const metric of item.scope.metrics) expect(metricIds.has(metric)).toBe(true)
      for (const value of item.scope.dimensionValues) {
        expect(dimensionValues.has(`${value.dimension}:${value.value}`)).toBe(true)
      }
    }
  })

  it('has valid reference data', () => {
    for (const area of areas) expect(z.safeParse(areaSchema, area).success).toBe(true)
    for (const person of people) expect(z.safeParse(personSchema, person).success).toBe(true)
    expect(z.safeParse(vocabularySchema, vocabulary).success).toBe(true)
  })

  it('can publish a JSON Schema from the same definition (FR-124)', () => {
    const schema = z.toJSONSchema(itemSchema) as {
      type?: string
      properties?: Record<string, unknown>
    }
    expect(schema.type).toBe('object')
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(['id', 'kind', 'title', 'summary', 'scope', 'validity', 'riskLevel']),
    )
  })
})
