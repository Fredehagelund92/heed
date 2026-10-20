/**
 * The inbox and live stream side of the `ContextApi` conformance suite (slice W7): who hears
 * about a step of review in their inbox, what each person's stream carries, replay after
 * `Last-Event-ID` and reset, and reading and archiving. The same steps run against the mock
 * binding (tests/unit/mock-live.test.ts) and against the http binding on the real service, its
 * relay and PostgreSQL (tests/integration/api-live.test.ts), so the mock keeps the service's
 * rules (migrations 0021 and 0023, src/server/modules/notifications).
 *
 * Maria writes; Jon is owner of Sandbox and reviews; Kofi has no role.
 */
import { afterAll, describe, expect, it } from 'vitest'
import type { InboxItem, ProposalRecord, StreamEvent } from '../../src/web/api/client.ts'
import { ApiError } from '../../src/web/api/errors.ts'
import type { SignedIn } from './context-api-writes.ts'

export type LiveConformanceOptions = {
  /** The binding's id for a fixture person, for example `per_maria`. */
  personId: (fixtureId: string) => string
  /** Waits until every event written so far has reached the inboxes and the streams. */
  settle: () => Promise<void>
}

/** Reads a stream in the background, so a test can wait for what it expects. */
function reader(open: Promise<AsyncIterable<StreamEvent>>) {
  const seen: StreamEvent[] = []
  const waiting = new Set<() => void>()
  let ended = false
  const wake = () => {
    for (const resolve of waiting) resolve()
  }
  void (async () => {
    try {
      for await (const event of await open) {
        seen.push(event)
        wake()
      }
    } catch {
      // Closed by the test.
    } finally {
      ended = true
      wake()
    }
  })()
  return {
    seen,
    /** Resolves once the events so far satisfy `done`; fails after `ms`. */
    async until(done: (events: StreamEvent[]) => boolean, ms = 8_000): Promise<StreamEvent[]> {
      const deadline = Date.now() + ms
      while (!done(seen) && !ended && Date.now() < deadline)
        await new Promise<void>((resolve) => {
          const go = () => {
            waiting.delete(go)
            resolve()
          }
          waiting.add(go)
          setTimeout(go, 50)
        })
      expect(done(seen), JSON.stringify(seen.map((event) => event.topic))).toBe(true)
      return [...seen]
    },
  }
}

const about = (id: string) => (event: StreamEvent) => event.subject?.id === id

export function describeContextApiLive(
  name: string,
  getApis: () => SignedIn,
  { personId, settle }: LiveConformanceOptions,
) {
  const as = (person: 'maria' | 'jon' | 'kofi') => getApis()[person]
  const id = (person: 'maria' | 'jon' | 'kofi') => personId(`per_${person}`)
  const streams: AbortController[] = []
  const open = (person: 'maria' | 'jon' | 'kofi', lastEventId?: string) => {
    const controller = new AbortController()
    streams.push(controller)
    return reader(
      as(person).streamEvents({
        ...(lastEventId === undefined ? {} : { lastEventId }),
        signal: controller.signal,
      }),
    )
  }
  afterAll(() => {
    for (const controller of streams) controller.abort()
  })

  const inboxAbout = async (person: 'maria' | 'jon' | 'kofi', proposalId: string) =>
    (await as(person).listInbox({ limit: 100 })).items.filter(
      (item) => item.subject.id === proposalId,
    )

  describe(`ContextApi inbox and live stream conformance: ${name}`, () => {
    let ready: StreamEvent
    let maria: ReturnType<typeof reader>
    let proposal: ProposalRecord

    it('opens a stream with stream.ready at the newest event', async () => {
      maria = open('maria')
      ready = (await maria.until((events) => events.length > 0))[0]!
      expect(ready).toMatchObject({ topic: 'stream.ready', subject: null, inbox: false })
      expect(Number.isInteger(ready!.id)).toBe(true)
    })

    it("puts a submitted proposal in the owner's inbox, not the writer's", async () => {
      const created = await as('maria').createProposal({
        draft: {
          areaId: 'area_sandbox',
          title: 'Norway closure for live updates',
          summary: 'Online sales to Norway stopped',
          scope: {
            metrics: ['metric:orders'],
            dimensions: [],
            dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
          },
          validity: { start: '2026-08-04', end: null },
          evidence: [
            { url: 'https://example.test/law', quote: 'Online sales stopped', date: '2026-08-04' },
          ],
        },
      })
      proposal = await as('maria').submitProposal({ id: created.id, revision: created.revision })
      await settle()
      const [item] = await inboxAbout('jon', proposal.id)
      expect(item).toMatchObject({
        kind: 'proposal.submitted',
        subject: { type: 'proposal', id: proposal.id },
        state: 'submitted',
        title: 'Norway closure for live updates',
        actor: { id: id('maria') },
        note: null,
        readAt: null,
        archivedAt: null,
      })
      expect(await inboxAbout('maria', proposal.id)).toEqual([])
      expect(await inboxAbout('kofi', proposal.id)).toEqual([])
    })

    it("carries the writer's own steps on their stream, ids and states only", async () => {
      const events = await maria.until((seen) =>
        seen.some((event) => event.topic === 'proposal.submitted' && about(proposal.id)(event)),
      )
      const mine = events.filter(about(proposal.id))
      expect(mine.map((event) => event.topic).slice(0, 2)).toEqual([
        'proposal.created',
        'proposal.submitted',
      ])
      expect(mine[1]).toMatchObject({
        areaId: 'area_sandbox',
        subject: { type: 'proposal', id: proposal.id },
        payload: { id: proposal.id, state: 'submitted', revision: proposal.revision },
        inbox: false,
      })
      // Relay order: every id is larger than the one before.
      const ids = events.map((event) => event.id)
      expect(ids).toEqual([...ids].sort((a, b) => a - b))
    })

    it('tells the writer when the owner claims, on the stream and in the inbox', async () => {
      const claimed = await as('jon').claimProposal({
        id: proposal.id,
        revision: proposal.revision,
      })
      await settle()
      const events = await maria.until((seen) =>
        seen.some((event) => event.topic === 'proposal.claimed' && about(proposal.id)(event)),
      )
      expect(events.find((event) => event.topic === 'proposal.claimed')).toMatchObject({
        payload: { id: proposal.id, state: 'in_review', revision: claimed.revision },
        inbox: true,
      })
      const [item] = await inboxAbout('maria', proposal.id)
      expect(item).toMatchObject({
        kind: 'proposal.claimed',
        state: 'in_review',
        actor: { id: id('jon') },
      })
      proposal = claimed
    })

    it('replays exactly the events after Last-Event-ID', async () => {
      const replay = open('maria', String(ready.id))
      const live = maria.seen.slice(1)
      const replayed = await replay.until((seen) => seen.length >= live.length)
      expect(replayed.slice(0, live.length).map((event) => [event.id, event.topic])).toEqual(
        live.map((event) => [event.id, event.topic]),
      )
      // The owner's replay holds the submission that reached their inbox.
      const jon = open('jon', String(ready.id))
      const seen = await jon.until((events) =>
        events.some((event) => event.topic === 'proposal.claimed' && about(proposal.id)(event)),
      )
      expect(
        seen.find((event) => event.topic === 'proposal.submitted' && about(proposal.id)(event)),
      ).toMatchObject({ inbox: true })
    })

    it('hides a proposal from someone with no role in its area', async () => {
      const kofi = open('kofi', String(ready.id))
      const own = await as('kofi').createProposal({
        draft: { areaId: 'area_sandbox', summary: 'A draft of Kofi’s own' },
      })
      await settle()
      const seen = await kofi.until((events) => events.some(about(own.id)))
      expect(seen.filter(about(proposal.id))).toEqual([])
    })

    it('says stream.reset for an event it does not know', async () => {
      const head = maria.seen.at(-1)!.id
      for (const lastEventId of ['999999999', 'not-a-number']) {
        const [first] = await open('maria', lastEventId).until((events) => events.length > 0)
        expect(first).toMatchObject({ topic: 'stream.reset', subject: null, inbox: false })
        expect(first!.id).toBeGreaterThanOrEqual(head)
      }
    })

    it('tells the writer the decision, with the state it left and why', async () => {
      await as('jon').decide({
        id: proposal.id,
        revision: proposal.revision,
        outcome: 'request_changes',
        reason: 'Add the regulator notice',
      })
      await settle()
      const items = await inboxAbout('maria', proposal.id)
      expect(items.map((item) => [item.kind, item.state, item.note])).toEqual([
        ['proposal.decided', 'changes_requested', 'Add the regulator notice'],
        ['proposal.claimed', 'in_review', null],
      ])
      // The reason is in the inbox only: the event on the stream carries ids and states.
      const events = await maria.until((seen) =>
        seen.some((event) => event.topic === 'proposal.decided' && about(proposal.id)(event)),
      )
      expect(
        JSON.stringify(events.find((event) => event.topic === 'proposal.decided')),
      ).not.toContain('regulator')
    })

    it('reads, archives and pages the inbox, and tells the other tabs the count', async () => {
      const before = await as('maria').listInbox()
      const [decided, claimed] = (await inboxAbout('maria', proposal.id)) as [InboxItem, InboxItem]
      expect(before.unread).toBeGreaterThanOrEqual(2)

      const read = await as('maria').markInboxRead({ ids: [claimed.id] })
      expect(read).toEqual({ changed: 1, unread: before.unread - 1 })
      expect(await as('maria').markInboxRead({ ids: [claimed.id] })).toEqual({
        changed: 0,
        unread: before.unread - 1,
      })
      await settle()
      const events = await maria.until((seen) =>
        seen.some((event) => event.topic === 'inbox.changed'),
      )
      expect(events.find((event) => event.topic === 'inbox.changed')).toMatchObject({
        subject: { type: 'inbox' },
        payload: { unread: before.unread - 1 },
      })

      const archived = await as('maria').archiveInbox({ ids: [decided.id] })
      expect(archived).toEqual({ changed: 1, unread: before.unread - 2 })
      expect((await inboxAbout('maria', proposal.id)).map((item) => item.id)).toEqual([claimed.id])
      const [stored] = (await as('maria').listInbox({ filter: 'archived' })).items.filter(
        (item) => item.id === decided.id,
      )
      expect(stored?.archivedAt).not.toBeNull()
      expect(stored?.readAt).not.toBeNull()
      expect(
        (await as('maria').listInbox({ filter: 'unread' })).items.some(
          (item) => item.id === claimed.id || item.id === decided.id,
        ),
      ).toBe(false)

      const all = await as('maria').markAllInboxRead()
      expect(all.unread).toBe(0)
      expect((await as('maria').markAllInboxRead()).changed).toBe(0)

      const first = await as('maria').listInbox({ limit: 1 })
      expect(first.items).toHaveLength(1)
      if (first.nextBefore) {
        const next = await as('maria').listInbox({ limit: 1, before: first.nextBefore })
        expect(next.items[0]!.id < first.items[0]!.id).toBe(true)
      }
    })

    it('refuses ids that are not inbox ids', async () => {
      for (const ids of [[], ['not-a-uuid']]) {
        const error = await as('maria')
          .markInboxRead({ ids })
          .then(
            () => null,
            (failure: unknown) => failure,
          )
        expect(error).toBeInstanceOf(ApiError)
        expect(error).toMatchObject({ kind: 'bad-request' })
      }
    })
  })
}
