import { summaryWords } from '@domain/obs-summary-words'
import { summaryPeriod } from '@domain/obs-summary'
import type { Domain } from '@/model/people'
import type { Snapshot, SnapshotItem, SummaryData } from '@/model/obs-summary'
import { ApiError } from '../errors'
import type { ObsData as Fixture } from './obs-engine'
import { obsSummary } from './obs-summary'
import type { Reader } from './obs-page'

// Summary's monthly snapshots as the mock binding keeps them: the demo's August and September,
// taken on the first of the month after, as the nightly job would have, for every domain together
// and for each domain. With the review flag ?snapshot=due the job has not taken September yet, so
// an admin can take it; one taken is kept for this visit. A snapshot keeps the Summary's counts as
// they were, what is open and what changed as counts alone, and the sentences said then, as the
// service keeps them.

const DAY = 86_400_000
const iso = (at: number) => new Date(at).toISOString().slice(0, 10)
const atOf = (day: string) => Date.parse(`${day}T00:00:00Z`)

/** A Summary as a snapshot keeps it: no list of topics or changes, and its words said now. */
function frozen(data: SummaryData): Pick<Snapshot, 'data' | 'words'> {
  const kept: SummaryData = {
    ...data,
    open: { total: data.open.total, spots: [] },
    changes: { ...data.changes, latest: [] },
  }
  const words =
    data.state === 'normal'
      ? summaryWords(kept)
      : { sentences: [] as string[], caught: [], notes: [] as string[] }
  return { data: kept, words }
}

/** What the snapshots are read over: the demo's days, its domains, and the review flag. */
export type SnapshotWorld = { fixture: Fixture; domains: Domain[]; due: boolean }

export function createSnapshots() {
  let kept: Snapshot[] | null = null
  let keptFor = ''
  let count = 0

  /** The last whole month's snapshots as of `today`, for every scope that has none yet. */
  function take(fixture: Fixture, domains: Domain[], today: string): number {
    const now = summaryPeriod('month', today).now
    const scopes = [undefined, ...domains.filter((d) => !d.sandbox).map((d) => d.id)]
    let taken = 0
    for (const domain of scopes) {
      const all = kept ?? []
      if (all.some((s) => s.now.start === atOf(now.start) && s.domain === domain)) continue
      const reader: Reader = { admin: true, owns: [] }
      const data = obsSummary(
        fixture,
        { period: 'month', ...(domain ? { domain } : {}) },
        reader,
        today,
      )
      if (data.state === 'empty') continue
      all.push({
        id: `snapshot-${++count}`,
        ...(domain ? { domain } : {}),
        now: data.now,
        takenOn: atOf(today),
        state: data.state,
        ...frozen(data),
      })
      kept = all
      taken++
    }
    return taken
  }

  /** The snapshots kept, the demo's months first taken once for its state. */
  function all({ fixture, domains, due }: SnapshotWorld): Snapshot[] {
    const key = `${fixture.state}|${due}`
    if (!kept || keptFor !== key) {
      kept = []
      keptFor = key
      const month = new Date(fixture.last + DAY)
      // The first of this month and of the one before: the job took the month before each.
      const firsts = (due ? [-1] : [-1, 0]).map((n) =>
        iso(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + n, 1)),
      )
      for (const day of firsts) take(fixture, domains, day)
    }
    return kept
  }

  const readable = (s: Snapshot, reader: Reader) =>
    reader.admin || (!!s.domain && reader.owns.includes(s.domain))

  const itemOf = ({ data: _data, words: _words, ...item }: Snapshot): SnapshotItem => item

  return {
    list(world: SnapshotWorld, reader: Reader, domain?: string): SnapshotItem[] {
      if (!reader.admin && !reader.owns.length)
        throw new ApiError('forbidden', 'Observability is for the owners of a domain and admins.')
      return all(world)
        .filter((s) =>
          domain ? s.domain === domain : reader.admin ? !s.domain : readable(s, reader),
        )
        .filter((s) => readable(s, reader))
        .sort((a, b) => b.now.start - a.now.start || (a.domain ?? '').localeCompare(b.domain ?? ''))
        .map(itemOf)
    },
    get(world: SnapshotWorld, reader: Reader, id: string): Snapshot | null {
      const found = all(world).find((s) => s.id === id)
      return found && readable(found, reader) ? found : null
    },
    take(world: SnapshotWorld, reader: Reader) {
      if (!reader.admin) throw new ApiError('forbidden', 'Only an admin takes a snapshot.')
      all(world)
      const today = iso(world.fixture.last + DAY)
      const { now } = summaryPeriod('month', today)
      return {
        now: { start: atOf(now.start), end: atOf(now.end) },
        taken: take(world.fixture, world.domains, today),
      }
    },
  }
}
