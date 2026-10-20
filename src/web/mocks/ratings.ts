import { shiftDate } from '../../domain/validity.ts'
import type { MockRating } from '../api/mock-quality.ts'

/*
  The assistant's ratings the demo starts with (FR-712): thumbs up and down in the last few weeks,
  by domain, as the service stores them: a verdict, a domain and a day, never who rated. Health
  counts them per week and hides a count below the minimum, so Sales shows its good answers
  and hides its few wrong ones, Paid media shows a week of many wrong answers, and two answers
  this week were about no one domain.
*/

const seeds: { area: string | null; weeksAgo: number; helpful: number; wrong: number }[] = [
  { area: 'area_sales', weeksAgo: 0, helpful: 6, wrong: 1 },
  { area: 'area_sales', weeksAgo: 1, helpful: 5, wrong: 0 },
  { area: 'area_sales', weeksAgo: 2, helpful: 3, wrong: 2 },
  { area: 'area_paid_media', weeksAgo: 0, helpful: 2, wrong: 5 },
  { area: 'area_paid_media', weeksAgo: 1, helpful: 7, wrong: 0 },
  { area: null, weeksAgo: 0, helpful: 2, wrong: 0 },
]

export function demoRatings(today: string): MockRating[] {
  return seeds.flatMap(({ area, weeksAgo, helpful, wrong }) => {
    const day = shiftDate(today, -7 * weeksAgo)
    return [
      ...Array.from({ length: helpful }, () => ({ area, verdict: 'helpful' as const, day })),
      ...Array.from({ length: wrong }, () => ({ area, verdict: 'wrong' as const, day })),
    ]
  })
}
