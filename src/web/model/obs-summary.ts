import type { CaughtView, SummaryPeriod } from '@domain/obs-summary'
import type { Period, SummaryWords } from '@domain/obs-summary-words'
import type { DomainId } from './items'
import type { Count } from './observability'

// Observability's Summary: the last whole calendar month or quarter, for someone who reads it
// rather than explores it, such as a manager the page is passed to. Every count comes from the
// binding already through one disclosure pass (src/domain/obs-summary.ts): a count under 5 is null,
// and none gives a hidden one away. The sentences are fixed templates over those counts, never
// written by a model (src/domain/obs-summary-words.ts), and a sentence shows only when its count is
// shown. A monthly snapshot keeps them as they were said when it was taken.

export type { SummaryPeriod }
export const SUMMARY_PERIODS: Record<SummaryPeriod, string> = {
  month: 'Last month',
  quarter: 'Last quarter',
}

export type { Period }
export {
  caughtLines,
  changesWords,
  countWords,
  dayName,
  EXACT_FROM,
  notComparedWords,
  periodName,
  shareWords,
  summaryNumbers,
  summarySentences,
  summaryWords,
  type CaughtLine,
  type Move,
  type SummaryWords,
} from '@domain/obs-summary-words'

export type SummaryData = {
  /** Nothing asked yet; fewer than 5 in the period (no counts at all); or counted. */
  state: 'empty' | 'quiet' | 'normal'
  period: SummaryPeriod
  /** The last day counted: the numbers are as of its end. */
  last: number
  now: Period
  before: Period
  /** The first day agents asked anything in the domains read. */
  since: number | null
  /** Whether every day of the period is still counted. */
  complete: boolean
  numbers: { asked: Count; checked: Count; warned: Count; missing: Count }
  /** The period before, or null when it is not compared. */
  previous: { asked: Count; checked: Count; missing: Count } | null
  /** Why the period before is not compared: agents first asked after it began, or it is no longer all counted. */
  notCompared: 'started' | 'not_kept' | null
  /** The trend: what was checked each week, oldest first. */
  weeks: { at: number; counted: boolean; checked: Count }[]
  /** Topics whose questions found nothing and that are still open, the biggest first. */
  open: {
    total: number
    spots: {
      id: string
      title: string
      domain?: DomainId
      /** The first day its questions found nothing. */
      since: number
      /** What found nothing about it in the period. */
      missing: Count
      /** What waits for it: a draft, a suggestion, or nothing yet. */
      label: string
      href: string
    }[]
  }
  /** Changes approved in review and published in the period, the latest five. */
  changes: {
    total: Count
    before: Count
    latest: { at: number; title: string; domain?: DomainId; by: string; href?: string }[]
  }
  /**
   * What was caught besides the answers with a warning: saved questions that changed after a
   * change, by the change, and alerts that asked an owner for a decision and were acted on. A
   * snapshot taken before it was counted has none.
   */
  caught?: CaughtView
  /** How many numbers on the page are hidden. */
  hidden: number
}

/* ---------- words ---------- */

/** What each headline number counts, exactly: one click away on the page and printed under it. */
export const DEFINITIONS = {
  asked:
    'Calls from AI agents to the answer tool whose question named something that could be read, such as a metric or a market. Questions are counted, not people: the words of a question and who asked are never kept.',
  checked:
    'Questions whose answer was based on checked context: an owner published it with a source and a check date, and it applies to what was asked. Answers with a warning are not counted here.',
  warned:
    'Questions answered with a warning: only part of what was asked was covered, two items disagreed, or an item was past its check date.',
  missing:
    'Questions with nothing written down for them. The agent was told so, and the topic waits for an owner to write it.',
  changes:
    'Changes to context items that an owner approved in review and published, so agents get them from then on.',
  saved:
    'Times a saved question was checked again on its own after a publish, an archive, a restore, a sync or a check date passing, and its answer was no longer the same. Check now, saving and keeping an answer are not counted.',
  alerts:
    'Alerts that asked an owner for a decision: Not found, a saved question needs a look, and a check is due. Acted on: an owner or admin decided within 14 days, such as a draft, a kept answer or the item checked. Not measured for the other five rules, which ask for no decision that is kept.',
} as const

/* ---------- snapshots ---------- */

/**
 * A monthly snapshot of Summary, as a list shows it: the month, every domain or one, the day it
 * was taken, and whether anything was counted.
 */
export type SnapshotItem = {
  id: string
  /** The domain it counts; none for every domain. */
  domain?: DomainId
  now: Period
  takenOn: number
  state: SummaryData['state']
}

/**
 * A snapshot as its digest reads it: the Summary's counts as they were shown when it was taken,
 * with what is open and what changed as counts alone, and the sentences said over them then.
 */
export type Snapshot = SnapshotItem & { data: SummaryData; words: SummaryWords }
