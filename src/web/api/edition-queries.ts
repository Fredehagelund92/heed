/**
 * Seeing what changed between editions (Editions design G1 to G3): one comparison engine on the
 * service, read the same way by the Editions pages and the Workbench. The keys live with every
 * other key (`queryKeys`) and start with `editions`, so a new edition makes these reads stale
 * (`afterPublish`, and live updates from others). The options live here, apart from queries.ts,
 * so only the pages that compare editions load them, not the shell.
 */
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import {
  api,
  type Edition,
  type EditionCompareInput,
  type EditionComparison,
  type EditionFeedInput,
  type EditionItemCompareInput,
} from '@/api'
import { editionBeforeDay } from '@/lib/edition-compare'
import {
  EDITIONS_PAGE_MAX,
  queryKeys,
  type EditionChangesFilter,
  type EditionFeedRange,
} from './queries'

/** Two named editions are sealed and never change, so their answer is kept until a publish. */
const sealedPair = (input: { from?: string | undefined; to?: string | undefined }) =>
  input.from !== undefined && input.to !== undefined ? { staleTime: Infinity } : {}

/** What changed between two editions, each item once: one page, with counts for every filter. */
export const editionComparisonQuery = (input: EditionCompareInput = {}) =>
  queryOptions({
    queryKey: queryKeys.editionComparison(input),
    queryFn: () => api.compareEditions(input),
    ...sealedPair(input),
  })

/** How many changed items a page of a comparison holds (the service's default). */
export const EDITION_CHANGES_PAGE = 50
type EditionChangesPage = { offset: number; from?: string; to?: string }
const firstChangesPage: EditionChangesPage = { offset: 0 }

/**
 * Every changed item between two editions, a page at a time. The first page names the editions
 * it compared and the next pages ask for exactly those, so a publish while someone reads does
 * not move the pages under them: by default the live edition against the one before it.
 */
export const editionComparisonPagesQuery = (input: EditionChangesFilter = {}) =>
  infiniteQueryOptions({
    queryKey: queryKeys.editionComparisonPages(input),
    queryFn: ({ pageParam }) =>
      api.compareEditions({ ...input, ...pageParam, limit: EDITION_CHANGES_PAGE }),
    initialPageParam: firstChangesPage,
    getNextPageParam: (page: EditionComparison): EditionChangesPage | undefined =>
      page.offset + page.items.length < page.total
        ? {
            offset: page.offset + page.items.length,
            to: page.to.label,
            ...(page.from ? { from: page.from.label } : {}),
          }
        : undefined,
    ...sealedPair(input),
  })

/** One item between two editions, field by field, with each edition that changed it. */
export const editionItemComparisonQuery = (input: EditionItemCompareInput) =>
  queryOptions({
    queryKey: queryKeys.editionItemComparison(input),
    queryFn: () => api.compareEditionItem(input),
    ...sealedPair(input),
  })

/** One page of the editions feed: newest first, what each changed, who did it and why. */
export const editionFeedQuery = (input: EditionFeedInput = {}) =>
  queryOptions({ queryKey: queryKeys.editionFeed(input), queryFn: () => api.editionFeed(input) })

/** The editions feed, a page at a time, from the newest edition back. */
export const editionFeedPagesQuery = (input: EditionFeedRange = {}) =>
  infiniteQueryOptions({
    queryKey: queryKeys.editionFeedPages(input),
    queryFn: ({ pageParam }) =>
      api.editionFeed({ ...input, ...(pageParam === null ? {} : { before: pageParam }) }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next,
  })

/**
 * What going back to an edition would do (G7): the live edition compared with it, and the
 * versions that cannot be served again. It depends on the live edition and on checks that can
 * fail later, so it is never kept: each dialog reads it afresh, and shows nothing older.
 */
export const rollbackPreviewQuery = (label: string) =>
  queryOptions({
    queryKey: queryKeys.rollbackPreview(label),
    queryFn: () => api.previewRollback(label),
    staleTime: 0,
    gcTime: 0,
  })

/** Every edition, newest first, a page of the list at a time: what the edition pickers offer. */
export const editionPagesQuery = () =>
  infiniteQueryOptions({
    queryKey: queryKeys.editionPages,
    queryFn: ({ pageParam }) => api.listEditions({ limit: EDITIONS_PAGE_MAX, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (page: Edition[], pages) =>
      page.length < EDITIONS_PAGE_MAX ? undefined : pages.length * EDITIONS_PAGE_MAX,
  })

/**
 * The edition that was live when a day began, so a range such as "the last 7 days" starts there:
 * the newest edition sealed on an earlier day, or the oldest edition when none is that old (null
 * with no edition at all). The service has no read by day, so this pages through the list, newest
 * first, and stops at the first page that reaches an earlier day.
 */
export const editionBeforeDayQuery = (day: string) =>
  queryOptions({
    queryKey: queryKeys.editionBeforeDay(day),
    queryFn: async (): Promise<Edition | null> => {
      let oldest: Edition | null = null
      for (let offset = 0; ; offset += EDITIONS_PAGE_MAX) {
        const page = await api.listEditions({ limit: EDITIONS_PAGE_MAX, offset })
        const found = editionBeforeDay(page, day)
        if (found) return found as Edition
        oldest = page.at(-1) ?? oldest
        if (page.length < EDITIONS_PAGE_MAX) return oldest
      }
    },
  })
