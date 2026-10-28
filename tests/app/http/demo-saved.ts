import pg from 'pg'
import { SAVED_TREND, savedSeed } from '@/api/mock/data/saved-questions'
import { compareSaved, type SavedAnswer } from '../../../src/domain/saved-check.ts'
import { calendarDateTypes } from '../../../src/server/db/database.ts'
import { loadServingBundle } from '../../../src/server/modules/editions/index.ts'
import { answerNow } from '../../../src/server/modules/saved-questions/index.ts'

/*
  The mockup's saved questions on the real service (data/saved-questions.ts), for the http
  journeys and the http binding's conformance: the twelve questions, each saved by the person the
  mock names, for its domain, nine weeks before the demo week. What each gets now is what the
  service's answer engine gives it on the demo week's library; what each should keep getting is
  that too, except for the three the mock shows as moved, whose saved answer is from before:

  - Why did support contacts in Norway rise in autumn 2025? It answered, Checked, from Payment
    provider switched in Norway; the engine finds nothing for it now: Needs a look.
  - What should I rule out before explaining a jump in gross margin? Its item was not out of date
    when it was saved; a definition it relies on changed since: Needs a look.
  - Why did orders in Norway drop in August? Its item said less when it was saved (the mock's
    saved words): Changed.

  The service's own comparison (src/domain/saved-check.ts) gives each result, in one run of the
  check job this morning, and the weeks before have the mock's chart: how many answered as saved.
*/

const DAY = 86_400_000

/** A mock id as the service takes it: `itm_` and 8 to 16 letters or digits. */
const serverItemId = (id: string) => `itm_${id.slice(4).replace(/[^a-z0-9]/g, '')}`

export async function seedSavedQuestions(
  databaseUrl: string,
  today: string,
  personId: (name: string) => string,
) {
  // Calendar days as the service reads them, for the answer engine.
  const client = new pg.Client({ connectionString: databaseUrl, types: calendarDateTypes })
  await client.connect()
  try {
    await seed(client, today, personId)
  } finally {
    await client.end()
  }
}

async function seed(client: pg.Client, today: string, personId: (name: string) => string) {
  const query = async <T>(sql: string, values?: unknown[]) =>
    (await client.query(sql, values)).rows as T[]
  const [head] = await query<{ seq: string; label: string; overlay: string }>(
    `select e.seq::text, e.label, coalesce((select seq::text from serving_overlay),'0') as overlay
       from editions e join live_edition l on l.seq = e.seq`,
  )
  const bundle = await loadServingBundle({ query }, head!)
  // An item as agents got it when it was live: the last version it had, archived or not.
  const item = async (id: string) => {
    const [found] = await query<{ title: string; summary: string }>(
      'select title, summary from item_versions where item_id = $1 order by version_no desc limit 1',
      [id],
    )
    if (!found) throw new Error(`No item ${id} in the demo week`)
    return { id, title: found.title, summary: found.summary, unverified: null }
  }
  // Monday of the demo week, and the Mondays before it.
  const monday = new Date(`${today}T00:00:00Z`)
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  const week = (back: number) => new Date(monday.getTime() - back * 7 * DAY)

  const archived = await item(serverItemId('itm_kh4llvi9'))
  const seeded = savedSeed.map((q, n) => {
    const factId = serverItemId(q.factId)
    const now = answerNow(bundle, q.question, today)
    let saved: SavedAnswer = now
    if (q.id === 'sq-support-norway')
      saved = { state: 'grounded', items: [archived], say: 'Checked.' }
    else if (q.id === 'sq-gross-margin')
      saved = { ...now, items: now.items.map((i) => ({ ...i, unverified: null })) }
    else if (q.id === 'sq-norway-august')
      saved = {
        ...now,
        items: now.items.map((i) => (i.id === factId ? { ...i, summary: q.diff!.saved } : i)),
      }
    const expect = saved.items.some((i) => i.id === factId)
      ? [factId]
      : saved.items.map((i) => i.id)
    const { result, reason } = compareSaved(saved, now, expect)
    if (result !== q.result)
      throw new Error(`${q.id} is ${result} on the service, ${q.result} in the mock`)
    // The first in the mock's list is the newest.
    const created = new Date(week(9).getTime() - n * 60_000)
    return { q, now, saved, expect, result, reason, created }
  })

  const run = (trigger: string, at: Date, total: number) =>
    query<{ id: string }>(
      `insert into check_runs (trigger, edition, overlay, day, total, checked, started_at, finished_at)
       values ($1, $2, $3, $4, $5, $5, $6, $6) returning id::text`,
      [trigger, head!.seq, head!.overlay, at.toISOString().slice(0, 10), total, at.toISOString()],
    ).then((rows) => rows[0]!.id)

  const ids: { question: string; baseline: string }[] = []
  for (const s of seeded) {
    const by = personId(s.q.savedBy)
    const [q] = await query<{ id: string }>(
      `insert into saved_questions (area_id, question, origin, expect_items, created_by, created_at)
       values ($1, $2, 'ask', $3, $4, $5) returning id::text`,
      [`area_${s.q.domain}`, s.q.question, s.expect, by, s.created.toISOString()],
    )
    const [b] = await query<{ id: string }>(
      `insert into saved_question_baselines (question_id, answer, edition, why, kept_by, kept_at)
       values ($1, $2, $3, 'saved', $4, $5) returning id::text`,
      [q!.id, JSON.stringify(s.saved), head!.seq, by, s.created.toISOString()],
    )
    ids.push({ question: q!.id, baseline: b!.id })
  }
  const result = (
    run: string,
    n: number,
    r: string,
    reason: string,
    answer: SavedAnswer,
    at: Date,
  ) =>
    query(
      `insert into saved_question_results (run_id, question_id, baseline_id, result, reason, answer, checked_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        run,
        ids[n]!.question,
        ids[n]!.baseline,
        r,
        reason,
        JSON.stringify(answer),
        at.toISOString(),
      ],
    )

  // Each week before the demo week: as many answered as saved as the mock's chart has.
  for (const [w, same] of SAVED_TREND.same.slice(0, -1).entries()) {
    const at = new Date(week(SAVED_TREND.same.length - 1 - w).getTime() + 2 * DAY + 9 * 3600_000)
    const id = await run('publish', at, seeded.length)
    for (const [n, s] of seeded.entries())
      if (n < seeded.length - same) await result(id, n, 'changed', 'words', s.now, at)
      else await result(id, n, 'same', 'same', s.saved, at)
  }
  // This morning's run, after the last publish: what the service's comparison says now.
  const at = new Date()
  const id = await run('publish', at, seeded.length)
  for (const [n, s] of seeded.entries()) await result(id, n, s.result, s.reason, s.now, at)
}
