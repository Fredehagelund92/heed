import type { DevPerson } from '../../src/server/modules/auth/dev-sign-in.ts'
import { createClient, type HeedClient } from '../../src/cli/client.ts'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { shiftDate } from '../../src/domain/validity.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createDatabase } from '../../src/server/db/database.ts'
import type { JobRunner } from '../../src/server/modules/jobs/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'

/*
  The practice domain (`practice`): invented, clearly labelled content to learn and show the
  workflow on, so nothing invented is ever said about a real metric. Its vocabulary is its own
  (an invented bakery's kiosks: every key starts with `practice_`), and every title says
  "Practice". It holds proposals in every state, gaps in every status and a few editions.

  The seed writes through the service's own API, in this process, as invented people of the
  practice domain, so every step passes the same checks, guards and history log as a person
  would. It therefore suits any migrated local database, empty or not: it adds the domain and
  touches nothing else. The domain is set up by the first administrator of the dev people file
  (CL_DEV_PEOPLE_FILE). Every item is low risk, so nothing waits for a paid answer test.
  Running it again on a database that has the finished domain changes nothing. The gap on
  kiosk visits (MARKER_METRIC) is the last write, and gaps are never deleted, so a domain without
  a gap on it, in any status, is a seed that stopped half way, and a rerun says so.
*/

import { PRACTICE_AREA } from '../../src/domain/practice.ts'
export { PRACTICE_AREA }
const ORIGIN = 'http://127.0.0.1'
/** The seed's last write reports a gap on this metric, in any status: with it, the seed ran to the end. */
const MARKER_METRIC = 'metric:practice_kiosk_visits'
/** Why the history log shows each setup step. */
const SEEDED =
  'Practice domain seed (npm run seed -- --practice): invented content for practice and demos'

/** The practice domain's invented people. Add them to the dev people file to sign in as them. */
export const practicePeople = {
  owner: { email: 'practice.owner@example.test', name: 'Practice Owner (invented)' },
  secondOwner: {
    email: 'practice.second-owner@example.test',
    name: 'Practice Second Owner (invented)',
  },
  approver: { email: 'practice.approver@example.test', name: 'Practice Approver (invented)' },
  contributor: {
    email: 'practice.contributor@example.test',
    name: 'Practice Contributor (invented)',
  },
} as const satisfies Record<string, { email: string; name: string }>
type Persona = keyof typeof practicePeople

/** The invented vocabulary: two metrics, one dimension and its three values. */
const terms = [
  {
    key: 'metric:practice_loaves_baked',
    kind: 'metric',
    parentKey: null,
    name: 'Loaves baked (practice)',
    aliases: ['Practice loaves'],
  },
  {
    key: 'metric:practice_kiosk_visits',
    kind: 'metric',
    parentKey: null,
    name: 'Kiosk visits (practice)',
    aliases: ['Practice footfall'],
  },
  {
    key: 'dim:practice_kiosk',
    kind: 'dimension',
    parentKey: null,
    name: 'Kiosk (practice)',
    aliases: [],
  },
  ...(
    [
      ['north_pier', 'North Pier'],
      ['old_town', 'Old Town'],
      ['station', 'Station'],
    ] as const
  ).map(([value, name]) => ({
    key: `val:practice_kiosk/${value}`,
    kind: 'dimension_value' as const,
    parentKey: 'dim:practice_kiosk',
    name: `${name} (practice)`,
    aliases: [],
  })),
] as const

const kiosk = (value: 'north_pier' | 'old_town' | 'station') => ({
  dimension: 'dim:practice_kiosk',
  value: `val:practice_kiosk/${value}`,
})
const INVENTED =
  'Invented for the practice domain: it describes no real metric, market, partner or person.'

/** The practice items, written relative to the seed's day so they stay current after a reset. */
function practiceDrafts(today: string) {
  const day = (offset: number) => shiftDate(today, offset)
  const evidence = (offset: number, quote: string) => [
    { url: 'https://example.test/practice/bakery-log', quote, date: day(offset) },
  ]
  const note = (draft: Draft): Draft => ({
    kind: 'note',
    riskLevel: 'low',
    claimLevel: 'fact_only',
    notToConclude: 'Practice content: do not draw conclusions about any real metric',
    body: INVENTED,
    ...draft,
  })
  return {
    ovenRepair: note({
      kind: 'issue',
      title: 'Practice: Old Town oven repair lowers loaves baked',
      summary:
        'The Old Town kiosk bakes on one oven while the other is repaired, so loaves baked there are lower than usual.',
      scope: {
        metrics: ['metric:practice_loaves_baked'],
        dimensions: [],
        dimensionValues: [kiosk('old_town')],
      },
      validity: { start: day(-10), end: day(20) },
      reviewDate: null,
      evidence: evidence(-10, 'Old Town runs on one oven until the repair is done'),
    }),
    countingChange: note({
      title: 'Practice: kiosk visits counted by door sensor from this month',
      summary:
        'Kiosk visits come from a door sensor instead of a hand count, so they are not comparable with the months before.',
      scope: { metrics: ['metric:practice_kiosk_visits'], dimensions: [], dimensionValues: [] },
      validity: { start: day(-40), end: null },
      reviewDate: day(60),
      evidence: evidence(-40, 'Door sensors replaced the hand count at every kiosk'),
    }),
    stationClosed: note({
      kind: 'event',
      title: 'Practice: Station kiosk closed for a platform rebuild',
      summary:
        'The Station kiosk was closed for a week while the platform was rebuilt, so it shows no loaves and no visits then.',
      scope: {
        metrics: ['metric:practice_loaves_baked', 'metric:practice_kiosk_visits'],
        dimensions: [],
        dimensionValues: [kiosk('station')],
      },
      validity: { start: day(-30), end: day(-23) },
      reviewDate: null,
      evidence: evidence(-30, 'Station kiosk closed for the platform rebuild'),
    }),
    holidayHours: note({
      title: 'Practice: North Pier keeps holiday hours on public holidays',
      summary:
        'North Pier opens only in the morning on public holidays, so visits there drop on those days.',
      scope: {
        metrics: ['metric:practice_kiosk_visits'],
        dimensions: [],
        dimensionValues: [kiosk('north_pier')],
      },
      validity: { start: day(-90), end: null },
      reviewDate: day(45),
      evidence: evidence(-90, 'North Pier keeps morning hours on public holidays'),
    }),
    // Proposals that stay open or end without an acceptance.
    sourdough: note({
      title: 'Practice: sourdough loaves count twice in loaves baked',
      summary:
        'A sourdough loaf is logged once when shaped and once when baked, so it counts twice.',
      scope: { metrics: ['metric:practice_loaves_baked'], dimensions: [], dimensionValues: [] },
      validity: { start: day(-20), end: null },
      reviewDate: day(70),
      evidence: evidence(-20, 'The log records sourdough at shaping and again at baking'),
    }),
    weather: note({
      title: 'Practice: rainy days lower kiosk visits',
      summary: 'Fewer people visit the kiosks on rainy days.',
      scope: { metrics: ['metric:practice_kiosk_visits'], dimensions: [], dimensionValues: [] },
      validity: { start: day(-15), end: null },
      reviewDate: day(75),
      evidence: evidence(-15, 'Visits looked lower on the rainy days we noticed'),
    }),
    newKiosk: note({
      title: 'Practice: a fourth kiosk is planned',
      summary: 'A fourth kiosk may open next year; it has no data yet.',
      scope: { metrics: ['metric:practice_kiosk_visits'], dimensions: [], dimensionValues: [] },
      validity: { start: day(-5), end: null },
      reviewDate: day(85),
      evidence: evidence(-5, 'A fourth kiosk is being considered'),
    }),
    flourDelivery: note({
      kind: 'issue',
      title: 'Practice: late flour delivery at North Pier',
      summary: 'A late flour delivery means North Pier bakes fewer loaves this week.',
      scope: {
        metrics: ['metric:practice_loaves_baked'],
        dimensions: [],
        dimensionValues: [kiosk('north_pier')],
      },
      validity: { start: day(-2), end: day(5) },
      reviewDate: null,
      evidence: evidence(-2, 'The flour delivery to North Pier is late this week'),
    }),
    tillUpgrade: note({
      title: 'Practice: till upgrade at Old Town',
      summary: 'Old Town gets a new till; visits are counted the same way.',
      scope: {
        metrics: ['metric:practice_kiosk_visits'],
        dimensions: [],
        dimensionValues: [kiosk('old_town')],
      },
      validity: { start: day(3), end: null },
      reviewDate: day(90),
      evidence: evidence(-1, 'Old Town gets a new till next week'),
    }),
  }
}

/** The service's scheduled jobs stay off: the seed only writes. */
const noJobs: JobRunner = {
  start: () => Promise.resolve(),
  stop: () => Promise.resolve(),
  runNow: () => Promise.resolve({ outcome: 'not_running' }),
  overview: () => Promise.reject(new Error('Jobs do not run in the practice seed')),
}

export class PracticeHalfSeededError extends Error {
  constructor() {
    super('The practice domain is half-seeded: run the reset command, then seed again')
  }
}

export type PracticeSeed = {
  /** False when the database had the practice domain already: nothing was changed. */
  seeded: boolean
  proposals: Record<string, number>
  gaps: Record<string, number>
  editions: number
}

/**
 * Seeds the practice domain through the API at `url` (a running service, or the in-process one
 * `seedPractice` starts). `admin` is an administrator's email in the service's dev people file;
 * the practice people must be in it too.
 */
export async function seedPracticeThrough(
  url: string,
  admin: string,
  today: string,
): Promise<PracticeSeed> {
  const sessions = {} as Record<Persona | 'admin', { client: HeedClient; id: string }>
  const emails: [Persona | 'admin', string][] = [
    ['admin', admin],
    ...(Object.keys(practicePeople) as Persona[]).map(
      (who) => [who, practicePeople[who].email] as [Persona, string],
    ),
  ]
  for (const [who, email] of emails) {
    const connection = createClient({ url, origin: ORIGIN })
    const person = await connection.signIn(email)
    sessions[who] = { client: connection.client, id: person.id }
  }
  const as = (who: Persona | 'admin') => sessions[who].client
  const empty: PracticeSeed = { seeded: false, proposals: {}, gaps: {}, editions: 0 }
  if ((await as('admin').areas.list()).some((area) => area.id === PRACTICE_AREA)) {
    const gaps = await as('owner').gaps.list({ areaId: PRACTICE_AREA })
    if (gaps.some((gap) => gap.topic.metrics.includes(MARKER_METRIC))) return empty
    throw new PracticeHalfSeededError()
  }
  const newestEdition = async () => (await as('admin').editions.list({ limit: 1 }))[0]?.seq ?? 0
  const editionsBefore = await newestEdition()

  await as('admin').areas.create({
    id: PRACTICE_AREA,
    name: 'Practice (invented)',
    label: 'stone',
    reviewDays: 5,
    chatChannel: null,
    ownerTeam: 'Practice team (invented)',
    summary: 'An invented bakery with three kiosks: loaves baked and kiosk visits, to practise on.',
    description: `Practice is an invented domain for learning Heed. It follows a small bakery with three kiosks (North Pier, Old Town and Station) and two numbers: **loaves baked** and **kiosk visits**, each by kiosk.

Everything in it is made up and every title says "Practice", so propose, review, retire and report gaps here freely. Never quote it as a fact about the business.`,
    reason: SEEDED,
    team: {
      ownerIds: [sessions.owner.id, sessions.secondOwner.id],
      approverIds: [sessions.approver.id],
    },
  })

  // The vocabulary: proposed by the owner, decided by the administrator (no Cube definition).
  for (const term of terms) {
    const proposal = await as('owner').vocabulary.propose({
      ...term,
      aliases: [...term.aliases],
      areaId: PRACTICE_AREA,
      definitionRefs: [],
    })
    await as('admin').review.decide({
      id: proposal.id,
      revision: proposal.revision,
      outcome: 'accept',
      reason: 'Practice vocabulary, invented',
    })
  }

  const drafts = practiceDrafts(today)
  const create = (who: Persona, draft: Draft, itemId?: string) =>
    as(who).proposals.create({ draft, ...(itemId ? { itemId } : {}) })
  const submit = async (who: Persona, draft: Draft, itemId?: string) => {
    const created = await create(who, draft, itemId)
    return as(who).proposals.submit({ id: created.id, revision: created.revision })
  }
  const decide = async (
    who: Persona,
    p: ProposalRecord,
    outcome: 'accept' | 'request_changes' | 'reject',
    reason: string,
  ) => {
    const { proposal } = await as(who).review.get({ id: p.id })
    return (await as(who).review.decide({ id: p.id, revision: proposal.revision, outcome, reason }))
      .proposal
  }

  // Accepted: four items, each its own edition, and a second version of one of them.
  const accepted = []
  for (const [draft, by] of [
    [drafts.ovenRepair, 'owner'],
    [drafts.countingChange, 'owner'],
    [drafts.stationClosed, 'secondOwner'],
    [drafts.holidayHours, 'owner'],
  ] as const) {
    const p = await submit('contributor', draft)
    accepted.push(await decide(by, p, 'accept', 'Matches the bakery log'))
  }
  const ovenItem = accepted[0]!.itemId!
  const repaired = await submit(
    'contributor',
    {
      ...drafts.ovenRepair,
      summary:
        'The Old Town kiosk bakes on one oven while the other is repaired, so loaves baked there are lower than usual. The repair is booked for the end of the window.',
    },
    ovenItem,
  )
  accepted.push(await decide('owner', repaired, 'accept', 'The repair date is confirmed'))

  // Rejected, with a reason.
  const rejected = await decide(
    'owner',
    await submit('contributor', drafts.weather),
    'reject',
    'A cause without evidence: the log does not record the weather',
  )
  // Changes requested.
  const changes = await decide(
    'owner',
    await submit('contributor', drafts.sourdough),
    'request_changes',
    'Name the day the logging changed, and link the log entry',
  )
  // In review: the owner has taken it.
  const inReview = await submit('contributor', drafts.flourDelivery)
  const claimed = await as('owner').proposals.claim({
    id: inReview.id,
    revision: inReview.revision,
  })
  // Submitted, waiting for a reviewer.
  const waiting = await submit('contributor', drafts.tillUpgrade)
  // Withdrawn by its author.
  const toWithdraw = await submit('contributor', drafts.newKiosk)
  const withdrawn = await as('contributor').proposals.withdraw({
    id: toWithdraw.id,
    revision: toWithdraw.revision,
    reason: 'Too early: nothing is decided about a fourth kiosk',
  })
  // A draft the contributor has not sent yet.
  const draft = await create('contributor', {
    ...drafts.sourdough,
    title: 'Practice: sourdough counts twice (rewritten)',
  })

  // Gaps, reported by people about scopes with nothing documented: one open, one resolved, one
  // set aside.
  const window = { from: shiftDate(today, -7), to: today }
  const report = (
    scope: { metric: string; kiosk?: 'north_pier' | 'old_town' | 'station' },
    note: string,
  ) =>
    as('contributor').gaps.report({
      metrics: [scope.metric],
      ...(scope.kiosk
        ? {
            dimension_filters: [
              { dimension: 'dim:practice_kiosk', values: [`val:practice_kiosk/${scope.kiosk}`] },
            ],
          }
        : {}),
      window,
      type: 'missing',
      note,
    })
  const resolved = await report(
    { metric: 'metric:practice_loaves_baked', kiosk: 'north_pier' },
    'Practice: North Pier baked fewer loaves this week',
  )
  const setAside = await report(
    { metric: 'metric:practice_loaves_baked', kiosk: 'station' },
    'Practice: what did Station bake on its first day?',
  )
  await as('owner').gaps.addNote({
    id: resolved.id,
    note: 'Practice: the late flour delivery note is under review',
  })
  await as('owner').gaps.setStatus({
    id: resolved.id,
    status: 'resolved',
    reason: 'Covered by the late flour delivery note under review',
  })
  await as('owner').gaps.setStatus({
    id: setAside.id,
    status: 'wont_fix',
    reason: 'Before the bakery log started: nothing to document',
  })
  await report(
    { metric: MARKER_METRIC, kiosk: 'station' },
    'Practice: why did Station visits jump last week?',
  )

  const states = [...accepted, rejected, changes, claimed, waiting, withdrawn, draft].reduce<
    Record<string, number>
  >((counts, p) => ({ ...counts, [p.state]: (counts[p.state] ?? 0) + 1 }), {})
  const editions = (await newestEdition()) - editionsBefore
  return {
    seeded: true,
    proposals: states,
    gaps: { open: 1, resolved: 1, wont_fix: 1 },
    editions,
  }
}

/**
 * Starts the service in this process on a free loopback port, on `databaseUrl` as the API role,
 * and seeds the practice domain through it.
 */
export async function seedPractice(options: {
  databaseUrl: string
  people: readonly DevPerson[]
  today?: string
}): Promise<PracticeSeed> {
  const admin = options.people.find((person) => person.roles.includes('administrator'))
  if (!admin)
    throw new Error('The dev people file needs an administrator to set up the practice domain')
  const clock = systemClock(options.today)
  const database = createDatabase(options.databaseUrl, createLogger({ level: 'silent' }))
  const known = new Set(options.people.map((person) => person.email))
  const app = buildApp({
    database,
    jobs: noJobs,
    logger: createLogger({ level: 'silent' }),
    clock,
    origins: [ORIGIN],
    devPeople: [
      ...options.people,
      ...Object.values(practicePeople)
        .filter((person) => !known.has(person.email))
        .map((person) => ({ ...person, roles: [] })),
    ],
  })
  try {
    const url = await app.listen({ host: '127.0.0.1', port: 0 })
    return await seedPracticeThrough(url, admin.email, clock.today())
  } finally {
    // Closing the app closes its database too.
    await app.close()
  }
}
