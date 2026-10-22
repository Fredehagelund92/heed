import type { AppFamily } from '../../domain/app-family.ts'
import { shiftDate } from '../../domain/validity.ts'
import type { MockAppDay } from '../api/mock-quality.ts'

/*
  The agents' tool calls the demo starts with (FR-410), as the request log counts them: per app
  family from the fixed list and day, never the agent's own name or a person. Health counts them per
  week and hides a count below the minimum, so this week Claude Code shows a few malformed calls
  among many, Cursor a high share of them, ChatGPT hides its few, and Claude's desktop and web
  apps hide every count.
*/

const seeds: (Omit<MockAppDay, 'day' | 'family'> & { family: AppFamily; weeksAgo: number })[] = [
  {
    family: 'claude_code',
    weeksAgo: 0,
    calls: 142,
    needMoreDetail: 9,
    noMatch: 21,
    invalidInput: 6,
    errors: 0,
  },
  {
    family: 'cursor',
    weeksAgo: 0,
    calls: 38,
    needMoreDetail: 6,
    noMatch: 7,
    invalidInput: 11,
    errors: 1,
  },
  {
    family: 'chatgpt',
    weeksAgo: 0,
    calls: 17,
    needMoreDetail: 2,
    noMatch: 5,
    invalidInput: 0,
    errors: 0,
  },
  {
    family: 'claude_ai',
    weeksAgo: 0,
    calls: 3,
    needMoreDetail: 0,
    noMatch: 1,
    invalidInput: 0,
    errors: 0,
  },
  {
    family: 'heed',
    weeksAgo: 0,
    calls: 60,
    needMoreDetail: 0,
    noMatch: 8,
    invalidInput: 0,
    errors: 0,
  },
  {
    family: 'claude_code',
    weeksAgo: 1,
    calls: 120,
    needMoreDetail: 12,
    noMatch: 18,
    invalidInput: 2,
    errors: 1,
  },
  {
    family: 'cursor',
    weeksAgo: 1,
    calls: 25,
    needMoreDetail: 5,
    noMatch: 6,
    invalidInput: 9,
    errors: 0,
  },
]

export function demoAppDays(today: string): MockAppDay[] {
  return seeds.map(({ weeksAgo, ...counts }) => ({
    ...counts,
    day: shiftDate(today, -7 * weeksAgo),
  }))
}
