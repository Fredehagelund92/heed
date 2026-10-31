import { expect, it } from 'vitest'
import { bulkSeed } from '../../db/seed/bulk.ts'
import { seedDemo } from '../../db/seed/demo.ts'
import { loadStory, norwayStop } from '../../db/seed/story.ts'
import { demoTestQuestions } from '../../db/seed/test-questions.ts'
import { gapFixtures } from '../../db/seed/fixtures/gaps.ts'
import { generateItems, regression } from '../../db/seed/fixtures/items.ts'
import { testDatabase } from './support.ts'

const { client, url } = testDatabase()

/*
  The demo's quality history on the bulk seed (db/seed/demo.ts). The seed checks its own story
  (every weekly run passes but the newest Sales one, which fails the regression on its
  note), so a change to the library or to get_facts that breaks it fails here. Then the demo's
  present (db/seed/story.ts): what the README shows a new install.
*/
it(
  'adds weekly runs, retrieval passes, gaps and the linked regression to the bulk seed, then the present',
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

    // Its present (db/seed/story.ts), as a new install gets it: what the README shows.
    expect(await loadStory(url)).toMatchObject({ items: 3, suggestions: 3 })
    const { rows: norway } = await client.query<{ id: string; area: string }>(
      `select id, area_id as area from v_item_list where title = $1 and status = 'accepted'`,
      [norwayStop.title],
    )
    expect(norway.map((item) => item.area)).toEqual(['area_sales'])
    const { rows: present } = await client.query<{
      waiting: string[]
      conflicts: number
      gap: string
      ask: boolean
      saved: number
      alert: string[]
    }>(
      `select (select array_agg(action::text order by action::text) from proposals
                where state = 'submitted' and area_id = 'area_sales') as waiting,
              (select count(*)::int from item_version_conflicts c join item_version_service s
                  on s.version_id = c.version_id and upper_inf(s.editions)) as conflicts,
              (select status::text from gaps where topic_id = (select id from topics
                where key = 'area_sales|metric:orders|val:market/norway|2026-10')) as gap,
              exists (select 1 from setup_marks where step = 'ask') as ask,
              (select count(*)::int from saved_questions) as saved,
              (select array_agg(rule) from alert_raises) as alert`,
    )
    expect(present).toEqual([
      {
        waiting: ['change', 'create', 'retire'],
        conflicts: 1,
        gap: 'resolved',
        ask: true,
        saved: 2,
        alert: ['disagree'],
      },
    ])
    // What agents asked: every answer line the README names, from the apps people use, and the
    // README's question about orders in Norway answered Checked with the Norway item first.
    const { rows: calls } = await client.query<{
      states: string[]
      families: string[]
      norway: { state: string; first: string }[]
    }>(
      `select (select array_agg(distinct answer_state order by answer_state) from deliveries
                where answer_state is not null) as states,
              (select array_agg(distinct app_family order by app_family) from mcp_requests
                where tool <> 'protocol') as families,
              (select jsonb_agg(distinct jsonb_build_object('state', d.answer_state, 'first', d.delivered->0->>'id'))
                 from deliveries d join topics t on t.id = d.topic_id
                where t.key = 'area_sales|metric:orders|val:market/norway|2026-10') as norway`,
    )
    expect(calls[0]!.states).toEqual(expect.arrayContaining(['conflict', 'grounded', 'missing']))
    expect(calls[0]!.families).toEqual(['chatgpt', 'claude_ai', 'claude_code', 'cursor'])
    expect(calls[0]!.norway).toEqual([{ state: 'grounded', first: norway[0]!.id }])
  },
)
