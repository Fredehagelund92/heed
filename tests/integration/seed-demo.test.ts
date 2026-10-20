import { expect, it } from 'vitest'
import { bulkSeed } from '../../db/seed/bulk.ts'
import { seedDemo } from '../../db/seed/demo.ts'
import { demoTestQuestions } from '../../db/seed/test-questions.ts'
import { gapFixtures } from '../../src/web/mocks/gaps.ts'
import { generateItems, regression } from '../../src/web/mocks/items.ts'
import { testDatabase } from './support.ts'

const { client } = testDatabase()

/*
  The demo's quality history on the bulk seed (db/seed/demo.ts). The seed checks its own story
  (every weekly run passes but the newest Sales one, which fails the regression on its
  note), so a change to the library or to get_context that breaks it fails here.
*/
it(
  'adds weekly runs, retrieval passes, gaps and the linked regression to the bulk seed',
  {
    timeout: 600_000,
  },
  async () => {
    await client.query('reset role')
    await expect(seedDemo(client)).rejects.toThrow('bulk seed of the 1,500 fixture items first')
    await bulkSeed(client, generateItems())
    await seedDemo(client)

    const [counts] = (
      await client.query<{
        questions: number
        runs: number
        passes: number
        gaps: number
        live: boolean
      }>(
        `select (select count(*)::int from golden_questions) as questions,
              (select count(*)::int from eval_runs where kind='scheduled' and state='finished') as runs,
              (select count(*)::int from retrieval_runs) as passes,
              (select count(*)::int from gaps) as gaps,
              (select seq=(select max(seq) from editions) from live_edition) as live`,
      )
    ).rows
    expect(counts).toMatchObject({
      questions: demoTestQuestions.length,
      // Every domain is run each Monday once it has test questions: twelve Mondays for Sales,
      // Marketing and Sandbox, three for Customer value (from 15 September) and one for Paid media
      // (from 2 October).
      runs: 40,
      gaps: gapFixtures.length,
      live: true,
    })
    expect(counts!.passes).toBeGreaterThan(50)

    const { rows: newest } = await client.query<{ day: string; regressions: string[] }>(
      `select (finished_at at time zone 'UTC')::date::text as day,
            summary->'result'->'scorecard'->'regressions' as regressions
       from eval_runs where area_id='area_sales' order by finished_at desc limit 1`,
    )
    expect(newest).toEqual([{ day: '2026-10-05', regressions: [regression.question] }])
    const { rows: links } = await client.query<{ question: string; evidence: boolean }>(
      `select g.question_id as question,
            g.evidence_run=(select id from eval_runs where area_id='area_sales'
                             order by finished_at desc limit 1) as evidence
       from gap_tests g join gaps x on x.id=g.gap_id where x.status='open'`,
    )
    expect(links).toEqual([{ question: regression.question, evidence: true }])

    await expect(seedDemo(client)).rejects.toThrow('never replaces them')
  },
)
