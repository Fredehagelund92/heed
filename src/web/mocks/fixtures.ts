import type { ContextItem } from '@domain/item'
import { DEFAULT_ITEM_COUNT, generateItems } from './items'

export {
  areas,
  currentUserId,
  people,
  roleGrants,
  vocabulary,
  FIXTURE_TODAY,
} from './reference-data'
export { DEFAULT_ITEM_COUNT, generateItems, regression, versionDays } from './items'
export { linksOf, mentions } from './links'
export { mockCatalogue } from './catalogue'
export { mockTestQuestions } from './test-questions'

let cached: ContextItem[] | null = null

/** The shared fixture set (1,500 items). Built once, on first use. */
export function getFixtureItems(): ContextItem[] {
  cached ??= generateItems(DEFAULT_ITEM_COUNT)
  return cached
}
